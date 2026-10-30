import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jetons, apprendre, desapprendre, probabilitePub, modeleDeDepart, MODELE_VIDE, elaguer,
} from '../src/moderation/classifieur.js';

test('jetons : accents, majuscules, ponctuation et paires de mots', () => {
  const j = jetons('Rejoignez MON Serveur !!');
  assert.ok(j.includes('rejoignez') && j.includes('serveur') && j.includes('mon_serveur'));
  assert.deepEqual(jetons('Été'), ['ete']); // accents retires
});

test('modele de depart : pub reconnue, discussion ordinaire non', () => {
  const m = modeleDeDepart();
  assert.ok(probabilitePub(m, 'venez sur mon serveur discord on recrute') > 0.95);
  assert.ok(probabilitePub(m, 'salut quelqu un pour un trade ce soir') < 0.5);
  assert.ok(probabilitePub(m, 'le bot marche pas pour mon link aidez moi') < 0.5);
});

test('trop court pour juger : 0', () => {
  assert.equal(probabilitePub(modeleDeDepart(), 'mp moi'), 0);
});

test('il apprend : une phrase signalee devient reconnue, et se desapprend', () => {
  const m = modeleDeDepart();
  const phrase = 'achetez vos spawners chez krakenshop meilleurs prix garantis';
  const avant = probabilitePub(m, phrase);
  for (let i = 0; i < 3; i += 1) apprendre(m, phrase, 'pub');
  assert.ok(probabilitePub(m, 'spawners chez krakenshop prix garantis') > Math.max(avant, 0.9));
  const docs = m.docs.pub;
  desapprendre(m, phrase, 'pub');
  assert.equal(m.docs.pub, docs - 1);
});

test('une correction « pas de la pub » fait baisser le score', () => {
  const m = modeleDeDepart();
  const phrase = 'je recrute pour ma faction sur donut venez en vocal';
  const avant = probabilitePub(m, phrase);
  for (let i = 0; i < 4; i += 1) apprendre(m, phrase, 'normal');
  assert.ok(probabilitePub(m, phrase) < avant);
});

test('elagage : le modele reste borne', () => {
  const m = MODELE_VIDE();
  for (let i = 0; i < 300; i += 1) apprendre(m, `mot${i}x unique${i}y autre${i}z`, i % 2 ? 'pub' : 'normal');
  elaguer(m, 100);
  const taille = new Set([...Object.keys(m.mots.pub), ...Object.keys(m.mots.normal)]).size;
  assert.ok(taille < 100);
});
