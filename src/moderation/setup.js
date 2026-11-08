// /setup general > Modération : quels roles peuvent avertir, mute, expulser,
// bannir ; les membres et roles autorises a tout ; le prefixe des commandes
// ecrites (+ban @x 3j raison). Rien de regle = les admins du bot.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, LabelBuilder,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { registre } from './actions.js';
import { reglagesQuota } from './quota.js';
import { reglagesAntipub, statsModele } from './antipub.js';

const ACTIONS = [
  ['warn', '⚠️', 'avertir', '+warn, +unwarn, +warns'],
  ['mute', '🔇', 'mute', '+mute, +unmute, +hebs, +unhebs'],
  ['kick', '👢', 'expulser', '+kick'],
  ['ban', '⛔', 'bannir', '+ban, +unban'],
];
const roles = (ids) => (ids?.length ? ids.map((id) => `<@&${id}>`).join(' ') : '*personne*');

export function pageModeration(note = '') {
  const perms = registre.perms();
  const { membres, roles: tout } = registre.autorises();
  const p = registre.prefixe();
  const regle = membres.length || tout.length || ACTIONS.some(([a]) => perms[a]?.length);
  const lignes = ACTIONS.map(([a, emoji, verbe, cmds]) => `${emoji} **Peut ${verbe}** (\`${cmds.replace(/\+/g, p)}\`) · ${roles(perms[a])}`);
  const menus = ACTIONS.map(([a, emoji, verbe]) => {
    const m = new RoleSelectMenuBuilder().setCustomId(`gsetup:mod:perm:${a}`)
      .setPlaceholder(`${emoji} Rôles qui peuvent ${verbe}`).setMinValues(0).setMaxValues(25);
    if (perms[a]?.length) m.setDefaultRoles(...perms[a].slice(0, 25));
    return new ActionRowBuilder().addComponents(m);
  });
  return {
    embeds: [embed('🔨・MODÉRATION', {
      couleur: FR.bleu,
      description: '**Qui peut sanctionner**, action par action. Le propriétaire du serveur peut toujours tout.\n\n'
        + `${lignes.join('\n')}\n`
        + `⏳ **Quota de bans (7 jours glissants)** · ${Object.entries(reglagesQuota.quotas()).map(([id, n]) => `<@&${id}> ${n}`).join(' · ') || 'par défaut : Sr Modérateur 10, Modérateur 3 (repérés par le nom du rôle)'} · *pas de quota pour le propriétaire et les administrateurs*\n`
        + `👑 **Peut tout faire** · ${[...membres.map((id) => `<@${id}>`), ...tout.map((id) => `<@&${id}>`)].join(' ') || '*personne*'}\n\n`
        + (regle ? '' : '➖ Rien de réglé : pour l\'instant, les admins du bot peuvent tout faire.\n\n')
        + `### Commandes rapides\nDans n'importe quel salon, préfixe **\`${p}\`** :\n`
        + `\`${p}ban @membre 3j pub\` · \`${p}mute 1234567890 1h spam\` · \`${p}kick @membre\` · \`${p}warn @membre insulte\`\n`
        + `\`${p}unban 1234567890\` · \`${p}unmute @membre\` · \`${p}unwarn @membre\` · \`${p}warns @membre\`\n`
        + 'Mention ou ID, puis la durée (facultative : sans elle, ban définitif et mute 1 h), puis la raison (facultative).'
        + ' Le message de commande est effacé, la réponse aussi au bout de 10 s ; tout reste dans le journal.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      ...menus,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:mod:prefixe').setLabel(`Préfixe : ${p}`).setEmoji('⌨️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:mod:tout').setLabel('Qui peut tout faire').setEmoji('👑').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:mod:quota').setLabel('Quota de bans').setEmoji('⏳').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function pageTout(note = '') {
  const { membres, roles: tout } = registre.autorises();
  const menuMembres = new UserSelectMenuBuilder().setCustomId('gsetup:mod:membres')
    .setPlaceholder('👤 Membres qui peuvent tout faire').setMinValues(0).setMaxValues(25);
  if (membres.length) menuMembres.setDefaultUsers(...membres.slice(0, 25));
  const menuRoles = new RoleSelectMenuBuilder().setCustomId('gsetup:mod:roles')
    .setPlaceholder('🛡️ Rôles qui peuvent tout faire').setMinValues(0).setMaxValues(25);
  if (tout.length) menuRoles.setDefaultRoles(...tout.slice(0, 25));
  return {
    embeds: [embed('👑・PEUT TOUT FAIRE', {
      couleur: FR.bleu,
      description: 'Ces membres et ces rôles ont **toutes** les sanctions (avertir, mute, expulser, bannir), en plus des rôles réglés action par action.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menuMembres),
      new ActionRowBuilder().addComponents(menuRoles),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:page:mod').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onModerationSelect(interaction, id) {
  if (id.startsWith('mod:perm:')) {
    registre.poserPerms(id.slice('mod:perm:'.length), interaction.values);
    return interaction.update(pageModeration('✅ Enregistré, effectif tout de suite.'));
  }
  if (id === 'mod:membres') registre.poserAutorises({ membres: interaction.values });
  else if (id === 'mod:roles') registre.poserAutorises({ roles: interaction.values });
  else return null;
  return interaction.update(pageTout('✅ Enregistré, effectif tout de suite.'));
}

export async function onModerationBouton(interaction, id) {
  if (id === 'mod:tout') return interaction.update(pageTout());
  if (id === 'mod:quota') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:mod:quota').setTitle('Quota de bans par rôle').addLabelComponents(
      new LabelBuilder().setLabel('Rôle').setDescription('Le rôle le plus généreux d\'un membre compte.')
        .setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId('role').setMinValues(1).setMaxValues(1)),
      new LabelBuilder().setLabel('Bans permis sur 7 jours glissants').setDescription('0 = retirer le quota de ce rôle.')
        .setTextInputComponent(new TextInputBuilder().setCustomId('n').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder('3')),
    ));
  }
  if (id === 'mod:prefixe') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:mod:prefixe').setTitle('Préfixe des commandes')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p')
        .setLabel('1 à 3 caractères, ex. + ! ?').setStyle(TextInputStyle.Short).setRequired(true)
        .setMinLength(1).setMaxLength(3).setValue(registre.prefixe()))));
  }
  return null;
}

export async function onModerationModal(interaction, id) {
  if (id === 'mod:quota') {
    const role = interaction.fields.getSelectedRoles('role')?.first();
    const n = Number(interaction.fields.getTextInputValue('n').trim());
    if (!role || !Number.isInteger(n) || n < 0 || n > 999) return interaction.update(pageModeration('❌ Il faut un rôle et un nombre entre 0 et 999.'));
    reglagesQuota.poser(role.id, n);
    return interaction.update(pageModeration(n ? `✅ ${role} : ${n} bans sur 7 jours.` : `✅ Plus de quota pour ${role}.`));
  }
  if (id !== 'mod:prefixe') return null;
  const p = interaction.fields.getTextInputValue('p').trim();
  if (!p || /\s|[@#<>`*_~|]/.test(p)) return interaction.update(pageModeration('❌ Préfixe refusé : pas d\'espace ni de @ # < > ` * _ ~ |.'));
  registre.poserPrefixe(p);
  return interaction.update(pageModeration(`✅ Préfixe : \`${p}\`. Exemple : \`${p}ban @membre 3j pub\`.`));
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
