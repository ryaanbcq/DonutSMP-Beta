import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerSuperviseur } from '../ingame/superviseur.js';
import { rapportKick, oublierRapports } from '../ingame/rapport-kick.js';
import { diagnostiquerKick } from '../ingame/diagnostic.js';

async function registreVide() {
  const d = await mkdtemp(join(tmpdir(), 'comptes-'));
  process.env.BOT_ACCOUNTS_FILE = join(d, 'comptes.json');
  process.env.BOT_ACCOUNTS_DIR = join(d, 'msa');
  process.env.BOT_ACCOUNT_FILE = join(d, 'compte.json');
  process.env.MC_EMAIL = 'bot@exemple.fr';
  process.env.MC_PROFILES_FOLDER = join(d, 'msa-cache');
  await writeFile(process.env.BOT_ACCOUNT_FILE, JSON.stringify({ nom: 'DonutSMP_FR' }));
  return import(`../src/ingame/comptes.js?t=${Date.now()}${Math.random()}`);
}

test('sans registre, le compte du .env est le compte actif unique', async () => {
  const m = await registreVide();
  const reg = m.lireRegistre();
  assert.equal(reg.comptes.length, 1);
  assert.equal(m.compteActif(reg).nom, 'DonutSMP_FR');
  assert.equal(m.compteActif(reg).cle, 'bot@exemple.fr');
});

test('ajouter ne change pas le compte actif, switch oui, remove refuse le compte actif', async () => {
  const m = await registreVide();
  m.ajouterCompte({ nom: 'Secours_FR', cle: 'k', dossier: m.dossierPour('secours_fr'), par: 'ryan' });
  assert.equal(m.compteActif().nom, 'DonutSMP_FR');
  assert.equal(m.lireRegistre().comptes.length, 2);
  m.activerCompte('Secours_FR');
  assert.equal(m.compteActif().nom, 'Secours_FR');
  assert.throws(() => m.retirerCompte('secours_fr'), /compte actif/);
  assert.equal(m.retirerCompte('donutsmp_fr').nom, 'DonutSMP_FR');
  assert.deepEqual(m.lireRegistre().comptes.map((c) => c.id), ['secours_fr']);
});

test('relancerMaintenant annule la relance de 30 min deja programmee (pas de double connexion)', () => {
  const minuteurs = [];
  let connexions = 0;
  const s = creerSuperviseur({ connecter: () => { connexions += 1; }, minuteur: (fn, ms) => minuteurs.push({ fn, ms }) });
  s.nouvelleGeneration();
  assert.equal(s.relancer('ban', undefined, 30 * 60_000), 30 * 60_000);
  s.relancerMaintenant('bascule');
  for (const m of minuteurs) m.fn();
  assert.equal(connexions, 1, 'seule la relance immediate part');
  assert.equal(minuteurs.at(-1).ms, 0);
});

test('compte rendu IA : un seul appel par motif, ban reconnu meme sans regle', async () => {
  oublierRapports();
  let appels = 0;
  const appeler = async ({ contenu }) => {
    appels += 1;
    assert.match(contenu, /Texte complet/);
    return { type: 'compte_bloque', ban: true, gravite: 'err', resume: 'Compte mis en attente.', que_faire: 'Ticket.', fin: null };
  };
  const diag = diagnostiquerKick('Something brand new happened to your account');
  assert.equal(diag.bloquant, false, 'les regles ne le voient pas');
  const r1 = await rapportKick(diag, { compte: 'X' }, { appeler, dispo: () => true });
  const r2 = await rapportKick(diag, { compte: 'X' }, { appeler, dispo: () => true });
  assert.equal(r1.ban, true);
  assert.equal(r2, r1);
  assert.equal(appels, 1);
  assert.equal(await rapportKick(diagnostiquerKick('autre'), {}, { appeler, dispo: () => false }), null, 'sans cle : rien');
});

test('/bot auth : accès total seulement (Peut tout faire, propriétaire), pas le rôle admin du bot', async () => {
  const { aAccesTotal } = await import('../src/commands/bot.js');
  const regle = { membres: ['10', '11', '12'], roles: ['900'] };
  const m = (id, roles = [], admin = false) => ({ id, guild: { ownerId: '1' }, roles, permissions: { has: () => admin } });
  assert.equal(aAccesTotal(m('11'), regle), true, 'superuser listé');
  assert.equal(aAccesTotal(m('50', ['900']), regle), true, 'rôle Peut tout faire');
  assert.equal(aAccesTotal(m('1'), regle), true, 'propriétaire');
  assert.equal(aAccesTotal(m('50', ['777'], true), regle), false, 'Administrateur non listé : refusé une fois la liste réglée');
  assert.equal(aAccesTotal(m('50', [], true), { membres: [], roles: [] }), true, 'rien de réglé : Administrateur passe');
  assert.equal(aAccesTotal(m('50'), { membres: [], roles: [] }), false);
});
