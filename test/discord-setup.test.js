import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';
import {
  creerManquants, droitsManquants, lienInvitation, PERMISSIONS, A_CREER,
} from '../scripts/lib/discord-setup.js';

// Faux Discord : garde en memoire ce qui est cree.
function fauxDiscord({ roles = [], salons = [] } = {}) {
  let n = 100;
  const posts = [];
  return {
    posts,
    get: async (c) => (c.endsWith('/roles') ? structuredClone(roles) : structuredClone(salons)),
    post: async (c, corps) => {
      const obj = { id: String(n += 1), ...corps };
      posts.push([c, obj]);
      (c.endsWith('/roles') ? roles : salons).push(obj);
      return obj;
    },
  };
}

const G = 'guild';
const BOT = 'bot';

test('cree le role et les quatre salons dans deux categories', async () => {
  const api = fauxDiscord();
  const poses = await creerManquants(api, { guildId: G, botId: BOT, env: {} });
  assert.deepEqual(Object.keys(poses).sort(), A_CREER.map((x) => x.cle).sort());
  const categories = api.posts.filter(([, o]) => o.type === 4);
  assert.equal(categories.length, 2);

  // Le staff est prive : @everyone ne voit pas, le bot si.
  const staff = categories.find(([, o]) => o.name.includes('STAFF'))[1];
  const tout = staff.permission_overwrites.find((o) => o.id === G);
  assert.ok(BigInt(tout.deny) & P.ViewChannel);
  const journal = api.posts.find(([, o]) => o.name === 'journal-bot')[1];
  assert.equal(journal.parent_id, staff.id);
  assert.ok(BigInt(journal.permission_overwrites.find((o) => o.id === BOT).allow) & P.ViewChannel);

  // Le public se lit sans ecrire.
  const connexion = api.posts.find(([, o]) => o.name === 'connexion')[1];
  assert.ok(BigInt(connexion.permission_overwrites.find((o) => o.id === G).deny) & P.SendMessages);
});

test('relance : reprend ce qui existe, ne cree rien en double', async () => {
  const api = fauxDiscord();
  const premier = await creerManquants(api, { guildId: G, botId: BOT, env: {} });
  const avant = api.posts.length;
  // Coupure juste apres la creation : le .env n a rien retenu.
  const second = await creerManquants(api, { guildId: G, botId: BOT, env: {} });
  assert.equal(api.posts.length, avant);
  assert.deepEqual(second, premier);
});

test('ne touche pas aux cles deja remplies', async () => {
  const api = fauxDiscord();
  const env = Object.fromEntries(A_CREER.map((x) => [x.cle, '1']));
  assert.deepEqual(await creerManquants(api, { guildId: G, botId: BOT, env }), {});
  assert.equal(api.posts.length, 0);
});

test('droits : administrateur suffit, sinon liste ce qui manque', () => {
  assert.deepEqual(droitsManquants(P.Administrator), []);
  assert.deepEqual(droitsManquants(PERMISSIONS), []);
  assert.ok(droitsManquants(PERMISSIONS & ~P.ManageChannels).includes('Gerer les salons'));
});

test('le lien d invitation porte tous les droits et fixe le serveur', () => {
  const l = new URL(lienInvitation('123', '456'));
  assert.equal(BigInt(l.searchParams.get('permissions')), PERMISSIONS);
  assert.equal(l.searchParams.get('guild_id'), '456');
});
