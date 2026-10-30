// /setup general > Modération : qui peut utiliser /warn, /kick, /mute,
// /unmute, /ban, /unban et /warns. Membres et roles au choix ; rien de choisi
// = les admins du bot.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { registre } from './actions.js';
import { reglagesAntipub, statsModele } from './antipub.js';

export function pageModeration(note = '') {
  const { membres, roles } = registre.autorises();
  const libre = !membres.length && !roles.length;
  const menuMembres = new UserSelectMenuBuilder().setCustomId('gsetup:mod:membres')
    .setPlaceholder('👤 Membres autorisés à sanctionner').setMinValues(0).setMaxValues(25);
  if (membres.length) menuMembres.setDefaultUsers(...membres.slice(0, 25));
  const menuRoles = new RoleSelectMenuBuilder().setCustomId('gsetup:mod:roles')
    .setPlaceholder('🛡️ Rôles autorisés à sanctionner').setMinValues(0).setMaxValues(25);
  if (roles.length) menuRoles.setDefaultRoles(...roles.slice(0, 25));
  return {
    embeds: [embed('🔨・MODÉRATION', {
      couleur: FR.bleu,
      description: 'Qui peut utiliser **/warn**, **/kick**, **/mute**, **/unmute**, **/ban**, **/unban** et **/warns**.\n\n'
        + (libre
          ? '👥 **Aucun choix** : les admins du bot (rôle de /setup general, ou « Gérer le serveur »).'
          : `👤 **Membres** · ${membres.length ? membres.map((id) => `<@${id}>`).join(' ') : '*aucun*'}\n`
            + `🛡️ **Rôles** · ${roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : '*aucun*'}\n\n`
            + 'Eux seuls peuvent sanctionner, admins du bot compris. Videz les deux menus pour revenir aux admins du bot.')
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menuMembres),
      new ActionRowBuilder().addComponents(menuRoles),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onModerationSelect(interaction, id) {
  if (id === 'mod:membres') registre.poserAutorises({ membres: interaction.values });
  else if (id === 'mod:roles') registre.poserAutorises({ roles: interaction.values });
  else return null;
  return interaction.update(pageModeration('✅ Enregistré, effectif tout de suite.'));
}

// ------------------------------------------------------------------ anti-pub

export function pageAntipub(note = '') {
  const r = reglagesAntipub;
  const actif = r.actif();
  const salons = r.salonsExemptes();
  const roles = r.rolesExemptes();
  const menuSalons = new ChannelSelectMenuBuilder().setCustomId('gsetup:antipub:salons')
    .setPlaceholder('📢 Salons où la pub est permise').setChannelTypes(ChannelType.GuildText, ChannelType.GuildCategory, ChannelType.GuildForum)
    .setMinValues(0).setMaxValues(25);
  if (salons.length) menuSalons.setDefaultChannels(...salons.slice(0, 25));
  const menuRoles = new RoleSelectMenuBuilder().setCustomId('gsetup:antipub:roles')
    .setPlaceholder('🛡️ Rôles autorisés à faire de la pub').setMinValues(0).setMaxValues(25);
  if (roles.length) menuRoles.setDefaultRoles(...roles.slice(0, 25));
  const seuil = r.avantMute();
  const mode = r.phrases();
  const s = statsModele();
  const MODES = {
    off: 'Pub sans lien : ignorée',
    alerte: 'Pub sans lien : alerte au staff (rien supprimé)',
    supprimer: 'Pub sans lien : supprimée et avertie',
  };
  const menuMode = new StringSelectMenuBuilder().setCustomId('gsetup:antipub:phrases').setPlaceholder('🧠 Pub sans lien')
    .addOptions(Object.entries(MODES).map(([value, label]) => ({ label, value, default: value === mode })));
  return {
    embeds: [embed('🚫・ANTI-PUB', {
      couleur: FR.bleu,
      description: 'Un message qui contient une **invitation vers un autre serveur Discord** est supprimé, et son auteur reçoit un avertissement'
        + ' (visible dans **/warns**), en MP, ou dans le salon 8 secondes si ses MP sont fermés. Les invitations vers ce serveur restent permises.\n\n'
        + `${actif ? '🟢 **Actif**' : '🔴 **Inactif**'}\n`
        + `🧠 **Pub sans lien** · ${MODES[mode].split(' : ')[1]}, au-dessus de **${Math.round(r.seuil() * 100)} %**`
        + ` · le détecteur a appris **${s.pub}** exemples de pub et **${s.normal}** normaux\n`
        + `⚖️ **Sanction** · ${seuil ? `mute **${r.muteHeures()} h** au ${seuil}e avertissement de pub en 24 h` : 'avertissement seul, jamais de mute'}\n`
        + `📢 **Salons exemptés** · ${salons.length ? salons.map((id) => `<#${id}>`).join(' ') : '*aucun*'}\n`
        + `🛡️ **Rôles exemptés** · ${roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : '*aucun*'}\n\n`
        + 'Le staff (admins du bot, membres autorisés à sanctionner) et les bots ne sont jamais touchés.\n\n'
        + '🧠 **Il apprend** : clic droit sur un message > Applications > **Signaler comme pub**, et les boutons'
        + ' **C\'est de la pub** / **Pas de la pub** du journal. Laissez-le en alerte le temps qu\'il apprenne, puis passez en suppression.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menuSalons),
      new ActionRowBuilder().addComponents(menuRoles),
      new ActionRowBuilder().addComponents(menuMode),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:antipub:basculer').setLabel(actif ? 'Désactiver' : 'Activer')
          .setEmoji(actif ? '⏸️' : '▶️').setStyle(actif ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId('gsetup:antipub:sanction').setLabel('Sanction').setEmoji('⚖️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onAntipubSelect(interaction, id) {
  if (id === 'antipub:salons') reglagesAntipub.poserSalonsExemptes(interaction.values);
  else if (id === 'antipub:roles') reglagesAntipub.poserRolesExemptes(interaction.values);
  else if (id === 'antipub:phrases') reglagesAntipub.poserPhrases(interaction.values[0]);
  else return null;
  return interaction.update(pageAntipub('✅ Enregistré.'));
}

export async function onAntipubBouton(interaction, id) {
  if (id === 'antipub:basculer') {
    reglagesAntipub.poserActif(!reglagesAntipub.actif());
    return interaction.update(pageAntipub(reglagesAntipub.actif() ? '✅ Anti-pub activé.' : '⏸️ Anti-pub désactivé.'));
  }
  if (id === 'antipub:sanction') {
    const champ = (cid, label, v) => new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(v)));
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:antipub:sanction').setTitle('Sanction anti-pub')
      .addComponents(
        champ('nb', 'Mute au combientième avertissement en 24 h (0 = jamais)', reglagesAntipub.avantMute()),
        champ('h', 'Durée du mute (heures, 672 max)', reglagesAntipub.muteHeures()),
        champ('seuil', 'Pub sans lien : probabilité minimale en % (50 à 99)', Math.round(reglagesAntipub.seuil() * 100)),
      ));
  }
  return null;
}

export async function onAntipubModal(interaction, id) {
  if (id !== 'antipub:sanction') return null;
  const nb = Math.round(Number(interaction.fields.getTextInputValue('nb').trim()));
  const h = Math.round(Number(interaction.fields.getTextInputValue('h').trim()));
  const pct = Math.round(Number(interaction.fields.getTextInputValue('seuil').trim()));
  if (!(nb >= 0 && nb <= 10) || !(h >= 1 && h <= 672) || !(pct >= 50 && pct <= 99)) {
    return interaction.update(pageAntipub('❌ De 0 à 10 avertissements, mute de 1 à 672 heures, probabilité de 50 à 99 %.'));
  }
  reglagesAntipub.poserSanction(nb, h);
  reglagesAntipub.poserSeuil(pct);
  return interaction.update(pageAntipub(nb ? `✅ Mute ${h} h au ${nb}e avertissement en 24 h.` : '✅ Avertissement seul, jamais de mute.'));
}
