import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = './data/test-dons.db';
for (const f of ['', '-wal', '-shm']) rmSync(`./data/test-dons.db${f}`, { force: true });

const { resolvePayment, startLink } = await import('../src/link/manager.js');
const { palierPour, totalDe, nomRole } = await import('../src/dons/dons.js');
const { Reversements, arrondiAffichable } = await import('../ingame/dons.js');

// ------------------------------------------------------------ cote Discord

test('un paiement au dessus des montants de /link est un don', () => {
  const r = resolvePayment({ from: 'Donateur1', amount: 6_000_000, raw: 'Donateur1 paid you $6M' });
  assert.equal(r.outcome, 'donation');
  assert.equal(r.avant, 0);
  assert.equal(r.total, 6_000_000);
  assert.equal(resolvePayment({ from: 'donateur1', amount: 50_000 }).total, 6_050_000);
});

test('un paiement de /link reste une verification, un petit paiement perdu reste « sans verification »', () => {
  const ch = startLink('uDon', 'Linkeur');
  assert.equal(resolvePayment({ from: 'Linkeur', amount: ch.amount }).outcome, 'linked');
  assert.equal(resolvePayment({ from: 'Perdu', amount: 5_000 }).outcome, 'unmatched');
  assert.equal(totalDe('Perdu'), 0);
});

test('paliers : le plus haut atteint', () => {
  const p = [5e6, 50e6, 150e6, 300e6, 500e6]; // liste arbitraire : la fonction ne depend pas des paliers configures
  assert.equal(palierPour(4_999_999, p), -1);
  assert.equal(palierPour(5e6, p), 0);
  assert.equal(palierPour(149e6, p), 1);
  assert.equal(palierPour(2e9, p), 4);
  assert.equal(nomRole(150e6), 'Donateur 150M');
});

// ------------------------------------------------------------- cote jeu

const fichier = () => join(mkdtempSync(join(tmpdir(), 'dons-')), 'dons.json');
// 2026-09-24 a 01:00 heure de Paris (UTC+2)
const NUIT = Date.UTC(2026, 8, 23, 23, 0);

test('arrondi a ce que DonutSMP affiche', () => {
  assert.equal(arrondiAffichable(12_345_678), 12_300_000);
  assert.equal(arrondiAffichable(5_230_000), 5_230_000);
  assert.equal(arrondiAffichable(1_509_000_000), 1_500_000_000);
  assert.equal(arrondiAffichable(999), 999);
});

test('reversement : une fois par jour, le cumul arrondi, le reste garde', async () => {
  const r = await new Reversements({ file: fichier(), beneficiaire: 'cctsuyo', heure: 0 }).load();
  assert.equal(r.ajouterDon({ from: 'A', amount: 12_345_678, at: 1 }), true);
  assert.equal(r.ajouterDon({ from: 'A', amount: 12_345_678, at: 1 }), false, 'meme ligne relue');
  const v = r.planifier(NUIT);
  assert.equal(v.amount, 12_300_000);
  assert.equal(v.to, 'cctsuyo');
  assert.equal(r.etat.cumul, 45_678);
  assert.equal(r.planifier(NUIT + 60_000), null, 'pas deux fois le meme jour');
});

test('reversement : rien avant l heure, rien sans beneficiaire', async () => {
  const tot = await new Reversements({ file: fichier(), beneficiaire: 'cctsuyo', heure: 5 }).load();
  tot.ajouterDon({ from: 'A', amount: 1e6, at: 1 });
  assert.equal(tot.planifier(NUIT), null);
  const sans = await new Reversements({ file: fichier(), beneficiaire: '' }).load();
  sans.ajouterDon({ from: 'A', amount: 1e6, at: 1 });
  assert.equal(sans.planifier(NUIT), null);
  assert.equal(sans.etat.cumul, 1e6);
});

test('confirmation tolerante a l arrondi, destinataire exact', async () => {
  const r = await new Reversements({ file: fichier(), beneficiaire: 'cctsuyo' }).load();
  r.ajouterDon({ from: 'A', amount: 12_300_000, at: 1 });
  const v = r.planifier(NUIT);
  r.marquer(v.id, 'sent', { sentAt: 1 });
  assert.equal(r.matchConfirmation('Autre', 12_300_000), null);
  assert.equal(r.matchConfirmation('cctsuyo', 12_000_000), null);
  assert.equal(r.matchConfirmation('CCTsuyo', 12_300_000)?.id, v.id);
});

test('un reversement parti sans confirmation passe en doute au redemarrage', async () => {
  const f = fichier();
  const r = await new Reversements({ file: f, beneficiaire: 'cctsuyo' }).load();
  r.ajouterDon({ from: 'A', amount: 2e6, at: 1 });
  const v = r.planifier(NUIT);
  r.marquer(v.id, 'sent', { sentAt: 1 });
  await r.save();
  const relu = await new Reversements({ file: f, beneficiaire: 'cctsuyo' }).load();
  assert.equal(relu.doutesAuChargement.length, 1);
  assert.equal(relu.aEnvoyer(), null, 'jamais renvoye tout seul');
  assert.equal(relu.etat.cumul, 0, 'le cumul n est pas rendu au compteur');
});
