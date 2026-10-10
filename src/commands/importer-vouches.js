import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { estAdmin } from '../lib/admin.js';
import { scannerFil } from '../vouch/reclamation.js';

// Staff : importe les vouches d un post de l ancien forum. Le bot scanne le
// fil, le staff exclut ce qui ne va pas et valide (voir vouch/reclamation.js).
export const data = new SlashCommandBuilder()
  .setName('importer-vouches')
  .setDescription('Staff : importer les vouches d\'un post de l\'ancien forum')
  .addStringOption((o) => o.setName('fil').setDescription('Lien du post du joueur dans l\'ancien forum').setRequired(true))
  .addUserOption((o) => o.setName('membre')
    .setDescription('À qui reviennent les vouches (par défaut : l\'auteur du post)'))
;

export const requiresLink = false;

export function execute(interaction) {
  if (!estAdmin(interaction.member)) return interaction.reply({ content: '❌ Réservé aux admins du bot (rôle choisi dans /setup general, ou « Gérer le serveur »).', flags: MessageFlags.Ephemeral });
  return scannerFil(interaction, interaction.options.getString('fil'), interaction.options.getUser('membre'));
}
