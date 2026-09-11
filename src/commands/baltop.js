import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { donut, LEADERBOARDS } from '../donut/api.js';
import { COLORS } from '../config.js';
import { shortMoney, duration, MEDALS } from '../lib/format.js';

export const data = new SlashCommandBuilder()
  .setName('baltop')
  .setDescription('Le classement DonutSMP')
  .addStringOption((o) =>
    o.setName('categorie')
      .setDescription('Le classement a afficher')
      .addChoices(...LEADERBOARDS));

export const requiresLink = true;

export async function execute(interaction) {
  const category = interaction.options.getString('categorie') ?? 'money';
  await interaction.deferReply();

  let rows;
  try {
    rows = await donut.leaderboard(category, 10);
  } catch (err) {
    return interaction.editReply(`❌ L'API DonutSMP ne repond pas (${err.message}).`);
  }

  const fmt = category === 'money' ? shortMoney
    : category === 'playtime' ? duration
    : (v) => Number(v).toLocaleString('en-US');

  const label = LEADERBOARDS.find((l) => l.value === category)?.name ?? category;
  const lines = rows.map((r, i) =>
    `${MEDALS[i] ?? `\`${String(r.rank).padStart(2, ' ')}\``} **${r.name}** · ${fmt(r.value)}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`Classement ${label}`)
    .setDescription(lines.join('\n') || 'Classement vide.');

  if (rows[0]?.mock) embed.setFooter({ text: 'Donnees de test : aucune cle API DonutSMP configuree.' });
  return interaction.editReply({ embeds: [embed] });
}
