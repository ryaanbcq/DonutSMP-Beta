// Recuperation des vouches de l ancien forum depuis un ticket. Les membres
// n ont plus acces a l ancien forum (« vouchs-ancien ») : c est le bot qui
// cherche le post du membre (auteur du post d abord, sinon nom du post qui
// contient son pseudo ou son nom Discord) et propose au staff un bouton qui
// lance l import (meme fiche que /importer-vouches).

import { ChannelType, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { scannerFil } from '../vouch/reclamation.js';

const simple = (n) => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]/g, '');

/** Le forum des anciens vouches : reglage, sinon un forum dont le nom contient « ancien ». */
export function forumAnciens(guild) {
  const id = store.kvGet('support.forumAnciens');
  const regle = id ? guild.channels.cache.get(id) : null;
  if (regle?.type === ChannelType.GuildForum) return regle;
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildForum && simple(c.name).includes('ancien')
    && c.id !== settings.salonVouch()) ?? null;
}

let cache = null; // { forumId, at, fils }

async function tousLesFils(forum) {
  if (cache?.forumId === forum.id && Date.now() - cache.at < 10 * 60_000) return cache.fils;
  const fils = new Map();
  const actifs = await forum.threads.fetchActive().catch(() => null);
  for (const [id, f] of actifs?.threads ?? []) fils.set(id, f);
  let avant;
  for (let page = 0; page < 20; page += 1) {
    const r = await forum.threads.fetchArchived({ limit: 100, before: avant }).catch(() => null);
    if (!r?.threads.size) break;
    for (const [id, f] of r.threads) fils.set(id, f);
    if (!r.hasMore) break;
    avant = r.threads.last();
  }
  cache = { forumId: forum.id, at: Date.now(), fils: [...fils.values()] };
  return cache.fils;
}

/** Les posts de l ancien forum qui semblent etre ceux du membre (3 au plus). */
export async function chercherFils(guild, discordId) {
  const forum = forumAnciens(guild);
  if (!forum) return { forum: null, fils: [] };
  const fils = await tousLesFils(forum);
  const lien = store.getLink(discordId);
  const m = guild.members.cache.get(discordId) ?? await guild.members.fetch(discordId).catch(() => null);
  const noms = [lien?.mc_name, m?.displayName, m?.user.username, m?.user.globalName].map(simple).filter((n) => n.length >= 3);
  const siens = fils.filter((f) => f.ownerId === discordId);
  const parNom = fils.filter((f) => f.ownerId !== discordId && noms.some((n) => simple(f.name).includes(n)));
  return { forum, fils: [...siens, ...parNom].slice(0, 3), parAuteur: siens.length > 0 };
}

/** Bouton staff « Importer » : support:import:<filId>:<membreId>. */
export async function onBoutonImport(interaction) {
  const [, , filId, membreId] = interaction.customId.split(':');
  if (!filId || !membreId) return interaction.reply({ content: '❌ Bouton invalide.', flags: MessageFlags.Ephemeral });
  const url = `https://discord.com/channels/${interaction.guildId}/${filId}`;
  return scannerFil(interaction, url, { id: membreId });
}
