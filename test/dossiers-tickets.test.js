process.env.DB_PATH = './data/test-dossiers.db';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { ChannelType } from 'discord.js';
const { reglagesTickets } = await import('../src/tickets/reglages.js');
const { parentPour } = await import('../src/tickets/manager.js');

// Faux serveur : des dossiers (categories Discord) et des salons ranges dedans.
function guilde(dossiers, salonsParDossier = {}) {
  const cache = new Map();
  for (const id of dossiers) cache.set(id, { id, type: ChannelType.GuildCategory });
  for (const [parent, n] of Object.entries(salonsParDossier))
    for (let i = 0; i < n; i++) cache.set(`${parent}-s${i}`, { id: `${parent}-s${i}`, type: ChannelType.GuildText, parentId: parent });
  cache.filter = (fn) => ({ size: [...cache.values()].filter(fn).length });
  return { channels: { cache } };
}

test('une categorie va dans son dossier, sinon le dossier general, sinon la racine', () => {
  reglagesTickets.poserDossier('general');
  const cle = reglagesTickets.poserCategorie({ nom: 'Support Technique', emoji: '🛠️' });
  reglagesTickets.poserDossierCategorie(cle, 'support');
  const c = reglagesTickets.categorie(cle);
  assert.equal(parentPour(guilde(['general', 'support']), c), 'support');
  assert.equal(parentPour(guilde(['general']), c), 'general', 'dossier supprime : repli general');
  assert.equal(parentPour(guilde(['general', 'support'], { support: 50 }), c), 'general', 'dossier plein : repli general');
  assert.equal(parentPour(guilde([]), c), null, 'rien : racine');
  assert.equal(parentPour(guilde(['general']), reglagesTickets.categorie(reglagesTickets.poserCategorie({ nom: 'Autre' }))), 'general');
});

test('modifier une categorie garde son dossier ; vider le choix revient au general', () => {
  const cle = reglagesTickets.poserCategorie({ nom: 'Middleman' });
  reglagesTickets.poserDossierCategorie(cle, 'mm');
  reglagesTickets.poserCategorie({ nom: 'Middleman', description: 'nouvelle description' });
  assert.equal(reglagesTickets.categorie(cle).dossier, 'mm');
  reglagesTickets.poserDossierCategorie(cle, '');
  assert.equal(reglagesTickets.categorie(cle).dossier, undefined);
});

test.after(() => { for (const s of ['', '-wal', '-shm']) rmSync(`./data/test-dossiers.db${s}`, { force: true }); });
