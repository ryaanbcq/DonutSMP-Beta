import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boostsDuMessage, compterBoosts, decisionRole } from '../src/boosts/logique.js';

test('boosts : nombre de boosts d un message systeme', () => {
  assert.equal(boostsDuMessage(''), 1);
  assert.equal(boostsDuMessage('2'), 2);
  assert.equal(boostsDuMessage('abc'), 1);
});

test('boosts : seuls les boosts du boost en cours comptent', () => {
  const debuts = new Map([['a', 1_000_000], ['b', null], ['c', 5_000_000]]);
  const msgs = [
    { auteur: 'a', at: 1_000_000, n: 1 }, { auteur: 'a', at: 2_000_000, n: 1 },
    { auteur: 'b', at: 2_000_000, n: 2 }, // ne booste plus
    { auteur: 'c', at: 1_000_000, n: 1 }, { auteur: 'c', at: 6_000_000, n: 1 }, // ancien boost retire
  ];
  const r = compterBoosts(msgs, debuts);
  assert.equal(r.get('a'), 2);
  assert.equal(r.has('b'), false);
  assert.equal(r.get('c'), 1);
});

test('boosts : role donne a 2 boosts, retire seulement s il vient du bot', () => {
  assert.equal(decisionRole({ boosts: 2, booste: true, aLeRole: false, donneParBot: false }), 'donner');
  assert.equal(decisionRole({ boosts: 1, booste: true, aLeRole: false, donneParBot: false }), null);
  assert.equal(decisionRole({ boosts: 0, booste: false, aLeRole: true, donneParBot: true }), 'retirer');
  assert.equal(decisionRole({ boosts: 0, booste: false, aLeRole: true, donneParBot: false }), null);
});
