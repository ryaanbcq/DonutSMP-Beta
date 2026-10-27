import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lireSaisie, ajouterRegle, retirerRegle, modifierRegle, regleVisee, evaluer, cleRegle, normaliserTag,
  lireEtat, PARAMS_DEFAUT,
} from '../src/tags/regles.js';
import { aIntentMembres, intentMembresCoche } from '../src/tags/intent.js';

const pg = (tag, identityGuildId = '111111111111111111', identityEnabled = true) => ({ tag, identityGuildId, identityEnabled });
const H = 3_600_000;
const D = PARAMS_DEFAUT.delaiMs;

test('saisie : un tag est normalise, un ID devient une regle serveur, le nom est garde', () => {
  assert.deepEqual(lireSaisie(' Sc AM '), { type: 'tag', valeur: 'scam' });
  assert.deepEqual(lireSaisie('123456789012345678', ' Arnaque X '), { type: 'serveur', valeur: '123456789012345678', nom: 'Arnaque X' });
  assert.ok(lireSaisie('').erreur);
  assert.ok(lireSaisie('BEAUCOUPTROPLONG').erreur);
  assert.equal(normaliserTag('ＳＣＡＭ'), 'scam'); // pleine chasse : meme tag
});

test('regles : pas de doublon, sanction progressive par defaut, modification, retrait', () => {
  let r = ajouterRegle([], { type: 'tag', valeur: 'scam' });
  r = ajouterRegle(r, { type: 'tag', valeur: 'scam' });
  r = ajouterRegle(r, { type: 'serveur', valeur: '222222222222222222', nom: 'X' });
  assert.equal(r.length, 2);
  assert.equal(r[0].sanction, 'progressif');
  r = modifierRegle(r, 'tag:scam', { nom: 'Arnaque', sanction: 'bannir' });
  assert.deepEqual(r[0], { type: 'tag', valeur: 'scam', nom: 'Arnaque', sanction: 'bannir' });
  r = modifierRegle(r, 'tag:scam', { nom: '', sanction: 'nimporte' });
  assert.deepEqual(r[0], { type: 'tag', valeur: 'scam', sanction: 'bannir' });
  r = retirerRegle(r, 'tag:scam');
  assert.equal(r.length, 1);
});

test('un tag vise par son texte ou par son serveur ; masque ou absent ne compte pas', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }, { type: 'serveur', valeur: '333333333333333333' }];
  assert.equal(regleVisee(pg('Scam'), regles)?.valeur, 'scam');
  assert.ok(regleVisee(pg('XYZ', '333333333333333333'), regles));
  assert.equal(regleVisee(pg('FR'), regles), null);
  assert.equal(regleVisee(pg('SCAM', '1', false), regles), null);
  assert.equal(regleVisee(null, regles), null);
});

test('progressif : avertissement, mute, ban temporaire, dernier avertissement, ban definitif', () => {
  const regles = [{ type: 'tag', valeur: 'scam', sanction: 'progressif' }];
  const tag = pg('SCAM');
  let t = 0;
  let d = evaluer({ primaryGuild: tag, regles, now: t });
  assert.equal(d.sanction, 'avertissement');
  assert.equal(d.etat.prochaine, t + D);
  let etat = d.etat;

  // Avant le delai : rien.
  d = evaluer({ primaryGuild: tag, regles, etat, now: t + D - 1 });
  assert.equal(d.action, 'rien');

  t += D; d = evaluer({ primaryGuild: tag, regles, etat, now: t });
  assert.equal(d.sanction, 'mute'); etat = d.etat;
  t += D; d = evaluer({ primaryGuild: tag, regles, etat, now: t });
  assert.equal(d.sanction, 'ban_temp'); etat = d.etat;
  // Au retour du ban temporaire, tout de suite le dernier avertissement.
  t += 7 * 24 * H; d = evaluer({ primaryGuild: tag, regles, etat, now: t });
  assert.equal(d.sanction, 'dernier_avertissement'); etat = d.etat;
  assert.equal(etat.prochaine, t + D);
  t += D; d = evaluer({ primaryGuild: tag, regles, etat, now: t });
  assert.equal(d.sanction, 'ban_def'); etat = d.etat;
  assert.equal(etat.prochaine, null);
  // Apres le ban definitif (debanni a la main par le staff) : plus rien.
  d = evaluer({ primaryGuild: tag, regles, etat, now: t + 10 * D });
  assert.equal(d.action, 'rien');
});

test('progressif : retirer le tag arrete, le remettre fait passer a l etape suivante sans delai', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  const d1 = evaluer({ primaryGuild: pg('SCAM'), regles, now: 0 });
  const leve = evaluer({ primaryGuild: pg('FR'), regles, etat: d1.etat, now: 1 * H });
  assert.equal(leve.action, 'leve');
  assert.equal(leve.etat.leveA, 1 * H);
  // Toujours sans tag, apres le delai : rien (pas de mute).
  assert.equal(evaluer({ primaryGuild: null, regles, etat: leve.etat, now: 2 * D }).action, 'rien');
  // Il le remet : mute immediat.
  const recidive = evaluer({ primaryGuild: pg('SCAM'), regles, etat: leve.etat, now: 3 * D });
  assert.equal(recidive.sanction, 'mute');
  assert.equal(recidive.etat.leveA, undefined);
});

