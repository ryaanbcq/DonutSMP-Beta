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

test('tolere l espace apres le dollar, comme DonutSMP l ecrit vraiment', () => {
  // Ligne relevee en production le 2026-09-11 sur donutsmp.net
  assert.deepEqual(parsePayment('SentiaZz paid you $ 24'),
    { from: 'SentiaZz', amount: 24, raw: 'SentiaZz paid you $ 24' });
  assert.equal(parsePayment('SentiaZz paid you $ 1,000').amount, 1000);
  assert.equal(parsePayment('You received $ 50 from SentiaZz').amount, 50);
  // L ancrage tient toujours malgre la souplesse ajoutee
  assert.equal(parsePayment('[VIP] Troll: SentiaZz paid you $ 24'), null);
});

test('reponses de /balance relevees en production', async () => {
  const { parseBalance } = await import('../src/minecraft/payments.js');
  // Formats releves sur donutsmp.net le 2026-09-11
  assert.deepEqual(parseBalance('SentiaZz has $ 79.9M'),
    { name: 'SentiaZz', amount: 79_900_000, raw: 'SentiaZz has $ 79.9M' });
  assert.equal(parseBalance('Accoutrement_ has $ 636M').amount, 636_000_000);
  assert.equal(parseBalance('You have $ 18,818,277').soi, true);
  assert.equal(parseBalance('That player does not exist').inconnu, true);
  // Un joueur qui tape la phrase dans le chat ne fixe pas un solde
  assert.equal(parseBalance('[VIP] Troll: SentiaZz has $ 5B'), null);
});

test('une reponse de /balance porte son pseudo et se suffit a elle meme', async () => {
  const { parseBalance } = await import('../src/minecraft/payments.js');
  // C est ce qui permet d accepter une reponse arrivee en retard : le nom est
  // dedans, aucune correspondance avec la demande en cours n est necessaire.
  const lu = parseBalance('DrDonutt has $ 116B');
  assert.equal(lu.name, 'DrDonutt');
  assert.equal(lu.amount, 116_000_000_000);
  // A l inverse « That player does not exist » ne porte aucun nom : elle ne
  // vaut que rattachee a la demande en cours.
  assert.deepEqual(parseBalance('That player does not exist'), { inconnu: true });
});
