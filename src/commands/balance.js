import { SlashCommandBuilder } from 'discord.js';
import { execute as executeBal, option, requiresLink as gate } from './bal.js';

// Discord ne connait pas les alias : /balance est une seconde commande qui
// partage exactement le meme code que /bal.
export const data = new SlashCommandBuilder()
  .setName('balance')
  .setDescription("Consulte le solde DonutSMP d'un joueur")
  .addStringOption(option);

export const requiresLink = gate;
export const execute = executeBal;
