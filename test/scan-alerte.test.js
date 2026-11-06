import test from 'node:test';
import assert from 'node:assert/strict';
import { parleDeRat } from '../src/scan/alerte.js';

test('alerte rat : les vrais cas des tickets', () => {
  for (const t of [
    'ya un mec il rat des petits sur le serveur',
    'Il y a un rat a l intérieur du cheat',
    'une perssone rate des perssone pour les scamm jai tout les preuv',
    'je me suis fait ratter par un faux client',
    'ratting des petits',
    'c est silentnet ce mod',
    'attention grabber dans le jar',
    'il m a envoyé un ratz',
  ]) assert.equal(parleDeRat(t), true, t);
});

test('alerte rat : pas de faux positif sur « rater »', () => {
  for (const t of [
    "j'ai raté mon coup",
    'rate de drop nul',
    'pirate',
    'karate',
    'bravo',
    '',
  ]) assert.equal(parleDeRat(t), false, t);
});
