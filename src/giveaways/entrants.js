// Repris d'Orbit (src/modules/giveaways/entrants.ts).
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { hexToInt } from './outils/couleurs.js';
import { ENTRANTS_PER_PAGE, entrantLine } from './rules.js';
import { canManageGiveaways, entrantRanking } from './service.js';
const ephemeral = MessageFlags.Ephemeral;
/**
 * Embed pour les modérateurs : tous les participants classés par nombre d'entrées,
 * avec leurs bonus et leur chance de gagner. 20 par page, fichier complet en pièce jointe.
 */
export function entrantsView(g, ranked, page, color) {
    const pages = Math.max(1, Math.ceil(ranked.length / ENTRANTS_PER_PAGE));
    const p = Math.min(Math.max(0, page), pages - 1);
    const totalTickets = ranked.reduce((sum, e) => sum + e.total, 0);
    const eligible = ranked.filter((e) => e.total > 0).length;
    const lines = ranked
        .slice(p * ENTRANTS_PER_PAGE, (p + 1) * ENTRANTS_PER_PAGE)
        .map((e, i) => entrantLine(p * ENTRANTS_PER_PAGE + i + 1, e, totalTickets, g.winners));
    const embed = new EmbedBuilder()
        .setColor(hexToInt(color))
        .setTitle(`👥 Participants : ${g.prize}`.slice(0, 256))
        .setDescription((lines.join('\n') || 'Personne ne participe pour l\'instant.').slice(0, 4096))
        .addFields({ name: 'Participants', value: String(ranked.length), inline: true }, { name: 'Peuvent gagner', value: String(eligible), inline: true }, { name: 'Entrées au total', value: String(totalTickets), inline: true })
        .setFooter({ text: `Giveaway #${g.id} · page ${p + 1}/${pages} · visible seulement par toi` });
    const nav = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:entrants:${g.id}:${p - 1}`).setLabel('◀ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(p === 0), new ButtonBuilder().setCustomId(`giveaway:entrants:${g.id}:${p + 1}`).setLabel('Suivant ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1), new ButtonBuilder().setCustomId(`giveaway:entrants:${g.id}:${p}`).setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: pages > 1 || ranked.length ? [nav] : [] };
}
/** Liste complète en fichier texte (pratique quand il y a beaucoup de monde). */
export function entrantsFile(g, ranked) {
    const rows = ['rang;id;entrees;roles;invitations;vouchs;remarque'];
    ranked.forEach((e, i) => rows.push([i + 1, e.id, e.total, e.roles, e.invites, e.vouches ?? 0, e.problem.replace(/;/g, ',')].join(';')));
    return new AttachmentBuilder(Buffer.from(rows.join('\n'), 'utf8'), { name: `participants-giveaway-${g.id}.csv` });
}
export async function onEntrants(interaction, ctx, g, page) {
    const s = ctx.settings.get(interaction.guildId).giveaways;
    if (!canManageGiveaways(interaction.member, s)) {
        return interaction.reply({ content: '🔒 Seuls les modérateurs (gestionnaires de giveaways) peuvent voir la liste des participants.', flags: ephemeral });
    }
    // Premier clic sur le message du giveaway → nouvelle réponse privée ; ensuite on change de page dans cette réponse
    const fromList = interaction.message.flags.has(MessageFlags.Ephemeral);
    if (fromList)
        await interaction.deferUpdate();
    else
        await interaction.deferReply({ flags: ephemeral });
    const ranked = await entrantRanking(ctx, interaction.guild, g);
    const view = entrantsView(g, ranked, page, s.color);
    const files = !fromList && ranked.length > ENTRANTS_PER_PAGE ? [entrantsFile(g, ranked)] : [];
    return interaction.editReply({ ...view, files, allowedMentions: { parse: [] } });
}
