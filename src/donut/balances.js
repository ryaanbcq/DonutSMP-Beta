// Cache des soldes des membres verifies, alimente en continu.
//
// Pourquoi pas un batch (une fois par jour, ou toutes les 20 min) : un batch
// envoie N requetes d un coup, donc il gaspille a 50 membres et il pique a
// 2000. Ici on rafraichit UN joueur a la fois, toujours le plus ancien, et la
// cadence se deduit de la taille de la commu :
//     intervalle = duree du cycle / nombre de membres
// bornee par un plafond de requetes par minute (l API DonutSMP en autorise
// 250). Le cycle s allonge tout seul quand la commu grandit, au lieu de faire
// exploser le budget de requetes.

import { db, store } from '../db.js';
import { donut } from './api.js';
import { normName } from '../lib/names.js';

db.exec(`
CREATE TABLE IF NOT EXISTS balances (
  mc_name_norm TEXT PRIMARY KEY,
  mc_name      TEXT NOT NULL,
  discord_id   TEXT NOT NULL,
  money        INTEGER NOT NULL DEFAULT 0,
  shards       INTEGER NOT NULL DEFAULT 0,
  kills        INTEGER NOT NULL DEFAULT 0,
  deaths       INTEGER NOT NULL DEFAULT 0,
  playtime_ms  INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0,
  erreurs      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bal_money ON balances(money DESC);
CREATE INDEX IF NOT EXISTS idx_bal_age ON balances(updated_at);
`);

const q = {
  upsert: db.prepare(`
    INSERT INTO balances (mc_name_norm, mc_name, discord_id, money, shards, kills, deaths, playtime_ms, updated_at, erreurs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(mc_name_norm) DO UPDATE SET
      mc_name = excluded.mc_name, discord_id = excluded.discord_id,
      money = excluded.money, shards = excluded.shards, kills = excluded.kills,
      deaths = excluded.deaths, playtime_ms = excluded.playtime_ms,
      updated_at = excluded.updated_at, erreurs = 0
  `),
  erreur: db.prepare(
    "UPDATE balances SET erreurs = erreurs + 1, updated_at = ? WHERE mc_name_norm = ?",
  ),
  toucher: db.prepare(`
    INSERT INTO balances (mc_name_norm, mc_name, discord_id, updated_at)
    VALUES (?, ?, ?, 0)
    ON CONFLICT(mc_name_norm) DO UPDATE SET mc_name = excluded.mc_name, discord_id = excluded.discord_id
  `),
  oublier: db.prepare('DELETE FROM balances WHERE mc_name_norm = ?'),
  // Le plus ancien d abord, et seulement ceux encore lies.
  suivant: db.prepare(`
    SELECT b.* FROM balances b
    JOIN links l ON l.mc_name_norm = b.mc_name_norm
    ORDER BY b.updated_at ASC LIMIT 1
  `),
  classement: db.prepare(`
    SELECT b.* FROM balances b
    JOIN links l ON l.mc_name_norm = b.mc_name_norm
    WHERE b.updated_at > 0
    ORDER BY b.%COL% DESC LIMIT ?
  `.replace('%COL%', 'money')),
  compte: db.prepare('SELECT COUNT(*) AS n FROM links'),
  plusVieux: db.prepare(`
    SELECT MIN(b.updated_at) AS vieux FROM balances b
    JOIN links l ON l.mc_name_norm = b.mc_name_norm WHERE b.updated_at > 0
  `),
};

const COLONNES = {
  money: 'money', shards: 'shards', kills: 'kills',
  deaths: 'deaths', playtime: 'playtime_ms',
};

export const balances = {
  /** Inscrit un compte au cycle de rafraichissement. */
  suivre(link) {
    q.toucher.run(normName(link.mc_name), link.mc_name, String(link.discord_id));
  },

  oublier(mcName) {
    q.oublier.run(normName(mcName));
  },

  /** Remet tous les comptes lies dans la table, au demarrage. */
  resynchroniser() {
    const liens = db.prepare('SELECT * FROM links').all();
    for (const l of liens) balances.suivre(l);
    return liens.length;
  },

  suivant: () => q.suivant.get() ?? null,

  ecrire(row, stats, now = Date.now()) {
    q.upsert.run(
      row.mc_name_norm, stats.name ?? row.mc_name, row.discord_id,
      Math.round(stats.money), Math.round(stats.shards ?? 0),
      Math.round(stats.kills), Math.round(stats.deaths),
      Math.round(stats.playtimeMs ?? 0), now,
    );
  },

  echec(row, now = Date.now()) {
    q.erreur.run(now, row.mc_name_norm);
  },

  classement(categorie = 'money', limite = 10) {
    const col = COLONNES[categorie] ?? 'money';
    return db.prepare(`
      SELECT b.* FROM balances b
      JOIN links l ON l.mc_name_norm = b.mc_name_norm
      WHERE b.updated_at > 0 AND b.${col} > 0
      ORDER BY b.${col} DESC LIMIT ?
    `).all(limite).map((r, i) => ({
      rank: i + 1,
      name: r.mc_name,
      discordId: r.discord_id,
      value: r[col],
      updatedAt: r.updated_at,
    }));
  },

  /** Age du plus ancien solde du classement, pour l afficher en pied d embed. */
  fraicheur() {
    const { vieux } = q.plusVieux.get() ?? {};
    return vieux ? Date.now() - vieux : null;
  },

  membres: () => q.compte.get().n,
};

/**
 * Cadence : on vise un cycle complet en `cycleMs`, sans jamais depasser
 * `maxParMinute` requetes ni descendre sous `minIntervalMs`.
 */
export function intervalle(membres, { cycleMs, maxParMinute, minIntervalMs = 1000 }) {
  if (membres <= 0) return cycleMs;
  const vise = Math.floor(cycleMs / membres);
  const plancher = Math.max(minIntervalMs, Math.ceil(60_000 / maxParMinute));
  return Math.max(vise, plancher);
}

/** Boucle de rafraichissement. Rend une fonction d arret. */
export function demarrerRafraichissement({
  cycleMs = 15 * 60_000,
  maxParMinute = 60,
  onError = () => {},
  onUpdate = () => {},
} = {}) {
  let timer = null;
  let arrete = false;

  const tour = async () => {
    if (arrete) return;
    let attente = intervalle(balances.membres(), { cycleMs, maxParMinute });

    const row = balances.suivant();
    if (row) {
      try {
        const stats = await donut.stats(row.mc_name);
        if (stats) {
          balances.ecrire(row, stats);
          onUpdate(row, stats);
        } else {
          balances.echec(row);
        }
      } catch (err) {
        balances.echec(row);
        onError(err, row);
        // Quota ou API a terre : on souffle avant de reessayer.
        if (/trop de requetes|refusee/i.test(err.message)) attente = Math.max(attente, 60_000);
      }
    }

    if (!arrete) {
      timer = setTimeout(tour, attente);
      timer.unref?.();
    }
  };

  tour();
  return () => { arrete = true; if (timer) clearTimeout(timer); };
}

export { store };
