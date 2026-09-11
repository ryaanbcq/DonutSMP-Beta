import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { donut } from '../donut/api.js';
import { store } from '../db.js';
import { embed, TITRES } from '../lib/brand.js';
import { shortMoney, duration } from '../lib/format.js';
import { isValidName } from '../lib/names.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription("Les statistiques DonutSMP d'un joueur")
  .addStringOption((o) => o.setName('pseudo').setDescription('Le pseudo à chercher').setMaxLength(24));

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
    return interaction.editReply(`❌ L'API DonutSMP ne répond pas (${err.message}).`);
  }
  if (!stats) return interaction.editReply(`Aucun joueur nommé **${pseudo}** sur DonutSMP.`);

  const kd = stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : String(stats.kills);
  const linked = store.getLinkByName(pseudo);
  const nombre = (n) => Number(n ?? 0).toLocaleString('fr-FR');

  const fiche = embed(TITRES.stats, { image: stats.name, description: `**${stats.name}**` })
    .addFields(
      { name: 'Argent', value: shortMoney(stats.money), inline: true },
      { name: 'Shards', value: nombre(stats.shards), inline: true },
      { name: 'Temps de jeu', value: duration(stats.playtimeMs), inline: true },
      { name: 'Kills', value: nombre(stats.kills), inline: true },
      { name: 'Morts', value: nombre(stats.deaths), inline: true },
      { name: 'K/D', value: kd, inline: true },
    );

  if (linked) fiche.addFields({ name: 'Membre vérifié', value: `<@${linked.discord_id}>` });
  if (stats.mock) fiche.setFooter({ text: 'Données de test : aucune clé API DonutSMP configurée.' });

  return interaction.editReply({ embeds: [fiche] });
}
