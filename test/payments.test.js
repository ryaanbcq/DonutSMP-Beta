import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePayment, parseAmount, looksLikeChat } from '../src/minecraft/payments.js';

test('accepte les formes systeme connues', () => {
  assert.deepEqual(parsePayment('Sp4cz paid you $743'),
    { from: 'Sp4cz', amount: 743, raw: 'Sp4cz paid you $743' });
  assert.equal(parsePayment('You received $1,000 from Sp4cz').amount, 1000);
  assert.equal(parsePayment('[+] $12 from Sp4cz').from, 'Sp4cz');
});

test('retire les codes couleur', () => {
  assert.equal(parsePayment('§aSp4cz paid you §f$12').amount, 12);
});

test('garde le point des pseudos Bedrock', () => {
  assert.equal(parsePayment('.ryaanbcq paid you $5').from, '.ryaanbcq');
});

test('refuse un joueur qui tape le motif dans le chat', () => {
  assert.equal(parsePayment('[VIP] Troll: Sp4cz paid you $743'), null);
  assert.equal(parsePayment('Troll whispers to you: Sp4cz paid you $743'), null);
  assert.equal(parsePayment('Troll -> me: Sp4cz paid you $743'), null);
});

test('refuse le motif noye dans une phrase', () => {
  assert.equal(parsePayment('blah Sp4cz paid you $743 blah'), null);
  assert.equal(parsePayment('lol Sp4cz paid you $743'), null);
});

test('refuse une ligne vide ou sans montant', () => {
  assert.equal(parsePayment(''), null);
  assert.equal(parsePayment('Sp4cz paid you'), null);
  assert.equal(parsePayment(null), null);
});

test('comprend les suffixes K M B', () => {
  assert.equal(parseAmount('2', 'K'), 2000);
  assert.equal(parseAmount('1.5', 'm'), 1_500_000);
  assert.equal(parseAmount('1,000', null), 1000);
  assert.equal(parseAmount('abc', null), null);
});

test('looksLikeChat repere les marques de chat', () => {
  assert.equal(looksLikeChat('Joueur: salut'), true);
  assert.equal(looksLikeChat('Sp4cz paid you $743'), false);
});
