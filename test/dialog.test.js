import test from 'node:test';
import assert from 'node:assert/strict';
import { rendreComposant, lireDialogueStats, valeurNumerique } from '../src/minecraft/dialog.js';

// Dialogue reel renvoye par DonutSMP pour /stats, releve le 2026-09-12.
const REEL = {
  title: { color: 'white', text: 'SentiaZz' },
  body: [
    { type: 'minecraft:plain_message', contents: { player: { id: [1, 2, 3, 4] } } },
    { type: 'minecraft:plain_message', contents: { color: 'gray', text: 'Money: ', extra: [{ text: '$ ' }, { text: '10M' }] } },
    { type: 'minecraft:plain_message', contents: { color: 'gray', text: 'Kills: ', extra: [{ text: '72' }] } },
    { type: 'minecraft:plain_message', contents: { color: 'gray', text: 'Deaths: ', extra: [{ text: '184' }] } },
    { type: 'minecraft:plain_message', contents: { color: 'gray', text: 'Playtime: ', extra: [{ text: '4d 7h ' }] } },
  ],
};

test('aplatit un composant et ses extras dans l ordre', () => {
  assert.equal(rendreComposant({ text: 'Money: ', extra: [{ text: '$ ' }, { text: '10M' }] }), 'Money: $ 10M');
  assert.equal(rendreComposant('brut'), 'brut');
  assert.equal(rendreComposant(null), '');
});

test('lit la fiche du dialogue reel', () => {
  const r = lireDialogueStats(REEL);
  assert.equal(r.nom, 'SentiaZz');
  assert.deepEqual(r.lignes, { Money: '$ 10M', Kills: '72', Deaths: '184', Playtime: '4d 7h' });
});

test('la ligne sans libelle (la tete du joueur) est ignoree', () => {
  assert.equal(Object.keys(lireDialogueStats(REEL).lignes).length, 4);
});

test('un dialogue qui n est pas une fiche rend null', () => {
  assert.equal(lireDialogueStats({ title: { text: 'Autre chose' }, body: [] }), null);
  assert.equal(lireDialogueStats(null), null);
  assert.equal(lireDialogueStats({ title: { text: '' }, body: [{ contents: { text: 'Money: 1' } }] }), null);
});

test('convertit les montants abreges', () => {
  assert.equal(valeurNumerique('$ 10M'), 10_000_000);
  assert.equal(valeurNumerique('1,234'), 1234);
  assert.equal(valeurNumerique('116B'), 116_000_000_000);
  // Le temps de jeu n est pas un nombre : il reste du texte
  assert.equal(valeurNumerique('4d 7h'), null);
  assert.equal(valeurNumerique(''), null);
});
