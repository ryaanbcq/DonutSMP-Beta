// /setup general > Modération : qui peut utiliser /warn, /kick, /mute,
// /unmute, /ban, /unban et /warns. Membres et roles au choix ; rien de choisi
// = les admins du bot.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, RoleSelectMenuBuilder,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { registre } from './actions.js';

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
