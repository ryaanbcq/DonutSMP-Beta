import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelType, PermissionFlagsBits,
} from 'discord.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { verrouiller, peutVerrouiller } from '../lib/salon.js';
import { panneauVouch } from './panel.js';
import { assurerFils } from './fils.js';

// /setup vouches : le forum, le salon du panneau, le role Trusted, tout a
// la souris. Meme principe que le setup des tickets.

export function rendreSetupVouch(guild, note = '') {
  const forum = settings.salonVouch();
  const salon = store.kvGet('vouch.salonPanneau');
  const role = settings.roleTrusted();
  const manque = [];
  const moi = guild.members.me;
  if (moi && !moi.permissions.has(PermissionFlagsBits.ManageThreads)) manque.push('Gérer les fils');
  if (moi && !moi.permissions.has(PermissionFlagsBits.ManageChannels)) manque.push('Gérer les salons (tags du forum)');

  const contenu = embed('⚙️・CONFIGURATION DES VOUCHES', {
    couleur: FR.or,
    description:
      'Choisissez chaque élément ci-dessous, tout est enregistré immédiatement.\n\n'
      + `**Forum des réputations** · ${forum ? `<#${forum}>` : 'à choisir'}\n`
      + `**Salon du panneau** · ${salon ? `<#${salon}>` : 'pas encore publié'}\n`
      + `**Rôle Trusted** · ${role ? `<@&${role}>` : 'aucun'}\n`
      + `**Posts ouverts** · ${store.allLinks().filter((l) => store.getThread(l.discord_id)).length} / ${store.countLinks()} membres vérifiés`
      + (manque.length ? `\n\n⚠️ Il me manque **${manque.join('** et **')}**.` : '')
      + (note ? `\n\n${note}` : ''),
  });

  const forumMenu = new ChannelSelectMenuBuilder().setCustomId('vsetup:forum')
    .setPlaceholder('🗂️ Forum des réputations (un post par membre)').setChannelTypes(ChannelType.GuildForum);
  if (forum) forumMenu.setDefaultChannels(forum);

  const salonMenu = new ChannelSelectMenuBuilder().setCustomId('vsetup:salon')
    .setPlaceholder('⭐ Salon du panneau membres (le publie aussitôt)').setChannelTypes(ChannelType.GuildText);
  if (salon) salonMenu.setDefaultChannels(salon);

  const roleMenu = new RoleSelectMenuBuilder().setCustomId('vsetup:role')
    .setPlaceholder('🥇 Rôle donné au palier Trusted').setMinValues(0).setMaxValues(1);
  if (role) roleMenu.setDefaultRoles(role);

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vsetup:republier').setLabel('Republier le panneau').setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary).setDisabled(!salon || !forum),
    new ButtonBuilder().setCustomId('vsetup:posts').setLabel('Ouvrir les posts manquants').setEmoji('🧵')
      .setStyle(ButtonStyle.Primary).setDisabled(!forum),
  );

  return {
    embeds: [contenu],
    components: [forumMenu, salonMenu, roleMenu].map((m) => new ActionRowBuilder().addComponents(m)).concat(boutons),
  };
}

export async function publierPanneauVouch(guild, salonId) {
  const forum = settings.salonVouch();
  if (!forum) throw new Error('choisissez d\'abord le forum');
  const salon = await guild.channels.fetch(salonId).catch(() => null);
  if (!salon?.isTextBased?.()) throw new Error('salon introuvable');

  const recents = await salon.messages.fetch({ limit: 50 }).catch(() => null);
  const mien = recents?.find((m) => m.author.id === guild.client.user.id
    && m.components?.some((r) => r.components.some((c) => c.customId === 'vouch:ouvrir')));
  if (mien) {
    await mien.edit(panneauVouch(forum));
    return 'panneau mis à jour';
  }
  await salon.send(panneauVouch(forum));
  store.kvSet('vouch.salonPanneau', salon.id);
  const moi = guild.members.me;
  if (peutVerrouiller(salon, moi)) {
    await verrouiller(salon, moi).catch(() => {});
    return 'panneau publié, salon verrouillé';
  }
  return 'panneau publié, salon non verrouillé (il me faut « Gérer les rôles » dessus)';
}

export async function onVsetupSelect(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;
  let note = '';
  if (id === 'vsetup:forum') {
    settings.poserSalonVouch(interaction.values[0]);
    await interaction.deferUpdate();
    const n = await assurerFils(interaction.client).catch(() => 0);
    note = `✅ Forum enregistré, ${n} post(s) ouvert(s).`;
    return interaction.editReply(rendreSetupVouch(guild, note));
  }
  if (id === 'vsetup:salon') {
    await interaction.deferUpdate();
    try {
      const n = await publierPanneauVouch(guild, interaction.values[0]);
      store.kvSet('vouch.salonPanneau', interaction.values[0]);
      note = `✅ <#${interaction.values[0]}> : ${n}.`;
    } catch (err) {
      note = `❌ ${err.message}`;
    }
    return interaction.editReply(rendreSetupVouch(guild, note));
  }
  if (id === 'vsetup:role') {
    settings.poserRoleTrusted(interaction.values[0] ?? '');
    note = interaction.values[0] ? '✅ Rôle Trusted enregistré, posé au prochain avis de chacun.' : '✅ Plus de rôle Trusted.';
    return interaction.update(rendreSetupVouch(guild, note));
  }
}

export async function onVsetupBouton(interaction) {
  const guild = interaction.guild;
  await interaction.deferUpdate();
  if (interaction.customId === 'vsetup:republier') {
    const salon = store.kvGet('vouch.salonPanneau');
    const note = await publierPanneauVouch(guild, salon).then((n) => `✅ ${n}.`).catch((e) => `❌ ${e.message}`);
    return interaction.editReply(rendreSetupVouch(guild, note));
  }
  if (interaction.customId === 'vsetup:posts') {
    const n = await assurerFils(interaction.client).catch((e) => `erreur : ${e.message}`);
    return interaction.editReply(rendreSetupVouch(guild, `✅ ${n} post(s) ouvert(s).`));
  }
}
