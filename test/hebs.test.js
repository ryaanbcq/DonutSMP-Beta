import test from 'node:test';
import assert from 'node:assert/strict';
import { lireHebs } from '../src/moderation/prefixe.js';

test('+hebs / +unhebs : lecture de la commande', () => {
  assert.deepEqual(lireHebs('+hebs <@123456789012345678>'), { retirer: false, cible: '123456789012345678', cibleBrute: '<@123456789012345678>' });
  assert.equal(lireHebs('+unhebs 123456789012345678').retirer, true);
  assert.equal(lireHebs('+hebs').cible, null);
  assert.equal(lireHebs('+hebsx @a'), null);
  assert.equal(lireHebs('hebs @a'), null);
  assert.equal(lireHebs('!hebs 123456789012345678', '!').cible, '123456789012345678');
});
