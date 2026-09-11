import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { delier } from '../link/unlink.js';
import { ouSeLier } from '../settings.js';

export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Détachez votre compte Minecraft de votre profil Discord');

export const requiresLink = false;

export async function execute(interaction) {
  const res = await delier(interaction.user.id, interaction.member);

  const texte = res.etat === 'delie'
    ? `✅ **${res.pseudo}** n'est plus associé à votre profil.\n`
      + `Pour vous relier, ${ouSeLier()} : un nouveau paiement sera demandé.`
    : res.etat === 'verification_annulee'
      ? '✅ Vérification en cours annulée.'
      : "Vous n'avez aucun compte associé.";

  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}
