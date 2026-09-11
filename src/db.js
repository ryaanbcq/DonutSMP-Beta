import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { normName } from './lib/names.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS links (
  discord_id   TEXT PRIMARY KEY,
  mc_name      TEXT NOT NULL,
  mc_name_norm TEXT NOT NULL UNIQUE,
  linked_at    INTEGER NOT NULL,
  fee_paid     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id   TEXT NOT NULL,
  mc_name      TEXT NOT NULL,
  mc_name_norm TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_ch_pending ON challenges(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ch_one_per_user
  ON challenges(discord_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ch_amount_free
  ON challenges(amount) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name  TEXT NOT NULL,
  from_norm  TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  raw        TEXT,
  seen_at    INTEGER NOT NULL,
  outcome    TEXT NOT NULL,
  challenge  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pay_seen ON payments(seen_at);

CREATE TABLE IF NOT EXISTS vouches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  value       INTEGER NOT NULL,
  comment     TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_vouch_to ON vouches(to_id);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

const q = {
  linkByDiscord: db.prepare('SELECT * FROM links WHERE discord_id = ?'),
  linkByName: db.prepare('SELECT * FROM links WHERE mc_name_norm = ?'),
  insertLink: db.prepare(
    'INSERT INTO links (discord_id, mc_name, mc_name_norm, linked_at, fee_paid) VALUES (?, ?, ?, ?, ?)',
  ),
  deleteLink: db.prepare('DELETE FROM links WHERE discord_id = ?'),
  countLinks: db.prepare('SELECT COUNT(*) AS n FROM links'),

  pendingByUser: db.prepare(
    "SELECT * FROM challenges WHERE discord_id = ? AND status = 'pending'",
  ),
  pendingAmounts: db.prepare(
    "SELECT amount FROM challenges WHERE status = 'pending'",
  ),
  matchChallenge: db.prepare(
    "SELECT * FROM challenges WHERE status = 'pending' AND mc_name_norm = ? AND amount = ?",
  ),
  insertChallenge: db.prepare(
    'INSERT INTO challenges (discord_id, mc_name, mc_name_norm, amount, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  setChallengeStatus: db.prepare('UPDATE challenges SET status = ? WHERE id = ?'),
  expireOld: db.prepare(
    "UPDATE challenges SET status = 'expired' WHERE status = 'pending' AND expires_at < ?",
  ),

  insertPayment: db.prepare(
    'INSERT INTO payments (from_name, from_norm, amount, raw, seen_at, outcome, challenge) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),

  upsertVouch: db.prepare(`
    INSERT INTO vouches (from_id, to_id, value, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(from_id, to_id) DO UPDATE SET
      value = excluded.value, comment = excluded.comment, created_at = excluded.created_at
  `),
  deleteVouch: db.prepare('DELETE FROM vouches WHERE from_id = ? AND to_id = ?'),
  vouchScore: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END), 0) AS pos,
      COALESCE(SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END), 0) AS neg
    FROM vouches WHERE to_id = ?
  `),
  vouchList: db.prepare(
    'SELECT * FROM vouches WHERE to_id = ? ORDER BY created_at DESC LIMIT ?',
  ),
  vouchTop: db.prepare(`
    SELECT to_id,
      SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS pos,
      SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END) AS neg
    FROM vouches GROUP BY to_id
    ORDER BY (pos - neg) DESC, pos DESC LIMIT ?
  `),

  kvGet: db.prepare('SELECT v FROM kv WHERE k = ?'),
  kvSet: db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
};

export const store = {
  // Liens
  getLink: (discordId) => q.linkByDiscord.get(String(discordId)) ?? null,
  getLinkByName: (name) => q.linkByName.get(normName(name)) ?? null,
  createLink: (discordId, mcName, fee) =>
    q.insertLink.run(String(discordId), mcName, normName(mcName), Date.now(), fee),
  removeLink: (discordId) => q.deleteLink.run(String(discordId)).changes > 0,
  countLinks: () => q.countLinks.get().n,

  // Challenges
  getPending: (discordId) => q.pendingByUser.get(String(discordId)) ?? null,
  takenAmounts: () => new Set(q.pendingAmounts.all().map((r) => r.amount)),
  findChallenge: (name, amount) => q.matchChallenge.get(normName(name), amount) ?? null,
  createChallenge: (discordId, mcName, amount, ttlMs) => {
    const now = Date.now();
    const info = q.insertChallenge.run(
      String(discordId), mcName, normName(mcName), amount, now, now + ttlMs,
    );
    return { id: Number(info.lastInsertRowid), amount, expiresAt: now + ttlMs };
  },
  closeChallenge: (id, status) => q.setChallengeStatus.run(status, id),
  expireStale: () => q.expireOld.run(Date.now()).changes,

  // Paiements vus
  recordPayment: (p, outcome, challengeId = null) =>
    q.insertPayment.run(p.from, normName(p.from), p.amount, p.raw ?? null, Date.now(), outcome, challengeId),

  // Vouches
  setVouch: (fromId, toId, value, comment) =>
    q.upsertVouch.run(String(fromId), String(toId), value, comment ?? null, Date.now()),
  removeVouch: (fromId, toId) => q.deleteVouch.run(String(fromId), String(toId)).changes > 0,
  vouchScore: (toId) => q.vouchScore.get(String(toId)),
  vouchList: (toId, limit = 5) => q.vouchList.all(String(toId), limit),
  vouchTop: (limit = 10) => q.vouchTop.all(limit),

  kvGet: (k) => q.kvGet.get(k)?.v ?? null,
  kvSet: (k, v) => q.kvSet.run(k, String(v)),
};
