// Dons des membres au bot, et rangs de donateur.
//
// Le don suit le COMPTE MINECRAFT, comme la reputation : il est enregistre au
// pseudo qui a paye. Un joueur pas encore lie garde ses dons, ils comptent des
// qu il se lie ; un membre qui se delie perd ses rangs, le compte les garde.
//
// Un seul role de donateur a la fois : celui du plus haut palier atteint. Les
// roles sont crees par le bot (tout en bas, donc donnables) et retenus en base.

import { db, store } from '../db.js';
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

// Paliers : ceux poses par /setup dons, sinon DONATION_TIERS du .env.
export const MAX_PALIERS = 4; // 4 menus de role + 1 rangee de boutons = limite Discord
export function paliers() {
  try {
    const perso = JSON.parse(q.kvGet.get('dons.paliers')?.v ?? 'null');
    if (Array.isArray(perso) && perso.length) return perso;
  } catch { /* valeur abimee : on retombe sur le .env */ }
  return config.dons.paliers;
}
export const poserPaliers = (liste) => q.kvSet.run('dons.paliers', JSON.stringify(liste));

const SUFFIXES = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** « 5M », « 2.5b », « 750 000 » -> entier, ou null si illisible. */
export function lireMontant(texte) {
  const r = String(texte ?? '').replace(/[\s$_]/g, '').replace(/,(?=\d{3}\b)/g, '')
    .match(/^(\d+(?:[.,]\d+)?)([kmbt])?$/i);
  if (!r) return null;
  const v = Math.round(Number(r[1].replace(',', '.')) * (r[2] ? SUFFIXES[r[2].toLowerCase()] : 1));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
/** « 500M, 1B, 5B » -> [5e8, 1e9, 5e9]. Rend { paliers } ou { erreur }. */
export function lirePaliers(texte) {
  const morceaux = String(texte ?? '').split(/[,;\s]+/).filter(Boolean);
  const liste = [];
  for (const m of morceaux) {
    const r = m.replace(/\$/g, '').match(/^(\d+(?:[.,]\d+)?)([kmbt])?$/i);
    if (!r) return { erreur: `« ${m} » n'est pas un montant (exemples : 500M, 1B, 2.5B).` };
    const v = Math.round(Number(r[1].replace(',', '.')) * (r[2] ? SUFFIXES[r[2].toLowerCase()] : 1));
    if (v < config.dons.min) return { erreur: `${m} est sous le don minimum (${shortMoney(config.dons.min)}).` };
    liste.push(v);
  }
  const uniques = [...new Set(liste)].sort((a, b) => a - b);
  if (!uniques.length) return { erreur: 'Au moins un palier.' };
  if (uniques.length > MAX_PALIERS) return { erreur: `${MAX_PALIERS} paliers au plus.` };
  return { paliers: uniques };
}

export function enregistrerDon(payment, at = Date.now()) {
  q.ajouter.run(payment.from, normName(payment.from), Math.floor(payment.amount), payment.raw ?? null, at);
  return totalDe(payment.from);
}

export const totalDe = (mcName) => q.total.get(normName(mcName)).t;

const qTop = db.prepare(`
  SELECT d.mc_name_norm, MAX(d.mc_name) AS mc_name, SUM(d.amount) AS total, l.discord_id, l.mc_name AS lie
  FROM dons d LEFT JOIN links l ON l.mc_name_norm = d.mc_name_norm
  GROUP BY d.mc_name_norm ORDER BY total DESC LIMIT ?
`);
/** Plus gros donateurs, par compte Minecraft (lies ou non). */
export const classementDons = (limite = 10) => qTop.all(limite).map((r) => ({
  name: r.lie ?? r.mc_name, discordId: r.discord_id ?? null, total: r.total,
}));

/** Index du plus haut palier atteint, -1 si aucun. */
export function palierPour(total, liste = paliers()) {
  let i = -1;
  liste.forEach((p, n) => { if (total >= p) i = n; });
  return i;
}

export const nomRole = (palier) => `Donateur ${shortMoney(palier).replace('$', '')}`;

const cleRole = (palier) => `dons.role.${palier}`;
export const roleDuPalier = (palier) => q.kvGet.get(cleRole(palier))?.v || null;
export const poserRolePalier = (palier, roleId) => q.kvSet.run(cleRole(palier), String(roleId));

/** Tous les roles de donateur connus, pour les retirer d un coup. */
export const rolesDonateur = () => paliers().map(roleDuPalier).filter(Boolean);

/**
 * Cree les roles qui manquent (supprimes a la main compris). Un role neuf nait
 * tout en bas, sous celui du bot : il pourra toujours le donner.
 */
export async function assurerRoles(guild) {
  const couleurs = [0xCD7F32, 0xC0C0C0, 0xFFD700, 0x7FDBFF, 0xB47CFF];
  for (const [n, palier] of paliers().entries()) {
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
export async function majRolesDonateur(guild, discordId, mcName, anciensRoles = []) {
  const membre = await guild.members.fetch(discordId).catch(() => null);
  if (!membre) return -1;
  const palier = mcName ? palierPour(totalDe(mcName)) : -1;
  const garder = palier >= 0 ? roleDuPalier(paliers()[palier]) : null;
  for (const id of new Set([...rolesDonateur(), ...anciensRoles])) {
    if (id === garder) {
      if (!membre.roles.cache.has(id)) await membre.roles.add(id, 'Palier de donateur').catch((e) => console.warn('[don] role :', e.message));
    } else if (membre.roles.cache.has(id)) {
      await membre.roles.remove(id, 'Palier de donateur').catch((e) => console.warn('[don] role :', e.message));
    }
  }
  return palier;
}

/**
 * Repasse sur tous les membres lies apres un changement de paliers ou de
 * roles : chacun garde le role de son palier, et perd ceux qui ne servent
 * plus (`anciensRoles`). Rend le nombre de membres avec un rang.
 */
export async function resynchroniser(guild, anciensRoles = []) {
  let avecRang = 0;
  for (const lien of store.allLinks()) {
    if (!anciensRoles.length && totalDe(lien.mc_name) === 0) continue;
    if (await majRolesDonateur(guild, lien.discord_id, lien.mc_name, anciensRoles) >= 0) avecRang += 1;
  }
  return avecRang;
}
