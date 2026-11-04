import { SlashCommandBuilder } from 'discord.js';
import { fermerParCommande } from '../tickets/manager.js';

// Fermer le ticket du salon courant, comme le bouton 🔒 de l en tete.
export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Fermer ce ticket')
  .setDMPermission(false);

export const execute = fermerParCommande;
