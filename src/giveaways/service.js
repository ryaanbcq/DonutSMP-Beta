// Repris d'Orbit (src/modules/giveaways/service.ts) et adapte a DonutSMP FR.
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, OverwriteType, PermissionFlagsBits, } from 'discord.js';
import { hexToInt } from './outils/couleurs.js';
import { formatDuration, renderTemplate } from './outils/format.js';
import { imagesDir, readImage } from './outils/images.js';
import { createLogger } from './outils/logger.js';
import { stayedInvites } from '../invites/index.js';
import { store } from '../db.js';
import { estAdmin } from '../lib/admin.js';
import { messagesDe } from '../stats/store.js';
import { channelNameFrom, checkRules, DAY_MS, defaultOptions, describeBonus, describeRules, drawWinners, isValidEmoji, MAX_GIVEAWAY_MS, MAX_WINNERS, nextRunAfter, normalizeOptions, optionsOf, rankEntrants, ticketCount, } from './rules.js';
const log = createLogger('giveaways');
/**
 * Récupère des membres par leur ID. La demande groupée passe par la passerelle ;
 * si elle échoue, on les demande un par un (sans intent privilégié).
 */
async function fetchMembers(guild, ids) {
    const out = new Map();
    const bulk = await guild.members.fetch({ user: ids }).catch(() => null);
    for (const id of ids) {
        const m = bulk?.get(id) ?? guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
        if (m) out.set(id, m);
    }
    return out;
}
// ───────────────────────────── Outils ─────────────────────────────
/** Temps restant arrondi à la minute (pas de secondes dans l'affichage). */
export const minutesLeft = (endsAt) => Math.max(1, Math.ceil((endsAt - Date.now()) / 60_000)) * 60_000;
export const jumpUrl = (g) => g.message_id ? `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}` : null;
/** Gestionnaire de giveaways : « Gérer le serveur », ou un des rôles choisis dans les réglages. */
export function canManageGiveaways(member, s) {
    // Les admins du bot (/setup general, « Gérer le serveur », DEV_USER_IDS) passent toujours.
    return estAdmin(member) || member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.some((r) => s.managerRoleIds.includes(r.id));
}
/** Ce que les conditions et les entrées bonus regardent chez un membre. */
export function factsFor(ctx, member) {
    const score = store.vouchScore(member.id);
    return {
        roleIds: new Set(member.roles.cache.keys()),
        level: 0,
        // Compte Minecraft lié avec le panneau « Se connecter »
        linked: !!store.getLink(member.id),
        // Vouchs positifs reçus moins les négatifs
        vouches: Math.max(0, (score?.pos ?? 0) - (score?.neg ?? 0)),
        // Messages comptés par le module de statistiques
        messages: messagesDe(member.guild.id, member.id),
        accountCreatedAt: member.user.createdTimestamp,
        joinedAt: member.joinedTimestamp,
        invites: stayedInvites(ctx, member.guild.id, member.id),
        blacklisted: ctx.settings.get(member.guild.id).giveaways.blacklistUserIds.includes(member.id),
    };
}
const linkRow = (url, label = 'Voir le giveaway') => url ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url))] : [];
function imageUrlFor(ref, current) {
    if (!ref)
        return null;
    if (ref.startsWith('file:'))
        return current || `attachment://${ref.slice(5)}`;
    return ref;
}
/** Fichiers à joindre au message pour les images gardées par le bot. */
export function imageAttachments(ctx, o) {
    const dir = imagesDir(ctx.config.databasePath);
    const names = [...new Set([o.image, o.thumbnail].filter((r) => r.startsWith('file:')).map((r) => r.slice(5)))];
    return names.flatMap((name) => {
        const buf = readImage(dir, name);
        return buf ? [new AttachmentBuilder(buf, { name })] : [];
    });
}
export function giveawayView(ctx, g, current = {}) {
    const s = ctx.settings.get(g.guild_id).giveaways;
    const o = optionsOf(g);
    const ended = !!g.ended;
    const entries = ctx.giveaways.entryCount(g.id);
    const winners = ctx.giveaways.winners(g);
    const claims = new Map(ctx.giveaways.claims.forGiveaway(g.id).map((c) => [c.user_id, c.status]));
    const endTs = Math.floor((ended ? g.ended_at ?? g.ends_at : g.ends_at) / 1000);
    const winnerLabel = (id) => {
        const status = claims.get(id);
        if (status === 'claimed')
            return `<@${id}> ✅`;
        if (status === 'expired')
            return `~~<@${id}>~~ (pas réclamé)`;
        if (status === 'pending')
            return `<@${id}> ⏳`;
        return `<@${id}>`;
    };
    const lines = [];
    if (o.drop && !ended)
        lines.push(`⚡ **Drop** : les ${g.winners} premier(s) à cliquer gagnent !`, '');
    if (g.description)
        lines.push(g.description, '');
    lines.push(ended ? `Terminé : <t:${endTs}:R> (<t:${endTs}:f>)` : `Fin : <t:${endTs}:R> (<t:${endTs}:f>)`);
    lines.push(`Organisé par : <@${g.host_id}>`);
    if (!o.drop)
        lines.push(`Participants : **${entries}**`);
    if (ended || o.drop) {
        lines.push(`Gagnants${o.drop && !ended ? ` (${winners.length}/${g.winners})` : ''} : ${winners.length ? winners.map(winnerLabel).join(', ') : ended ? 'aucun' : 'personne pour l\'instant'}`);
    }
    else {
        lines.push(`Gagnants : **${g.winners}**`);
    }
    if (!ended) {
        if (o.winnerRoleId)
            lines.push(`Rôle offert : <@&${o.winnerRoleId}>${o.winnerRoleDays ? ` pendant ${o.winnerRoleDays} jour(s)` : ''}`);
        if (o.claimHours)
            lines.push(`Les gagnants auront **${o.claimHours} h** pour réclamer leur lot.`);
        const rules = describeRules(o);
        if (rules.length)
            lines.push('', '**Conditions**', ...rules.map((r) => `• ${r}`));
        const bonus = describeBonus(o);
        if (bonus.length && !o.drop)
            lines.push('', '**Entrées bonus**', ...bonus.map((b) => `• ${b}`));
    }
    const embed = new EmbedBuilder()
        .setColor(hexToInt(ended ? o.endedColor || s.endedColor : o.color || s.color))
        .setTitle(`${o.drop ? '⚡ ' : ''}${g.prize}`.slice(0, 256))
        .setDescription(lines.join('\n').slice(0, 4096))
        .setFooter({ text: `Giveaway #${g.id}${ended ? ' · terminé' : ''}` })
        .setTimestamp(ended ? g.ended_at ?? g.ends_at : g.ends_at);
    const image = imageUrlFor(o.image, current.image);
    const thumbnail = imageUrlFor(o.thumbnail, current.thumbnail);
    if (image)
        embed.setImage(image);
    if (thumbnail)
        embed.setThumbnail(thumbnail);
    const row = new ActionRowBuilder();
    if (ended) {
        row.addComponents(new ButtonBuilder().setCustomId(`giveaway:summary:${g.id}`).setLabel('Résumé').setStyle(ButtonStyle.Secondary));
        if (g.own_channel) {
            row.addComponents(new ButtonBuilder().setCustomId(`giveaway:delchan:${g.id}`).setLabel('Supprimer le salon').setEmoji('🗑️').setStyle(ButtonStyle.Danger));
        }
    }
    else {
        const button = new ButtonBuilder()
            .setCustomId(`giveaway:enter:${g.id}`)
            .setEmoji(isValidEmoji(s.emoji) ? s.emoji.trim() : '🎉')
            .setStyle(o.drop ? ButtonStyle.Success : ButtonStyle.Primary);
        const label = o.drop ? s.buttonLabel.trim() || 'Attraper' : s.buttonLabel.trim();
        if (label)
            button.setLabel(label.slice(0, 80));
        row.addComponents(button);
    }
    // Réservé aux modérateurs (vérifié au clic) : classement des participants par entrées
    if (!o.drop)
        row.addComponents(new ButtonBuilder().setCustomId(`giveaway:entrants:${g.id}:0`).setLabel('Participants').setEmoji('👥').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row] };
}
/**
 * Met à jour le message du giveaway. `reupload` : les images ont changé, on renvoie les fichiers.
 * Sinon on réutilise l'adresse Discord des images déjà présentes dans le message.
 */
