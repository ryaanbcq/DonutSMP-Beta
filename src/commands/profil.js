import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { ouSeLier } from '../settings.js';
import { donut } from '../donut/api.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { shortMoney, duration, reputation } from '../lib/format.js';

export const data = new SlashCommandBuilder()
  .setName('profil')
  .setDescription("Affiche le profil d'un membre vérifié")
  .addUserOption((o) => o.setName('membre').setDescription('Le membre à consulter'));

export const requiresLink = false;

export async function execute(interaction) {
  const target = interaction.options.getUser('membre') ?? interaction.user;
  const link = store.getLink(target.id);

  if (!link) {
    return interaction.reply({
      content: target.id === interaction.user.id
        ? `Vous n'êtes pas encore vérifié : ${ouSeLier()}.`
        : `**${target.username}** n'a pas associé de compte Minecraft.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();
  const { pos, neg } = store.vouchScore(target.id);
  const rep = reputation(pos, neg);

  let stats = null;
  try {
    stats = await donut.stats(link.mc_name);
  } catch { /* API muette : on affiche quand même le profil */ }

  const fiche = embed(TITRES.profil, {
    image: link.mc_name,
    description: `**${link.mc_name}**\n<@${target.id}>`,
  }).addFields(
    { name: 'Réputation', value: `${rep.label}\n\`+${pos}\` / \`-${neg}\``, inline: true },
    { name: 'Vérifié', value: `<t:${Math.floor(link.linked_at / 1000)}:R>`, inline: true },
  );

  if (stats) {
    fiche.addFields(
      { name: 'Argent', value: shortMoney(stats.money), inline: true },
      { name: 'Kills', value: stats.kills.toLocaleString('fr-FR'), inline: true },
      { name: 'Morts', value: stats.deaths.toLocaleString('fr-FR'), inline: true },
      { name: 'Temps de jeu', value: duration(stats.playtimeMs), inline: true },
    );
    if (stats.mock) fiche.setFooter({ text: 'Données de test : aucune clé API DonutSMP configurée.' });
  }

  return interaction.editReply({ embeds: [fiche] });
}
