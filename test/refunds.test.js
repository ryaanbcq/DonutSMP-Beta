import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { RefundLedger, PENDING, SENT, PAID, FAILED, idOf } from '../ingame/refunds.js';

const FILE = './data/test-refunds.json';
const fresh = (opts = {}) => new RefundLedger({
  file: FILE, min: 1, max: 1000, dailyMax: 5000,
  delayMin: 60_000, delayMax: 120_000, random: () => 0.5, ...opts,
});

test('met en file un paiement valide avec un delai de 1 a 2 min', () => {
  const l = fresh();
  const now = Date.now();
  const { entry } = l.queue({ from: 'Sp4cz', amount: 65, receivedAt: now }, now);
  assert.equal(entry.to, 'Sp4cz');
  assert.equal(entry.amount, 65);
  assert.equal(entry.status, PENDING);
  assert.ok(entry.dueAt - now >= 60_000 && entry.dueAt - now <= 120_000);
});

test('ne rembourse jamais plus que la fourchette de link', () => {
  const l = fresh();
  assert.match(l.queue({ from: 'Sp4cz', amount: 500_000_000 }).skipped, /plafond/);
  assert.match(l.queue({ from: 'Sp4cz', amount: 0 }).skipped, /minimum/);
  assert.match(l.queue({ from: 'Sp4cz', amount: 12.5 }).skipped, /minimum/);
});

test('refuse un pseudo qui n en est pas un', () => {
  const l = fresh();
  assert.ok(l.queue({ from: 'pas un pseudo; /pay autre 1000', amount: 10 }).skipped);
  assert.ok(l.queue({ from: '', amount: 10 }).skipped);
});

test('le meme paiement ne peut pas entrer deux fois', () => {
  const l = fresh();
  const now = Date.now();
  assert.ok(l.queue({ from: 'Sp4cz', amount: 65, receivedAt: now }, now).entry);
  assert.match(l.queue({ from: 'Sp4cz', amount: 65, receivedAt: now }, now).skipped, /deja/);
});

test('deux paiements identiques a des instants differents sont deux entrees', () => {
  const l = fresh();
  const now = Date.now();
  assert.ok(l.queue({ from: 'Sp4cz', amount: 65, receivedAt: now }, now).entry);
  assert.ok(l.queue({ from: 'Sp4cz', amount: 65, receivedAt: now + 1000 }, now).entry);
});

test('le plafond journalier arrete la boucle', () => {
  const l = fresh({ dailyMax: 100 });
  const now = Date.now();
  const a = l.queue({ from: 'A', amount: 60, receivedAt: now }, now).entry;
  l.markSent(a.id);
  assert.match(l.queue({ from: 'B', amount: 60, receivedAt: now }, now).skipped, /journalier/);
});

test('un seul remboursement en vol a la fois', () => {
  const l = fresh();
  const now = Date.now() - 200_000;
  const a = l.queue({ from: 'A', amount: 10, receivedAt: now }, now).entry;
  l.queue({ from: 'B', amount: 20, receivedAt: now + 1 }, now);
  assert.equal(l.inFlight(), null);
  l.markSent(a.id);
  assert.equal(l.inFlight().id, a.id);
});

test('la confirmation retrouve la bonne entree, casse et point Bedrock compris', () => {
  const l = fresh();
  const now = Date.now();
  const e = l.queue({ from: '.ryaanbcq', amount: 42, receivedAt: now }, now).entry;
  l.markSent(e.id);
  assert.equal(l.matchConfirmation('RyaanBcq', 42)?.id, e.id);
  assert.equal(l.matchConfirmation('RyaanBcq', 41), null, 'le montant doit coller');
  assert.equal(l.matchConfirmation('QuelquUn', 42), null, 'le pseudo doit coller');
});

test('une entree payee n est plus jamais rejouee', () => {
  const l = fresh();
  const now = Date.now() - 200_000;
  const e = l.queue({ from: 'A', amount: 10, receivedAt: now }, now).entry;
  l.markSent(e.id);
  l.markPaid(e.id);
  assert.equal(l.due(), null);
  assert.equal(l.inFlight(), null);
  assert.equal(l.matchConfirmation('A', 10), null);
});

test('abandonne apres trois essais au lieu de boucler', () => {
  const l = fresh();
  const now = Date.now() - 200_000;
  const e = l.queue({ from: 'A', amount: 10, receivedAt: now }, now).entry;
  for (let i = 0; i < 3; i++) { l.markSent(e.id); l.retryOrFail(e.id); }
  assert.equal(l.entries.get(e.id).status, FAILED);
  assert.equal(l.due(), null);
});

test('un redemarrage ne renvoie pas un /pay deja parti, il attend sa confirmation', async () => {
  rmSync(FILE, { force: true });
  const l = fresh();
  const now = Date.now() - 200_000;
  const e = l.queue({ from: 'A', amount: 10, receivedAt: now }, now).entry;
  l.markSent(e.id);
  await l.save();

  const reloaded = await fresh().load();
  const back = reloaded.entries.get(e.id);
  assert.equal(back.status, PENDING, 'reprise en attente, pas en vol');
  assert.equal(back.attempts, 1, 'l essai deja consomme est conserve');
  rmSync(FILE, { force: true });
});

test('idOf est stable', () => {
  assert.equal(idOf('A', 10, 5), idOf('A', 10, 5));
  assert.notEqual(idOf('A', 10, 5), idOf('A', 11, 5));
});
