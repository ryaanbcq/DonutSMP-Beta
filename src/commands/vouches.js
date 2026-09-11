import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { reputation, MEDALS } from '../lib/format.js';

export const data = new SlashCommandBuilder()
  .setName('vouches')
  .setDescription('Consultez la réputation de la commu')
  .addSubcommand((s) =>
    s.setName('membre')
      .setDescription('Les avis reçus par un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre à consulter')))
  .addSubcommand((s) =>
    s.setName('top').setDescription('Le classement des membres les mieux notés'))
  .addSubcommand((s) =>
    s.setName('retirer')
      .setDescription("Retirez l'avis que vous aviez laissé")
      .addUserOption((o) => o.setName('membre').setDescription('Le membre concerné').setRequired(true)));

export const requiresLink = true;

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'retirer') {
    const target = interaction.options.getUser('membre', true);
    const removed = store.removeVouch(interaction.user.id, target.id);
    return interaction.reply({
      content: removed
        ? `✅ Votre avis sur **${target.username}** a été retiré.`
        : "Vous n'aviez pas d'avis sur ce membre.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'top') {
    const rows = store.vouchTop(10);
    if (rows.length === 0) {
      return interaction.reply({ content: 'Aucun avis pour le moment.', flags: MessageFlags.Ephemeral });
    }
    const lignes = rows.map((r, i) => {
      const link = store.getLink(r.to_id);
      const nom = link ? link.mc_name : 'inconnu';
      const medaille = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``;
      return `${medaille} **${nom}** · \`+${r.pos}\` / \`-${r.neg}\` <@${r.to_id}>`;
    });
    return interaction.reply({
      embeds: [embed(TITRES.reputation, {
        description: `**Les plus fiables de la commu**\n\n${lignes.join('\n')}`,
      })],
    });
  }

  const target = interaction.options.getUser('membre') ?? interaction.user;
  const link = store.getLink(target.id);
  if (!link) {
    return interaction.reply({
      content: `**${target.username}** n'est pas vérifié.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const { pos, neg } = store.vouchScore(target.id);
  const rep = reputation(pos, neg);
  const recents = store.vouchList(target.id, 8);

  const lignes = recents.map((v) => {
    const auteur = store.getLink(v.from_id);
    const qui = auteur ? auteur.mc_name : `<@${v.from_id}>`;
    const icone = v.value > 0 ? '👍' : '👎';
    return `${icone} **${qui}** <t:${Math.floor(v.created_at / 1000)}:R>${v.comment ? `\n> ${v.comment}` : ''}`;
  });

  return interaction.reply({
    embeds: [embed(TITRES.reputation, {
      couleur: neg > pos ? FR.rouge : FR.vert,
      image: link.mc_name,
      description: `**${link.mc_name}**\n${rep.label} · \`+${pos}\` positifs / \`-${neg}\` négatifs`,
    }).addFields({ name: 'Derniers avis', value: lignes.join('\n') || 'Aucun avis.' })],
  });
}
