import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { donut } from '../donut/api.js';
import { COLORS } from '../config.js';
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
        ? "Tu n'es pas encore vérifié. Fais `/link <pseudo>`."
        : `**${target.username}** n'a pas lié de compte Minecraft.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();
  const { pos, neg } = store.vouchScore(target.id);
  const rep = reputation(pos, neg);

  let stats = null;
  try {
    stats = await donut.stats(link.mc_name);
  } catch { /* API muette : on affiche quand meme le profil */ }

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
    .setTitle(link.mc_name)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(link.mc_name.replace(/^\./, ''))}/128`)
    .addFields(
      { name: 'Réputation', value: `${rep.label}\n\`+${pos}\` / \`-${neg}\``, inline: true },
      { name: 'Vérifié depuis', value: `<t:${Math.floor(link.linked_at / 1000)}:R>`, inline: true },
    );

  if (stats) {
    embed.addFields(
      { name: 'Argent', value: shortMoney(stats.money), inline: true },
      { name: 'Kills', value: String(stats.kills), inline: true },
      { name: 'Morts', value: String(stats.deaths), inline: true },
      { name: 'Temps de jeu', value: duration(stats.playtimeMs), inline: true },
    );
    if (stats.mock) embed.setFooter({ text: 'Stats de test : aucune clé API DonutSMP configurée.' });
  }

  return interaction.editReply({ embeds: [embed] });
}
