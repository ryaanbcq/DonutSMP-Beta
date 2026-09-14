import { SlashCommandBuilder } from 'discord.js';
import { ouvrir } from '../vouch/panel.js';

// Sans argument : tout se passe dans un panneau prive (membre, verdict,
// etoiles, message), rien ne part avant « Publier ».
export const data = new SlashCommandBuilder()
  .setName('vouch')
  .setDescription('Notez un membre avec qui vous avez tradé : vouch ou signalement, étoiles, message');

export const requiresLink = true;

export async function execute(interaction) {
  return ouvrir(interaction);
}
