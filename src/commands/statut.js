import { SlashCommandBuilder, MessageFlags, ActivityType, PresenceUpdateStatus } from 'discord.js';
import { estAdmin } from '../lib/admin.js';
import { store } from '../db.js';

// Staff : presence du bot sur Discord. Statut (en ligne, inactif, ne pas
// deranger, invisible) et statut personnalise (le texte sous le nom).
// Retenu en base : le bot le reprend a chaque demarrage.

export const requiresLink = false;

const STATUTS = {
  online: PresenceUpdateStatus.Online,
  idle: PresenceUpdateStatus.Idle,
  dnd: PresenceUpdateStatus.DoNotDisturb,
  invisible: PresenceUpdateStatus.Invisible,
};
const LIBELLES = { online: '🟢 En ligne', idle: '🌙 Inactif', dnd: '⛔ Ne pas déranger', invisible: '⚫ Invisible' };

export const data = new SlashCommandBuilder()
  .setName('statut')
  .setDescription('Staff : statut et statut personnalisé du bot')
  .addSubcommand((s) => s.setName('voir').setDescription('Afficher le statut actuel'))
  .addSubcommand((s) => s.setName('changer').setDescription('Changer le statut ou le statut personnalisé')
    .addStringOption((o) => o.setName('statut').setDescription('En ligne, inactif, ne pas déranger, invisible')
      .addChoices(
        { name: 'En ligne', value: 'online' },
        { name: 'Inactif', value: 'idle' },
        { name: 'Ne pas déranger', value: 'dnd' },
        { name: 'Invisible', value: 'invisible' },
      ))
    .addStringOption((o) => o.setName('texte').setDescription('Statut personnalisé (le texte sous le nom du bot)').setMaxLength(128)))
  .addSubcommand((s) => s.setName('effacer').setDescription('Retirer le statut personnalisé'));

/** Presence retenue en base. */
export function presenceVoulue() {
  return {
    statut: store.kvGet('presence.statut') || 'online',
    texte: store.kvGet('presence.texte') || '',
  };
}

/** Applique la presence retenue. Appele au demarrage et apres /statut. */
export function appliquerPresence(client) {
  const { statut, texte } = presenceVoulue();
  client.user.setPresence({
    status: STATUTS[statut] ?? PresenceUpdateStatus.Online,
    activities: texte ? [{ name: texte, type: ActivityType.Custom, state: texte }] : [],
  });
  return { statut, texte };
}

const resume = ({ statut, texte }) => `${LIBELLES[statut] ?? statut} · ${texte ? `« ${texte} »` : '*pas de statut personnalisé*'}`;

export async function execute(interaction) {
  if (!estAdmin(interaction.member)) return interaction.reply({ content: '❌ Réservé aux admins du bot (rôle choisi dans /setup general, ou « Gérer le serveur »).', flags: MessageFlags.Ephemeral });
  const sous = interaction.options.getSubcommand();

  if (sous === 'voir') {
    return interaction.reply({ content: `Statut du bot : ${resume(presenceVoulue())}`, flags: MessageFlags.Ephemeral });
  }
  if (sous === 'effacer') {
    store.kvSet('presence.texte', '');
  } else {
    const statut = interaction.options.getString('statut');
    const texte = interaction.options.getString('texte');
    if (!statut && texte === null) {
      return interaction.reply({ content: '❌ Donnez au moins un statut ou un texte.', flags: MessageFlags.Ephemeral });
    }
    if (statut) store.kvSet('presence.statut', statut);
    if (texte !== null) store.kvSet('presence.texte', texte.trim());
  }
  const etat = appliquerPresence(interaction.client);
  console.log(`[statut] ${interaction.user.tag} : ${etat.statut} « ${etat.texte} »`);
  return interaction.reply({ content: `✅ Statut du bot : ${resume(etat)}\n*Discord peut mettre une minute à l'afficher.*`, flags: MessageFlags.Ephemeral });
}
