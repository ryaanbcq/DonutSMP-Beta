import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = mkdtempSync(join(tmpdir(), 'pres-'));
process.env.DB_PATH = join(dossier, 'bot.db');
process.env.INGAME_STATUS = join(dossier, 'status.json');
const statut = (online) => writeFileSync(process.env.INGAME_STATUS, JSON.stringify({ online, at: Date.now() }));

const { surveillerPresence } = await import('../src/ingame/surveillance.js');
const { poserSalon, attendreJournal } = await import('../src/ops/journal.js');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test('une micro-coupure ne dit rien, une vraie coupure est annoncee puis levee', async () => {
  const titres = [];
  poserSalon({ name: 'logs', send: async (p) => { titres.push(p.embeds[0].data.title); return { edit: async () => {} }; } });
  statut(true);
  const stop = surveillerPresence({ users: { fetch: async () => null } }, { intervalMs: 20, annonceApresMs: 150 });
  await attendre(60);

  statut(false); await attendre(60); statut(true); await attendre(80);
  await attendreJournal();
  assert.deepEqual(titres, [], 'coupure de 60 ms sous le seuil : silence');

  statut(false); await attendre(260); statut(true); await attendre(80);
  stop();
  await attendreJournal();
  assert.equal(titres.length, 2);
  assert.match(titres[0], /suspendues/);
  assert.match(titres[1], /rouvertes/);
});
