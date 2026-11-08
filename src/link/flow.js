import { MessageFlags } from 'discord.js';
import { compteBot } from '../ingame/compte.js';
import { startLink, LinkError } from './manager.js';
import { remember } from './interactions.js';
import { realCase } from '../donut/mojang.js';
import { config } from '../config.js';
import { presence } from '../ingame/presence.js';
import { embed, TITRES, FR } from '../lib/brand.js';

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

export function embedChallenge(challenge, connecte = compteBot()) {
  const reste = minutes(challenge.expiresAt - Date.now());
  const delai = `${Math.round(config.refundDelayMaxS / 60)} min`;

  return embed(TITRES.verification, {
    description:
      `Pour prouver que **${challenge.mc_name}** vous appartient, envoyez cette somme `
      + `**exacte** en jeu sur DonutSMP.\n\n`
      + `\`\`\`/pay ${connecte} ${challenge.amount}\`\`\`\n`
      + `Cette somme n'est pas un frais : elle vous est **rendue automatiquement** `
      + `sous ${delai}.`,
  }).addFields(
    // Le compte qui est VRAIMENT en jeu en ce moment : apres une bascule de
    // compte, un joueur qui paierait l ancien perdrait son argent.
    { name: 'Bot connecté', value: `🟢 **${connecte}**`, inline: true },
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

  // Garde-fou : sans le bot en jeu, un paiement n est vu par personne. Ni
  // lien, ni remboursement, et le joueur perd sa mise. On n ouvre donc aucune
  // verification tant qu il n est pas connecte.
  const etat = await presence();
  if (!etat.enLigne) {
    return interaction.editReply({
      embeds: [embed('⚠️・SERVICE INDISPONIBLE', {
        couleur: FR.jaune,
        description:
          `Notre bot **${compteBot()}** n'est pas connecté à DonutSMP pour le moment, `
          + "il ne pourrait pas voir votre paiement.\n\n"
          + "**Aucune vérification n'est ouverte**, et surtout **n'envoyez pas d'argent** : "
          + "il serait perdu sans que votre compte soit lié.\n\n"
          + (etat.bloquant
            ? "Le compte du bot est actuellement suspendu par DonutSMP : les liaisons sont en pause "
              + "jusqu'à son retour. Le staff est prévenu."
            : "Réessayez dans quelques minutes. Si cela dure, prévenez le staff."),
      })],
    });
  }

  // Connecte, mais sous un autre compte que celui que les joueurs doivent
  // payer (bascule en cours, mauvais jeton) : le paiement ne serait pas vu.
  const attendu = compteBot();
  const norm = (n) => String(n).toLowerCase().replace(/^\./, '');
  if (etat.username && norm(etat.username) !== norm(attendu)) {
    return interaction.editReply({
      embeds: [embed('⚠️・SERVICE INDISPONIBLE', {
        couleur: FR.jaune,
        description:
          `Notre bot change de compte en ce moment (**${etat.username}** → **${attendu}**).\n\n`
          + "**Aucune vérification n'est ouverte**, n'envoyez pas d'argent. Réessayez dans une minute.",
      })],
    });
  }

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

  await interaction.editReply({ embeds: [embedChallenge(challenge, etat.username || attendu)] });
  remember(interaction.user.id, interaction, challenge.expiresAt - Date.now());
  return null;
}
