import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lireSaisie, ajouterRegle, retirerRegle, regleVisee, decision, cleRegle, normaliserTag,
} from '../src/tags/regles.js';
import { aIntentMembres, intentMembresCoche } from '../src/tags/intent.js';

const pg = (tag, identityGuildId = '111111111111111111', identityEnabled = true) => ({ tag, identityGuildId, identityEnabled });

test('saisie : un tag est normalise, un ID devient une regle serveur', () => {
  assert.deepEqual(lireSaisie(' Sc AM '), { type: 'tag', valeur: 'scam' });
  assert.deepEqual(lireSaisie('123456789012345678'), { type: 'serveur', valeur: '123456789012345678' });
  assert.ok(lireSaisie('').erreur);
  assert.ok(lireSaisie('BEAUCOUPTROPLONG').erreur);
  assert.equal(normaliserTag('ＳＣＡＭ'), 'scam'); // pleine chasse : meme tag
});

test('regles : pas de doublon, retrait par cle', () => {
  let r = ajouterRegle([], { type: 'tag', valeur: 'scam' });
  r = ajouterRegle(r, { type: 'tag', valeur: 'scam' });
  r = ajouterRegle(r, { type: 'serveur', valeur: '222222222222222222' });
  assert.equal(r.length, 2);
  r = retirerRegle(r, 'tag:scam');
  assert.deepEqual(r, [{ type: 'serveur', valeur: '222222222222222222' }]);
});

test('un tag vise par son texte, quelle que soit la casse', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  assert.equal(regleVisee(pg('SCAM'), regles)?.valeur, 'scam');
  assert.equal(regleVisee(pg('Scam'), regles)?.valeur, 'scam');
  assert.equal(regleVisee(pg('FR'), regles), null);
});

test('un tag vise par son serveur, meme renomme', () => {
  const regles = [{ type: 'serveur', valeur: '333333333333333333' }];
  assert.ok(regleVisee(pg('XYZ', '333333333333333333'), regles));
  assert.equal(regleVisee(pg('XYZ', '444444444444444444'), regles), null);
});

test('un tag masque par le membre ne compte pas, ni l absence de tag', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  assert.equal(regleVisee(pg('SCAM', '1', false), regles), null);
  assert.equal(regleVisee(null, regles), null);
  assert.equal(regleVisee({ tag: null, identityGuildId: null, identityEnabled: null }, regles), null);
});

test('decision : sanction une fois, puis rien, puis levee', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  const cle = cleRegle(regles[0]);
  assert.equal(decision({ primaryGuild: pg('SCAM'), regles }).action, 'sanctionner');
  assert.equal(decision({ primaryGuild: pg('SCAM'), regles, deja: cle }).action, 'rien');
  assert.equal(decision({ primaryGuild: pg('FR'), regles, deja: cle }).action, 'leve');
  assert.equal(decision({ primaryGuild: pg('FR'), regles }).action, 'rien');
});

test('decision : le staff exempte n est jamais sanctionne', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  assert.equal(decision({ primaryGuild: pg('SCAM'), regles, exempt: true }).action, 'rien');
});

test('decision : une nouvelle regle resanctionne un membre deja vu pour une autre', () => {
  const regles = [{ type: 'serveur', valeur: '111111111111111111' }];
  assert.equal(decision({ primaryGuild: pg('SCAM'), regles, deja: 'tag:scam' }).action, 'sanctionner');
});

test('intent Server Members : lu dans les drapeaux de l application', async () => {
  assert.equal(aIntentMembres({ flags: 1 << 15 }), true);
  assert.equal(aIntentMembres({ flags: 1 << 14 }), true);
  assert.equal(aIntentMembres({ flags: 1 << 19 }), false); // Message Content seul
  const repondre = (corps, ok = true) => async () => ({ ok, json: async () => corps });
  assert.equal(await intentMembresCoche('t', { fetch: repondre({ flags: 1 << 15 }) }), true);
  assert.equal(await intentMembresCoche('t', { fetch: repondre({ flags: 0 }) }), false);
  assert.equal(await intentMembresCoche('t', { fetch: repondre({}, false) }), false);
  assert.equal(await intentMembresCoche('t', { fetch: async () => { throw new Error('reseau'); } }), false);
  assert.equal(await intentMembresCoche(''), false);
});
