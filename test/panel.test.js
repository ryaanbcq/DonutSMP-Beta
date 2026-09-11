import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/test-panel.db';
for (const f of ['.db', '.db-wal', '.db-shm']) rmSync('./data/test-panel' + f, { force: true });

const { store, db } = await import('../src/db.js');
const { balances } = await import('../src/donut/balances.js');
const { signature } = await import('../src/baltop/panel.js');

function poser(id, nom, argent) {
  store.createLink(id, nom, 1);
  balances.suivre(store.getLink(id));
  db.prepare('UPDATE balances SET money = ?, updated_at = ? WHERE mc_name_norm = ?')
    .run(argent, Date.now(), nom.toLowerCase());
}

test('la signature change quand un membre entre au classement', () => {
  db.exec('DELETE FROM balances; DELETE FROM links;');
  poser('a', 'Alpha', 100);
  const avant = signature();

  poser('b', 'Beta', 999);
  assert.notEqual(signature(), avant, 'un nouvel entrant doit declencher une reecriture');
});

test('la signature change quand un solde bouge', () => {
  const avant = signature();
  db.prepare("UPDATE balances SET money = 50000 WHERE mc_name_norm = 'alpha'").run();
  assert.notEqual(signature(), avant);
});

test('la signature ne bouge pas si rien ne bouge', () => {
  assert.equal(signature(), signature());
});

test('un compte delie sort de la signature', () => {
  const avant = signature();
  store.removeLink('b');
  balances.oublier('Beta');
  assert.notEqual(signature(), avant);
});
