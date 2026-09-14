import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { rendreSetup } from '../tickets/setup.js';

export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Système de tickets')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('setup').setDescription('Panneau de configuration : salons, rôles, catégories'));

export async function execute(interaction) {
  return interaction.reply({ ...rendreSetup(interaction.guild), flags: MessageFlags.Ephemeral });
}
