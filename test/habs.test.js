import test from 'node:test';
import assert from 'node:assert/strict';
import { lireHabs } from '../src/moderation/prefixe.js';

test('+habs / +unhabs : lecture de la commande', () => {
  assert.deepEqual(lireHabs('+habs <@123456789012345678>'), { retirer: false, cible: '123456789012345678', cibleBrute: '<@123456789012345678>' });
  assert.equal(lireHabs('+unhabs 123456789012345678').retirer, true);
  assert.equal(lireHabs('+habs').cible, null);
  assert.equal(lireHabs('+habsx @a'), null);
  assert.equal(lireHabs('habs @a'), null);
  assert.equal(lireHabs('!habs 123456789012345678', '!').cible, '123456789012345678');
});
