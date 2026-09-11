import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { reputation } from '../lib/format.js';

export const data = new SlashCommandBuilder()
  .setName('vouch')
  .setDescription('Laissez un avis sur un membre avec qui vous avez tradé')
  .addUserOption((o) => o.setName('membre').setDescription('Le membre à noter').setRequired(true))
  .addStringOption((o) =>
    o.setName('avis')
      .setDescription('Votre verdict')
      .setRequired(true)
      .addChoices(
        { name: "Positif, tout s'est bien passé", value: 'pos' },
        { name: 'Négatif, scam ou problème', value: 'neg' },
      ))
  .addStringOption((o) =>
    o.setName('commentaire')
      .setDescription("Ce qui s'est passé (visible par tous)")
      .setMaxLength(280));

export const requiresLink = true;

export async function execute(interaction) {
  const target = interaction.options.getUser('membre', true);
  const positif = interaction.options.getString('avis', true) === 'pos';
  const comment = interaction.options.getString('commentaire');

  if (target.id === interaction.user.id) {
    return interaction.reply({ content: '❌ On ne se vouch pas soi-même.', flags: MessageFlags.Ephemeral });
  }
  if (target.bot) {
    return interaction.reply({ content: '❌ Ce membre est un bot.', flags: MessageFlags.Ephemeral });
  }

  const targetLink = store.getLink(target.id);
  if (!targetLink) {
    return interaction.reply({
      content: `❌ **${target.username}** n'a pas de compte Minecraft vérifié, impossible de le noter.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const previous = store.vouchList(target.id, 100).find((v) => v.from_id === interaction.user.id);
  store.setVouch(interaction.user.id, target.id, positif ? 1 : -1, comment);

  const { pos, neg } = store.vouchScore(target.id);
  const rep = reputation(pos, neg);
  const auteur = store.getLink(interaction.user.id);

  const carte = embed(TITRES.avis, {
    couleur: positif ? FR.vert : FR.rouge,
    image: targetLink.mc_name,
    description: `${positif ? '👍 Avis positif' : '👎 Avis négatif'}\n`
      + `**${auteur.mc_name}** a noté **${targetLink.mc_name}**`,
  }).addFields({
    name: `Réputation de ${targetLink.mc_name}`,
    value: `${rep.label} · \`+${pos}\` / \`-${neg}\``,
  });

  if (comment) carte.addFields({ name: 'Commentaire', value: comment });
  if (previous) carte.setFooter({ text: 'Cet avis remplace le précédent du même auteur.' });

  return interaction.reply({ embeds: [carte] });
}
