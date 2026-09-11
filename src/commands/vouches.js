import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { COLORS } from '../config.js';
import { reputation, MEDALS } from '../lib/format.js';

export const data = new SlashCommandBuilder()
  .setName('vouches')
  .setDescription('Consulte la réputation de la commu')
  .addSubcommand((s) =>
    s.setName('membre')
      .setDescription("Les avis reçus par un membre")
      .addUserOption((o) => o.setName('membre').setDescription('Le membre à consulter')))
  .addSubcommand((s) =>
    s.setName('top').setDescription('Le classement des membres les mieux notés'))
  .addSubcommand((s) =>
    s.setName('retirer')
      .setDescription("Retire l'avis que tu avais laissé")
      .addUserOption((o) => o.setName('membre').setDescription('Le membre concerné').setRequired(true)));

export const requiresLink = true;

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'retirer') {
    const target = interaction.options.getUser('membre', true);
    const removed = store.removeVouch(interaction.user.id, target.id);
    return interaction.reply({
      content: removed ? `✅ Ton avis sur **${target.username}** a été retiré.` : "Tu n'avais pas d'avis sur ce membre.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'top') {
    const rows = store.vouchTop(10);
    if (rows.length === 0) {
      return interaction.reply({ content: 'Aucun avis pour le moment.', flags: MessageFlags.Ephemeral });
    }
    const lines = rows.map((r, i) => {
      const link = store.getLink(r.to_id);
      const name = link ? link.mc_name : 'inconnu';
      const medal = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``;
      return `${medal} **${name}** · \`+${r.pos}\` / \`-${r.neg}\` <@${r.to_id}>`;
    });
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle('Les plus fiables de la commu')
        .setDescription(lines.join('\n'))],
    });
  }

  const target = interaction.options.getUser('membre') ?? interaction.user;
  const link = store.getLink(target.id);
  if (!link) {
    return interaction.reply({ content: `**${target.username}** n'est pas vérifié.`, flags: MessageFlags.Ephemeral });
  }

  const { pos, neg } = store.vouchScore(target.id);
  const rep = reputation(pos, neg);
  const recent = store.vouchList(target.id, 8);

  const lines = recent.map((v) => {
    const author = store.getLink(v.from_id);
    const who = author ? author.mc_name : `<@${v.from_id}>`;
    const icon = v.value > 0 ? '👍' : '👎';
    const when = `<t:${Math.floor(v.created_at / 1000)}:R>`;
    return `${icon} **${who}** ${when}${v.comment ? `\n> ${v.comment}` : ''}`;
  });

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(neg > pos ? COLORS.err : COLORS.ok)
      .setTitle(`Réputation de ${link.mc_name}`)
      .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(link.mc_name.replace(/^\./, ''))}/128`)
      .setDescription(`**${rep.label}** · \`+${pos}\` positifs / \`-${neg}\` négatifs`)
      .addFields({ name: 'Derniers avis', value: lines.join('\n') || 'Aucun avis.' })],
  });
}
