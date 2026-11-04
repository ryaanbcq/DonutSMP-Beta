// /setup general > Vocaux : le salon hub, la categorie des vocaux perso, et
// l etat des droits du bot. Les roles staff qui gerent les vocaux sont les
// roles admin du bot (page d accueil).

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, ModalBuilder, PermissionFlagsBits,
  RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle,
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

  const conf = reglagesVocaux.conf();
  const description = 'Un membre rejoint le **hub** : le bot lui crée son vocal dans la **catégorie**, l\'y déplace'
    + ' et poste un panneau (réglages, permissions, sauvegarde). Commande `/vocal` en plus. Le vocal est supprimé quand il est vide,'
    + ' et passe à quelqu\'un d\'autre si son propriétaire part. Caméra, soundboard et invitations : boosters seulement.\n\n'
    + `${hub ? '✅' : '⚠️'} **Hub** · ${salon(hub)}\n`
    + `${cat ? '✅' : '⚠️'} **Catégorie des vocaux** · ${salon(cat)}\n`
    + `${reglagesVocaux.salonLogs() ? '✅' : '➖'} **Logs (ouverts et fermés)** · ${reglagesVocaux.salonLogs() ? salon(reglagesVocaux.salonLogs()) : '*aucun*'}\n`
    + `👮 **Staff** · ${staff.length ? staff.map((r) => `<@&${r}>`).join(' ') : '*rôles admin du bot (page d\'accueil)*'}, plus « Gérer le serveur »\n`
    + `✏️ **Nom par défaut** · ${conf.modele}  ·  👥 **Limite** · ${conf.limite || 'aucune'}  ·  📨 **Entre deux invitations** · ${conf.attenteInvitations} min\n`
    + `🛡️ **Rôles protégés** (jamais expulsés ni refusés) · ${conf.rolesProteges.length ? conf.rolesProteges.map((r) => `<@&${r}>`).join(' ') : '*aucun*'}\n`
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

  const menuProteges = new RoleSelectMenuBuilder().setCustomId('gsetup:vocaux:proteges')
    .setPlaceholder('🛡️ Rôles protégés (jamais expulsés ni refusés)').setMinValues(0).setMaxValues(10);
  if (conf.rolesProteges.length) menuProteges.setDefaultRoles(...conf.rolesProteges.slice(0, 10));

  return {
    embeds: [embed('🔊・VOCAUX', { couleur: FR.bleu, description })],
    components: [
      new ActionRowBuilder().addComponents(menuHub),
      new ActionRowBuilder().addComponents(menuCat),
      new ActionRowBuilder().addComponents(menuLogs),
      new ActionRowBuilder().addComponents(menuProteges),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:vocaux:defauts').setLabel('Nom et limite par défaut').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gsetup:vocaux:creer').setLabel('Tout créer pour moi').setEmoji('✨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('gsetup:vocaux:off').setLabel('Désactiver').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
          .setDisabled(!hub),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onVocauxSelect(interaction, id) {
  if (id === 'vocaux:proteges') {
    reglagesVocaux.poserConf({ rolesProteges: [...interaction.values] });
    return interaction.update(pageVocaux(interaction.guild, '✅ Rôles protégés enregistrés.'));
  }
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
  if (id === 'vocaux:defauts') {
    const c = reglagesVocaux.conf();
    const champ = (cid, label, valeur, max, requis = true) => new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(requis).setMaxLength(max).setValue(String(valeur)));
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:vocaux:defauts').setTitle('Vocaux : réglages par défaut').addComponents(
      champ('modele', 'Nom ({pseudo} = nom sur le serveur)', c.modele, 100),
      champ('limite', 'Limite de places (0 = illimité)', c.limite, 2),
      champ('attente', 'Minutes entre deux invitations', c.attenteInvitations, 3),
    ));
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

export async function onVocauxModal(interaction, id) {
  if (id !== 'vocaux:defauts') return;
  const modele = interaction.fields.getTextInputValue('modele').trim() || '🔊 Vocal de {pseudo}';
  const limite = Number.parseInt(interaction.fields.getTextInputValue('limite'), 10);
  const attente = Number.parseInt(interaction.fields.getTextInputValue('attente'), 10);
  if (!Number.isInteger(limite) || limite < 0 || limite > 99 || !Number.isInteger(attente) || attente < 0 || attente > 1440) {
    return interaction.update(pageVocaux(interaction.guild, '❌ Limite entre 0 et 99, invitations entre 0 et 1440 minutes.'));
  }
  reglagesVocaux.poserConf({ modele, limite, attenteInvitations: attente });
  return interaction.update(pageVocaux(interaction.guild, '✅ Réglages par défaut enregistrés (pour les prochains vocaux).'));
}
