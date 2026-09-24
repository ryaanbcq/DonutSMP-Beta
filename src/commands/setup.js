import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { rendreSetup } from '../tickets/setup.js';
import { rendreSetupVouch } from '../vouch/setup.js';
import { rendreSetupDons } from '../dons/setup.js';
import { rendreSetupGeneral } from '../setup/general.js';

// Toute la configuration du bot a la souris, un panneau prive par module.
export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configuration du bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('general').setDescription('Tout configurer : rôles, salons, panneaux, dons'))
  .addSubcommand((s) => s.setName('tickets').setDescription('Tickets : panneau, dossier, logs, rôles, catégories'))
  .addSubcommand((s) => s.setName('vouches').setDescription('Vouches : forum, panneau, rôle Trusted'))
  .addSubcommand((s) => s.setName('dons').setDescription('Dons : paliers et rôles des donateurs'));

export async function execute(interaction) {
  const vues = { general: rendreSetupGeneral, vouches: rendreSetupVouch, dons: rendreSetupDons, tickets: rendreSetup };
  const vue = await vues[interaction.options.getSubcommand()](interaction.guild);
  return interaction.reply({ ...vue, flags: MessageFlags.Ephemeral });
}
