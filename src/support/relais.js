// Relais humain : quand le support passe la main au staff, une carte sobre
// part dans le salon du staff (kv support.salonRelais, sinon un salon dont
// le nom contient « general-staff ») : le membre (photo de profil), le
// resume du support, les infos deja rassemblees, et un bouton vers le
// ticket. Une seule carte par ticket, mise a jour a chaque nouvelle
// transmission, puis marquee « pris en charge » ou « ferme ».

import { ChannelType, EmbedBuilder } from 'discord.js';
import { store, db } from '../db.js';
import './reglages.js'; // cree la table support_tickets avant l ALTER
import { ETATS, carteRelais } from './relais-carte.js';

export { carteRelais };

try { db.exec('ALTER TABLE support_tickets ADD COLUMN relais_msg TEXT'); } catch { /* deja la */ }
const q = {
  lire: db.prepare('SELECT relais_msg FROM support_tickets WHERE channel_id = ?'),
  poser: db.prepare('UPDATE support_tickets SET relais_msg = ? WHERE channel_id = ?'),
};

const simple = (n) => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const reglagesRelais = {
  salon: () => store.kvGet('support.salonRelais') || null,
  poserSalon: (id) => store.kvSet('support.salonRelais', id ? String(id) : ''),
};

/** Le salon du relais : reglage, sinon le salon texte « general-staff ». */
export function salonRelais(guild) {
  const id = reglagesRelais.salon();
  const regle = id ? guild.channels.cache.get(id) : null;
  if (regle?.isTextBased?.()) return regle;
  return guild.channels.cache.find((c) => c.type === ChannelType.GuildText && simple(c.name).includes('generalstaff')) ?? null;
}

async function auteur(guild, discordId) {
  const m = guild.members.cache.get(discordId) ?? await guild.members.fetch(discordId).catch(() => null);
  const u = m?.user ?? await guild.client.users.fetch(discordId).catch(() => null);
  return { nom: m?.displayName ?? u?.globalName ?? u?.username ?? 'Un membre', avatar: (m ?? u)?.displayAvatarURL?.({ size: 256 }) ?? null };
}

/**
 * Publie la carte (ou la met a jour si elle existe deja). Rend true si une
 * carte est partie, false s il n y a pas de salon (l appelant garde le journal).
 */
export async function publierRelais(guild, ticket, { resume, infos }) {
  const salon = salonRelais(guild);
  if (!salon) return false;
  const { nom, avatar } = await auteur(guild, ticket.discord_id);
  const contenu = carteRelais({ ticket, nom, avatar, resume, infos, guildId: guild.id });
  const id = q.lire.get(String(ticket.channel_id))?.relais_msg;
  const ancien = id ? await salon.messages.fetch(id).catch(() => null) : null;
  if (ancien) { await ancien.edit(contenu); return true; }
  const m = await salon.send(contenu);
  q.poser.run(m.id, String(ticket.channel_id));
  return true;
}

/** Ticket pris ou ferme : la carte change de couleur, le bouton reste. */
export async function marquerRelais(guild, channelId, etat, par = null) {
  const id = q.lire.get(String(channelId))?.relais_msg;
  const salon = id ? salonRelais(guild) : null;
  const msg = salon ? await salon.messages.fetch(id).catch(() => null) : null;
  if (!msg?.embeds[0]) return;
  const e = ETATS[etat] ?? ETATS.attente;
  const ticket = store.getTicket(channelId);
  const carte = EmbedBuilder.from(msg.embeds[0]).setColor(e.couleur)
    .setFooter({ text: `${e.pied}${par ? ` · ${par}` : ''}${ticket ? ` · ticket #${ticket.id} · ${ticket.categorie ?? 'sans catégorie'}` : ''}`.slice(0, 2048) });
  await msg.edit({ embeds: [carte], components: msg.components }).catch(() => {});
}
