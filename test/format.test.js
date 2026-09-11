import test from 'node:test';
import assert from 'node:assert/strict';
import { shortMoney, duration } from '../src/lib/format.js';

test('les montants sont en K, M, B sans zeros inutiles', () => {
  assert.equal(shortMoney(636_000_000), '$636M');
  assert.equal(shortMoney(79_900_000), '$79.9M');
  assert.equal(shortMoney(1_250_000_000), '$1.25B');
  assert.equal(shortMoney(1_000_000), '$1M');
  assert.equal(shortMoney(12_500), '$12.5K');
});

test('en dessous du millier on garde le chiffre exact', () => {
  assert.equal(shortMoney(999), '$999');
  assert.equal(shortMoney(65), '$65');
  assert.equal(shortMoney(0), '$0');
});

test('les dettes restent lisibles', () => {
  assert.equal(shortMoney(-2_500_000), '$-2.5M');
});

test('le temps de jeu passe en jours au dela de 24 h', () => {
  assert.equal(duration(3_600_000), '1h');
  assert.equal(duration(30 * 3_600_000), '1j 6h');
});
