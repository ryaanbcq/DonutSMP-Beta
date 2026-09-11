import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/test-link.db';
rmSync('./data/test-link.db', { force: true });
rmSync('./data/test-link.db-wal', { force: true });
rmSync('./data/test-link.db-shm', { force: true });

const { startLink, resolvePayment, cancelLink, LinkError, allocateAmount } = await import('../src/link/manager.js');
const { store, db } = await import('../src/db.js');

test('un challenge ouvre un montant unique', () => {
  const a = startLink('u1', 'Alpha');
  const b = startLink('u2', 'Beta');
  assert.notEqual(a.amount, b.amount);
  assert.ok(a.amount >= 1 && a.amount <= 1000);
});

test('le meme membre retrouve son challenge au lieu d en creer un second', () => {
  const first = startLink('u3', 'Gamma');
  const again = startLink('u3', 'Gamma');
  assert.equal(again.amount, first.amount);
  assert.equal(again.resumed, true);
});

test('un pseudo invalide est refuse', () => {
  assert.throws(() => startLink('u4', 'pseudo invalide!'), LinkError);
});

test('le bon joueur qui paie le bon montant est lie', () => {
  const ch = startLink('u10', 'Delta');
  const res = resolvePayment({ from: 'Delta', amount: ch.amount, raw: 'x' });
  assert.equal(res.outcome, 'linked');
  assert.equal(store.getLink('u10').mc_name, 'Delta');
});

test('un tiers qui paie le bon montant ne vole pas le lien', () => {
  const ch = startLink('u11', 'Epsilon');
  const res = resolvePayment({ from: 'Voleur', amount: ch.amount, raw: 'x' });
  assert.equal(res.outcome, 'unmatched');
  assert.equal(store.getLink('u11'), null);
  // le challenge reste ouvert pour le vrai proprietaire
  assert.equal(resolvePayment({ from: 'Epsilon', amount: ch.amount, raw: 'x' }).outcome, 'linked');
});

test('le bon joueur avec le mauvais montant ne valide rien', () => {
  const ch = startLink('u12', 'Zeta');
  const wrong = ch.amount === 1 ? 2 : ch.amount - 1;
  assert.equal(resolvePayment({ from: 'Zeta', amount: wrong, raw: 'x' }).outcome, 'unmatched');
  assert.equal(store.getLink('u12'), null);
});

test('la casse et le point Bedrock ne cassent pas la correspondance', () => {
  const ch = startLink('u13', '.ryaanbcq');
  assert.equal(resolvePayment({ from: 'RyaanBcq', amount: ch.amount, raw: 'x' }).outcome, 'linked');
});

test('un pseudo deja lie ne peut pas etre re-demande', () => {
  assert.throws(() => startLink('u14', 'Delta'), LinkError);
});

test('un membre deja lie doit unlink avant de relier', () => {
  assert.throws(() => startLink('u10', 'Autre'), LinkError);
});

test('un challenge expire ne vaut plus rien', () => {
  const ch = startLink('u15', 'Eta');
  assert.ok(store.getPending('u15'));
  db.prepare('UPDATE challenges SET expires_at = 1 WHERE id = ?').run(ch.id);
  assert.equal(resolvePayment({ from: 'Eta', amount: ch.amount, raw: 'x' }).outcome, 'unmatched');
});

test('annuler libere le montant', () => {
  const ch = startLink('u16', 'Theta');
  assert.equal(cancelLink('u16'), true);
  assert.equal(store.getPending('u16'), null);
});

test('allocateAmount reste dans les bornes', () => {
  for (let i = 0; i < 50; i++) {
    const n = allocateAmount();
    assert.ok(n >= 1 && n <= 1000, `montant hors bornes : ${n}`);
  }
});
