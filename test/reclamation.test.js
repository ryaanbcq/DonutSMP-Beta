import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = mkdtempSync(join(tmpdir(), 'recl-'));
process.env.DB_PATH = join(dossier, 'bot.db');
process.env.TRACKED_FILE = join(dossier, 'tracked.json');

const { selectionnerCandidats, idDuFil, importer, rendreFiche } = await import('../src/vouch/reclamation.js');
const { db, store } = await import('../src/db.js');

const msg = (id, auteurId, texte, date, extra = {}) => ({
  id, auteurId, auteurNom: `nom-${auteurId}`, bot: false, texte, pieces: 0, date, lien: `https://x/${id}`, ...extra,
});

test('une reponse par autre membre, la plus ancienne ; ni proprio, ni bot, ni vide', () => {
  const c = selectionnerCandidats([
    msg('1', 'PROPRIO', 'post vouch ici', 1),
    msg('2', 'A', 'vouch legit 10M', 5),
    msg('3', 'A', 'encore moi', 9),
    msg('4', 'B', '', 6, { pieces: 1 }),
    msg('5', 'C', '   ', 7),
    msg('6', 'BOT', 'bienvenue', 8, { bot: true }),
    msg('7', 'D', 'deja importe', 3),
  ], ['PROPRIO'], new Set(['7']));
  assert.deepEqual(c.map((x) => x.messageId), ['2', '4']);
});

test('lien du post ou id nu', () => {
  assert.equal(idDuFil('https://discord.com/channels/111111111111111111/222222222222222222'), '222222222222222222');
  assert.equal(idDuFil('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333'), '222222222222222222');
  assert.equal(idDuFil('222222222222222222'), '222222222222222222');
  assert.equal(idDuFil('pas un lien'), null);
});

function creerRec(membre, candidats, exclus = []) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO reclamations (discord_id, fil_id, posts, candidats, exclus, cree_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(membre, 'fil', JSON.stringify([{ id: 'fil', nom: 'VOUCH', lien: 'https://x', auteur: membre }]),
    JSON.stringify(candidats), JSON.stringify(exclus), Date.now());
  return db.prepare('SELECT * FROM reclamations WHERE id = ?').get(lastInsertRowid);
}
const cand = (messageId, auteurId, date) => ({ messageId, auteurId, auteurNom: auteurId, texte: 'vouch', pieces: 0, date, lien: 'https://x' });

test('import : exclusions respectees, date d origine, pas de reimport, avis recent prioritaire', () => {
  store.setVouch('RECENT', 'M1', 1, 'avis du nouveau systeme', 4);
  const rec = creerRec('M1', [cand('m1', 'A', 1000), cand('m2', 'B', 2000), cand('m3', 'RECENT', 3000)], ['m2']);
  assert.equal(importer(rec), 1, 'A seulement : B exclu, RECENT a deja un avis');
  const avis = store.vouchAll('M1');
  const a = avis.find((v) => v.from_id === 'A');
  assert.equal(a.created_at, 1000);
  assert.equal(a.stars, null);
  assert.match(a.comment, /^\[Ancien vouch\]/);
  assert.equal(avis.find((v) => v.from_id === 'RECENT').comment, 'avis du nouveau systeme');
  assert.equal(importer(creerRec('M1', [cand('m1', 'A', 1000)])), 0, 'un message deja importe ne repasse pas');
});

test('la fiche respecte les limites Discord, meme a 100 candidats', () => {
  const beaucoup = Array.from({ length: 100 }, (_, i) => ({ ...cand(`x${i}`, `U${i}`, i), texte: 'y'.repeat(280) }));
  const f = rendreFiche(creerRec('M2', beaucoup));
  assert.ok(f.components.length <= 5);
  for (const rangee of f.components.slice(0, -1)) assert.ok(rangee.components[0].options.length <= 25);
  assert.ok(f.embeds[0].data.description.length <= 4096);
  for (const rangee of f.components.slice(0, -1)) {
    for (const o of rangee.components[0].options) {
      assert.ok(o.data.label.length <= 50);
      assert.ok(o.data.description.length <= 60);
    }
  }
  const l = rendreFiche(creerRec('M2b', beaucoup), { leger: true });
  assert.equal(l.components[0].components[0].options[0].data.description, undefined);
  assert.ok(!l.embeds[0].data.description.includes('[↗]'));
  assert.ok(JSON.stringify(l).length < JSON.stringify(f).length * 0.7);
});

test('la fiche annonce sa partie quand le post depasse 100 vouches', () => {
  const rec = { ...creerRec('M3', [cand('z1', 'U1', 1)]), partie: '2/2' };
  const f = rendreFiche(rec);
  assert.match(f.embeds[0].data.description, /Fiche 2\/2/);
  assert.equal(rendreFiche(creerRec('M4', [cand('z2', 'U2', 2)])).embeds[0].data.description.includes('Fiche'), false);
});
