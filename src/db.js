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

CREATE TABLE IF NOT EXISTS vouch_threads (
  discord_id TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL,
  card_id    TEXT,
  mc_name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL UNIQUE,
  discord_id  TEXT NOT NULL,
  categorie   TEXT,
  sujet       TEXT,
  etat        TEXT NOT NULL DEFAULT 'ouvert',
  pris_par    TEXT,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ticket_membre ON tickets(discord_id, etat);
`);

// Colonnes ajoutees apres coup : un seul message de log par ticket, edite au
// fil de sa vie, et qui a change l etat en dernier.
for (const col of ['log_message_id TEXT', 'etat_par TEXT']) {
  try { db.exec(`ALTER TABLE tickets ADD COLUMN ${col}`); } catch { /* deja la */ }
}
// Avis : etoiles (1-5, null = ancien avis sans note) et carte publiee dans le fil.
for (const col of ['stars INTEGER', 'message_id TEXT', 'preuves TEXT']) {
  try { db.exec(`ALTER TABLE vouches ADD COLUMN ${col}`); } catch { /* deja la */ }
}

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
    INSERT INTO vouches (from_id, to_id, value, comment, created_at, stars)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_id, to_id) DO UPDATE SET
      value = excluded.value, comment = excluded.comment, created_at = excluded.created_at,
      stars = excluded.stars
  `),
  vouchGet: db.prepare('SELECT * FROM vouches WHERE from_id = ? AND to_id = ?'),
  vouchAll: db.prepare('SELECT * FROM vouches WHERE to_id = ? ORDER BY created_at DESC'),
  vouchTargets: db.prepare('SELECT DISTINCT to_id FROM vouches'),
  vouchSetMessage: db.prepare('UPDATE vouches SET message_id = ?, preuves = COALESCE(?, preuves) WHERE from_id = ? AND to_id = ?'),
  vouchCountFrom: db.prepare('SELECT COUNT(*) AS n FROM vouches WHERE from_id = ?'),
  allLinks: db.prepare('SELECT * FROM links ORDER BY linked_at'),

  threadGet: db.prepare('SELECT * FROM vouch_threads WHERE discord_id = ?'),
  threadSet: db.prepare(`
    INSERT INTO vouch_threads (discord_id, thread_id, card_id, mc_name) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET thread_id = excluded.thread_id, card_id = excluded.card_id, mc_name = excluded.mc_name
  `),
  threadDel: db.prepare('DELETE FROM vouch_threads WHERE discord_id = ?'),
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

  insertTicket: db.prepare(
    'INSERT INTO tickets (channel_id, discord_id, categorie, sujet, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  ticketBySalon: db.prepare('SELECT * FROM tickets WHERE channel_id = ?'),
  ticketOuvertDe: db.prepare(
    "SELECT * FROM tickets WHERE discord_id = ? AND etat != 'supprime' ORDER BY id DESC LIMIT 1",
  ),
  setTicketEtat: db.prepare('UPDATE tickets SET etat = ?, closed_at = ?, etat_par = ? WHERE channel_id = ?'),
  setTicketLog: db.prepare('UPDATE tickets SET log_message_id = ? WHERE channel_id = ?'),
  setTicketPris: db.prepare('UPDATE tickets SET pris_par = ? WHERE channel_id = ?'),
  renameTicket: db.prepare('UPDATE tickets SET channel_id = ? WHERE channel_id = ?'),
  countTicketsEtat: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE etat = ?'),

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
  setVouch: (fromId, toId, value, comment, stars = null) =>
    q.upsertVouch.run(String(fromId), String(toId), value, comment ?? null, Date.now(), stars),
  getVouch: (fromId, toId) => q.vouchGet.get(String(fromId), String(toId)) ?? null,
  vouchAll: (toId) => q.vouchAll.all(String(toId)),
  vouchTargets: () => q.vouchTargets.all().map((r) => r.to_id),
  setVouchMessage: (fromId, toId, messageId, preuves = null) =>
    q.vouchSetMessage.run(messageId ? String(messageId) : null, preuves ? JSON.stringify(preuves) : null, String(fromId), String(toId)),
  vouchCountFrom: (fromId) => q.vouchCountFrom.get(String(fromId)).n,
  allLinks: () => q.allLinks.all(),

  getThread: (discordId) => q.threadGet.get(String(discordId)) ?? null,
  setThread: (discordId, threadId, cardId, mcName) =>
    q.threadSet.run(String(discordId), String(threadId), cardId ? String(cardId) : null, mcName),
  removeThread: (discordId) => q.threadDel.run(String(discordId)),
  removeVouch: (fromId, toId) => q.deleteVouch.run(String(fromId), String(toId)).changes > 0,
  vouchScore: (toId) => q.vouchScore.get(String(toId)),
  vouchList: (toId, limit = 5) => q.vouchList.all(String(toId), limit),
  vouchTop: (limit = 10) => q.vouchTop.all(limit),

  // Tickets
  createTicket: (channelId, discordId, categorie, sujet) => {
    const info = q.insertTicket.run(String(channelId), String(discordId), categorie ?? null, sujet ?? null, Date.now());
    return Number(info.lastInsertRowid);
  },
  getTicket: (channelId) => q.ticketBySalon.get(String(channelId)) ?? null,
  ticketEnCours: (discordId) => q.ticketOuvertDe.get(String(discordId)) ?? null,
  setTicketEtat: (channelId, etat, par = null) =>
    q.setTicketEtat.run(etat, etat === 'ouvert' ? null : Date.now(), par ? String(par) : null, String(channelId)),
  setTicketLog: (channelId, messageId) => q.setTicketLog.run(String(messageId), String(channelId)),
  setTicketPris: (channelId, discordId) => q.setTicketPris.run(discordId ? String(discordId) : null, String(channelId)),
  renommerTicket: (avant, apres) => q.renameTicket.run(String(apres), String(avant)),
  countTickets: (etat) => q.countTicketsEtat.get(etat).n,

  kvGet: (k) => q.kvGet.get(k)?.v ?? null,
  kvSet: (k, v) => q.kvSet.run(k, String(v)),

  transfererReputation,
  orphelinsDuPseudo,
};

