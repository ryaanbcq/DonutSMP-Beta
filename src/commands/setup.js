import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { rendreSetup } from '../tickets/setup.js';
import { rendreSetupVouch } from '../vouch/setup.js';

// Toute la configuration du bot a la souris, un panneau prive par module.
export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configuration du bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('tickets').setDescription('Tickets : panneau, dossier, logs, rôles, catégories'))
  .addSubcommand((s) => s.setName('vouches').setDescription('Vouches : forum, panneau, rôle Trusted'));

export async function execute(interaction) {
  const vue = interaction.options.getSubcommand() === 'vouches'
    ? rendreSetupVouch(interaction.guild)
    : rendreSetup(interaction.guild);
  return interaction.reply({ ...vue, flags: MessageFlags.Ephemeral });
}
