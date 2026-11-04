// Role « habs » donne par les moderateurs : /habs membre, ou +habs @membre
// (+unhabs @membre ou /habs membre retirer:oui pour l enlever).
//
// Qui peut : ceux qui ont le droit de mute (/setup general > Modération).
// Le role : kv mod.roleHabs, sinon le premier role dont le nom contient « habs ».

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { journal } from '../ops/journal.js';
import { peutSanctionner } from './actions.js';

export const PERM_HABS = 'mute';

export const reglagesHabs = {
  roleId: () => store.kvGet('mod.roleHabs') || null,
  poserRole: (id) => store.kvSet('mod.roleHabs', id ? String(id) : ''),
};

export function roleHabs(guild) {
  const id = reglagesHabs.roleId();
  if (id) return guild.roles.cache.get(id) ?? null;
  return guild.roles.cache.find((r) => /habs/i.test(r.name)) ?? null;
}

/** Donne ou retire le role. Rend { ok, texte }. */
export async function appliquerHabs({ guild, moderateur, id, retirer = false }) {
  if (!peutSanctionner(moderateur, PERM_HABS)) return { ok: false, texte: '🔒 Réservé aux modérateurs.' };
  const role = roleHabs(guild);
  if (!role) return { ok: false, texte: '❌ Aucun rôle « habs » sur le serveur.' };
  const cible = await guild.members.fetch(id).catch(() => null);
  if (!cible) return { ok: false, texte: `❌ <@${id}> n'est pas sur le serveur.` };
  if (cible.user.bot) return { ok: false, texte: '❌ Pas sur un bot.' };
  const moi = guild.members.me;
  if (role.position >= (moi?.roles.highest.position ?? 0)) {
    return { ok: false, texte: `❌ Le rôle ${role} est au-dessus du bot : remonte le rôle du bot dans la liste.` };
  }
  const a = cible.roles.cache.has(role.id);
  if (!retirer && a) return { ok: false, texte: `ℹ️ ${cible} a déjà le rôle ${role}.` };
  if (retirer && !a) return { ok: false, texte: `ℹ️ ${cible} n'a pas le rôle ${role}.` };
  const par = moderateur.user?.tag ?? moderateur.id;
  if (retirer) await cible.roles.remove(role, `Retiré par ${par}`);
  else await cible.roles.add(role, `Donné par ${par}`);
  console.log(`[habs] ${cible.user.tag} : role ${role.name} ${retirer ? 'retire' : 'donne'} par ${par}`);
  journal({
    niveau: 'info', titre: `Rôle ${role.name}`,
    texte: `${cible} : rôle **${role.name}** ${retirer ? 'retiré' : 'donné'} par <@${moderateur.id}>.`,
  });
  return { ok: true, texte: `✅ ${cible} ${retirer ? 'n\'a plus' : 'a maintenant'} le rôle ${role}.` };
}

export const data = new SlashCommandBuilder()
  .setName('habs')
  .setDescription('Donner (ou retirer) le rôle habs à un membre')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('joueur').setDescription('Le membre').setRequired(true))
  .addBooleanOption((o) => o.setName('retirer').setDescription('Retirer le rôle au lieu de le donner').setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await appliquerHabs({
    guild: interaction.guild, moderateur: interaction.member,
    id: interaction.options.getUser('joueur', true).id, retirer: interaction.options.getBoolean('retirer') ?? false,
  });
  return interaction.editReply({ content: r.texte, allowedMentions: { parse: [] } });
}
