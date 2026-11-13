import { SlashCommandBuilder } from 'discord.js';
import { onAutosupport } from '../support/agent.js';

// Le staff confie le ticket du salon courant a l assistant IA : il relit
// tout le ticket et ecrit UNE reponse pour informer le membre, rien de plus.
export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('autosupport')
  .setDescription('Staff : l\'assistant lit ce ticket et écrit une réponse à votre place')
  .setDMPermission(false);

export const execute = onAutosupport;
