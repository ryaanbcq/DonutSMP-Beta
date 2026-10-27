import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/test-mod.db';
for (const f of ['.db', '.db-wal', '.db-shm']) rmSync('./data/test-mod' + f, { force: true });
const { refusHierarchie, registre } = await import('../src/moderation/actions.js');

const membre = (id, position, { bot = false } = {}) => ({
  id,
  user: { bot },
  permissions: { has: () => false },
  roles: { highest: { position }, cache: { has: () => false } },
});
const guild = { ownerId: 'owner' };

test('hierarchie : soi-meme, proprietaire, bot, role egal ou au-dessus refuses', () => {
  const mod = membre('mod', 10);
  assert.match(refusHierarchie({ moderateur: mod, cible: mod, guild }), /toi-même/);
  assert.match(refusHierarchie({ moderateur: mod, cible: membre('owner', 1), guild }), /propriétaire/);
  assert.match(refusHierarchie({ moderateur: mod, cible: membre('b', 1, { bot: true }), guild }), /bot/);
  assert.match(refusHierarchie({ moderateur: mod, cible: membre('x', 10), guild }), /niveau/);
  assert.equal(refusHierarchie({ moderateur: mod, cible: membre('y', 9), guild }), null);
  // Le proprietaire passe au-dessus de la hierarchie.
  assert.equal(refusHierarchie({ moderateur: membre('owner', 1), cible: membre('z', 50), guild }), null);
});

test('registre : avertissements comptes, ban temporaire pose puis retire', () => {
  assert.equal(registre.ajouterWarn('u1', { at: 1, par: 'm', raison: 'a' }), 1);
  assert.equal(registre.ajouterWarn('u1', { at: 2, par: 'm', raison: 'b' }), 2);
  assert.equal(registre.warns('u1').length, 2);
  registre.poserBanTemp('u2', { jusqua: 10, raison: 'r' });
  assert.equal(registre.bansTemp().u2.jusqua, 10);
  registre.poserBanTemp('u2', null);
  assert.equal(registre.bansTemp().u2, undefined);
});

test('permission de sanctionner : la liste d ids posee fait seule foi', async () => {
  const { peutSanctionner } = await import('../src/moderation/actions.js');
  const liste = '689896112383066156, 777943506458247198,1544749036823646341';
  assert.equal(peutSanctionner({ id: '777943506458247198' }, liste), true);
  assert.equal(peutSanctionner({ user: { id: '1544749036823646341' } }, liste), true);
  // Meme avec « Gerer le serveur », hors liste = refus.
  assert.equal(peutSanctionner({ id: '1', permissions: { has: () => true } }, liste), false);
});
