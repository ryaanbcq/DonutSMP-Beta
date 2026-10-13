// Les commandes staff sont visibles de tous (le role admin du bot, pose par
// /setup general, doit pouvoir les lancer) : chacune doit donc refuser elle-meme
// un membre ordinaire, sans planter (un import oublie ne se voit qu'a l'execution).
process.env.DB_PATH = './data/test-acces.db';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const membre = { id: '1', permissions: { has: () => false }, roles: { cache: { has: () => false } } };
const fausseInteraction = () => {
  const i = {
    member: membre, user: { id: '1', tag: 'membre' }, guild: null, channel: null,
    options: { getSubcommand: () => 'general', getChannel: () => null, getString: () => null, getRole: () => null },
    reply: async (r) => { i.repondu = r; return r; },
  };
  return i;
};

for (const nom of ['setup', 'panel', 'embed', 'importer-vouches', 'statut']) {
  test(`/${nom} refuse un membre sans role admin`, async () => {
    const cmd = await import(`../src/commands/${nom}.js`);
    assert.equal(cmd.data.toJSON().default_member_permissions ?? null, null, 'la commande doit rester visible');
    const i = fausseInteraction();
    await cmd.execute(i);
    assert.match(String(i.repondu?.content ?? ''), /Réservé/);
  });
}

test.after(() => { for (const s of ['', '-wal', '-shm']) rmSync(`./data/test-acces.db${s}`, { force: true }); });

test('/statut retient et applique la presence', async () => {
  const { presenceVoulue, appliquerPresence } = await import('../src/commands/statut.js');
  const { store } = await import('../src/db.js');
  store.kvSet('presence.statut', 'dnd');
  store.kvSet('presence.texte', 'Beta en cours');
  let pose = null;
  const etat = appliquerPresence({ user: { setPresence: (p) => { pose = p; } } });
  assert.deepEqual(etat, { statut: 'dnd', texte: 'Beta en cours' });
  assert.equal(pose.status, 'dnd');
  assert.equal(pose.activities[0].state, 'Beta en cours');
  store.kvSet('presence.texte', '');
  assert.deepEqual(appliquerPresence({ user: { setPresence: (p) => { pose = p; } } }).texte, '');
  assert.deepEqual(pose.activities, []);
  assert.equal(presenceVoulue().statut, 'dnd');
});
