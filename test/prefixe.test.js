import test from 'node:test';
import assert from 'node:assert/strict';
import { lireCommande } from '../src/moderation/prefixe.js';

const H = 3_600_000;
const ID = '1126956881559179446';

test('prefixe : mention ou ID, duree et raison facultatives', () => {
  assert.deepEqual(lireCommande(`+ban <@${ID}> 3j pub en vocal`),
    { nom: 'ban', cible: ID, cibleBrute: `<@${ID}>`, duree: 72 * H, raison: 'pub en vocal' });
  assert.deepEqual(lireCommande(`+ban ${ID}`), { nom: 'ban', cible: ID, cibleBrute: ID, duree: null, raison: '' });
  assert.equal(lireCommande(`+mute ${ID} 1h spam`).duree, H);
  // Pas de duree reconnue : tout est la raison.
  assert.deepEqual(lireCommande(`+ban ${ID} arnaque 3 fois`).raison, 'arnaque 3 fois');
  assert.equal(lireCommande(`+ban ${ID} arnaque`).duree, null);
});

test('prefixe : warn et kick ne prennent pas de duree', () => {
  const c = lireCommande(`+warn <@!${ID}> 2h de retard`);
  assert.equal(c.duree, null);
  assert.equal(c.raison, '2h de retard');
});

test('prefixe : autres messages ignores, prefixe reglable', () => {
  assert.equal(lireCommande('salut +ban'), null);
  assert.equal(lireCommande('+bonjour'), null);
  assert.equal(lireCommande(`!ban ${ID}`), null);
  assert.equal(lireCommande(`!ban ${ID}`, '!').nom, 'ban');
  assert.equal(lireCommande(`+BAN ${ID}`).nom, 'ban');
  assert.equal(lireCommande('+ban pseudo').cible, null);
});

test('unwarn : commande reconnue, numero, tout ou le dernier par defaut', async () => {
  const { lireRetrait } = await import('../src/moderation/actions.js');
  const c = lireCommande(`+unwarn <@${ID}> 2 erreur de modo`);
  assert.equal(c.nom, 'unwarn');
  assert.equal(c.cible, ID);
  assert.equal(c.raison, '2 erreur de modo');
  assert.deepEqual(lireRetrait('', 3), { n: 3 });
  assert.deepEqual(lireRetrait('dernier', 3), { n: 3 });
  assert.deepEqual(lireRetrait('Tout', 3), { n: null });
  assert.deepEqual(lireRetrait(' 1 ', 3), { n: 1 });
  assert.ok(lireRetrait('abc', 3).erreur);
});
