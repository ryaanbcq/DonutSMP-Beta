import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = mkdtempSync(join(tmpdir(), 'rep-'));
process.env.DB_PATH = join(dossier, 'bot.db');
process.env.TRACKED_FILE = join(dossier, 'tracked.json');

const { startLink, resolvePayment } = await import('../src/link/manager.js');
const { delier } = await import('../src/link/unlink.js');
const { store, cleOrpheline } = await import('../src/db.js');

function lier(discordId, pseudo) {
  const ch = startLink(discordId, pseudo);
  const r = resolvePayment({ from: pseudo, amount: ch.amount });
  assert.equal(r.outcome, 'linked', `${pseudo} lie`);
}
const recus = (id) => store.vouchAll(id).map((v) => `${v.from_id}:${v.value}`).sort();

test('un signale qui relie son pseudo depuis un autre Discord garde ses signalements', async () => {
  lier('D1', 'Arnaqueur');
  store.setThread('D1', 'fil-1', 'fil-1', 'Arnaqueur');
  store.setVouch('V1', 'D1', -1, 'scam', null);
  store.setVouch('V2', 'D1', -1, 'scam aussi', null);

  await delier('D1', null);
  assert.deepEqual(recus('D1'), [], 'plus rien sous l ancien Discord');
  assert.equal(recus(cleOrpheline('Arnaqueur')).length, 2, 'garde par le pseudo');

  lier('D2', 'Arnaqueur');
  assert.deepEqual(recus('D2'), ['V1:-1', 'V2:-1'], 'le nouveau Discord herite des signalements');
  assert.equal(store.getThread('D2')?.thread_id, 'fil-1', 'et du post du forum');
});

test('un membre qui change de pseudo ne transporte pas la reputation de l ancien', async () => {
  lier('D3', 'Ancien');
  store.setVouch('V1', 'D3', 1, 'top', 5);
  await delier('D3', null);
  lier('D3', 'Nouveau');
  assert.deepEqual(recus('D3'), [], 'Nouveau part de zero');
  lier('D4', 'Ancien');
  assert.deepEqual(recus('D4'), ['V1:1'], 'l avis suit Ancien');
});

test('un vieux delie (avant ce mecanisme) rend aussi sa reputation au pseudo', () => {
  // Etat laisse par l ancien code : lien supprime, avis et post sous le Discord.
  store.setThread('D9', 'fil-9', 'fil-9', 'Legacy');
  store.setVouch('V3', 'D9', -1, 'ancien scam', null);
  lier('D10', 'Legacy');
  assert.deepEqual(recus('D10'), ['V3:-1']);
  assert.deepEqual(recus('D9'), []);
});

test('un meme auteur ne garde qu un avis, et personne ne s herite soi-meme', async () => {
  lier('D5', 'Double');
  store.setVouch('V5', 'D5', 1, 'vieux', 3);
  store.setVouch('D6', 'D5', 1, 'mon alt ?', 5);
  await delier('D5', null);
  store.setVouch('V5', cleOrpheline('Double'), 1, 'recent', 5);
  lier('D6', 'Double');
  const avis = store.vouchAll('D6');
  assert.equal(avis.filter((v) => v.from_id === 'V5').length, 1);
  assert.equal(avis.find((v) => v.from_id === 'V5').comment, 'recent');
  assert.equal(avis.some((v) => v.from_id === 'D6'), false, 'pas d auto-avis');
});

test('transfert : quand un auteur a note les deux cles, le plus recent gagne', async () => {
  store.setVouch('A', 'X', 1, 'vieil avis', 2);
  await new Promise((r) => setTimeout(r, 5));
  store.setVouch('A', 'Y', -1, 'avis recent', null);
  store.transfererReputation('X', 'Y');
  const avis = store.vouchAll('Y').filter((v) => v.from_id === 'A');
  assert.equal(avis.length, 1);
  assert.equal(avis[0].comment, 'avis recent');

  store.setVouch('B', 'Y', 1, 'ancien', 3);
  await new Promise((r) => setTimeout(r, 5));
  store.setVouch('B', 'Z', 1, 'nouveau', 5);
  store.transfererReputation('Z', 'Y');
  assert.equal(store.vouchAll('Y').find((v) => v.from_id === 'B').comment, 'nouveau');
});
