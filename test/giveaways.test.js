import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';

mkdirSync('./data', { recursive: true });
rmSync('./data/test-giveaways.db', { force: true });
process.env.DB_PATH = './data/test-giveaways.db';

const { normalizeOptions, checkRules, ticketCount, drawWinners } = await import('../src/giveaways/rules.js');
const stats = await import('../src/stats/store.js');

const membre = (x = {}) => ({
  roleIds: new Set(), linked: true, vouches: 0, messages: 0, invites: 0,
  accountCreatedAt: 0, joinedAt: 0, blacklisted: false, level: 0, ...x,
});

test('giveaway : compte lie et vouchs minimum', () => {
  const o = normalizeOptions({ requireLink: true, minVouches: 3 });
  assert.match(checkRules(o, membre({ linked: false })), /lié ton compte/);
  assert.match(checkRules(o, membre({ vouches: 2 })), /3 vouch/);
  assert.equal(checkRules(o, membre({ vouches: 3 })), null);
});

test('giveaway : entrees bonus par vouchs plafonnees', () => {
  const o = normalizeOptions({ vouchStep: 5, maxVouchEntries: 2 });
  assert.equal(ticketCount(o, membre({ vouches: 7 })).total, 2);
  assert.equal(ticketCount(o, membre({ vouches: 50 })).total, 3);
});

test('giveaway : tirage sans doublon', () => {
  const w = drawWinners([{ id: 'a', weight: 1 }, { id: 'b', weight: 5 }, { id: 'c', weight: 1 }], 3);
  assert.equal(new Set(w).size, 3);
});

test('giveaway : messages minimum comptes par membre', () => {
  const g = '111111111111111111';
  stats.ajouterMembre(g, 'u1', 'messages', 3);
  stats.ajouterMembre(g, 'u1', 'messages', 2, '2026-01-01');
  assert.equal(stats.messagesDe(g, 'u1'), 5);
  assert.equal(stats.messagesDe(g, 'u2'), 0);
  assert.throws(() => stats.ajouterMembre(g, 'u1', 'drop table', 1));
  const o = normalizeOptions({ minMessages: 10 });
  assert.match(checkRules(o, membre({ messages: stats.messagesDe(g, 'u1') })), /10 messages/);
});