export async function editGiveawayMessage(ctx, g, reupload = false) {
    if (!g.message_id)
        return;
    const channel = ctx.client.guilds.cache.get(g.guild_id)?.channels.cache.get(g.channel_id);
    if (!channel || !('messages' in channel))
        return;
    const message = await channel.messages.fetch(g.message_id).catch(() => null);
    if (!message)
        return;
    const o = optionsOf(g);
    try {
        if (reupload) {
            await message.edit({ ...giveawayView(ctx, g), files: imageAttachments(ctx, o), attachments: [] });
        }
        else {
            const embed = message.embeds[0];
            const current = {
                image: o.image.startsWith('file:') ? embed?.image?.url : null,
                thumbnail: o.thumbnail.startsWith('file:') ? embed?.thumbnail?.url : null,
            };
            await message.edit(giveawayView(ctx, g, current));
        }
    }
    catch (err) {
        log.debug('Message de giveaway non modifié', err);
    }
}
/**
 * Le nombre de participants est mis à jour au plus toutes les 5 secondes :
 * sur un gros giveaway, modifier le message à chaque clic dépasserait les limites de Discord.
 */
const pendingRefresh = new Map();
export function scheduleRefresh(ctx, id) {
    if (pendingRefresh.has(id))
        return;
    pendingRefresh.set(id, setTimeout(() => {
        pendingRefresh.delete(id);
        const g = ctx.giveaways.get(id);
        if (g)
            void editGiveawayMessage(ctx, g);
    }, 5000));
}
export async function createGiveawayChannel(guild, prize, number, c) {
    const me = guild.members.me;
    const parent = c.categoryId && guild.channels.cache.get(c.categoryId)?.type === ChannelType.GuildCategory ? c.categoryId : null;
    return guild.channels.create({
        name: channelNameFrom(c.name, { prize, number, date: new Date() }),
        type: ChannelType.GuildText,
        parent,
        topic: `Giveaway : ${prize}`.slice(0, 1024),
        reason: 'Salon de giveaway',
        permissionOverwrites: c.readOnly
            ? [
                {
                    id: guild.roles.everyone.id,
                    type: OverwriteType.Role,
                    deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads],
                },
                ...(me
                    ? [
                        {
                            id: me.id,
                            type: OverwriteType.Member,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory],
                        },
                    ]
                    : []),
            ]
            : undefined,
    });
}
/** Supprime le salon créé pour un giveaway (bouton admin ou suppression automatique). */
export async function deleteGiveawayChannel(ctx, g, reason) {
    const channel = ctx.client.guilds.cache.get(g.guild_id)?.channels.cache.get(g.channel_id);
    // On marque d'abord : l'événement « salon supprimé » ne doit pas traiter ce giveaway une 2e fois
    ctx.giveaways.markChannelDeleted(g.id);
    if (!channel)
        return false;
    await channel.delete(reason);
    return true;
}
/** Crée le giveaway et publie son message. Utilisé par les commandes, le dashboard et la programmation. */
export async function startGiveaway(ctx, guild, data) {
    const s = ctx.settings.get(guild.id).giveaways;
    const options = normalizeOptions({
        ...defaultOptions(),
        bonusEntries: s.bonusEntries,
        pingRoleId: s.pingRoleId,
        entriesPerInvite: s.entriesPerInvite,
        maxInviteEntries: s.maxInviteEntries,
        ...data.options,
    });
    let channel = null;
    let created = false;
    if (data.newChannel) {
        channel = await createGiveawayChannel(guild, data.prize, data.runNumber ?? 1, data.newChannel);
        created = true;
    }
    else {
        const existing = data.channelId ? guild.channels.cache.get(data.channelId) : undefined;
        if (!existing || (existing.type !== ChannelType.GuildText && existing.type !== ChannelType.GuildAnnouncement))
            throw new Error('Salon introuvable');
        channel = existing;
    }
    const g = ctx.giveaways.create({
        guildId: guild.id,
        channelId: channel.id,
        hostId: data.hostId,
        prize: data.prize.slice(0, 256),
        description: (data.description ?? '').slice(0, 2000),
        winners: Math.max(1, Math.min(MAX_WINNERS, data.winners)),
        options,
        endsAt: Date.now() + Math.min(data.durationMs, MAX_GIVEAWAY_MS),
        ownChannel: created,
        scheduleId: data.scheduleId ?? null,
    });
    // Le rôle @everyone a le même ID que le serveur
    const everyone = options.pingRoleId === guild.id;
    const ping = everyone ? '@everyone' : options.pingRoleId ? `<@&${options.pingRoleId}>` : '';
    try {
        const message = await channel.send({
            content: ping ? `${ping} ${options.drop ? '⚡ **Nouveau drop !**' : '🎉 **Nouveau giveaway !**'}` : undefined,
            ...giveawayView(ctx, g),
            files: imageAttachments(ctx, options),
            allowedMentions: { parse: everyone ? ['everyone'] : [], roles: options.pingRoleId && !everyone ? [options.pingRoleId] : [] },
        });
        ctx.giveaways.setMessage(g.id, message.id);
        return ctx.giveaways.get(g.id);
    }
    catch (err) {
        ctx.giveaways.delete(g.id);
        if (created)
            await channel.delete('Giveaway impossible à publier').catch(() => { });
        throw err;
    }
}
// ───────────────────────────── Gagnants ─────────────────────────────
/** Participants éligibles au moment du tirage, avec leur nombre de tickets. */
async function eligiblePool(ctx, guild, g, exclude) {
    const o = optionsOf(g);
    const ids = ctx.giveaways.entries(g.id).filter((id) => !exclude.has(id));
    const pool = [];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const members = await fetchMembers(guild, chunk);
        for (const id of chunk) {
            const member = members?.get(id);
            if (!member || member.user.bot)
                continue; // parti du serveur entre-temps
            const facts = factsFor(ctx, member);
            if (checkRules(o, facts))
                continue; // ne remplit plus les conditions
            pool.push({ id, weight: ticketCount(o, facts).total });
        }
    }
    return pool;
}
/**
 * Classement de tous les participants par nombre d'entrées (pour les modérateurs).
 * Ceux qui sont partis ou ne remplissent plus les conditions apparaissent à la fin avec 0.
 */
