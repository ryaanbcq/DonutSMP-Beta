import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

// Base de test AVANT tout import : antipub.js charge la base au premier import.
process.env.DB_PATH = './data/test-antipub.db';
for (const f of ['.db', '.db-wal', '.db-shm']) rmSync('./data/test-antipub' + f, { force: true });
const { codesInvitation, reglagesAntipub } = await import('../src/moderation/antipub.js');

test('anti-pub : liens d invitation reconnus, variantes comprises', () => {
  assert.deepEqual(codesInvitation('rejoins discord.gg/abcDEF'), ['abcDEF']);
  assert.deepEqual(codesInvitation('https://discord.com/invite/xyz-12'), ['xyz-12']);
  assert.deepEqual(codesInvitation('https://discordapp.com/invite/abc'), ['abc']);
  assert.deepEqual(codesInvitation('dsc.gg/monserv'), ['monserv']);
  assert.deepEqual(codesInvitation('viens sur .gg/serv'), ['serv']);
  assert.deepEqual(codesInvitation('discord . gg / espace'), ['espace']);
  assert.deepEqual(codesInvitation('discord.​gg/cache'), ['cache']);
  assert.deepEqual(codesInvitation('discord.gg/a1 et discord.gg/a1'), ['a1']);
});

test('anti-pub : texte normal et autres liens ignores', () => {
  assert.deepEqual(codesInvitation('salut, gg à tous'), []);
  assert.deepEqual(codesInvitation('https://youtube.com/watch?v=abc'), []);
  assert.deepEqual(codesInvitation('mon pseudo est discord_gg'), []);
  assert.deepEqual(codesInvitation(''), []);
});

test('anti-pub : reglage absent = valeur par defaut (mute au 3e en 24 h)', () => {
  assert.equal(reglagesAntipub.avantMute(), 3);
  assert.equal(reglagesAntipub.muteHeures(), 24);
  reglagesAntipub.poserSanction(0, 12);
  assert.equal(reglagesAntipub.avantMute(), 0);
});
