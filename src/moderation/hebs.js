// /hebs : met un membre en PRISON (role Prison) : /hebs membre, ou +hebs @membre
// (+unhebs @membre ou /hebs membre retirer:oui pour l enlever).
//
// Qui peut : ceux qui ont le droit de mute (/setup general > Modération).
// Le role : kv mod.roleHebs, sinon le role Prison de la prod (ROLE_PRISON),
// sinon le premier role dont le nom contient « prison » ou « hebs » (beta).
//
// La prison survit a un depart : la liste des prisonniers (kv mod.prison) est
// tenue a jour a chaque pose ou retrait du role (commande, ou a la main), et
// le role est remis des que le membre revient sur le serveur.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { config } from '../config.js';
import { journal } from '../ops/journal.js';
import { peutSanctionner } from './actions.js';

export const PERM_HEBS = 'mute';
// Role Prison du serveur DonutSMP FR (Ryan, 04/11). Un ID de role n est pas un secret.
export const ROLE_PRISON = '1491851506390011924';

export const reglagesHebs = {
  roleId: () => store.kvGet('mod.roleHebs') || null,
  poserRole: (id) => store.kvSet('mod.roleHebs', id ? String(id) : ''),
};

const lirePrison = () => { try { return new Set(JSON.parse(store.kvGet('mod.prison') ?? '[]')); } catch { return new Set(); } };
const ecrirePrison = (set) => store.kvSet('mod.prison', JSON.stringify([...set]));
export const prison = {
  liste: () => [...lirePrison()],
  a: (id) => lirePrison().has(String(id)),
  poser: (id, dedans) => {
    const set = lirePrison();
    if (dedans) set.add(String(id)); else set.delete(String(id));
    ecrirePrison(set);
  },
};

export function roleHebs(guild) {
  const id = reglagesHebs.roleId();
  if (id) return guild.roles.cache.get(id) ?? null;
  return guild.roles.cache.get(ROLE_PRISON) ?? guild.roles.cache.find((r) => /prison|hebs/i.test(r.name)) ?? null;
}

/** Donne ou retire le role. Rend { ok, texte }. */
export async function appliquerHebs({ guild, moderateur, id, retirer = false }) {
  if (!peutSanctionner(moderateur, PERM_HEBS)) return { ok: false, texte: '🔒 Réservé aux modérateurs.' };
  const role = roleHebs(guild);
  if (!role) return { ok: false, texte: '❌ Aucun rôle Prison sur le serveur.' };
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
  prison.poser(cible.id, !retirer);
  console.log(`[hebs] ${cible.user.tag} : role ${role.name} ${retirer ? 'retire' : 'donne'} par ${par}`);
  journal({
    niveau: 'info', titre: `Rôle ${role.name}`,
    texte: `${cible} : rôle **${role.name}** ${retirer ? 'retiré' : 'donné'} par <@${moderateur.id}>.`,
  });
  return { ok: true, texte: `✅ ${cible} ${retirer ? 'n\'a plus' : 'a maintenant'} le rôle ${role}.` };
}

export const data = new SlashCommandBuilder()
  .setName('hebs')
  .setDescription('Mettre un membre en prison (ou l\'en sortir)')
  .setDMPermission(false)
  .addUserOption((o) => o.setName('joueur').setDescription('Le membre').setRequired(true))
  .addBooleanOption((o) => o.setName('retirer').setDescription('Sortir le membre de prison').setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await appliquerHebs({
    guild: interaction.guild, moderateur: interaction.member,
    id: interaction.options.getUser('joueur', true).id, retirer: interaction.options.getBoolean('retirer') ?? false,
  });
  return interaction.editReply({ content: r.texte, allowedMentions: { parse: [] } });
}

// ------------------------------------------------------------------ persistance

async function surArrivee(membre) {
  if (membre.guild.id !== config.discord.guildId || !prison.a(membre.id)) return;
  const role = roleHebs(membre.guild);
  if (!role || membre.roles.cache.has(role.id)) return;
  await membre.roles.add(role, 'Revenu sur le serveur : toujours en prison');
  console.log(`[hebs] ${membre.user.tag} revenu : role ${role.name} remis`);
  journal({ niveau: 'info', titre: `Rôle ${role.name}`, texte: `${membre} est revenu sur le serveur : remis en **${role.name}**.` });
}

function surMaj(ancien, membre) {
  if (membre.guild.id !== config.discord.guildId) return;
  const role = roleHebs(membre.guild);
  if (!role || !ancien?.roles?.cache) return;
  const avant = ancien.roles.cache.has(role.id);
  const apres = membre.roles.cache.has(role.id);
  if (avant !== apres) prison.poser(membre.id, apres);
}

/** Au demarrage : la liste suit le role (poses ou retraits faits bot eteint). Un absent reste dans la liste. */
async function synchroniser(guild) {
  const role = roleHebs(guild);
  if (!role) return console.log('[hebs] aucun role Prison : persistance inactive');
  const membres = await guild.members.fetch().catch(() => guild.members.cache);
  const set = new Set(prison.liste());
  for (const m of membres.values()) {
    if (m.roles.cache.has(role.id)) set.add(m.id); else set.delete(m.id);
  }
  ecrirePrison(set);
  console.log(`[hebs] role ${role.name} : ${set.size} prisonnier(s) suivi(s)`);
}

export function demarrerHebs(client) {
  client.on('guildMemberAdd', (m) => surArrivee(m).catch((e) => console.warn('[hebs] retour :', e.message)));
  client.on('guildMemberUpdate', (a, b) => { try { surMaj(a, b); } catch (e) { console.warn('[hebs] :', e.message); } });
  const guild = client.guilds.cache.get(config.discord.guildId);
  if (guild) synchroniser(guild).catch((e) => console.warn('[hebs] synchro :', e.message));
}
