import { MessageFlags } from 'discord.js';
import { startLink, LinkError } from './manager.js';
import { remember } from './interactions.js';
import { realCase } from '../donut/mojang.js';
import { config } from '../config.js';
import { embed, TITRES, FR } from '../lib/brand.js';

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

export function embedChallenge(challenge) {
  const reste = minutes(challenge.expiresAt - Date.now());
  const delai = `${Math.round(config.refundDelayMaxS / 60)} min`;

  return embed(TITRES.verification, {
    description:
      `Pour prouver que **${challenge.mc_name}** vous appartient, envoyez cette somme `
      + `**exacte** en jeu sur DonutSMP.\n\n`
      + `\`\`\`/pay ${config.mc.linkAccount} ${challenge.amount}\`\`\`\n`
      + `Cette somme n'est pas un frais : elle vous est **rendue automatiquement** `
      + `sous ${delai}.`,
  }).addFields(
    { name: 'Montant exact', value: `\`$${challenge.amount}\``, inline: true },
    { name: 'Validité', value: `${reste} min`, inline: true },
  ).setFooter({
    text: 'Ce montant n\'appartient qu\'à vous. Un autre joueur qui paie la même somme ne validera pas votre compte.',
  });
}

/**
 * Ouvre un challenge et repond en ephemere. Partage par la commande /link et
 * par le bouton du panneau.
 */
export async function repondreChallenge(interaction, pseudoSaisi) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // La vraie casse vient de Mojang : « sentiazz » doit s afficher « SentiaZz ».
  const pseudo = await realCase(pseudoSaisi);

  let challenge;
  try {
    challenge = startLink(interaction.user.id, pseudo);
  } catch (err) {
    if (err instanceof LinkError) {
      return interaction.editReply({
        embeds: [embed('⛔・IMPOSSIBLE', { couleur: FR.rouge, description: err.message, image: 'aucune' })],
      });
    }
    throw err;
  }

  await interaction.editReply({ embeds: [embedChallenge(challenge)] });
  remember(interaction.user.id, interaction, challenge.expiresAt - Date.now());
  return null;
}
