import { SlashCommandBuilder } from 'discord.js';
import { onAutosupport } from '../support/agent.js';

// Le staff confie le ticket du salon courant a l assistant IA : il relit
// tout le ticket, repond tout de suite, puis a chaque message du membre.
export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('autosupport')
  .setDescription('Staff : l\'assistant lit ce ticket et répond à votre place')
  .addBooleanOption((o) => o.setName('arreter').setDescription('Reprendre la main : l\'assistant ne répond plus dans ce ticket'))
  .setDMPermission(false);

export const execute = onAutosupport;
