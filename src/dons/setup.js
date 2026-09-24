// /setup dons : les paliers et le role de chacun, a la souris. Meme principe
// que /setup vouches : une fiche privee, tout est enregistre aussitot.
//
// Changer un palier ou un role repasse sur tous les membres lies : chacun
// garde le role de son palier et perd ceux qui ne servent plus.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { embed, FR } from '../lib/brand.js';
import { shortMoney } from '../lib/format.js';
import {
  paliers, poserPaliers, lirePaliers, roleDuPalier, poserRolePalier, rolesDonateur,
  assurerRoles, resynchroniser,
} from './dons.js';

const court = (n) => shortMoney(n).replace('$', '');

export function rendreSetupDons(guild, note = '') {
  const liste = paliers();
  const moi = guild.members.me;
  const lignes = liste.map((p) => {
    const id = roleDuPalier(p);
    const role = id && guild.roles.cache.get(id);
    return `**${court(p)}** · ${role ? `<@&${id}>` : '⚠️ aucun rôle'}`;
  });

  const contenu = embed('⚙️・CONFIGURATION DES DONS', {
    couleur: FR.or,
    description:
      'Tout `/pay` au bot à partir du minimum est un don. Le membre porte le rôle du plus haut palier atteint'
      + ' (total de ses dons).\n\n'
      + `**Don minimum** · ${shortMoney(config.dons.min)}\n`
      + `**Reversé chaque jour à** · ${config.dons.beneficiaire || 'personne (le bot garde les dons)'}\n`
      + `**Historique** · ${config.dons.salonId ? `<#${config.dons.salonId}>` : 'dans le journal staff'}\n\n`
      + `**Paliers**\n${lignes.join('\n')}`
      + (moi && !moi.permissions.has(PermissionFlagsBits.ManageRoles) ? '\n\n⚠️ Il me manque **Gérer les rôles**.' : '')
      + (note ? `\n\n${note}` : ''),
  }).setFooter({ text: 'Minimum et bénéficiaire : donut config sur la machine du bot.' });

  const menus = liste.map((p) => {
    const m = new RoleSelectMenuBuilder().setCustomId(`dsetup:role:${p}`)
      .setPlaceholder(`🎖️ Rôle du palier ${court(p)}`).setMinValues(1).setMaxValues(1);
    const id = roleDuPalier(p);
    if (id && guild.roles.cache.has(id)) m.setDefaultRoles(id);
    return new ActionRowBuilder().addComponents(m);
  });

  const manquants = liste.some((p) => !guild.roles.cache.has(roleDuPalier(p) ?? ''));
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dsetup:paliers').setLabel('Modifier les paliers').setEmoji('✏️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dsetup:creer').setLabel('Créer les rôles manquants').setEmoji('➕')
      .setStyle(ButtonStyle.Secondary).setDisabled(!manquants),
    new ButtonBuilder().setCustomId('dsetup:sync').setLabel('Resynchroniser les membres').setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [contenu], components: [...menus, boutons] };
}

/** Un role que le bot peut vraiment poser, sinon la raison. */
function refusRole(guild, role) {
  if (!role) return 'rôle introuvable';
  if (role.id === guild.id) return '@everyone ne peut pas servir de rang';
  if (role.managed) return `${role.name} est géré par une intégration`;
  const moi = guild.members.me;
  if (moi && role.position >= moi.roles.highest.position) {
    return `${role.name} est au-dessus de mon rôle : je ne pourrai pas le donner. Montez mon rôle au-dessus dans les paramètres du serveur`;
  }
  return null;
}

export async function onDsetupSelect(interaction) {
  const guild = interaction.guild;
  const palier = Number(interaction.customId.split(':')[2]);
  if (!paliers().includes(palier)) return interaction.update(rendreSetupDons(guild, 'ℹ️ Ce palier n\'existe plus.'));
  const role = guild.roles.cache.get(interaction.values[0]);
  const refus = refusRole(guild, role);
  if (refus) return interaction.update(rendreSetupDons(guild, `❌ ${refus}.`));

  const ancien = roleDuPalier(palier);
  if (ancien === role.id) return interaction.update(rendreSetupDons(guild));
  await interaction.deferUpdate();
  poserRolePalier(palier, role.id);
  const n = await resynchroniser(guild, ancien ? [ancien] : []);
  return interaction.editReply(rendreSetupDons(guild,
    `✅ Palier **${court(palier)}** → <@&${role.id}>. ${n} membre(s) avec un rang, rôles remis à jour.`));
}

export async function onDsetupBouton(interaction) {
  const guild = interaction.guild;
  if (interaction.customId === 'dsetup:paliers') {
    return interaction.showModal(new ModalBuilder().setCustomId('dsetup:modal').setTitle('Paliers de dons')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('paliers').setLabel('Montants, du plus petit au plus grand')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          .setPlaceholder('500M, 1B, 5B').setValue(paliers().map(court).join(', ')),
      )));
  }
  await interaction.deferUpdate();
  if (interaction.customId === 'dsetup:creer') {
    await assurerRoles(guild).catch((e) => console.warn('[don] roles :', e.message));
    const n = await resynchroniser(guild);
    return interaction.editReply(rendreSetupDons(guild, `✅ Rôles créés. ${n} membre(s) avec un rang.`));
  }
  if (interaction.customId === 'dsetup:sync') {
    const n = await resynchroniser(guild, rolesDonateur());
    return interaction.editReply(rendreSetupDons(guild, `✅ ${n} membre(s) avec un rang, rôles remis à jour.`));
  }
}

export async function onDsetupModal(interaction) {
  const guild = interaction.guild;
  const { paliers: nouveaux, erreur } = lirePaliers(interaction.fields.getTextInputValue('paliers'));
  if (erreur) return interaction.update(rendreSetupDons(guild, `❌ ${erreur}`));

  await interaction.deferUpdate();
  const anciensRoles = rolesDonateur();
  poserPaliers(nouveaux);
  // Un palier neuf recoit un role cree par le bot ; un role du meme nom deja
  // la (ancien palier revenu) est repris.
  await assurerRoles(guild).catch((e) => console.warn('[don] roles :', e.message));
  const n = await resynchroniser(guild, anciensRoles);
  return interaction.editReply(rendreSetupDons(guild,
    `✅ Paliers : **${nouveaux.map(court).join(' · ')}**. ${n} membre(s) avec un rang.`
    + ' Les rôles des anciens paliers ne sont plus donnés (supprimez-les si besoin).'));
}

