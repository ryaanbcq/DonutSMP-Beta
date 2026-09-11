import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { donut } from '../donut/api.js';
import { store } from '../db.js';
import { COLORS } from '../config.js';
import { shortMoney, duration } from '../lib/format.js';
import { isValidName } from '../lib/names.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription("Les stats DonutSMP d'un joueur")
  .addStringOption((o) => o.setName('pseudo').setDescription('Le pseudo a chercher').setMaxLength(24));

export const requiresLink = true;

export async function execute(interaction) {
  const own = store.getLink(interaction.user.id);
  const pseudo = interaction.options.getString('pseudo') ?? own?.mc_name;

  if (!pseudo || !isValidName(pseudo)) {
    return interaction.reply({ content: '❌ Pseudo invalide.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();

  let stats;
  try {
    stats = await donut.stats(pseudo);
  } catch (err) {
    return interaction.editReply(`❌ L'API DonutSMP ne repond pas (${err.message}).`);
  }
  if (!stats) return interaction.editReply(`Aucun joueur nomme **${pseudo}** sur DonutSMP.`);

  const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);
  const linked = store.getLinkByName(pseudo);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(stats.name)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(String(stats.name).replace(/^\./, ''))}/128`)
    .addFields(
      { name: 'Argent', value: shortMoney(stats.money), inline: true },
      { name: 'Kills', value: String(stats.kills), inline: true },
      { name: 'Morts', value: String(stats.deaths), inline: true },
      { name: 'K/D', value: kd, inline: true },
      { name: 'Temps de jeu', value: duration(stats.playtimeMs), inline: true },
    );

  if (linked) embed.addFields({ name: 'Membre verifie', value: `<@${linked.discord_id}>`, inline: true });
  if (stats.mock) embed.setFooter({ text: 'Donnees de test : aucune cle API DonutSMP configuree.' });

  return interaction.editReply({ embeds: [embed] });
}
