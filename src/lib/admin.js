import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { config } from '../config.js';

/**
 * Qui a acces aux commandes staff du bot.
 *
 * « Gerer le serveur » ouvre toujours l acces : c est la permission Discord
 * qui designe deja les responsables du serveur, et la retirer enfermerait
 * dehors le proprietaire le jour ou ADMIN_ROLE_ID pointe un role supprime.
 * Le role et les ids du .env s ajoutent a elle, ils ne la remplacent pas.
 *
 * Le membre peut arriver sous deux formes : un GuildMember de discord.js
 * (permissions et roles sont des objets) ou le membre brut de l interaction
 * quand la guilde n est pas en cache (permissions est une chaine de bits,
 * roles un tableau d ids). Avant, la forme brute refusait tout le monde sauf
 * le proprietaire : seule « la couronne » avait les commandes.
 *
 * `reglages` n est passe que par les tests : config.js lit process.env une
 * seule fois, au chargement du module.
 */
const liste = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => x.trim()).filter(Boolean);
let rolesAdminLus = () => liste(config.discord.adminRoleId);
/** Branche par settings.js : le role staff peut etre pose par /setup general. */
export function brancherRoleAdmin(fn) { rolesAdminLus = fn; }

function gereLeServeur(membre) {
  const p = membre.permissions;
  if (!p) return false;
  if (typeof p.has === 'function') return p.has(PermissionFlagsBits.ManageGuild);
  try { return new PermissionsBitField(BigInt(p)).has(PermissionFlagsBits.ManageGuild); } catch { return false; }
}

function aLeRole(membre, id) {
  const r = membre.roles;
  if (!r) return false;
  if (typeof r.cache?.has === 'function') return r.cache.has(id);
  if (Array.isArray(r)) return r.includes(id);
  return false;
}

export function estAdmin(membre, reglages = null) {
  if (!membre) return false;
  if (gereLeServeur(membre)) return true;
  const roles = reglages ? liste(reglages.adminRoleId) : rolesAdminLus();
  if (roles.some((r) => aLeRole(membre, r))) return true;
  const id = membre.id ?? membre.user?.id;
  if (Boolean(id) && ((reglages ?? config.discord).adminUserIds ?? []).includes(id)) return true;
  // Trace du refus dans donut logs discord : on voit tout de suite si c est
  // un role manquant ou une forme de membre inattendue.
  if (!reglages) {
    const siens = Array.isArray(membre.roles) ? membre.roles : [...(membre.roles?.cache?.keys?.() ?? [])];
    console.log(`[admin] refus ${id ?? '?'} : roles admin attendus [${roles.join(', ') || 'aucun'}], roles du membre [${siens.join(', ')}], gere le serveur : non`);
  }
  return false;
}
