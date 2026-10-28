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

test('permission de sanctionner : par role choisi, et admins du bot quand rien n est choisi', async () => {
  const { peutSanctionner } = await import('../src/moderation/actions.js');
  const avecRole = { id: '5', roles: { cache: { has: (r) => r === 'modos' } }, permissions: { has: () => false } };
  assert.equal(peutSanctionner(avecRole, { membres: [], roles: ['modos'] }), true);
  assert.equal(peutSanctionner(avecRole, { membres: ['9'], roles: [] }), false);
  // Rien de choisi : « Gerer le serveur » suffit (admin du bot).
  const gerant = { id: '6', roles: { cache: { has: () => false } }, permissions: { has: () => true } };
  assert.equal(peutSanctionner(gerant, { membres: [], roles: [] }), true);
});

test('/warns : retirer un avertissement par numero, ou tous', () => {
  registre.ajouterWarn('w1', { at: 1, par: 'm', raison: 'a' });
  registre.ajouterWarn('w1', { at: 2, par: 'm', raison: 'b' });
  registre.ajouterWarn('w1', { at: 3, par: 'm', raison: 'c' });
  assert.equal(registre.retirerWarns('w1', 2), 1);
  assert.deepEqual(registre.warns('w1').map((w) => w.raison), ['a', 'c']);
  assert.equal(registre.retirerWarns('w1', 9), 0);
  assert.equal(registre.retirerWarns('w1'), 2);
  assert.equal(registre.warns('w1').length, 0);
});

test('autorises : membres et roles enregistres separement', () => {
  registre.poserAutorises({ membres: ['1', '2'] });
  registre.poserAutorises({ roles: ['r'] });
  assert.deepEqual(registre.autorises(), { membres: ['1', '2'], roles: ['r'] });
  registre.poserAutorises({ membres: [], roles: [] });
  assert.deepEqual(registre.autorises(), { membres: [], roles: [] });
});