export async function entrantRanking(ctx, guild, g) {
    const o = optionsOf(g);
    const ids = ctx.giveaways.entries(g.id);
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const members = await fetchMembers(guild, chunk);
        for (const id of chunk) {
            const member = members?.get(id) ?? guild.members.cache.get(id);
            if (!member) {
                out.push({ id, total: 0, roles: 0, invites: 0, vouches: 0, levels: 0, problem: 'a quitté le serveur' });
                continue;
            }
            const facts = factsFor(ctx, member);
            const problem = checkRules(o, facts);
            const t = ticketCount(o, facts);
            out.push(problem ? { id, total: 0, roles: 0, invites: 0, vouches: 0, levels: 0, problem } : { id, ...t, problem: '' });
        }
    }
    return rankEntrants(out);
}
/** Donne le rôle de gagnant (et programme son retrait s'il est temporaire). */
async function giveWinnerRole(ctx, guild, g, userId) {
    const o = optionsOf(g);
    if (!o.winnerRoleId)
        return;
    const member = await guild.members.fetch(userId).catch(() => null);
    const role = guild.roles.cache.get(o.winnerRoleId);
    if (!member || !role)
        return;
    try {
        await member.roles.add(role, `Gagnant du giveaway #${g.id}`);
        if (o.winnerRoleDays > 0)
            ctx.giveaways.tempRoles.add(guild.id, userId, role.id, Date.now() + o.winnerRoleDays * DAY_MS);
    }
    catch (err) {
        log.warn(`Rôle de gagnant impossible à donner (giveaway #${g.id}) : place le rôle du bot au-dessus`, err);
    }
}
/** Ce qui arrive à un nouveau gagnant : délai pour réclamer, ou rôle tout de suite. */
async function onNewWinner(ctx, guild, g, userId) {
    const o = optionsOf(g);
    if (o.claimHours > 0 && !o.drop)
        ctx.giveaways.claims.add(g.id, userId, Date.now() + o.claimHours * 3_600_000);
    else
        await giveWinnerRole(ctx, guild, g, userId);
}
async function announce(ctx, guild, g, newWinners, kind, replaced) {
    const s = ctx.settings.get(guild.id).giveaways;
    const o = optionsOf(g);
    const channel = guild.channels.cache.get(g.channel_id);
    const url = jumpUrl(g);
    const vars = { winners: newWinners.map((id) => `<@${id}>`).join(', '), prize: g.prize, host: `<@${g.host_id}>` };
    const claim = o.claimHours > 0 && !o.drop && newWinners.length > 0;
    const claimRow = claim
        ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:claim:${g.id}`).setLabel('Réclamer mon lot').setEmoji('🎁').setStyle(ButtonStyle.Success))]
        : [];
    if (channel && 'send' in channel) {
        let text;
        if (kind === 'drop')
            text = `⚡ ${vars.winners} a attrapé le drop **${g.prize}** !`;
        else if (!newWinners.length)
            text = renderTemplate(s.noWinnerMessage, vars);
        else {
            const prefix = kind === 'reroll' ? '🔁 Nouveau tirage ! ' : kind === 'replace' ? `⌛ <@${replaced}> n'a pas réclamé son lot à temps. ` : '🎉 ';
            text = prefix + renderTemplate(s.winMessage, vars);
        }
        if (claim)
            text += `\nVous avez **${o.claimHours} h** pour cliquer sur « Réclamer mon lot », sinon un nouveau gagnant sera tiré au sort.`;
        await channel
            .send({
            content: text.slice(0, 2000),
            components: claimRow,
            reply: g.message_id ? { messageReference: g.message_id, failIfNotExists: false } : undefined,
            allowedMentions: { users: newWinners },
        })
            .catch((err) => log.warn('Annonce des gagnants impossible', err));
    }
    if (s.dmWinners) {
        for (const id of newWinners) {
            const user = await ctx.client.users.fetch(id).catch(() => null);
            const claimText = claim ? `\n\n⏳ Tu as **${o.claimHours} h** pour réclamer ton lot avec le bouton ci-dessous, sinon un autre gagnant sera tiré.` : '';
            await user
                ?.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(hexToInt(s.color))
                        .setTitle('🎉 Tu as gagné un giveaway !')
                        .setDescription(`Tu remportes **${g.prize}** sur **${guild.name}**.\nContacte <@${g.host_id}> pour récupérer ton lot.${claimText}`),
                ],
                components: [...claimRow, ...linkRow(url)],
            })
                .catch(() => { }); // MP fermés : l'annonce publique suffit
        }
    }
    if (s.dmHost && kind === 'end') {
        const host = await ctx.client.users.fetch(g.host_id).catch(() => null);
        await host
            ?.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(hexToInt(s.endedColor))
                    .setTitle(`Ton giveaway est terminé : ${g.prize}`.slice(0, 256))
                    .setDescription(`Serveur : **${guild.name}**\nParticipants : **${ctx.giveaways.entryCount(g.id)}**\nGagnants : ${newWinners.length ? newWinners.map((id) => `<@${id}>`).join(', ') : 'aucun'}`),
            ],
            components: linkRow(url),
        })
            .catch(() => { });
    }
}
/** Après la fin : programme la suppression automatique du salon créé, si demandée. */
function planChannelDeletion(ctx, g) {
    const hours = optionsOf(g).deleteChannelAfterHours;
    if (g.own_channel && hours > 0)
        ctx.giveaways.setDeleteChannelAt(g.id, Date.now() + hours * 3_600_000);
}
/** Termine le giveaway et tire les gagnants (en revérifiant les conditions). */
export async function endGiveaway(ctx, g) {
    const guild = ctx.client.guilds.cache.get(g.guild_id);
    if (!guild) {
        ctx.giveaways.finish(g.id, ctx.giveaways.winners(g));
        return [];
    }
    const o = optionsOf(g);
    if (o.drop) {
        // Drop : les gagnants sont déjà connus (les premiers à avoir cliqué)
        const winners = ctx.giveaways.winners(g);
        ctx.giveaways.finish(g.id, winners);
        const done = ctx.giveaways.get(g.id);
        await editGiveawayMessage(ctx, done);
        if (!winners.length)
            await announce(ctx, guild, done, [], 'end');
        planChannelDeletion(ctx, done);
        return winners;
    }
    const winners = drawWinners(await eligiblePool(ctx, guild, g, new Set()), g.winners);
    ctx.giveaways.finish(g.id, winners);
    const done = ctx.giveaways.get(g.id);
    for (const id of winners)
        await onNewWinner(ctx, guild, done, id);
    await editGiveawayMessage(ctx, done);
    await announce(ctx, guild, done, winners, 'end');
    planChannelDeletion(ctx, done);
    return winners;
}
/** Tire de nouveaux gagnants parmi ceux qui n'ont pas encore gagné (comme /greroll). */
export async function rerollGiveaway(ctx, g, count = 1, replaced) {
    const guild = ctx.client.guilds.cache.get(g.guild_id);
    if (!guild)
        return [];
    const previous = ctx.giveaways.winners(g);
    const winners = drawWinners(await eligiblePool(ctx, guild, g, new Set(previous)), Math.max(1, Math.min(MAX_WINNERS, count)));
    ctx.giveaways.finish(g.id, [...previous, ...winners]);
    const done = ctx.giveaways.get(g.id);
    for (const id of winners)
        await onNewWinner(ctx, guild, done, id);
    await editGiveawayMessage(ctx, done);
    if (winners.length || !replaced)
        await announce(ctx, guild, done, winners, replaced ? 'replace' : 'reroll', replaced);
    return winners;
}
/** Supprime le giveaway et son message, sans tirer de gagnant (comme /gdelete). */
export async function deleteGiveaway(ctx, g) {
    const channel = ctx.client.guilds.cache.get(g.guild_id)?.channels.cache.get(g.channel_id);
    if (g.message_id && channel && 'messages' in channel) {
        const message = await channel.messages.fetch(g.message_id).catch(() => null);
        await message?.delete().catch(() => { });
    }
    ctx.giveaways.delete(g.id);
}
/**
 * Clic sur le bouton d'un drop. Tout est synchrone jusqu'à l'enregistrement, donc deux
 * clics simultanés ne peuvent pas gagner la même place.
 */
