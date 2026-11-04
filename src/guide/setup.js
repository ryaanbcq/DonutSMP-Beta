// /setup general > Guide staff : le salon ou le bot tient le guide a jour.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { reglagesGuide, publierGuide } from './staff.js';
import { reglagesSuggestions, publierAccueil } from '../suggestions/salon.js';

export function pageGuide(note = '') {
  const id = reglagesGuide.salon();
  const menu = new ChannelSelectMenuBuilder().setCustomId('gsetup:guide:salon')
    .setPlaceholder('📘 Salon du guide (staff)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (id) menu.setDefaultChannels(id);
  const sug = reglagesSuggestions.salon();
  const menuSug = new ChannelSelectMenuBuilder().setCustomId('gsetup:guide:suggestions')
    .setPlaceholder('💡 Salon des suggestions pour le bot').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (sug) menuSug.setDefaultChannels(sug);
  return {
    embeds: [embed('📘・GUIDE STAFF', {
      couleur: FR.bleu,
      description: 'Le bot publie dans ce salon un guide complet du bot (sanctions, tags, anti-pub, tickets, vouches, vocaux…)'
        + ' et le tient à jour tout seul : préfixe, rôles autorisés et règles sont lus dans les réglages.'
        + ' Choisissez un salon que seul le staff voit.\n\n'
        + `${id ? '✅' : '⚠️'} **Salon du guide** · ${id ? `<#${id}>` : '*à choisir*'}\n`
        + `${sug ? '✅' : '➖'} **Suggestions** · ${sug ? `<#${sug}>` : '*aucun*'} (le bot met ✅ sous chaque message, les ✅ servent de vote)`
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(menuSug),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:guide:republier').setLabel('Republier').setEmoji('🔄').setStyle(ButtonStyle.Primary)
          .setDisabled(!id),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onGuideSelect(interaction) {
  if (interaction.customId === 'gsetup:guide:suggestions') {
    const v = interaction.values[0] ?? '';
    reglagesSuggestions.poserSalon(v);
    if (v) reglagesSuggestions.poserAccueil('');
    await interaction.deferUpdate();
    const n = v ? await publierAccueil(interaction.client).catch((e) => `❌ ${e.message}`) : null;
    return interaction.editReply(pageGuide(v ? `✅ <#${v}> : ${n}.` : '✅ Plus de salon des suggestions.'));
  }
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
