// Repris d'Orbit (src/modules/giveaways/index.ts) : boutons, formulaire /gcreate
// et tache de fond (fin des giveaways, programmes, rappels, reclamations).
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, PermissionFlagsBits, } from 'discord.js';
import { hexToInt } from './outils/couleurs.js';
import { parseDuration } from './outils/format.js';
import { normalizeImageRef } from './outils/images.js';
import { createLogger } from './outils/logger.js';
import { giveawayCommands, giveawayMenus } from './commands.js';
import { onEntrants } from './entrants.js';
import { checkRules, MAX_GIVEAWAY_MS, MAX_WINNERS, optionsOf, ticketCount } from './rules.js';
import { afterDropWin, canManageGiveaways, claimPrize, deleteGiveawayChannel, endGiveaway, factsFor, processChannelDeletes, processExpiredClaims, processReminders, processSchedules, processTempRoles, scheduleRefresh, startGiveaway, takeDropSpot, } from './service.js';
// Ce que le reste du bot (dashboard, actions) utilise
export { isValidEmoji, MAX_GIVEAWAY_MS } from './rules.js';
export { deleteGiveaway, editGiveaway, entrantRanking, deleteGiveawayChannel, endGiveaway, rerollGiveaway, runSchedule, startGiveaway, } from './service.js';
const log = createLogger('giveaways');
const ephemeral = MessageFlags.Ephemeral;
function leaveRow(id) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:leave:${id}`).setLabel('Quitter le giveaway').setStyle(ButtonStyle.Danger));
}
async function onEnter(interaction, ctx, g) {
    if (g.ended || g.ends_at <= Date.now())
        return interaction.reply({ content: 'Ce giveaway est terminé.', flags: ephemeral });
    const o = optionsOf(g);
    const facts = factsFor(ctx, interaction.member);
    const problem = checkRules(o, facts);
    if (o.drop) {
        if (problem)
            return interaction.reply({ content: `⛔ ${problem}`, flags: ephemeral, allowedMentions: { parse: [] } });
        const spot = takeDropSpot(ctx, g, interaction.user.id);
        if (spot.full)
            return interaction.reply({ content: '😢 Trop tard, toutes les places du drop sont prises !', flags: ephemeral });
        if (!spot.won)
            return interaction.reply({ content: 'Tu as déjà attrapé ce drop 👍', flags: ephemeral });
        await interaction.reply({ content: `⚡ Bien joué, tu as attrapé le drop **${g.prize}** !`, flags: ephemeral });
        await afterDropWin(ctx, interaction.guild, g, interaction.user.id, spot.full);
        return;
    }
    if (ctx.giveaways.hasEntry(g.id, interaction.user.id)) {
        return interaction.reply({ content: 'Tu participes déjà à ce giveaway.', components: [leaveRow(g.id)], flags: ephemeral });
    }
    if (problem)
        return interaction.reply({ content: `⛔ ${problem}`, flags: ephemeral, allowedMentions: { parse: [] } });
    ctx.giveaways.addEntry(g.id, interaction.user.id);
    scheduleRefresh(ctx, g.id);
    const t = ticketCount(o, facts);
    const parts = [];
    if (t.roles > 1)
        parts.push(`${t.roles} grâce à tes rôles`);
    if (t.invites)
        parts.push(`+${t.invites} pour tes invitations`);
    if (t.vouches)
        parts.push(`+${t.vouches} pour tes vouchs`);
    const bonus = t.total > 1 ? `\nTu as **${t.total} entrées** (${parts.join(', ')}).` : '';
    return interaction.reply({ content: `🎉 Tu participes au giveaway **${g.prize}** !${bonus}`, components: [leaveRow(g.id)], flags: ephemeral });
}
async function onSummary(interaction, ctx, g) {
    const entrants = ctx.giveaways.entries(g.id);
    const winners = ctx.giveaways.winners(g);
    const s = ctx.settings.get(g.guild_id).giveaways;
    const shown = entrants.slice(0, 40).map((id) => `<@${id}>`).join(' ');
    const embed = new EmbedBuilder()
        .setColor(hexToInt(s.endedColor))
        .setTitle(`Résumé : ${g.prize}`.slice(0, 256))
        .addFields({ name: 'Organisé par', value: `<@${g.host_id}>`, inline: true }, { name: 'Participants', value: String(entrants.length), inline: true }, { name: 'Terminé', value: `<t:${Math.floor((g.ended_at ?? g.ends_at) / 1000)}:f>`, inline: true }, { name: 'Gagnants', value: winners.map((id) => `<@${id}>`).join(', ').slice(0, 1024) || 'Aucun' }, { name: 'Liste des participants', value: (shown + (entrants.length > 40 ? ` et ${entrants.length - 40} autre(s)` : '')).slice(0, 1024) || 'Personne' });
    const summaryUrl = `${ctx.config.dashboardUrl}/giveaway/${g.id}`;
    const files = entrants.length > 40 ? [new AttachmentBuilder(Buffer.from(entrants.join('\n'), 'utf8'), { name: `participants-${g.id}.txt` })] : [];
    // Discord n'accepte un bouton-lien que vers une adresse publique en https
    const components = summaryUrl.startsWith('https://')
        ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Résumé complet').setURL(summaryUrl))]
        : [];
    return interaction.reply({ embeds: [embed], files, components, flags: ephemeral, allowedMentions: { parse: [] } });
}
/** Seuls les gestionnaires de giveaways ou ceux qui peuvent gérer ce salon peuvent le supprimer. */
function canDeleteChannel(interaction, ctx) {
    const member = interaction.member;
    const channel = interaction.channel;
    return (canManageGiveaways(member, ctx.settings.get(interaction.guildId).giveaways) ||
        (!!channel && 'permissionsFor' in channel && !!channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageChannels)));
}
export const giveawaysModule = {
    name: 'Giveaways',
    commands: giveawayCommands,
    messageMenus: giveawayMenus,
    buttons: {
        giveaway: async (interaction, ctx, [action, rawId, rawPage]) => {
            const g = ctx.giveaways.get(Number(rawId));
            // Réclamer : marche aussi depuis le bouton envoyé en message privé
            if (action === 'claim') {
                if (!g)
                    return interaction.reply({ content: 'Ce giveaway n\'existe plus.', flags: ephemeral });
                return interaction.reply({ content: await claimPrize(ctx, g, interaction.user.id), flags: ephemeral, allowedMentions: { parse: [] } });
            }
            if (action === 'cancel')
                return interaction.update({ content: 'Annulé.', components: [] });
            if (!interaction.inCachedGuild())
                return;
            if (!g || g.guild_id !== interaction.guildId)
                return interaction.reply({ content: 'Ce giveaway n\'existe plus.', flags: ephemeral });
            // "join" : boutons des giveaways créés avant la mise à jour
            if (action === 'enter' || action === 'join')
                return onEnter(interaction, ctx, g);
            if (action === 'summary')
                return onSummary(interaction, ctx, g);
            if (action === 'entrants')
                return onEntrants(interaction, ctx, g, Number(rawPage) || 0);
            if (action === 'leave') {
                if (g.ended)
                    return interaction.update({ content: 'Ce giveaway est terminé.', components: [] });
                const left = ctx.giveaways.removeEntry(g.id, interaction.user.id);
                scheduleRefresh(ctx, g.id);
                return interaction.update({ content: left ? 'Tu ne participes plus à ce giveaway.' : 'Tu ne participais pas à ce giveaway.', components: [] });
            }
            // Bouton « Supprimer le salon » : demande une confirmation d'abord
            if (action === 'delchan' || action === 'delchanyes') {
                if (!g.ended || !g.own_channel)
                    return interaction.reply({ content: 'Ce salon n\'a pas été créé pour un giveaway terminé.', flags: ephemeral });
                if (!canDeleteChannel(interaction, ctx)) {
                    return interaction.reply({ content: 'Seuls les gestionnaires de giveaways peuvent supprimer ce salon.', flags: ephemeral });
                }
                if (action === 'delchan') {
                    const confirm = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:delchanyes:${g.id}`).setLabel('Oui, supprimer le salon').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`giveaway:cancel:${g.id}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary));
                    return interaction.reply({ content: `Supprimer définitivement <#${g.channel_id}> et tout son contenu ?`, components: [confirm], flags: ephemeral });
                }
                await interaction.update({ content: '🗑️ Suppression du salon…', components: [] });
                try {
                    await deleteGiveawayChannel(ctx, g, `Supprimé par ${interaction.user.username} (giveaway terminé)`);
                }
                catch (err) {
                    log.warn(`Salon du giveaway #${g.id} non supprimé`, err);
                    await interaction.followUp({ content: '❌ Impossible de supprimer le salon : il me faut la permission « Gérer les salons ».', flags: ephemeral }).catch(() => { });
                }
                return;
            }
        },
    },
    modals: {
        gcreate: async (interaction, ctx, [channelId]) => {
            if (!interaction.inCachedGuild())
                return;
            const v = (id) => interaction.fields.getTextInputValue(id).trim();
            const duration = parseDuration(v('duration'));
            const winners = Number(v('winners'));
            const errors = [];
            if (!duration || duration > MAX_GIVEAWAY_MS)
                errors.push('Durée invalide (exemples : 30m, 2h, 3d ; max 60 jours).');
            if (!Number.isInteger(winners) || winners < 1 || winners > MAX_WINNERS)
                errors.push(`Nombre de gagnants invalide (1 à ${MAX_WINNERS}).`);
            if (errors.length)
                return interaction.reply({ content: `❌ ${errors.join(' ')}`, flags: ephemeral });
            await interaction.deferReply({ flags: ephemeral });
            const imageLink = v('image');
            const image = imageLink ? normalizeImageRef(imageLink) : '';
            if (imageLink && !image)
                return interaction.editReply('❌ Lien d\'image invalide : il faut un lien https direct vers une image.');
            try {
                const g = await startGiveaway(ctx, interaction.guild, {
                    channelId: channelId ?? interaction.channelId ?? undefined,
                    hostId: interaction.user.id,
                    prize: v('prize'),
                    description: v('description'),
                    durationMs: duration,
                    winners,
                    options: image ? { image } : {},
                });
                return interaction.editReply(`🎉 Giveaway #${g.id} lancé dans <#${g.channel_id}> !`);
            }
            catch (err) {
                log.warn('Lancement de giveaway impossible', err);
                return interaction.editReply('❌ Impossible de publier le giveaway : vérifie que je peux créer des salons et écrire dedans.');
            }
        },
    },
    setup(ctx) {
        // Salon de giveaway supprimé à la main : on termine proprement ce qui s'y trouvait
        ctx.client.on(Events.ChannelDelete, (channel) => {
            for (const g of ctx.giveaways.byChannel(channel.id)) {
                if (!g.ended)
                    ctx.giveaways.finish(g.id, ctx.giveaways.winners(g));
                ctx.giveaways.markChannelDeleted(g.id);
            }
        });
        let running = false;
        const failures = new Map();
        const tick = async () => {
            if (running)
                return;
            running = true;
            try {
                for (const g of ctx.giveaways.due()) {
                    await endGiveaway(ctx, g).catch((err) => {
                        // Erreur passagère (réseau, Discord) : on réessaie au prochain passage, 5 fois maximum
                        const count = (failures.get(g.id) ?? 0) + 1;
                        failures.set(g.id, count);
                        log.error(`Fin du giveaway #${g.id} impossible (essai ${count}/5)`, err);
                        if (count >= 5) {
                            ctx.giveaways.finish(g.id, []);
                            failures.delete(g.id);
                        }
                    });
                }
                const tasks = [
                    ['programmés', processSchedules],
                    ['réclamations', processExpiredClaims],
                    ['rappels', processReminders],
                    ['rôles temporaires', processTempRoles],
                    ['suppression des salons', processChannelDeletes],
                ];
                for (const [name, task] of tasks)
                    await task(ctx).catch((err) => log.error(`Tâche « ${name} » en échec`, err));
            }
            finally {
                running = false;
            }
        };
        setInterval(() => void tick(), 10_000).unref();
    },
};
