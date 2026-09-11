import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { COLORS } from '../config.js';
import { reputation } from '../lib/format.js';

export const data = new SlashCommandBuilder()
  .setName('vouch')
  .setDescription('Laisse un avis sur un membre avec qui tu as trade')
  .addUserOption((o) => o.setName('membre').setDescription('Le membre a noter').setRequired(true))
  .addStringOption((o) =>
    o.setName('avis')
      .setDescription('Ton verdict')
      .setRequired(true)
      .addChoices(
        { name: 'Positif, tout s est bien passe', value: 'pos' },
        { name: 'Negatif, scam ou probleme', value: 'neg' },
      ))
  .addStringOption((o) =>
    o.setName('commentaire')
      .setDescription('Ce qui s est passe (visible par tous)')
      .setMaxLength(280));

export const requiresLink = true;

export async function execute(interaction) {
  const target = interaction.options.getUser('membre', true);
  const value = interaction.options.getString('avis', true) === 'pos' ? 1 : -1;
  const comment = interaction.options.getString('commentaire');

  if (target.id === interaction.user.id) {
    return interaction.reply({ content: '❌ On ne se vouch pas soi meme.', flags: MessageFlags.Ephemeral });
  }
  if (target.bot) {
    return interaction.reply({ content: '❌ Ce membre est un bot.', flags: MessageFlags.Ephemeral });
  }

  const targetLink = store.getLink(target.id);
  if (!targetLink) {
    return interaction.reply({
      content: `❌ **${target.username}** n'a pas de compte Minecraft verifie, impossible de le noter.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const previous = store.vouchList(target.id, 100).find((v) => v.from_id === interaction.user.id);
  store.setVouch(interaction.user.id, target.id, value, comment);

  const { pos, neg } = store.vouchScore(target.id);
  const rep = reputation(pos, neg);
  const author = store.getLink(interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor(value > 0 ? COLORS.ok : COLORS.err)
    .setTitle(value > 0 ? '👍 Avis positif' : '👎 Avis negatif')
    .setDescription(`**${author.mc_name}** a note **${targetLink.mc_name}**`)
    .addFields({ name: 'Reputation de ' + targetLink.mc_name, value: `${rep.label} · \`+${pos}\` / \`-${neg}\`` });

  if (comment) embed.addFields({ name: 'Commentaire', value: comment });
  if (previous) embed.setFooter({ text: 'Cet avis remplace le precedent du meme auteur.' });

  return interaction.reply({ embeds: [embed] });
}
