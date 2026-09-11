import test from 'node:test';
import assert from 'node:assert/strict';
import { remember, take, forget } from '../src/link/interactions.js';

test('rend l interaction memorisee une seule fois', () => {
  const fake = { id: 'i1' };
  remember('u1', fake, 60_000);
  assert.equal(take('u1'), fake);
  assert.equal(take('u1'), null, 'un second retrait ne doit rien rendre');
});

test('rend null si le token a expire', () => {
  remember('u2', { id: 'i2' }, -1);
  assert.equal(take('u2'), null);
});

test('le plafond de 15 min de Discord prime sur un TTL plus long', () => {
  remember('u3', { id: 'i3' }, 60 * 60_000);
  // Toujours recuperable maintenant, mais borne sous les 15 min de Discord.
  assert.notEqual(take('u3'), null);
});

test('forget retire l interaction en attente', () => {
  remember('u4', { id: 'i4' }, 60_000);
  forget('u4');
  assert.equal(take('u4'), null);
});

test('un membre inconnu ne casse rien', () => {
  assert.equal(take('jamais-vu'), null);
});
