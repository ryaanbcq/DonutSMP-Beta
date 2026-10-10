import test from 'node:test';
import assert from 'node:assert/strict';
import { calculerTrust, etoiles, barre, SEUIL_TRUSTED } from '../src/vouch/trust.js';

const now = Date.now();
const vouch = (stars, il = 0) => ({ value: 1, stars, created_at: now - il * 86_400_000 });
const scam = (il = 0) => ({ value: -1, stars: null, created_at: now - il * 86_400_000 });

test('un seul 5 etoiles ne bat pas quarante avis a 4.8', () => {
  const seul = calculerTrust([vouch(5)]);
  const beaucoup = calculerTrust([...Array(32).fill(vouch(5)), ...Array(8).fill(vouch(4))]);
  assert.ok(beaucoup.score > seul.score, `${beaucoup.score} doit depasser ${seul.score}`);
  assert.equal(seul.palier.nom, 'Nouveau', 'moins de 10 avis = nouveau');
});

test('paliers : dix 5 etoiles = Trusted, quarante = Legende', () => {
  const dix = calculerTrust(Array(10).fill(vouch(5)));
  assert.ok(dix.score >= SEUIL_TRUSTED && dix.trusted, `dix 5★ → ${dix.score}`);
  assert.equal(dix.palier.nom, 'Trusted');
  assert.equal(calculerTrust(Array(40).fill(vouch(5))).palier.nom, 'Légende');
});

test('un scam pese trois avis, deux scams = Signale quoi qu il arrive', () => {
  const propre = calculerTrust(Array(10).fill(vouch(5)));
  const tache = calculerTrust([...Array(10).fill(vouch(5)), scam()]);
  assert.ok(tache.score < propre.score - 10, `${tache.score} vs ${propre.score}`);
  assert.equal(tache.trusted, false);
  const signale = calculerTrust([...Array(50).fill(vouch(5)), scam(), scam()]);
  assert.equal(signale.palier.nom, 'Signalé');
  assert.equal(signale.trusted, false);
});

test('un vieux scam pese moins qu un scam d hier', () => {
  const recent = calculerTrust([...Array(10).fill(vouch(5)), scam(1)]);
  const vieux = calculerTrust([...Array(10).fill(vouch(5)), scam(400)]);
  assert.ok(vieux.score > recent.score);
});

test('sans etoiles (ancien avis), un vouch vaut 5', () => {
  assert.equal(calculerTrust([vouch(null)]).moyenne, 5);
});

test('etoiles et barre', () => {
  assert.equal(etoiles(3.4), '★★★☆☆');
  assert.equal(etoiles(0), '☆☆☆☆☆');
  assert.equal(barre(100), '██████████');
  assert.equal(barre(0), '░░░░░░░░░░');
  assert.equal(barre(50, 4), '██░░');
});

test('un scam pese au moins 10 % des avis positifs sur un gros profil', () => {
  const vieux = Date.now() - 200 * 86_400_000;
  const t = calculerTrust([...Array(99).fill({ value: 1, stars: 5 }), { value: -1, stars: null, created_at: vieux }]);
  assert.ok(t.score <= 92, `99 x 5★ + 1 scam ancien → ${t.score}, il ne doit plus noyer le scam`);
});

test('un seul scam recent ne plafonne pas un gros profil', () => {
  const t = calculerTrust([...Array(99).fill({ value: 1, stars: 5 }), { value: -1, stars: null }]);
  assert.ok(t.score > 80 && t.score < 94, `99 x 5★ + 1 scam recent → ${t.score}`);
});

test('un profil signale n affiche plus de score', async () => {
  const { ligneScore } = await import('../src/vouch/trust.js');
  const t = calculerTrust([...Array(50).fill({ value: 1, stars: 5 }), { value: -1, stars: null }, { value: -1, stars: null }]);
  assert.match(ligneScore(t), /suspendu/);
  assert.doesNotMatch(ligneScore(t), /\/ 100/);
});
