// Quota de bans par role (Ryan, 08/11) : Moderateur 3 bans, Sr Moderateur 10
// bans, sur 7 jours glissants. Le role qui donne le plus haut quota compte.
// Bans temporaires et definitifs comptent ; un unban ne rend pas de credit.
// Pas de quota : proprietaire, permission Administrateur, ou role au niveau du
// role « Administrateur » ou au-dessus, ou aucun role a quota.
//
//   kv mod.quotaBans  { roleId: n }  (vide = defaut par nom de role : Sr Moderateur 10, Moderateur 3)
//   kv mod.bansFaits  { modId: [ts...] }  (purge au-dela de 7 jours)

import { PermissionFlagsBits } from 'discord.js';
import { store } from '../db.js';

export const FENETRE_MS = 7 * 86_400_000;
const json = (cle, defaut) => { try { return JSON.parse(store.kvGet(cle) ?? '') ?? defaut; } catch { return defaut; } };

export const reglagesQuota = {
  quotas: () => json('mod.quotaBans', {}),
  poser: (roleId, n) => {
    const q = json('mod.quotaBans', {});
    if (n > 0) q[roleId] = n; else delete q[roleId];
    store.kvSet('mod.quotaBans', JSON.stringify(q));
  },
  bans: (modId, now = Date.now()) => (json('mod.bansFaits', {})[modId] ?? []).filter((t) => now - t < FENETRE_MS),
  noterBan: (modId, now = Date.now()) => {
    const tous = json('mod.bansFaits', {});
    for (const [id, l] of Object.entries(tous)) {
      const f = l.filter((t) => now - t < FENETRE_MS);
      if (f.length) tous[id] = f; else delete tous[id];
    }
    tous[modId] = [...(tous[modId] ?? []), now];
    store.kvSet('mod.bansFaits', JSON.stringify(tous));
    return tous[modId].length;
  },
};

/** Quotas effectifs : ceux de /setup, sinon par nom de role. Rend Map roleId -> n. */
export function quotasDe(guild, reglages = reglagesQuota.quotas()) {
  const m = new Map(Object.entries(reglages).map(([k, v]) => [k, Number(v)]).filter(([, v]) => v > 0));
  if (m.size || !guild) return m;
  for (const r of guild.roles.cache.values()) {
    if (/sr\.?\s*mod[ée]rat/i.test(r.name)) m.set(r.id, 10);
    else if (/(^|\W)mod[ée]rateur/i.test(r.name)) m.set(r.id, 3);
  }
  return m;
}

/**
 * Limite de bans du membre : { limite, roleId } ou null (pas de quota).
 * Fonction pure : membre = { id, roleIds:Set, admin:bool, positionMax }, guild = { ownerId, positionAdmin }.
 */
export function limiteDe({ id, roleIds, admin, positionMax }, { ownerId, positionAdmin = null }, quotas) {
  if (id === ownerId || admin) return null;
  if (positionAdmin != null && positionMax >= positionAdmin) return null;
  let best = null;
  for (const [roleId, n] of quotas) if (roleIds.has(roleId) && (!best || n > best.limite)) best = { limite: n, roleId };
  return best;
}

/** Le meme calcul depuis un GuildMember discord.js. */
export function limitePourMembre(membre) {
  const guild = membre.guild;
  const roleAdmin = guild.roles.cache.filter((r) => /administrateur/i.test(r.name)).sort((a, b) => a.position - b.position).first();
  return limiteDe(
    { id: membre.id, roleIds: new Set(membre.roles.cache.keys()), admin: membre.permissions.has(PermissionFlagsBits.Administrator), positionMax: membre.roles.highest.position },
    { ownerId: guild.ownerId, positionAdmin: roleAdmin?.position ?? null },
    quotasDe(guild),
  );
}

/** Peut-il bannir maintenant ? { ok, limite, faits, roleId, prochain } */
export function verifierQuota(membre, now = Date.now()) {
  const l = limitePourMembre(membre);
  if (!l) return { ok: true, limite: null };
  const faits = reglagesQuota.bans(membre.id, now);
  const tri = [...faits].sort((a, b) => a - b);
  const prochain = faits.length >= l.limite ? tri[faits.length - l.limite] + FENETRE_MS : null;
  return { ok: faits.length < l.limite, limite: l.limite, faits: faits.length, roleId: l.roleId, prochain };
}
