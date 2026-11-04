// Carte du relais humain (pure, sans base : testable).

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { FR } from '../lib/brand.js';

export const ETATS = {
  attente: { couleur: FR.jaune, pied: 'En attente d\'un membre du staff' },
  pris: { couleur: FR.vert, pied: 'Pris en charge' },
  ferme: { couleur: 0x4f545c, pied: 'Ticket fermé' },
};

/** La carte du relais. */
export function carteRelais({ ticket, nom, avatar, resume, infos = [], etat = 'attente', par = null, guildId }) {
  const e = ETATS[etat] ?? ETATS.attente;
  const lignes = infos.map((i) => String(i).trim()).filter(Boolean).slice(0, 8).map((i) => `• ${escapeMarkdown(i).slice(0, 180)}`);
  const carte = new EmbedBuilder().setColor(e.couleur)
    .setAuthor({ name: '🆘・BESOIN D\'UN HUMAIN' })
    .setDescription(`### ${escapeMarkdown(nom)} a besoin d'aide\n> ${escapeMarkdown(String(resume ?? '').trim() || 'Demande à reprendre.').slice(0, 400)}`)
    .setFooter({ text: `${e.pied}${par ? ` · ${par}` : ''} · ticket #${ticket.id} · ${ticket.categorie ?? 'sans catégorie'}`.slice(0, 2048) })
    .setTimestamp(Date.now());
  if (avatar) carte.setThumbnail(avatar);
  if (lignes.length) carte.addFields({ name: '📋 Infos collectées', value: lignes.join('\n').slice(0, 1024) });
  const bouton = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ouvrir le ticket').setEmoji('🎫')
    .setURL(`https://discord.com/channels/${guildId}/${ticket.channel_id}`);
  return { embeds: [carte], components: [new ActionRowBuilder().addComponents(bouton)], allowedMentions: { parse: [] } };
}

