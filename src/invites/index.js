// Repris d'Orbit (src/modules/invites) : qui a invite qui, pour les entrees bonus
// des giveaways et /invites. Demande l'intent « Server Members » (DISCORD_MEMBERS=true).
import { EmbedBuilder, Events, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../giveaways/outils/couleurs.js';
import { createLogger } from '../giveaways/outils/logger.js';
import { findUsedInvite } from './track.js';
const log = createLogger('invites');
/**
 * Discord ne dit pas qui a invité un nouveau membre. Méthode classique : on garde le
 * nombre d'utilisations de chaque lien, et à chaque arrivée on regarde lequel a augmenté.
 * Il faut la permission « Gérer le serveur » pour lire les invitations.
 */
const uses = new Map();
/** Une file par serveur : deux arrivées simultanées ne doivent pas se mélanger. */
const queues = new Map();
async function snapshot(guild) {
    const invites = await guild.invites.fetch({ cache: false });
    const map = new Map();
    for (const inv of invites.values())
        map.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviterId ?? null, maxUses: inv.maxUses ?? 0 });
    return map;
}
async function refresh(guild) {
    try {
        uses.set(guild.id, await snapshot(guild));
    }
    catch {
        // Pas la permission « Gérer le serveur » : le suivi est désactivé sur ce serveur
        uses.delete(guild.id);
    }
}
function enqueue(guildId, task) {
    const previous = queues.get(guildId) ?? Promise.resolve();
    const next = previous.then(task, task).catch((err) => log.warn('Suivi des invitations : erreur', err));
    queues.set(guildId, next);
}
/** Nombre d'invitations restées d'un membre (celles qui comptent pour les giveaways). */
export function stayedInvites(ctx, guildId, userId) {
    return ctx.invites.counts(guildId, userId, ctx.settings.get(guildId).giveaways.inviteMinAccountDays).stayed;
}
const invitesCommand = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Invitations sur ce serveur')
        .addSubcommand((s) => s
        .setName('voir')
        .setDescription('Combien de personnes un membre a invitées')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)')))
        .addSubcommand((s) => s.setName('classement').setDescription('Les membres qui ont invité le plus de monde')),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild())
            return;
        const minDays = ctx.settings.get(interaction.guildId).giveaways.inviteMinAccountDays;
        if (interaction.options.getSubcommand() === 'classement') {
            const top = ctx.invites.top(interaction.guildId, minDays, 10);
            const medals = ['🥇', '🥈', '🥉'];
            const lines = top.map((r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.inviter_id}> — **${r.stayed}** invitation(s)`);
            return interaction.reply({
                embeds: [new EmbedBuilder().setColor(COLORS.brand).setTitle('🏆 Meilleurs inviteurs').setDescription(lines.join('\n') || 'Personne n\'a encore invité de membre depuis l\'arrivée du bot.')],
                allowedMentions: { parse: [] },
            });
        }
        const user = interaction.options.getUser('membre') ?? interaction.user;
        const c = ctx.invites.counts(interaction.guildId, user.id, minDays);
        const embed = new EmbedBuilder()
            .setColor(COLORS.brand)
            .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
            .setDescription(`**${c.stayed}** invitation(s) restée(s) sur le serveur`)
            .addFields({ name: 'Parties', value: String(c.left), inline: true }, { name: 'Comptes trop récents', value: String(c.fake), inline: true }, { name: 'Total', value: String(c.total), inline: true })
            .setFooter({ text: `Les comptes de moins de ${minDays} jour(s) à leur arrivée ne comptent pas.` });
        const inviter = ctx.invites.inviterOf(interaction.guildId, user.id);
        if (inviter)
            embed.addFields({ name: 'Invité(e) par', value: `<@${inviter}>` });
        if (!uses.has(interaction.guildId)) {
            embed.addFields({ name: '⚠️ Suivi inactif', value: 'Donne-moi la permission « Gérer le serveur » pour que je puisse voir qui invite qui.' });
        }
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    },
};
function setup(ctx) {
    ctx.client.once(Events.ClientReady, async (client) => {
        for (const guild of client.guilds.cache.values())
            await refresh(guild);
        log.info(`Suivi des invitations actif sur ${uses.size} serveur(s)`);
    });
    ctx.client.on(Events.GuildCreate, (guild) => void refresh(guild));
    ctx.client.on(Events.GuildDelete, (guild) => uses.delete(guild.id));
    ctx.client.on(Events.InviteCreate, (invite) => {
        if (!invite.guild)
            return;
        uses.get(invite.guild.id)?.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviterId ?? null, maxUses: invite.maxUses ?? 0 });
    });
    ctx.client.on(Events.InviteDelete, (invite) => {
        if (!invite.guild)
            return;
        // On attend un peu : un lien supprimé parce qu'il vient d'atteindre sa limite sert encore à détecter l'arrivée
        setTimeout(() => uses.get(invite.guild.id)?.delete(invite.code), 5000).unref();
    });
    ctx.client.on(Events.GuildMemberAdd, (member) => {
        if (member.user.bot)
            return;
        enqueue(member.guild.id, async () => {
            const before = uses.get(member.guild.id);
            let used = null;
            if (before) {
                const after = await snapshot(member.guild).catch(() => null);
                if (after) {
                    used = findUsedInvite(before, after);
                    uses.set(member.guild.id, after);
                }
            }
            ctx.invites.recordJoin({
                guildId: member.guild.id,
                userId: member.id,
                inviterId: used?.inviterId ?? null,
                code: used?.code ?? null,
                accountCreatedAt: member.user.createdTimestamp,
                joinedAt: member.joinedTimestamp ?? Date.now(),
            });
        });
    });
    ctx.client.on(Events.GuildMemberRemove, (member) => {
        if (!member.user?.bot)
            ctx.invites.recordLeave(member.guild.id, member.id);
    });
}
export const invitesModule = { name: 'Invitations', commands: [invitesCommand], setup };
