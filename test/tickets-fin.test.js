import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionInactivite, DELAI_INACTIF as J } from '../src/tickets/fin-logique.js';

const now = 10 * J;
test('inactivite : le membre a ecrit en dernier, on attend le staff', () => {
  assert.equal(decisionInactivite({ messages: [{ role: 'staff', at: 0 }, { role: 'membre', at: 1 }], now }), 'rien');
  assert.equal(decisionInactivite({ messages: [], now }), 'rien');
});
test('inactivite : 24 h apres la reponse du staff ou du support, avertissement', () => {
  assert.equal(decisionInactivite({ messages: [{ role: 'membre', at: 0 }, { role: 'ia', at: now - J }], now }), 'avertir');
  assert.equal(decisionInactivite({ messages: [{ role: 'staff', at: now - J + 1000 }], now }), 'rien');
});
test('inactivite : quelqu un parle apres l avertissement, on annule', () => {
  const avertiAt = now - 1000;
  assert.equal(decisionInactivite({ messages: [{ role: 'staff', at: 0 }, { role: 'staff', at: now - 10 }], avertiAt, now }), 'annuler');
  assert.equal(decisionInactivite({ messages: [{ role: 'staff', at: 0 }, { role: 'ia', at: now - 10 }], avertiAt, now }), 'attendre');
});
test('inactivite : 24 h de plus sans un mot, suppression', () => {
  assert.equal(decisionInactivite({ messages: [{ role: 'staff', at: 0 }], avertiAt: now - J, now }), 'supprimer');
});