test('progressif : casier oublie apres la periode sans tag', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  const etat = { regle: 'tag:scam', mode: 'progressif', etape: 2, prochaine: null, leveA: 0, maj: 0 };
  assert.equal(evaluer({ primaryGuild: null, regles, etat, now: PARAMS_DEFAUT.oubliMs + 1 }).action, 'oublier');
  // Oublie puis revient avec le tag : on repart de l avertissement.
  assert.equal(evaluer({ primaryGuild: pg('SCAM'), regles, etat: null, now: 0 }).sanction, 'avertissement');
});

test('sanction directe : appliquee une fois, puis rien, puis levee', () => {
  const regles = [{ type: 'tag', valeur: 'scam', sanction: 'bannir' }];
  const d = evaluer({ primaryGuild: pg('SCAM'), regles, now: 0 });
  assert.equal(d.sanction, 'bannir');
  assert.equal(evaluer({ primaryGuild: pg('SCAM'), regles, etat: d.etat, now: 1 }).action, 'rien');
  assert.equal(evaluer({ primaryGuild: pg('FR'), regles, etat: d.etat, now: 2 }).action, 'leve');
  // Changer la sanction de la regle la reapplique.
  const regles2 = [{ ...regles[0], sanction: 'role' }];
  assert.equal(evaluer({ primaryGuild: pg('SCAM'), regles: regles2, etat: d.etat, now: 3 }).sanction, 'role');
});

test('le staff exempte n est jamais sanctionne', () => {
  const regles = [{ type: 'tag', valeur: 'scam' }];
  assert.equal(evaluer({ primaryGuild: pg('SCAM'), regles, exempt: true }).action, 'rien');
});

test('ancien format du casier (simple cle) relu sans casse', () => {
  assert.deepEqual(lireEtat('tag:scam'), { regle: 'tag:scam', mode: 'ancien', maj: 0 });
  assert.equal(lireEtat(null), null);
  assert.equal(cleRegle({ type: 'tag', valeur: 'scam' }), 'tag:scam');
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

test('avertir : N avertissements espaces du delai, puis mute, puis nouveau cycle', () => {
  const regles = [{ type: 'serveur', valeur: '111111111111111111', sanction: 'avertir', nbAvert: 3, muteH: 72 }];
  const tag = pg('SURG');
  let t = 0;
  let d = evaluer({ primaryGuild: tag, regles, now: t });
  assert.equal(d.sanction, 'avertir'); assert.equal(d.avert, 1); assert.equal(d.nb, 3);
  let etat = d.etat;
  assert.equal(evaluer({ primaryGuild: tag, regles, etat, now: t + D - 1 }).action, 'rien');
  t += D; d = evaluer({ primaryGuild: tag, regles, etat, now: t }); assert.equal(d.avert, 2); etat = d.etat;
  t += D; d = evaluer({ primaryGuild: tag, regles, etat, now: t }); assert.equal(d.avert, 3); etat = d.etat;
  t += D; d = evaluer({ primaryGuild: tag, regles, etat, now: t });
  assert.equal(d.sanction, 'mute_avertir'); etat = d.etat;
  assert.equal(etat.prochaine, t + 72 * H);
  // Pendant le mute : rien ; a la fin, un nouveau cycle commence.
  assert.equal(evaluer({ primaryGuild: tag, regles, etat, now: t + 71 * H }).action, 'rien');
  d = evaluer({ primaryGuild: tag, regles, etat, now: t + 72 * H });
  assert.equal(d.sanction, 'avertir'); assert.equal(d.avert, 1);
});

test('actifs seulement : un membre muet n est ni averti ni sanctionne', () => {
  const regles = [{ type: 'tag', valeur: 'surg', sanction: 'avertir', actifs: true }];
  assert.equal(evaluer({ primaryGuild: pg('SURG'), regles, actif: false, now: 0 }).action, 'rien');
  assert.equal(evaluer({ primaryGuild: pg('SURG'), regles, actif: true, now: 0 }).sanction, 'avertir');
  // Sans l option, l activite ne compte pas.
  const tous = [{ type: 'tag', valeur: 'surg', sanction: 'avertir' }];
  assert.equal(evaluer({ primaryGuild: pg('SURG'), regles: tous, actif: false, now: 0 }).sanction, 'avertir');
});

test('reglages d une regle avertir : bornes respectees', () => {
  let r = [{ type: 'tag', valeur: 'surg', sanction: 'avertir' }];
  r = modifierRegle(r, 'tag:surg', { nbAvert: 5, muteH: 48, actifs: true });
  assert.deepEqual(r[0], { type: 'tag', valeur: 'surg', sanction: 'avertir', nbAvert: 5, muteH: 48, actifs: true });
  r = modifierRegle(r, 'tag:surg', { nbAvert: 99, muteH: 0, actifs: false });
  assert.deepEqual(r[0], { type: 'tag', valeur: 'surg', sanction: 'avertir', nbAvert: 5, muteH: 48 });
});
