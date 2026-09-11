import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { embed, TITRES } from '../lib/brand.js';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Publie le panneau de connexion dans ce salon')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o.setName('salon').setDescription('Où publier le panneau (ici par défaut)'));

export const requiresLink = false;

export function panneau() {
  const delai = Math.round(config.refundDelayMaxS / 60);

  const contenu = embed(TITRES.connexion, {
    description:
      "Associez votre compte Minecraft à votre profil Discord pour débloquer "
      + "l'ensemble des fonctionnalités interactives de DonutSMP FR.\n\n"
      + "**1.** Cliquez sur **Se connecter** ci-dessous.\n"
      + "**2.** Indiquez votre pseudo Minecraft.\n"
      + "**3.** Envoyez en jeu la somme exacte demandée.\n\n"
      + `Cette somme n'est **pas un frais** : elle vous est rendue automatiquement `
      + `sous ${delai} minutes. Elle sert uniquement à prouver que le compte est bien le vôtre.\n\n`
      + "Vos informations servent uniquement à la synchronisation sur DonutSMP FR et ne "
      + "seront jamais partagées. Pour toute question ou demande de suppression, "
      + "contactez le staff via un ticket.",
  });

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('link:start')
      .setLabel('Se connecter')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [contenu], components: [boutons] };
}

export async function execute(interaction) {
  const salon = interaction.options.getChannel('salon') ?? interaction.channel;

  if (!salon?.isTextBased?.()) {
    return interaction.reply({ content: '❌ Ce salon n\'accepte pas de messages.', flags: MessageFlags.Ephemeral });
  }

  await salon.send(panneau());
  return interaction.reply({
    content: `✅ Panneau publié dans ${salon}.`,
    flags: MessageFlags.Ephemeral,
  });
}
