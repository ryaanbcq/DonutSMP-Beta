import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { writeFile, appendFile } from 'node:fs/promises';

process.env.DB_PATH = './data/test-integ.db';
process.env.PAYMENT_FILE = './data/test-integ.jsonl';
for (const f of ['.db', '.db-wal', '.db-shm']) rmSync('./data/test-integ' + f, { force: true });
await writeFile('./data/test-integ.jsonl', '');

const { startLink } = await import('../src/link/manager.js');
const { PaymentWatcher, normalizeEntry } = await import('../src/link/watcher.js');
const { store } = await import('../src/db.js');

// Exactement ce qu ecrit ingame/bot.js. Si ce format change d un cote sans
// l autre, ce test tombe.
const ingameLine = (raw) => JSON.stringify({ raw, at: Date.now() }) + '\n';

test('le format ecrit par le bot en jeu est compris par le watcher', () => {
  const entry = JSON.parse(ingameLine('Sp4cz paid you $742').trim());
  assert.deepEqual(normalizeEntry(entry), {
    from: 'Sp4cz', amount: 742, raw: 'Sp4cz paid you $742',
  });
});

test('la ligne brute fait foi meme si des champs recopies la contredisent', () => {
  // Un intermediaire qui recopie mal, ou qui ment, ne passe pas devant la ligne.
  const entry = { raw: 'Sp4cz paid you $10', from: 'Voleur', amount: 999999 };
  assert.deepEqual(normalizeEntry(entry), {
    from: 'Sp4cz', amount: 10, raw: 'Sp4cz paid you $10',
  });
});

test('une entree sans ligne brute exigible reste refusee si elle est mal formee', () => {
  assert.equal(normalizeEntry({ from: 'pseudo invalide!', amount: 5 }), null);
  assert.equal(normalizeEntry({ from: 'Sp4cz', amount: -5 }), null);
  assert.equal(normalizeEntry({ from: 'Sp4cz' }), null);
  assert.equal(normalizeEntry(null), null);
});

test('bout en bout : paiement ecrit par le bot en jeu, lien cree cote Discord', async () => {
  const ch = startLink('integ1', 'Kappa');
  const watcher = new PaymentWatcher({ file: './data/test-integ.jsonl', pollMs: 25 });
  const outcomes = [];
  watcher.on('payment', (r) => outcomes.push(r.outcome));
  await watcher.start();

  await appendFile('./data/test-integ.jsonl', ingameLine(`Intrus paid you $${ch.amount}`));
  await appendFile('./data/test-integ.jsonl', ingameLine(`[VIP] Intrus: Kappa paid you $${ch.amount}`));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(store.getLink('integ1'), null, 'ni le tiers ni le faux chat ne doivent lier');

  await appendFile('./data/test-integ.jsonl', ingameLine(`Kappa paid you $${ch.amount}`));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(store.getLink('integ1')?.mc_name, 'Kappa');

  watcher.stop();
  assert.deepEqual(outcomes, ['unmatched', 'linked']);
});

test('une ligne coupee en deux ecritures est reassemblee, pas perdue', async () => {
  const ch = startLink('integ2', 'Lambda');
  const watcher = new PaymentWatcher({ file: './data/test-integ.jsonl', pollMs: 25 });
  await watcher.start();

  const full = ingameLine(`Lambda paid you $${ch.amount}`);
  const cut = Math.floor(full.length / 2);
  await appendFile('./data/test-integ.jsonl', full.slice(0, cut));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(store.getLink('integ2'), null, 'une demi ligne ne doit rien declencher');

  await appendFile('./data/test-integ.jsonl', full.slice(cut));
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(store.getLink('integ2')?.mc_name, 'Lambda');
  watcher.stop();
});
