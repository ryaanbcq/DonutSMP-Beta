import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formater, nomSalon, peutRenommer, FENETRE } from '../src/compteurs/logique.js';

test('compteurs : chiffre formate et place dans le modele', () => {
  assert.equal(formater(1234567), '1 234 567');
  assert.equal(formater(-3), '0');
  assert.equal(nomSalon('👥 Membres : {nombre}', 1520), '👥 Membres : 1 520');
  assert.equal(nomSalon('Joueurs', 7), 'Joueurs 7');
  assert.equal(nomSalon('x'.repeat(120), 1).length, 100);
});

test('compteurs : deux renommages au plus par 10 min', () => {
  const now = 100 * FENETRE;
  assert.equal(peutRenommer([], now).ok, true);
  assert.equal(peutRenommer([now - 1000, now - 2000], now).ok, false);
  assert.deepEqual(peutRenommer([now - FENETRE - 1, now - 1000], now), { ok: true, recents: [now - 1000] });
});
