import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  nomVocal, nomParDefaut, sansPrefixe, bornerLimite, peutGerer, sortDuVocal, droitsManquants, droitsAccordables,
  NOM_MAX,
} from '../src/vocaux/logique.js';

const membre = (id, bits = 0n) => ({ id, permissions: new PermissionsBitField(bits) });
const entree = { owner_id: '111' };

test('vocaux : l hote, un administrateur et le staff gerent, les autres non', () => {
  assert.equal(peutGerer(membre('111'), entree), true);
  assert.equal(peutGerer(membre('222'), entree), false);
  assert.equal(peutGerer(membre('222', PermissionFlagsBits.Administrator), entree), true);
  assert.equal(peutGerer(membre('222'), entree, () => true), true);
  assert.equal(peutGerer({ id: '222', permissions: String(PermissionFlagsBits.Administrator) }, entree), true); // membre brut
  assert.equal(peutGerer(null, entree), false);
  assert.equal(peutGerer(membre('111'), null), false);
});

test('vocaux : limite entiere de 0 a 99, le reste refuse', () => {
  assert.equal(bornerLimite('0'), 0);
  assert.equal(bornerLimite(' 12 '), 12);
  assert.equal(bornerLimite('99'), 99);
  for (const v of ['100', '-1', '2.5', 'abc', '', null, '1e2']) assert.equal(bornerLimite(v), null, String(v));
});

test('vocaux : nom prefixe, sans doublon de prefixe, tronque a 90 caracteres', () => {
  assert.equal(nomVocal('  Chill   entre potes '), '🔊 Chill entre potes');
  assert.equal(nomVocal('🔊 Deja prefixe'), '🔊 Deja prefixe');
  assert.equal(nomVocal('   '), null);
  const long = nomVocal('x'.repeat(200));
  assert.equal([...long].length, NOM_MAX);
  assert.ok(long.startsWith('🔊 '));
  assert.equal(nomParDefaut('Ryan'), '🔊 Vocal de Ryan');
  assert.equal(sansPrefixe('🔊 Vocal de Ryan'), 'Vocal de Ryan');
});

test('vocaux : vide = supprime, disparu = oublie, occupe = garde', () => {
  assert.equal(sortDuVocal(null), 'oublier');
  assert.equal(sortDuVocal({ members: new Map() }), 'supprimer');
  assert.equal(sortDuVocal({ members: new Map([['1', {}]]) }), 'garder');
});

test('vocaux : droits du bot manquants et droits accordables', () => {
  const tout = new PermissionsBitField([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageRoles,
  ]);
  assert.deepEqual(droitsManquants(tout), []);
  assert.deepEqual(droitsManquants(new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageRoles])), ['Se connecter']);
  assert.equal(droitsManquants(null).length, 5);
  // Le bot n accorde que ce qu il a.
  const bot = new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]);
  assert.deepEqual(droitsAccordables(['ViewChannel', 'Connect', 'MuteMembers'], bot), [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]);
  assert.equal(droitsAccordables(['MuteMembers'], new PermissionsBitField(PermissionFlagsBits.Administrator)).length, 1);
});