/** Cle de la reputation d un compte Minecraft que plus personne n a lie. */
export const cleOrpheline = (mcName) => `mc:${normName(mcName)}`;

/**
 * Deplace la reputation RECUE (avis + post du forum) d une cle a une autre.
 * La reputation suit le compte Minecraft, pas le compte Discord : avant, un
 * joueur signale se deliait, reliait le meme pseudo depuis un autre Discord et
 * repartait a zero. Les avis DONNES par le membre restent a lui.
 */
function transfererReputation(de, vers) {
  de = String(de); vers = String(vers);
  if (de === vers) return 0;
  db.exec('BEGIN');
  try {
    // Un meme auteur ne garde qu un avis par cible : le plus recent gagne.
    const doublons = db.prepare(`SELECT a.from_id, a.created_at AS ancien, b.created_at AS actuel
      FROM vouches a JOIN vouches b ON a.from_id = b.from_id WHERE a.to_id = ? AND b.to_id = ?`).all(de, vers);
    const retirer = db.prepare('DELETE FROM vouches WHERE from_id = ? AND to_id = ?');
    for (const d of doublons) retirer.run(d.from_id, d.ancien > d.actuel ? vers : de);
    const n = db.prepare('UPDATE vouches SET to_id = ? WHERE to_id = ?').run(vers, de).changes;
    // On ne s auto-note pas, meme par heritage.
    db.prepare('DELETE FROM vouches WHERE to_id = ? AND from_id = ?').run(vers, vers);
    if (db.prepare('SELECT 1 FROM vouch_threads WHERE discord_id = ?').get(de)) {
      db.prepare('DELETE FROM vouch_threads WHERE discord_id = ?').run(vers);
      db.prepare('UPDATE vouch_threads SET discord_id = ? WHERE discord_id = ?').run(vers, de);
    }
    db.exec('COMMIT');
    return n;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Cles qui portent encore la reputation de ce pseudo sans lien actif : la cle
 * orpheline, et les anciens comptes Discord delies avant ce mecanisme (leur
 * post du forum garde le pseudo).
 */
function orphelinsDuPseudo(mcName, sauf) {
  const norm = normName(mcName);
  const cles = new Set([cleOrpheline(mcName)]);
  for (const r of db.prepare('SELECT discord_id, mc_name FROM vouch_threads').all()) {
    if (normName(r.mc_name) !== norm || r.discord_id === String(sauf)) continue;
    if (!store.getLink(r.discord_id)) cles.add(r.discord_id);
  }
  return [...cles];
}
