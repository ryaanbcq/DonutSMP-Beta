// Compteur de messages par membre et par jour (sans le contenu), pour la
// condition « messages minimum » des giveaways. Table creee au demarrage.

import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS message_counts (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  day      TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, day)
);
`);

const q = {
  ajouter: db.prepare(`INSERT INTO message_counts (guild_id, user_id, day, n) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, day) DO UPDATE SET n = n + excluded.n`),
  total: db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM message_counts WHERE guild_id = ? AND user_id = ?'),
};

/** Jour au format AAAA-MM-JJ, heure de Paris. */
export function dayKey(at = Date.now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(at);
}

export function ajouterMembre(guildId, userId, quoi, n = 1, day = dayKey()) {
  if (quoi !== 'messages') throw new Error(`compteur inconnu : ${quoi}`);
  q.ajouter.run(String(guildId), String(userId), day, n);
}

/** Messages envoyes par un membre depuis le debut du comptage. */
export function messagesDe(guildId, userId) {
  return q.total.get(String(guildId), String(userId)).n;
}

export function demarrerCompteurMessages(client, guildId) {
  client.on('messageCreate', (m) => {
    if (!m.inGuild() || m.author.bot || m.guildId !== guildId) return;
    try { ajouterMembre(m.guildId, m.author.id, 'messages', 1); } catch (e) { console.warn('[stats] messages :', e.message); }
  });
}
