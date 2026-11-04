// /setup general > Guide staff : le salon ou le bot tient le guide a jour.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { reglagesGuide, publierGuide } from './staff.js';

export function pageGuide(note = '') {
  const id = reglagesGuide.salon();
  const menu = new ChannelSelectMenuBuilder().setCustomId('gsetup:guide:salon')
    .setPlaceholder('📘 Salon du guide (staff)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (id) menu.setDefaultChannels(id);
  return {
    embeds: [embed('📘・GUIDE STAFF', {
      couleur: FR.bleu,
      description: 'Le bot publie dans ce salon un guide complet du bot (sanctions, tags, anti-pub, tickets, vouches, vocaux…)'
        + ' et le tient à jour tout seul : préfixe, rôles autorisés et règles sont lus dans les réglages.'
        + ' Choisissez un salon que seul le staff voit.\n\n'
        + `${id ? '✅' : '⚠️'} **Salon** · ${id ? `<#${id}>` : '*à choisir*'}`
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:guide:republier').setLabel('Republier').setEmoji('🔄').setStyle(ButtonStyle.Primary)
          .setDisabled(!id),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onGuideSelect(interaction) {
  const valeur = interaction.values[0] ?? '';
  reglagesGuide.poserSalon(valeur);
  // Un nouveau salon : on repart de zero (les anciens messages restent dans l ancien).
  reglagesGuide.poserMessages([]);
  await interaction.deferUpdate();
  const r = valeur ? await publierGuide(interaction.client, { force: true }).catch((e) => ({ note: `❌ ${e.message}` })) : null;
  return interaction.editReply(pageGuide(valeur ? `✅ <#${valeur}> : ${r.note}.` : '✅ Plus de guide.'));
}

export async function onGuideBouton(interaction) {
  await interaction.deferUpdate();
  const r = await publierGuide(interaction.client, { force: true }).catch((e) => ({ note: `❌ ${e.message}` }));
  return interaction.editReply(pageGuide(`✅ ${r.note}.`));
}
