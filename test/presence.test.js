import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';

const FICHIER = './data/test-status.json';
process.env.INGAME_STATUS = FICHIER;
const { presence, PERIME } = await import('../src/ingame/presence.js');

const ecrire = (etat) => writeFile(FICHIER, JSON.stringify(etat));

test('fichier absent : on considere le bot indisponible', async () => {
  await rm(FICHIER, { force: true });
  const p = await presence();
  assert.equal(p.enLigne, false);
  assert.equal(p.raison, 'jamais_demarre');
});

test('bot connecte et frais : disponible', async () => {
  await ecrire({ online: true, username: 'BlackPrizm', at: Date.now() });
  const p = await presence();
  assert.equal(p.enLigne, true);
  assert.equal(p.username, 'BlackPrizm');
});

test('bot marque hors ligne : indisponible', async () => {
  await ecrire({ online: false, username: 'BlackPrizm', at: Date.now() });
  assert.equal((await presence()).raison, 'deconnecte');
});

test('etat perime : indisponible meme si online dit oui', async () => {
  // Process tue net : le fichier reste a online:true et se fige. Sans le test
  // de fraicheur, le bot autoriserait des paiements que personne ne verrait.
  await ecrire({ online: true, username: 'BlackPrizm', at: Date.now() - PERIME - 1000 });
  const p = await presence();
  assert.equal(p.enLigne, false);
  assert.equal(p.raison, 'muet');
});

test('fichier illisible : indisponible, jamais une exception', async () => {
  await writeFile(FICHIER, 'ceci n est pas du json');
  assert.equal((await presence()).enLigne, false);
  await rm(FICHIER, { force: true });
});
