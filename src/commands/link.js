import { SlashCommandBuilder } from 'discord.js';
import { repondreChallenge } from '../link/flow.js';

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Liez votre compte Minecraft à votre profil Discord')
  .addStringOption((o) =>
    o.setName('pseudo')
      .setDescription('Votre pseudo exact sur DonutSMP')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(24));

export const requiresLink = false;

export async function execute(interaction) {
  return repondreChallenge(interaction, interaction.options.getString('pseudo', true));
}
