import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { estAdmin } from '../src/lib/admin.js';

const membre = ({ perms = 0n, roles = [], id = '1' }) => ({
  id,
  permissions: { has: (bit) => (perms & bit) === bit },
  roles: { cache: { has: (r) => roles.includes(r) } },
});
const reglages = (adminRoleId = '', ids = []) => ({ adminRoleId, adminUserIds: ids });

test('gerer le serveur suffit, meme sans role ni id configures', () => {
  assert.equal(estAdmin(membre({ perms: PermissionFlagsBits.ManageGuild }), reglages()), true);
  assert.equal(estAdmin(membre({}), reglages()), false);
  assert.equal(estAdmin(null, reglages()), false);
});

test('le role admin et les ids du .env ouvrent l acces', () => {
  const r = reglages('42', ['7', '8']);
  assert.equal(estAdmin(membre({ roles: ['42'] }), r), true);
  assert.equal(estAdmin(membre({ id: '8' }), r), true);
  assert.equal(estAdmin(membre({ id: '9', roles: ['41'] }), r), false);
});

test('un role admin vide ne matche pas un membre sans role', () => {
  assert.equal(estAdmin(membre({ id: '9' }), reglages('', [])), false);
  // Le membre sans id ne doit jamais tomber dans le includes d une liste vide.
  assert.equal(estAdmin({ roles: { cache: { has: () => false } } }, reglages('', [])), false);
});

test('ADMIN_USER_IDS est nettoye des espaces par la config', async () => {
  process.env.ADMIN_USER_IDS = ' 7, 8 ,';
  process.env.ADMIN_ROLE_ID = '42';
  const { config } = await import('../src/config.js?admin');
  assert.deepEqual(config.discord.adminUserIds, ['7', '8']);
  assert.equal(config.discord.adminRoleId, '42');
});