export function takeDropSpot(ctx, g, userId) {
    const fresh = ctx.giveaways.get(g.id);
    const winners = ctx.giveaways.winners(fresh);
    if (fresh.ended || winners.length >= fresh.winners)
        return { won: false, full: true, position: 0 };
    if (winners.includes(userId))
        return { won: false, full: false, position: winners.indexOf(userId) + 1 };
    const next = [...winners, userId];
    ctx.giveaways.addEntry(g.id, userId);
    ctx.giveaways.setWinnerIds(g.id, next);
    return { won: true, full: next.length >= fresh.winners, position: next.length };
}
export async function afterDropWin(ctx, guild, g, userId, full) {
    const fresh = ctx.giveaways.get(g.id);
    await onNewWinner(ctx, guild, fresh, userId);
    await announce(ctx, guild, fresh, [userId], 'drop');
    if (full) {
        ctx.giveaways.finish(g.id, ctx.giveaways.winners(fresh));
        const done = ctx.giveaways.get(g.id);
        await editGiveawayMessage(ctx, done);
        planChannelDeletion(ctx, done);
    }
    else {
        scheduleRefresh(ctx, g.id);
    }
}
/** Un gagnant clique sur « Réclamer mon lot ». Retourne le message à lui afficher. */
export async function claimPrize(ctx, g, userId) {
    const claim = ctx.giveaways.claims.get(g.id, userId);
    if (!claim)
        return ctx.giveaways.winners(g).includes(userId) ? 'Ce giveaway ne demande pas de réclamer le lot.' : 'Tu n\'as pas gagné ce giveaway.';
    if (claim.status === 'claimed')
        return 'Tu as déjà réclamé ce lot 👍';
    if (claim.status === 'expired' || claim.deadline <= Date.now())
        return '⌛ Trop tard : le délai pour réclamer ce lot est dépassé.';
    ctx.giveaways.claims.setStatus(g.id, userId, 'claimed');
    const guild = ctx.client.guilds.cache.get(g.guild_id);
    if (guild)
        await giveWinnerRole(ctx, guild, g, userId);
    scheduleRefresh(ctx, g.id);
    return `✅ Lot réclamé ! Contacte <@${g.host_id}> pour recevoir **${g.prize}**.`;
}
/** Modifie un giveaway et met son message à jour. Retourne une erreur lisible, ou null. */
export async function editGiveaway(ctx, g, changes) {
    if (changes.endsAt !== undefined) {
        if (g.ended)
            return 'Ce giveaway est terminé : sa date de fin ne peut plus changer.';
        if (changes.endsAt <= Date.now())
            return 'La nouvelle fin doit être dans le futur (utilise /gend pour terminer maintenant).';
        if (changes.endsAt > Date.now() + MAX_GIVEAWAY_MS)
            return '60 jours maximum.';
    }
    if (changes.winners !== undefined && (changes.winners < 1 || changes.winners > MAX_WINNERS))
        return `Entre 1 et ${MAX_WINNERS} gagnants.`;
    if (changes.prize !== undefined && !changes.prize.trim())
        return 'Le prix ne peut pas être vide.';
    const o = optionsOf(g);
    const options = normalizeOptions({
        ...o,
        ...(changes.image !== undefined ? { image: changes.image } : {}),
        ...(changes.thumbnail !== undefined ? { thumbnail: changes.thumbnail } : {}),
        ...(changes.color !== undefined ? { color: changes.color } : {}),
        ...(changes.endedColor !== undefined ? { endedColor: changes.endedColor } : {}),
    });
    if (changes.image && !options.image)
        return 'Image invalide : il faut un lien https direct vers une image, ou un fichier image.';
    if (changes.thumbnail && !options.thumbnail)
        return 'Miniature invalide : il faut un lien https direct vers une image, ou un fichier image.';
    ctx.giveaways.update(g.id, {
        prize: changes.prize?.trim().slice(0, 256),
        description: changes.description?.slice(0, 2000),
        winners: changes.winners,
        endsAt: changes.endsAt,
        hostId: changes.hostId,
        options,
    });
    const imagesChanged = options.image !== o.image || options.thumbnail !== o.thumbnail;
    await editGiveawayMessage(ctx, ctx.giveaways.get(g.id), imagesChanged);
    return null;
}
// ───────────────────────────── Tâches automatiques ─────────────────────────────
/** Gagnants qui n'ont pas réclamé à temps : on tire un remplaçant. */
export async function processExpiredClaims(ctx) {
    for (const claim of ctx.giveaways.claims.expired()) {
        ctx.giveaways.claims.setStatus(claim.giveaway_id, claim.user_id, 'expired');
        const g = ctx.giveaways.get(claim.giveaway_id);
        if (!g)
            continue;
        await rerollGiveaway(ctx, g, 1, claim.user_id).catch((err) => log.warn(`Remplacement du gagnant impossible (#${g.id})`, err));
    }
}
/** Rappel « plus que X minutes » avant la fin. */
export async function processReminders(ctx) {
    const now = Date.now();
    for (const g of ctx.giveaways.notReminded()) {
        const minutes = optionsOf(g).reminderMinutes;
        if (!minutes || g.ends_at <= now || g.ends_at - now > minutes * 60_000)
            continue;
        ctx.giveaways.markReminded(g.id);
        const channel = ctx.client.guilds.cache.get(g.guild_id)?.channels.cache.get(g.channel_id);
        if (!channel || !('send' in channel))
            continue;
        await channel
            .send({
            content: `⏰ Plus que **${formatDuration(minutesLeft(g.ends_at))}** pour participer au giveaway **${g.prize}** !`,
            reply: g.message_id ? { messageReference: g.message_id, failIfNotExists: false } : undefined,
        })
            .catch(() => { });
    }
}
export async function processTempRoles(ctx) {
    for (const r of ctx.giveaways.tempRoles.due()) {
        ctx.giveaways.tempRoles.remove(r.guild_id, r.user_id, r.role_id);
        const guild = ctx.client.guilds.cache.get(r.guild_id);
        const member = await guild?.members.fetch(r.user_id).catch(() => null);
        await member?.roles.remove(r.role_id, 'Fin du rôle de gagnant de giveaway').catch(() => { });
    }
}
export async function processChannelDeletes(ctx) {
    for (const g of ctx.giveaways.dueChannelDeletes()) {
        await deleteGiveawayChannel(ctx, g, 'Suppression automatique après le giveaway').catch((err) => log.warn(`Salon du giveaway #${g.id} non supprimé`, err));
    }
}
// ───────────────────────────── Giveaways programmés ─────────────────────────────
function safeJson(text) {
    try {
        const v = JSON.parse(text || '{}');
        return typeof v === 'object' && v !== null ? v : {};
    }
    catch {
        return {};
    }
}
export function scheduleToGiveaway(row) {
    return {
        channelId: row.channel_id || undefined,
        newChannel: row.channel_name ? { name: row.channel_name, categoryId: row.category_id, readOnly: !!row.read_only } : null,
        hostId: row.host_id,
        prize: row.prize,
        description: row.description,
        durationMs: row.duration_ms,
        winners: row.winners,
        // Options partielles (programmé avec /gprogrammer) : les valeurs par défaut du serveur complètent au lancement
        options: safeJson(row.options),
        scheduleId: row.id,
        runNumber: row.runs + 1,
    };
}
const scheduleFailures = new Map();
/** Lance un giveaway programmé. `extra` = lancé à la main en plus, sans décaler la programmation. */
export async function runSchedule(ctx, row, extra = false) {
    const guild = ctx.client.guilds.cache.get(row.guild_id);
    if (!guild)
        throw new Error('Le bot n\'est plus sur ce serveur');
    const g = await startGiveaway(ctx, guild, scheduleToGiveaway(row));
    if (!extra)
        ctx.giveaways.schedules.ran(row.id, nextRunAfter(row.next_run_at, row.repeat_days));
    scheduleFailures.delete(row.id);
    return g;
}
export async function processSchedules(ctx) {
    for (const row of ctx.giveaways.schedules.due()) {
        try {
            const g = await runSchedule(ctx, row);
            log.info(`Giveaway programmé #${row.id} lancé (giveaway #${g.id})`);
        }
        catch (err) {
            const attempts = (scheduleFailures.get(row.id) ?? 0) + 1;
            scheduleFailures.set(row.id, attempts);
            const message = err.message || 'Erreur inconnue';
            log.warn(`Giveaway programmé #${row.id} : échec ${attempts}/3`, err);
            if (attempts < 3)
                ctx.giveaways.schedules.failed(row.id, message, Date.now() + 5 * 60_000);
            else {
                scheduleFailures.delete(row.id);
                // Récurrent : on passe à l'occurrence suivante ; une seule fois : on désactive
                ctx.giveaways.schedules.failed(row.id, message, nextRunAfter(row.next_run_at, row.repeat_days));
            }
        }
    }
}
