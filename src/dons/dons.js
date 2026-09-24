// Dons des membres au bot, et rangs de donateur.
//
// Le don suit le COMPTE MINECRAFT, comme la reputation : il est enregistre au
// pseudo qui a paye. Un joueur pas encore lie garde ses dons, ils comptent des
// qu il se lie ; un membre qui se delie perd ses rangs, le compte les garde.
//
// Un seul role de donateur a la fois : celui du plus haut palier atteint. Les
// roles sont crees par le bot (tout en bas, donc donnables) et retenus en base.

import { db } from '../db.js';
import { config } from '../config.js';
import { normName } from '../lib/names.js';
import { shortMoney } from '../lib/format.js';

db.exec(`
CREATE TABLE IF NOT EXISTS dons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mc_name      TEXT NOT NULL,
  mc_name_norm TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  raw          TEXT,
  at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dons_nom ON dons(mc_name_norm);
`);

const q = {
  ajouter: db.prepare('INSERT INTO dons (mc_name, mc_name_norm, amount, raw, at) VALUES (?, ?, ?, ?, ?)'),
  total: db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM dons WHERE mc_name_norm = ?'),
  kvGet: db.prepare('SELECT v FROM kv WHERE k = ?'),
  kvSet: db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
};

export const estUnDon = (amount, min = config.dons.min) => Number(amount) >= min;

export function enregistrerDon(payment, at = Date.now()) {
  q.ajouter.run(payment.from, normName(payment.from), Math.floor(payment.amount), payment.raw ?? null, at);
  return totalDe(payment.from);
}

export const totalDe = (mcName) => q.total.get(normName(mcName)).t;

/** Index du plus haut palier atteint, -1 si aucun. */
export function palierPour(total, paliers = config.dons.paliers) {
  let i = -1;
  paliers.forEach((p, n) => { if (total >= p) i = n; });
  return i;
}

export const nomRole = (palier) => `Donateur ${shortMoney(palier).replace('$', '')}`;

const cleRole = (palier) => `dons.role.${palier}`;
export const roleDuPalier = (palier) => q.kvGet.get(cleRole(palier))?.v || null;

/** Tous les roles de donateur connus, pour les retirer d un coup. */
export const rolesDonateur = () => config.dons.paliers.map(roleDuPalier).filter(Boolean);

/**
 * Cree les roles qui manquent (supprimes a la main compris). Un role neuf nait
 * tout en bas, sous celui du bot : il pourra toujours le donner.
 */
export async function assurerRoles(guild) {
  const couleurs = [0xCD7F32, 0xC0C0C0, 0xFFD700, 0x7FDBFF, 0xB47CFF];
  for (const [n, palier] of config.dons.paliers.entries()) {
    const id = roleDuPalier(palier);
    if (id && guild.roles.cache.has(id)) continue;
    const deja = guild.roles.cache.find((r) => r.name === nomRole(palier) && !r.managed);
    const role = deja ?? await guild.roles.create({
      name: nomRole(palier),
      colors: { primaryColor: couleurs[n] ?? couleurs.at(-1) },
      reason: 'Rangs de donateur',
    });
    q.kvSet.run(cleRole(palier), role.id);
    if (!deja) console.log(`[don] role ${role.name} cree`);
  }
}

/**
 * Pose sur le membre le role de son palier et retire les autres. Rend
 * l index du palier (ou -1). Sans compte lie : aucun role de donateur.
 */
export async function majRolesDonateur(guild, discordId, mcName) {
  const membre = await guild.members.fetch(discordId).catch(() => null);
  if (!membre) return -1;
  const palier = mcName ? palierPour(totalDe(mcName)) : -1;
  const garder = palier >= 0 ? roleDuPalier(config.dons.paliers[palier]) : null;
  for (const id of rolesDonateur()) {
    if (id === garder) {
      if (!membre.roles.cache.has(id)) await membre.roles.add(id, 'Palier de donateur').catch((e) => console.warn('[don] role :', e.message));
    } else if (membre.roles.cache.has(id)) {
      await membre.roles.remove(id, 'Palier de donateur').catch((e) => console.warn('[don] role :', e.message));
    }
  }
  return palier;
}
