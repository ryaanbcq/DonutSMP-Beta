// /setup general > Vocaux : le salon hub, la categorie des vocaux perso, et
// l etat des droits du bot. Les roles staff qui gerent les vocaux sont les
// roles admin du bot (page d accueil).

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, PermissionFlagsBits,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { settings } from '../settings.js';
import { reglagesVocaux, vocaux, problemesDroits, balayerVocaux } from './hub.js';

const salon = (id) => (id ? `<#${id}>` : '*à choisir*');

export function pageVocaux(guild, note = '') {
  const hub = reglagesVocaux.hub();
  const cat = reglagesVocaux.categorie();
  const pbs = problemesDroits(guild);
  const staff = settings.rolesAdmin();

  const description = 'Un membre rejoint le **hub** : le bot lui crée son vocal dans la **catégorie**, l\'y déplace'
    + ' et poste un panneau (Verrouiller, Ouvrir, Renommer, Limite, Expulser). Le vocal est supprimé quand il est vide.\n\n'
    + `${hub ? '✅' : '⚠️'} **Hub** · ${salon(hub)}\n`
    + `${cat ? '✅' : '⚠️'} **Catégorie des vocaux** · ${salon(cat)}\n`
    + `${reglagesVocaux.salonLogs() ? '✅' : '➖'} **Logs (ouverts et fermés)** · ${reglagesVocaux.salonLogs() ? salon(reglagesVocaux.salonLogs()) : '*aucun*'}\n`
    + `👮 **Staff** · ${staff.length ? staff.map((r) => `<@&${r}>`).join(' ') : '*rôles admin du bot (page d\'accueil)*'}, plus « Gérer le serveur »\n`
    + `🔊 **Vocaux ouverts** · ${vocaux.tous().length}\n`
    + (hub && cat
      ? (pbs.length ? `\n⚠️ Droits du bot manquants ${pbs.join(' ; ')}.` : '\n🟢 Droits du bot : OK (Voir, Se connecter, Gérer les salons, Déplacer des membres, Gérer les permissions).')
      : '\n➖ Choisissez le hub et la catégorie pour activer les vocaux.')
    + (note ? `\n\n${note}` : '');

  const menuHub = new ChannelSelectMenuBuilder().setCustomId('gsetup:vocaux:hub')
    .setPlaceholder('🎧 Salon hub (vocal à rejoindre)').setChannelTypes(ChannelType.GuildVoice).setMinValues(0).setMaxValues(1);
  if (hub) menuHub.setDefaultChannels(hub);
  const menuCat = new ChannelSelectMenuBuilder().setCustomId('gsetup:vocaux:cat')
    .setPlaceholder('📁 Catégorie des vocaux perso').setChannelTypes(ChannelType.GuildCategory).setMinValues(0).setMaxValues(1);
  if (cat) menuCat.setDefaultChannels(cat);
  const menuLogs = new ChannelSelectMenuBuilder().setCustomId('gsetup:vocaux:logs')
    .setPlaceholder('📋 Logs des vocaux ouverts et fermés (staff)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (reglagesVocaux.salonLogs()) menuLogs.setDefaultChannels(reglagesVocaux.salonLogs());

  return {
    embeds: [embed('🔊・VOCAUX', { couleur: FR.bleu, description })],
    components: [
      new ActionRowBuilder().addComponents(menuHub),
      new ActionRowBuilder().addComponents(menuCat),
      new ActionRowBuilder().addComponents(menuLogs),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:vocaux:creer').setLabel('Tout créer pour moi').setEmoji('✨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('gsetup:vocaux:off').setLabel('Désactiver').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
          .setDisabled(!hub),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onVocauxSelect(interaction, id) {
  const valeur = interaction.values[0] ?? '';
  if (id === 'vocaux:hub') reglagesVocaux.poserHub(valeur);
  if (id === 'vocaux:cat') reglagesVocaux.poserCategorie(valeur);
  if (id === 'vocaux:logs') {
    reglagesVocaux.poserSalonLogs(valeur);
    // Salon staff : les roles admin du bot le voient, comme les autres logs.
    const s = valeur ? interaction.guild.channels.cache.get(valeur) : null;
    for (const r of s ? settings.rolesAdmin() : []) {
      await s.permissionOverwrites.edit(r, { ViewChannel: true, ReadMessageHistory: true }, { reason: 'Rôle staff du bot' }).catch(() => {});
    }
  }
  return interaction.update(pageVocaux(interaction.guild, valeur ? `✅ <#${valeur}> enregistré.` : '✅ Retiré.'));
}

export async function onVocauxBouton(interaction, id) {
  const { guild } = interaction;
  if (id === 'vocaux:off') {
    reglagesVocaux.poserHub('');
    return interaction.update(pageVocaux(guild, '✅ Hub retiré : plus aucun vocal ne sera créé. Les vocaux ouverts disparaissent quand ils se vident.'));
  }
  if (id === 'vocaux:creer') {
    await interaction.deferUpdate();
    try {
      let cat = guild.channels.cache.get(reglagesVocaux.categorie());
      if (!cat) {
        cat = await guild.channels.create({ name: '🔊 VOCAUX', type: ChannelType.GuildCategory, reason: 'Vocaux perso' });
        reglagesVocaux.poserCategorie(cat.id);
      }
      let hub = guild.channels.cache.get(reglagesVocaux.hub());
      if (!hub) {
        hub = await guild.channels.create({
          name: '➕ Créer un vocal',
          type: ChannelType.GuildVoice,
          parent: cat.id,
          // On rejoint le hub, on n y parle pas.
          permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.Speak] }],
          reason: 'Hub des vocaux perso',
        });
        reglagesVocaux.poserHub(hub.id);
      }
      await balayerVocaux(interaction.client).catch(() => {});
      return interaction.editReply(pageVocaux(guild, `✅ Hub <#${hub.id}> dans la catégorie <#${cat.id}>.`));
    } catch (e) {
      return interaction.editReply(pageVocaux(guild, `❌ ${e.message} (il faut au bot **Gérer les salons**).`));
    }
  }
}
