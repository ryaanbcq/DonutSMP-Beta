import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { creerVerificateur, MAX_PAR_JOUR } from '../ingame/verifications.js';

const chemin = join(mkdtempSync(join(tmpdir(), 'verif-')), 'bot.db');
const db = new DatabaseSync(chemin);
db.exec(`CREATE TABLE challenges (id INTEGER PRIMARY KEY, discord_id TEXT, mc_name TEXT, mc_name_norm TEXT,
  amount INTEGER, created_at INTEGER, expires_at INTEGER, status TEXT)`);
const T = 1_790_000_000_000;
db.prepare('INSERT INTO challenges (mc_name, mc_name_norm, amount, created_at, expires_at, status) VALUES (?,?,?,?,?,?)')
  .run('.Steve', 'steve', 437, T - 60_000, T + 840_000, 'confirmed');
const v = creerVerificateur(chemin);

test('un paiement de verification se rend, meme avec le point Bedrock', () => {
  assert.deepEqual(v.rembourser({ to: '.Steve', receivedAt: T }, 1), { ok: true });
  assert.deepEqual(v.rembourser({ to: 'STEVE', receivedAt: T }, 1), { ok: true });
});

test('un paiement sans /link est retenu', () => {
  assert.equal(v.rembourser({ to: 'PayAutoGamble', receivedAt: T }, 1).ok, false);
});

test('un challenge trop vieux ne couvre plus les paiements', () => {
  assert.equal(v.rembourser({ to: 'Steve', receivedAt: T + 25 * 3_600_000 }, 1).ok, false);
});

test('au dela du quota du jour, retenu', () => {
  assert.equal(v.rembourser({ to: 'Steve', receivedAt: T }, MAX_PAR_JOUR).ok, true);
  assert.equal(v.rembourser({ to: 'Steve', receivedAt: T }, MAX_PAR_JOUR + 1).ok, false);
});

test('base introuvable : rien ne sort', () => {
  const casse = creerVerificateur(join(tmpdir(), 'nexiste-pas', 'bot.db'));
  const r = casse.rembourser({ to: 'Steve', receivedAt: T }, 1);
  assert.equal(r.ok, false);
  assert.match(r.raison, /base illisible/);
});
