import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/test-bal.db';
for (const f of ['.db', '.db-wal', '.db-shm']) rmSync('./data/test-bal' + f, { force: true });

const { balances, intervalle } = await import('../src/donut/balances.js');
const { store, db } = await import('../src/db.js');

test('la cadence se deduit de la taille de la commu', () => {
  const opts = { cycleMs: 15 * 60_000, maxParMinute: 60 };
  // 90 membres sur 15 min = un joueur toutes les 10 s
  assert.equal(intervalle(90, opts), 10_000);
  // 900 membres : le cycle voudrait 1 s, le plancher de 60 req/min impose 1 s
  assert.equal(intervalle(900, opts), 1000);
  // 5000 membres : on ne depasse pas le plafond, le cycle s allonge tout seul
  assert.equal(intervalle(5000, opts), 1000);
});

test('le plafond de requetes par minute est respecte', () => {
  // 30 requetes par minute = au plus une toutes les 2 s
  assert.ok(intervalle(10_000, { cycleMs: 60_000, maxParMinute: 30 }) >= 2000);
});

test('sans membre on ne boucle pas a vide', () => {
  assert.equal(intervalle(0, { cycleMs: 900_000, maxParMinute: 60 }), 900_000);
});

test('un compte lie entre dans le cycle et en sort au unlink', () => {
  store.createLink('d1', 'Alpha', 10);
  balances.suivre(store.getLink('d1'));
  assert.equal(balances.suivant()?.mc_name, 'Alpha');

  store.removeLink('d1');
  // Le classement et le tour de role ne regardent que les comptes encore lies.
  assert.equal(balances.suivant(), null);
});

test('le plus ancien passe en premier', () => {
  store.createLink('d2', 'Beta', 10);
  store.createLink('d3', 'Gamma', 10);
  balances.suivre(store.getLink('d2'));
  balances.suivre(store.getLink('d3'));

  const row = balances.suivant();
  balances.ecrire(row, { name: row.mc_name, money: 5, kills: 0, deaths: 0, shards: 0, playtimeMs: 0 });

  const suivant = balances.suivant();
  assert.notEqual(suivant.mc_name_norm, row.mc_name_norm, 'on ne repasse pas sur le meme');
});

test('le classement trie sur la valeur et ignore les soldes jamais lus', () => {
  db.exec('DELETE FROM balances; DELETE FROM links;');
  const donnees = [['d10', 'Riche', 900_000], ['d11', 'Moyen', 5_000], ['d12', 'Pauvre', 12]];
  for (const [id, nom, argent] of donnees) {
    store.createLink(id, nom, 1);
    balances.suivre(store.getLink(id));
    const row = balances.suivant();
    balances.ecrire(row, { name: nom, money: argent, kills: 0, deaths: 0, shards: 0, playtimeMs: 0 });
  }
  store.createLink('d13', 'JamaisLu', 1);
  balances.suivre(store.getLink('d13'));

  const top = balances.classement('money', 10);
  assert.deepEqual(top.map((r) => r.name), ['Riche', 'Moyen', 'Pauvre']);
  assert.equal(top[0].rank, 1);
  assert.equal(top[0].value, 900_000);
});

test('la fraicheur rend l age du plus ancien solde', () => {
  const age = balances.fraicheur();
  assert.ok(age !== null && age < 5000);
});

test('une donnee de test ne peut jamais entrer dans le classement', () => {
  db.exec('DELETE FROM balances; DELETE FROM links;');
  store.createLink('d20', 'Cobaye', 1);
  balances.suivre(store.getLink('d20'));
  const row = balances.suivant();

  assert.throws(
    () => balances.ecrire(row, { mock: true, name: 'Cobaye', money: 3_344_400, kills: 0, deaths: 0, shards: 0, playtimeMs: 0 }),
    /donnee de test/,
    'le classement doit refuser une valeur inventee',
  );
  assert.equal(balances.classement('money', 10).length, 0);
});

test('un membre parti du serveur sort du classement, le suivant remonte', async () => {
  const { brancherDeparts } = await import('../src/donut/balances.js');
  const { calculerPartis } = await import('../src/lib/membres.js');
  for (const [id, nom, argent] of [['p1', 'Riche', 900], ['p2', 'Moyen', 500], ['p3', 'Petit', 100]]) {
    store.createLink(id, nom, 10);
    balances.ecrire({ mc_name_norm: nom.toLowerCase(), mc_name: nom, discord_id: id },
      { name: nom, money: argent, kills: 0, deaths: 0 });
  }
  const noms = () => balances.classement('money', 2).map((r) => r.name);
  brancherDeparts(() => false);
  assert.deepEqual(noms(), ['Riche', 'Moyen']);

  const partis = calculerPartis(['p1', 'p2', 'p3'], new Set(['p2', 'p3']));
  assert.deepEqual([...partis], ['p1']);
  brancherDeparts((id) => partis.has(id));
  assert.deepEqual(noms(), ['Moyen', 'Petit']);
  assert.equal(balances.classement('money', 2)[0].rank, 1);
  brancherDeparts(() => false);
});

test('classement : nom Discord en texte, pas de mention brute', async () => {
  const { qui } = await import('../src/lib/membres.js');
  assert.equal(qui('Alienlegoat', 'Alien'), 'Alien · **Alienlegoat**');
  assert.equal(qui('ZKR5', 'zkr5'), '**ZKR5**');           // meme nom : une seule fois
  assert.equal(qui('.Bedrock', 'bedrock'), '**.Bedrock**');
  assert.equal(qui('t3ph', undefined), '**t3ph**');         // nom inconnu : pseudo seul
  const { rendre } = await import('../src/baltop/panel.js');
  const texte = rendre(new Map([['p2', 'Moyenne']])).data.description;
  assert.ok(!/<@\d/.test(texte), 'aucune mention <@id> dans le classement');
});
