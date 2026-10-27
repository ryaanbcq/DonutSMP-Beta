import test from 'node:test';
import assert from 'node:assert/strict';
import { lireDuree, ecrireDuree, lireIdUtilisateur, MUTE_MAX_MS } from '../src/moderation/outils.js';

const M = 60_000; const H = 60 * M; const J = 24 * H;

test('durees : unites francaises et anglaises, combinaisons, nombre seul en minutes', () => {
  assert.equal(lireDuree('10m'), 10 * M);
  assert.equal(lireDuree('2h'), 2 * H);
  assert.equal(lireDuree('3j'), 3 * J);
  assert.equal(lireDuree('3d'), 3 * J);
  assert.equal(lireDuree('1sem'), 7 * J);
  assert.equal(lireDuree('1j12h'), 36 * H);
  assert.equal(lireDuree(' 1 j 12 h '), 36 * H);
  assert.equal(lireDuree('45'), 45 * M);
  assert.equal(lireDuree('30min'), 30 * M);
});

test('durees : illisibles ou nulles refusees', () => {
  for (const x of ['', 'abc', '3x', 'h2', '0m', '3j abc', null]) assert.equal(lireDuree(x), null, String(x));
  assert.ok(lireDuree('29j') > MUTE_MAX_MS);
});

test('durees ecrites en clair', () => {
  assert.equal(ecrireDuree(3 * J), '3 jours');
  assert.equal(ecrireDuree(36 * H), '1 jour 12 h');
  assert.equal(ecrireDuree(2 * H + 30 * M), '2 h 30 min');
  assert.equal(ecrireDuree(10 * M), '10 min');
});

test('unban : ID brut ou mention', () => {
  assert.equal(lireIdUtilisateur('1126956881559179446'), '1126956881559179446');
  assert.equal(lireIdUtilisateur('<@1126956881559179446>'), '1126956881559179446');
  assert.equal(lireIdUtilisateur('<@!1126956881559179446>'), '1126956881559179446');
  assert.equal(lireIdUtilisateur('@pseudo'), null);
  assert.equal(lireIdUtilisateur('123'), null);
});
