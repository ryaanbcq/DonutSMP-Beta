import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { cancelLink } from '../link/manager.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Detache ton compte Minecraft de ton Discord');

export const requiresLink = false;

export async function execute(interaction) {
  const cancelled = cancelLink(interaction.user.id);
  const link = store.getLink(interaction.user.id);

  if (!link) {
    return interaction.reply({
      content: cancelled
        ? '✅ Verification en cours annulee.'
        : "Tu n'as aucun compte lie.",
      flags: MessageFlags.Ephemeral,
    });
  }

  store.removeLink(interaction.user.id);

  if (config.discord.verifiedRoleId) {
    await interaction.member?.roles?.remove(config.discord.verifiedRoleId).catch(() => {});
  }

  return interaction.reply({
    content: `✅ **${link.mc_name}** n'est plus lie a ton Discord. Un nouveau \`/link\` demandera un nouveau paiement.`,
    flags: MessageFlags.Ephemeral,
  });
}
