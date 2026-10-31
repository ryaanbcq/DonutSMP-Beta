import test from 'node:test';
import assert from 'node:assert/strict';
import { lireLienMedal } from '../src/vouch/video.js';

test('lien Medal : clips acceptes, nettoyes de leurs parametres', () => {
  assert.equal(lireLienMedal('https://medal.tv/games/minecraft/clips/jQ2kD0/aBcD?invite=cr-xyz&v=1'),
    'https://medal.tv/games/minecraft/clips/jQ2kD0/aBcD');
  assert.equal(lireLienMedal('medal.tv/clips/abc123'), 'https://medal.tv/clips/abc123');
  assert.equal(lireLienMedal('https://www.medal.tv/clip/abc123/'), 'https://medal.tv/clip/abc123');
});

test('lien Medal : autres sites et pages refuses', () => {
  for (const x of ['', 'https://youtube.com/watch?v=abc', 'https://medal.tv/', 'https://evilmedal.tv/clips/a',
    'https://medal.tv.evil.com/clips/a', 'pas un lien']) assert.equal(lireLienMedal(x), null, x);
});
