import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

/**
 * Qui a acces aux commandes staff du bot.
 *
 * « Gerer le serveur » ouvre toujours l acces : c est la permission Discord
 * qui designe deja les responsables du serveur, et la retirer enfermerait
 * dehors le proprietaire le jour ou ADMIN_ROLE_ID pointe un role supprime.
 * Le role et les ids du .env s ajoutent a elle, ils ne la remplacent pas.
 *
 * `reglages` n est passe que par les tests : config.js lit process.env une
 * seule fois, au chargement du module.
 */
export function estAdmin(membre, reglages = config.discord) {
  if (!membre) return false;
  if (membre.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = reglages.adminRoleId;
  if (roleId && membre.roles?.cache?.has?.(roleId)) return true;
  const id = membre.id ?? membre.user?.id;
  return Boolean(id) && (reglages.adminUserIds ?? []).includes(id);
}
