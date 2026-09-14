import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { embed, TITRES } from '../lib/brand.js';
import { MEDALS } from '../lib/format.js';
import { calculerTrust, barre, etoiles } from '../vouch/trust.js';
import { carteReputation, filDe, retirerAvis } from '../vouch/fils.js';

export const data = new SlashCommandBuilder()
  .setName('vouches')
  .setDescription('Consultez la réputation de la commu')
  .addSubcommand((s) =>
    s.setName('membre')
      .setDescription('La carte de réputation d\'un membre et son fil d\'avis')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre à consulter')))
  .addSubcommand((s) =>
    s.setName('top').setDescription('Les membres au meilleur trust score'))
  .addSubcommand((s) =>
    s.setName('retirer')
      .setDescription("Retirez l'avis que vous aviez laissé")
      .addUserOption((o) => o.setName('membre').setDescription('Le membre concerné').setRequired(true)));

export const requiresLink = true;

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'retirer') {
    const target = interaction.options.getUser('membre', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const removed = await retirerAvis(interaction.client, interaction.user.id, target.id);
    return interaction.editReply(removed
      ? `✅ Votre avis sur **${target.username}** a été retiré.`
      : "Vous n'aviez pas d'avis sur ce membre.");
  }

  if (sub === 'top') {
    const classes = store.vouchTargets()
      .map((id) => ({ id, link: store.getLink(id), t: calculerTrust(store.vouchAll(id)) }))
      .filter((r) => r.link && r.t.n >= 1)
      .sort((a, b) => b.t.score - a.t.score || b.t.n - a.t.n)
      .slice(0, 10);
    if (!classes.length) {
      return interaction.reply({ content: 'Aucun avis pour le moment.', flags: MessageFlags.Ephemeral });
    }
    const lignes = classes.map((r, i) => {
      const medaille = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``;
      return `${medaille} ${r.t.palier.emoji} **${r.link.mc_name}** · \`${barre(r.t.score, 6)}\` ${r.t.score} · ${etoiles(r.t.moyenne)} · ${r.t.n} avis`;
    });
    return interaction.reply({
      embeds: [embed(TITRES.reputation, { description: `**Les plus fiables de la commu**\n\n${lignes.join('\n')}` })],
    });
  }

  const target = interaction.options.getUser('membre') ?? interaction.user;
  const link = store.getLink(target.id);
  if (!link) {
    return interaction.reply({ content: `**${target.username}** n'est pas vérifié.`, flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply();
  const fil = await filDe(interaction.client, link).catch(() => null);
  const carte = carteReputation(link);
  return interaction.editReply({ ...carte, content: fil ? `Tous ses avis : ${fil}` : undefined });
}
