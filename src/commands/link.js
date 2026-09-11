import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { startLink, cancelLink, LinkError } from '../link/manager.js';
import { config, COLORS } from '../config.js';
import { store } from '../db.js';
import { remember } from '../link/interactions.js';

export const data = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Lie ton compte Minecraft à ton Discord')
  .addStringOption((o) =>
    o.setName('pseudo')
      .setDescription('Ton pseudo exact sur DonutSMP')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(24));

export const requiresLink = false;

export async function execute(interaction) {
  const pseudo = interaction.options.getString('pseudo', true);

  let challenge;
  try {
    challenge = startLink(interaction.user.id, pseudo);
  } catch (err) {
    if (err instanceof LinkError) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    throw err;
  }

  const minutes = Math.max(1, Math.round((challenge.expiresAt - Date.now()) / 60_000));
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(challenge.resumed ? 'Vérification déjà en cours' : 'Vérification de ton compte')
    .setDescription(
      `Pour prouver que **${challenge.mc_name}** est bien à toi, envoie exactement cette somme en jeu :`,
    )
    .addFields(
      { name: 'Commande à taper sur DonutSMP', value: `\`\`\`/pay ${config.mc.linkAccount} ${challenge.amount}\`\`\`` },
      { name: 'Montant exact', value: `$${challenge.amount}`, inline: true },
      { name: 'Validité', value: `${minutes} min`, inline: true },
    )
    .setFooter({ text: 'Le montant est unique. Un autre joueur qui paie la même somme ne validera pas ton compte.' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

  // Sert a confirmer en ephemere quand le paiement arrivera, hors interaction.
  remember(interaction.user.id, interaction, challenge.expiresAt - Date.now());

}

export const cancel = { cancelLink, store };
