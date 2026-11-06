import { ouvrirPanneau } from './brouillon.js';
// Repris d'Orbit (src/modules/giveaways/commands.ts) et adapte a DonutSMP FR.
import { ActionRowBuilder, ApplicationCommandType, ChannelType, ContextMenuCommandBuilder, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { hexToInt } from './outils/couleurs.js';
import { formatDuration, parseDuration } from './outils/format.js';
import { createLogger } from './outils/logger.js';
import { ENTRANTS_PER_PAGE, isValidEmoji, MAX_GIVEAWAY_MS, MAX_WINNERS, parseStartInput } from './rules.js';
import { downloadImage, imagesDir, MAX_IMAGE_BYTES, normalizeImageRef, saveImage } from './outils/images.js';
import { entrantsFile, entrantsView } from './entrants.js';
import { canManageGiveaways, deleteGiveaway, editGiveaway, endGiveaway, entrantRanking, jumpUrl, minutesLeft, rerollGiveaway, startGiveaway } from './service.js';
const log = createLogger('giveaways');
const ephemeral = MessageFlags.Ephemeral;
const REPEAT_CHOICES = [
    { name: 'Une seule fois', value: 0 },
    { name: 'Tous les jours', value: 1 },
    { name: 'Toutes les semaines', value: 7 },
    { name: 'Toutes les 2 semaines', value: 14 },
    { name: 'Tous les 30 jours', value: 30 },
];
export const repeatLabel = (days) => REPEAT_CHOICES.find((c) => c.value === days)?.name ?? `Tous les ${days} jours`;
/** Accepte le numéro du giveaway (#12), l'ID du message ou son lien. */
function resolveGiveaway(ctx, guildId, input) {
    const value = input.trim().replace(/^#/, '');
    const fromMessage = /\/(\d{17,20})$/.exec(value)?.[1] ?? (/^\d{17,20}$/.test(value) ? value : null);
    const g = fromMessage ? ctx.giveaways.byMessage(fromMessage) : /^\d+$/.test(value) ? ctx.giveaways.get(Number(value)) : undefined;
    return g && g.guild_id === guildId ? g : null;
}
async function suggest(interaction, ctx, state) {
    if (!interaction.inCachedGuild())
        return interaction.respond([]);
    const typed = interaction.options.getFocused().toLowerCase().replace('#', '');
    const rows = ctx.giveaways
        .forGuild(interaction.guildId, 50)
        .filter((g) => state === 'all' || (state === 'active' ? !g.ended : !!g.ended))
        .filter((g) => !typed || g.prize.toLowerCase().includes(typed) || String(g.id).startsWith(typed))
        .slice(0, 25);
    await interaction.respond(rows.map((g) => ({
        name: (`#${g.id} · ${g.prize}`.slice(0, 70) + (g.ended ? ' (terminé)' : ` (fin dans ${formatDuration(minutesLeft(g.ends_at))})`)).slice(0, 100),
        value: String(g.id),
    })));
}
const giveawayOption = (o) => o.setName('giveaway').setDescription('Le giveaway (numéro ou ID du message)').setRequired(true).setAutocomplete(true);
/** Vérifie les droits ; répond à la place de la commande si refusé. */
async function guard(interaction, ctx) {
    if (canManageGiveaways(interaction.member, ctx.settings.get(interaction.guildId).giveaways))
        return true;
    await interaction.reply({ content: '🔒 Réservé aux admins du bot et aux rôles gestionnaires des giveaways (/gsettings).', flags: ephemeral });
    return false;
}
/** Options communes à /gstart et /gprogrammer creer. */
function readOptions(interaction) {
    const opts = {};
    const role = (name) => interaction.options.getRole(name)?.id;
    const n = (name) => interaction.options.getInteger(name);
    if (role('role_requis'))
        opts.requiredRoleIds = [role('role_requis')];
    if (role('role_interdit'))
        opts.blockedRoleIds = [role('role_interdit')];
    if (role('ping'))
        opts.pingRoleId = role('ping');
    if (role('role_gagnant'))
        opts.winnerRoleId = role('role_gagnant');
    if (interaction.options.getBoolean('compte_lie'))
        opts.requireLink = true;
    if (n('vouchs_min') !== null)
        opts.minVouches = n('vouchs_min');
    if (n('messages_min') !== null)
        opts.minMessages = n('messages_min');
    if (n('invitations_min') !== null)
        opts.minInvites = n('invitations_min');
    if (n('entrees_par_invite') !== null)
        opts.entriesPerInvite = n('entrees_par_invite');
    if (n('reclamer_heures') !== null)
        opts.claimHours = n('reclamer_heures');
    if (n('rappel_minutes') !== null)
        opts.reminderMinutes = n('rappel_minutes');
    if (interaction.options.getBoolean('drop'))
        opts.drop = true;
    return opts;
}
/** Pièce jointe Discord → copie gardée par le bot (les liens de fichiers Discord expirent). */
async function storeAttachment(ctx, att) {
    if (att.size > MAX_IMAGE_BYTES)
        return { error: 'Image trop lourde (8 Mo maximum).' };
    if (att.contentType && !att.contentType.startsWith('image/'))
        return { error: 'Ce fichier n\'est pas une image.' };
    const dl = await downloadImage(att.url);
    if ('error' in dl)
        return dl;
    const saved = saveImage(imagesDir(ctx.config.databasePath), dl.buf);
    return 'error' in saved ? saved : { ref: `file:${saved.file}` };
}
/** Options image / image_lien / miniature (communes à /gstart, /gprogrammer, /gdrop). */
async function readImages(interaction, ctx) {
    const out = {};
    const file = interaction.options.getAttachment('image');
    const link = interaction.options.getString('image_lien')?.trim();
    const thumb = interaction.options.getAttachment('miniature');
    if (file) {
        const r = await storeAttachment(ctx, file);
        if ('error' in r)
            return r;
        out.image = r.ref;
    }
    else if (link) {
        const ref = normalizeImageRef(link);
        if (!ref)
            return { error: 'Lien d\'image invalide : il faut un lien https direct (qui finit souvent par .png ou .jpg).' };
        out.image = ref;
    }
    if (thumb) {
        const r = await storeAttachment(ctx, thumb);
        if ('error' in r)
            return r;
        out.thumbnail = r.ref;
    }
    return out;
}
/** Salon : nouveau salon à créer, ou salon existant (défaut : celui de la commande). */
function readChannel(interaction, ctx) {
    const name = interaction.options.getString('nouveau_salon')?.trim();
    if (name) {
        const s = ctx.settings.get(interaction.guildId).giveaways;
        return { newChannel: { name, categoryId: interaction.options.getChannel('categorie')?.id ?? s.channelCategoryId, readOnly: true } };
    }
    return { channelId: interaction.options.getChannel('salon')?.id ?? interaction.channelId };
}
/** Ajoute les options facultatives communes (même liste pour /gstart et /gprogrammer creer). */
function withCommonOptions(b) {
    const x = b;
    x.addStringOption((o) => o.setName('description').setDescription('Texte affiché sous le prix').setMaxLength(1000))
        .addStringOption((o) => o.setName('nouveau_salon').setDescription('Créer un salon avec ce nom pour le giveaway (ex : 🎉-{prix})').setMaxLength(100))
        .addChannelOption((o) => o.setName('salon').setDescription('Salon existant (défaut : ici)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addChannelOption((o) => o.setName('categorie').setDescription('Catégorie du salon créé').addChannelTypes(ChannelType.GuildCategory))
        .addRoleOption((o) => o.setName('ping').setDescription('Rôle à mentionner au lancement'))
        .addBooleanOption((o) => o.setName('drop').setDescription('Drop : les premiers à cliquer gagnent tout de suite'))
        .addRoleOption((o) => o.setName('role_requis').setDescription('Rôle obligatoire pour participer'))
        .addRoleOption((o) => o.setName('role_interdit').setDescription('Rôle qui ne peut pas participer'))
        .addBooleanOption((o) => o.setName('compte_lie').setDescription('Réservé aux comptes Minecraft liés'))
        .addIntegerOption((o) => o.setName('vouchs_min').setDescription('Vouchs positifs minimum').setMinValue(1).setMaxValue(10000))
        .addIntegerOption((o) => o.setName('messages_min').setDescription('Messages envoyés minimum').setMinValue(1).setMaxValue(1_000_000))
        .addIntegerOption((o) => o.setName('invitations_min').setDescription('Invitations restées minimum').setMinValue(1).setMaxValue(10_000))
        .addIntegerOption((o) => o.setName('entrees_par_invite').setDescription('Entrées en plus par invitation restée').setMinValue(1).setMaxValue(10))
        .addIntegerOption((o) => o.setName('reclamer_heures').setDescription('Délai pour réclamer le lot, sinon nouveau tirage').setMinValue(1).setMaxValue(168))
        .addRoleOption((o) => o.setName('role_gagnant').setDescription('Rôle donné aux gagnants'))
        .addIntegerOption((o) => o.setName('rappel_minutes').setDescription('Rappel X minutes avant la fin').setMinValue(5).setMaxValue(10_080))
        .addAttachmentOption((o) => o.setName('image').setDescription('Grande image du giveaway (envoie un fichier)'))
        .addStringOption((o) => o.setName('image_lien').setDescription('…ou lien https vers une image').setMaxLength(500))
        .addAttachmentOption((o) => o.setName('miniature').setDescription('Petite image en haut à droite'));
    return b;
}
// ───────────────────────────── /gstart /gdrop /gcreate ─────────────────────────────
const gstart = {
    data: withCommonOptions(new SlashCommandBuilder()
        .setName('gstart')
        .setDescription('Lance un giveaway')
        .addStringOption((o) => o.setName('duree').setDescription('Ex : 30s, 10m, 2h, 3d').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true).setMinValue(1).setMaxValue(MAX_WINNERS))
        .addStringOption((o) => o.setName('prix').setDescription('Ce qu\'on peut gagner').setRequired(true).setMaxLength(256))),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const duration = parseDuration(interaction.options.getString('duree', true));
        if (!duration || duration > MAX_GIVEAWAY_MS) {
            return interaction.reply({ content: 'Durée invalide (max 60 jours). Exemples : `30s`, `10m`, `2h`, `3d`.', flags: ephemeral });
        }
        await interaction.deferReply({ flags: ephemeral });
        const images = await readImages(interaction, ctx);
        if ('error' in images)
            return interaction.editReply(`❌ ${images.error}`);
        try {
            const g = await startGiveaway(ctx, interaction.guild, {
                ...readChannel(interaction, ctx),
                hostId: interaction.user.id,
                prize: interaction.options.getString('prix', true),
                description: interaction.options.getString('description') ?? '',
                durationMs: duration,
                winners: interaction.options.getInteger('gagnants', true),
                options: { ...readOptions(interaction), ...images },
            });
            return interaction.editReply(`🎉 Giveaway #${g.id} lancé dans <#${g.channel_id}> !`);
        }
        catch (err) {
            log.warn('Lancement de giveaway impossible', err);
            return interaction.editReply('❌ Impossible de publier le giveaway : vérifie que je peux créer des salons, écrire et intégrer des liens.');
        }
    },
};
const gdrop = {
    data: new SlashCommandBuilder()
        .setName('gdrop')
        .setDescription('Lance un drop : les premiers à cliquer gagnent tout de suite')
        .addStringOption((o) => o.setName('prix').setDescription('Ce qu\'on peut gagner').setRequired(true).setMaxLength(256))
        .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants (défaut 1)').setMinValue(1).setMaxValue(MAX_WINNERS))
        .addStringOption((o) => o.setName('duree').setDescription('Temps avant que le drop expire (défaut 1h)').setMaxLength(20))
        .addChannelOption((o) => o.setName('salon').setDescription('Salon (défaut : ici)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('ping').setDescription('Rôle à mentionner'))
        .addAttachmentOption((o) => o.setName('image').setDescription('Grande image (envoie un fichier)'))
        .addStringOption((o) => o.setName('image_lien').setDescription('…ou lien https vers une image').setMaxLength(500))
        .addAttachmentOption((o) => o.setName('miniature').setDescription('Petite image en haut à droite')),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const raw = interaction.options.getString('duree');
        const duration = raw ? parseDuration(raw) : 3_600_000;
        if (!duration || duration > MAX_GIVEAWAY_MS)
            return interaction.reply({ content: 'Durée invalide. Exemples : `10m`, `1h`.', flags: ephemeral });
        await interaction.deferReply({ flags: ephemeral });
        const images = await readImages(interaction, ctx);
        if ('error' in images)
            return interaction.editReply(`❌ ${images.error}`);
        try {
            const ping = interaction.options.getRole('ping')?.id;
            const g = await startGiveaway(ctx, interaction.guild, {
                channelId: interaction.options.getChannel('salon')?.id ?? interaction.channelId,
                hostId: interaction.user.id,
                prize: interaction.options.getString('prix', true),
                durationMs: duration,
                winners: interaction.options.getInteger('gagnants') ?? 1,
                options: { drop: true, ...(ping ? { pingRoleId: ping } : {}), ...images },
            });
            return interaction.editReply(`⚡ Drop #${g.id} lancé !`);
        }
        catch (err) {
            log.warn('Lancement de drop impossible', err);
            return interaction.editReply('❌ Impossible de publier le drop dans ce salon.');
        }
    },
};
const gcreate = {
    data: new SlashCommandBuilder().setName('gcreate').setDescription('Crée un giveaway depuis un panneau (lot, rôles requis, rôles bonus)'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        // Panneau de creation, dans le style des panneaux de config du bot (brouillon.js).
        return ouvrirPanneau(interaction, ctx);
    },
};
// ───────────────────────────── /gparticipants (modérateurs) ─────────────────────────────
const gparticipants = {
    data: new SlashCommandBuilder()
        .setName('gparticipants')
        .setDescription('Modérateurs : tous les participants classés par nombre d\'entrées')
        .addStringOption(giveawayOption),
    autocomplete: (i, ctx) => suggest(i, ctx, 'all'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const g = resolveGiveaway(ctx, interaction.guildId, interaction.options.getString('giveaway', true));
        if (!g)
            return interaction.reply({ content: 'Giveaway introuvable.', flags: ephemeral });
        await interaction.deferReply({ flags: ephemeral });
        const ranked = await entrantRanking(ctx, interaction.guild, g);
        const view = entrantsView(g, ranked, 0, ctx.settings.get(interaction.guildId).giveaways.color);
        const files = ranked.length > ENTRANTS_PER_PAGE ? [entrantsFile(g, ranked)] : [];
        return interaction.editReply({ ...view, files, allowedMentions: { parse: [] } });
    },
};
// ───────────────────────────── /gend /greroll /gdelete /glist ─────────────────────────────
const gend = {
    data: new SlashCommandBuilder().setName('gend').setDescription('Termine un giveaway maintenant et tire les gagnants').addStringOption(giveawayOption),
    autocomplete: (i, ctx) => suggest(i, ctx, 'active'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const g = resolveGiveaway(ctx, interaction.guildId, interaction.options.getString('giveaway', true));
        if (!g)
            return interaction.reply({ content: 'Giveaway introuvable.', flags: ephemeral });
        if (g.ended)
            return interaction.reply({ content: 'Ce giveaway est déjà terminé. Utilise /greroll pour tirer un nouveau gagnant.', flags: ephemeral });
        await interaction.deferReply({ flags: ephemeral });
        const winners = await endGiveaway(ctx, g);
        return interaction.editReply(winners.length ? `✅ Giveaway terminé : ${winners.length} gagnant(s).` : 'Giveaway terminé : aucun participant éligible.');
    },
};
const greroll = {
    data: new SlashCommandBuilder()
        .setName('greroll')
        .setDescription('Tire un nouveau gagnant pour un giveaway terminé')
        .addStringOption(giveawayOption)
        .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre de nouveaux gagnants (défaut 1)').setMinValue(1).setMaxValue(MAX_WINNERS)),
    autocomplete: (i, ctx) => suggest(i, ctx, 'ended'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const g = resolveGiveaway(ctx, interaction.guildId, interaction.options.getString('giveaway', true));
        if (!g)
            return interaction.reply({ content: 'Giveaway introuvable.', flags: ephemeral });
        if (!g.ended)
            return interaction.reply({ content: 'Ce giveaway n\'est pas terminé. Utilise /gend pour le terminer.', flags: ephemeral });
        await interaction.deferReply({ flags: ephemeral });
        const winners = await rerollGiveaway(ctx, g, interaction.options.getInteger('nombre') ?? 1);
        return interaction.editReply(winners.length ? `🔁 Nouveau tirage : ${winners.map((id) => `<@${id}>`).join(', ')}` : 'Plus personne d\'éligible à tirer au sort.');
    },
};
const gdelete = {
    data: new SlashCommandBuilder().setName('gdelete').setDescription('Supprime un giveaway sans tirer de gagnant').addStringOption(giveawayOption),
    autocomplete: (i, ctx) => suggest(i, ctx, 'all'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const g = resolveGiveaway(ctx, interaction.guildId, interaction.options.getString('giveaway', true));
        if (!g)
            return interaction.reply({ content: 'Giveaway introuvable.', flags: ephemeral });
        await deleteGiveaway(ctx, g);
        return interaction.reply({ content: `🗑️ Giveaway #${g.id} (${g.prize}) supprimé.`, flags: ephemeral });
    },
};
const glist = {
    data: new SlashCommandBuilder().setName('glist').setDescription('Les giveaways en cours et programmés sur ce serveur'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild())
            return;
        const s = ctx.settings.get(interaction.guildId).giveaways;
        const rows = ctx.giveaways.active(interaction.guildId);
        const lines = rows.slice(0, 15).map((g) => {
            const url = jumpUrl(g);
            return `\`#${g.id}\` ${url ? `[${g.prize}](${url})` : g.prize} · ${g.winners} gagnant(s) · ${ctx.giveaways.entryCount(g.id)} participant(s) · fin <t:${Math.floor(g.ends_at / 1000)}:R>`;
        });
        const planned = ctx.giveaways.schedules.active(interaction.guildId).slice(0, 10);
        const embed = new EmbedBuilder()
            .setColor(hexToInt(s.color))
            .setTitle('Giveaways')
            .setDescription(lines.join('\n') || 'Aucun giveaway en cours. Lance-en un avec /gstart ou /gcreate.');
        if (planned.length) {
            embed.addFields({
                name: 'Programmés',
                value: planned
                    .map((p) => `\`P${p.id}\` **${p.prize}** · <t:${Math.floor(p.next_run_at / 1000)}:f>${p.repeat_days ? ` · ${repeatLabel(p.repeat_days).toLowerCase()}` : ''}`)
                    .join('\n')
                    .slice(0, 1024),
            });
        }
        return interaction.reply({ embeds: [embed], flags: ephemeral });
    },
};
// ───────────────────────────── /gprogrammer ─────────────────────────────
const gprogrammer = {
    data: new SlashCommandBuilder()
        .setName('gprogrammer')
        .setDescription('Giveaways programmés (une fois ou récurrents)')
        .addSubcommand((s) => withCommonOptions(s
        .setName('creer')
        .setDescription('Programme un giveaway (le bot peut créer un salon rien que pour lui)')
        .addStringOption((o) => o.setName('debut').setDescription('Quand le lancer : « dans 2h », « 18h30 », « 25/10 20h »').setRequired(true).setMaxLength(30))
        .addStringOption((o) => o.setName('duree').setDescription('Durée du giveaway, ex : 1d').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true).setMinValue(1).setMaxValue(MAX_WINNERS))
        .addStringOption((o) => o.setName('prix').setDescription('Ce qu\'on peut gagner').setRequired(true).setMaxLength(256))
        .addIntegerOption((o) => o.setName('repeter').setDescription('Relancer automatiquement').addChoices(...REPEAT_CHOICES))))
        .addSubcommand((s) => s.setName('liste').setDescription('Les giveaways programmés'))
        .addSubcommand((s) => s
        .setName('annuler')
        .setDescription('Annule un giveaway programmé')
        .addStringOption((o) => o.setName('programme').setDescription('Le giveaway programmé').setRequired(true).setAutocomplete(true))),
    async autocomplete(interaction, ctx) {
        if (!interaction.inCachedGuild())
            return interaction.respond([]);
        const typed = interaction.options.getFocused().toLowerCase();
        const rows = ctx.giveaways.schedules
            .active(interaction.guildId)
            .filter((p) => !typed || p.prize.toLowerCase().includes(typed))
            .slice(0, 25);
        return interaction.respond(rows.map((p) => ({ name: `P${p.id} · ${p.prize}`.slice(0, 100), value: String(p.id) })));
    },
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const sub = interaction.options.getSubcommand();
        if (sub === 'liste') {
            const rows = ctx.giveaways.schedules.active(interaction.guildId);
            const lines = rows.slice(0, 20).map((p) => {
                const where = p.channel_name ? `nouveau salon « ${p.channel_name} »` : `<#${p.channel_id}>`;
                return `\`P${p.id}\` **${p.prize}** · <t:${Math.floor(p.next_run_at / 1000)}:f> (<t:${Math.floor(p.next_run_at / 1000)}:R>) · ${where}${p.repeat_days ? ` · ${repeatLabel(p.repeat_days).toLowerCase()}` : ''}${p.last_error ? ' · ⚠️ dernier essai raté' : ''}`;
            });
            return interaction.reply({
                embeds: [new EmbedBuilder().setColor(hexToInt(ctx.settings.get(interaction.guildId).giveaways.color)).setTitle('Giveaways programmés').setDescription(lines.join('\n') || 'Aucun giveaway programmé.')],
                flags: ephemeral,
            });
        }
        if (sub === 'annuler') {
            const id = Number(interaction.options.getString('programme', true).replace(/^p/i, ''));
            const row = ctx.giveaways.schedules.get(id);
            if (!row || row.guild_id !== interaction.guildId || !row.active)
                return interaction.reply({ content: 'Giveaway programmé introuvable.', flags: ephemeral });
            ctx.giveaways.schedules.cancel(id);
            return interaction.reply({ content: `🗑️ Giveaway programmé « ${row.prize} » annulé.`, flags: ephemeral });
        }
        const startAt = parseStartInput(interaction.options.getString('debut', true), Date.now(), parseDuration);
        if (!startAt || startAt < Date.now() - 60_000) {
            return interaction.reply({ content: 'Date de début invalide. Exemples : `dans 2h`, `18h30`, `25/10 20h`, `25/10/2026 20:00`.', flags: ephemeral });
        }
        if (startAt > Date.now() + 365 * 86_400_000)
            return interaction.reply({ content: 'Un an à l\'avance maximum.', flags: ephemeral });
        const duration = parseDuration(interaction.options.getString('duree', true));
        if (!duration || duration > MAX_GIVEAWAY_MS)
            return interaction.reply({ content: 'Durée invalide (max 60 jours).', flags: ephemeral });
        const where = readChannel(interaction, ctx);
        const images = await readImages(interaction, ctx);
        if ('error' in images)
            return interaction.reply({ content: `❌ ${images.error}`, flags: ephemeral });
        const row = ctx.giveaways.schedules.create({
            guildId: interaction.guildId,
            hostId: interaction.user.id,
            prize: interaction.options.getString('prix', true),
            description: interaction.options.getString('description') ?? '',
            winners: interaction.options.getInteger('gagnants', true),
            durationMs: duration,
            options: { ...readOptions(interaction), ...images },
            startAt,
            repeatDays: interaction.options.getInteger('repeter') ?? 0,
            channelId: where.channelId ?? '',
            channelName: where.newChannel?.name ?? '',
            categoryId: where.newChannel?.categoryId ?? '',
            readOnly: true,
        });
        const ts = Math.floor(startAt / 1000);
        const place = row.channel_name ? `dans un nouveau salon « ${row.channel_name} »` : `dans <#${row.channel_id}>`;
        return interaction.reply({
            content: `📅 Giveaway **${row.prize}** programmé pour <t:${ts}:f> (<t:${ts}:R>) ${place}${row.repeat_days ? `, ${repeatLabel(row.repeat_days).toLowerCase()}` : ''}.`,
            flags: ephemeral,
        });
    },
};
// ───────────────────────────── /gedit (comme g.edit de Giveaway Boat) ─────────────────────────────
const gedit = {
    data: new SlashCommandBuilder()
        .setName('gedit')
        .setDescription('Modifie un giveaway (image, prix, durée…)')
        .addSubcommand((s) => s
        .setName('image')
        .setDescription('Change la grande image')
        .addStringOption(giveawayOption)
        .addAttachmentOption((o) => o.setName('fichier').setDescription('Nouvelle image'))
        .addStringOption((o) => o.setName('lien').setDescription('…ou lien https vers une image').setMaxLength(500))
        .addBooleanOption((o) => o.setName('retirer').setDescription('Enlever l\'image')))
        .addSubcommand((s) => s
        .setName('miniature')
        .setDescription('Change la petite image en haut à droite')
        .addStringOption(giveawayOption)
        .addAttachmentOption((o) => o.setName('fichier').setDescription('Nouvelle miniature'))
        .addStringOption((o) => o.setName('lien').setDescription('…ou lien https vers une image').setMaxLength(500))
        .addBooleanOption((o) => o.setName('retirer').setDescription('Enlever la miniature')))
        .addSubcommand((s) => s.setName('prix').setDescription('Change le prix').addStringOption(giveawayOption).addStringOption((o) => o.setName('texte').setDescription('Nouveau prix').setRequired(true).setMaxLength(256)))
        .addSubcommand((s) => s
        .setName('description')
        .setDescription('Change la description')
        .addStringOption(giveawayOption)
        .addStringOption((o) => o.setName('texte').setDescription('Nouvelle description (vide = l\'enlever)').setMaxLength(1000)))
        .addSubcommand((s) => s
        .setName('gagnants')
        .setDescription('Change le nombre de gagnants')
        .addStringOption(giveawayOption)
        .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre de gagnants').setRequired(true).setMinValue(1).setMaxValue(MAX_WINNERS)))
        .addSubcommand((s) => s
        .setName('duree')
        .setDescription('Change la fin : le giveaway finira dans ce temps')
        .addStringOption(giveawayOption)
        .addStringOption((o) => o.setName('fin_dans').setDescription('Ex : 2h, 3d, 1w').setRequired(true).setMaxLength(20)))
        .addSubcommand((s) => s.setName('hote').setDescription('Change l\'organisateur').addStringOption(giveawayOption).addUserOption((o) => o.setName('membre').setDescription('Nouvel organisateur').setRequired(true)))
        .addSubcommand((s) => s
        .setName('couleur')
        .setDescription('Couleur de ce giveaway')
        .addStringOption(giveawayOption)
        .addStringOption((o) => o.setName('hex').setDescription('Ex : #12fa8e (vide = couleur du serveur)').setMaxLength(7))
        .addStringOption((o) => o.setName('hex_fin').setDescription('Couleur une fois terminé').setMaxLength(7))),
    autocomplete: (i, ctx) => suggest(i, ctx, 'all'),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const g = resolveGiveaway(ctx, interaction.guildId, interaction.options.getString('giveaway', true));
        if (!g)
            return interaction.reply({ content: 'Giveaway introuvable.', flags: ephemeral });
        const sub = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: ephemeral });
        const changes = {};
        if (sub === 'image' || sub === 'miniature') {
            const key = sub === 'image' ? 'image' : 'thumbnail';
            const file = interaction.options.getAttachment('fichier');
            const link = interaction.options.getString('lien')?.trim();
            if (interaction.options.getBoolean('retirer'))
                changes[key] = '';
            else if (file) {
                const r = await storeAttachment(ctx, file);
                if ('error' in r)
                    return interaction.editReply(`❌ ${r.error}`);
                changes[key] = r.ref;
            }
            else if (link)
                changes[key] = link;
            else
                return interaction.editReply('Envoie un fichier, un lien, ou coche « retirer ».');
        }
        if (sub === 'prix')
            changes.prize = interaction.options.getString('texte', true);
        if (sub === 'description')
            changes.description = interaction.options.getString('texte') ?? '';
        if (sub === 'gagnants')
            changes.winners = interaction.options.getInteger('nombre', true);
        if (sub === 'hote')
            changes.hostId = interaction.options.getUser('membre', true).id;
        if (sub === 'duree') {
            const ms = parseDuration(interaction.options.getString('fin_dans', true));
            if (!ms)
                return interaction.editReply('Durée invalide. Exemples : `2h`, `3d`, `1w`.');
            changes.endsAt = Date.now() + ms;
        }
        if (sub === 'couleur') {
            const hex = (name) => {
                const raw = interaction.options.getString(name)?.trim();
                if (raw === undefined)
                    return undefined;
                const v = raw.startsWith('#') ? raw : `#${raw}`;
                return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
            };
            const color = hex('hex');
            const ended = hex('hex_fin');
            if (color === null || ended === null)
                return interaction.editReply('Couleur invalide. Exemple : `#12fa8e`.');
            changes.color = color ?? '';
            if (ended !== undefined)
                changes.endedColor = ended;
        }
        const error = await editGiveaway(ctx, g, changes);
        if (error)
            return interaction.editReply(`❌ ${error}`);
        const url = jumpUrl(g);
        return interaction.editReply(`✅ Giveaway #${g.id} modifié.${url ? ` [Voir le giveaway](${url})` : ''}`);
    },
};
// ───────────────────────────── /gblacklist /gsettings ─────────────────────────────
const gblacklist = {
    data: new SlashCommandBuilder()
        .setName('gblacklist')
        .setDescription('Membres exclus de tous les giveaways')
        .addSubcommand((s) => s.setName('ajouter').setDescription('Exclut un membre').addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)))
        .addSubcommand((s) => s.setName('retirer').setDescription('Réautorise un membre').addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)))
        .addSubcommand((s) => s.setName('liste').setDescription('Membres exclus')),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild() || !(await guard(interaction, ctx)))
            return;
        const s = ctx.settings.get(interaction.guildId).giveaways;
        const sub = interaction.options.getSubcommand();
        if (sub === 'liste') {
            return interaction.reply({
                content: s.blacklistUserIds.length ? `Exclus des giveaways : ${s.blacklistUserIds.map((id) => `<@${id}>`).join(', ')}` : 'Personne n\'est exclu des giveaways.',
                flags: ephemeral,
                allowedMentions: { parse: [] },
            });
        }
        const user = interaction.options.getUser('membre', true);
        const list = new Set(s.blacklistUserIds);
        if (sub === 'ajouter')
            list.add(user.id);
        else
            list.delete(user.id);
        ctx.settings.update(interaction.guildId, { giveaways: { blacklistUserIds: [...list].slice(0, 500) } });
        return interaction.reply({
            content: sub === 'ajouter' ? `⛔ ${user} ne peut plus participer aux giveaways.` : `✅ ${user} peut de nouveau participer aux giveaways.`,
            flags: ephemeral,
            allowedMentions: { parse: [] },
        });
    },
};
const gsettings = {
    data: new SlashCommandBuilder()
        .setName('gsettings')
        .setDescription('Réglages des giveaways du serveur')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('voir').setDescription('Affiche les réglages'))
        .addSubcommand((s) => s.setName('couleur').setDescription('Couleur des giveaways en cours').addStringOption((o) => o.setName('hex').setDescription('Ex : #ff5e8a').setRequired(true).setMaxLength(7)))
        .addSubcommand((s) => s.setName('couleur_fin').setDescription('Couleur des giveaways terminés').addStringOption((o) => o.setName('hex').setDescription('Ex : #2b2d31').setRequired(true).setMaxLength(7)))
        .addSubcommand((s) => s.setName('emoji').setDescription('Emoji du bouton de participation').addStringOption((o) => o.setName('emoji').setDescription('Un emoji, ex : 🎁').setRequired(true).setMaxLength(64)))
        .addSubcommand((s) => s.setName('texte_bouton').setDescription('Texte à côté de l\'emoji (vide = emoji seul)').addStringOption((o) => o.setName('texte').setDescription('Ex : Participer').setMaxLength(80))),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild())
            return;
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const hex = () => {
            const raw = interaction.options.getString('hex', true).trim();
            const v = raw.startsWith('#') ? raw : `#${raw}`;
            return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
        };
        if (sub === 'couleur' || sub === 'couleur_fin') {
            const color = hex();
            if (!color)
                return interaction.reply({ content: 'Couleur invalide. Exemple : `#ff5e8a`.', flags: ephemeral });
            ctx.settings.update(guildId, { giveaways: sub === 'couleur' ? { color } : { endedColor: color } });
        }
        else if (sub === 'emoji') {
            const emoji = interaction.options.getString('emoji', true).trim();
            if (!isValidEmoji(emoji))
                return interaction.reply({ content: 'Emoji invalide. Mets un seul emoji, ou un emoji personnalisé de ce serveur.', flags: ephemeral });
            ctx.settings.update(guildId, { giveaways: { emoji } });
        }
        else if (sub === 'texte_bouton') {
            ctx.settings.update(guildId, { giveaways: { buttonLabel: interaction.options.getString('texte')?.trim() ?? '' } });
        }
        const s = ctx.settings.get(guildId).giveaways;
        const embed = new EmbedBuilder()
            .setColor(hexToInt(s.color))
            .setTitle(sub === 'voir' ? 'Réglages des giveaways' : '✅ Réglage enregistré')
            .addFields({ name: 'Couleur', value: s.color, inline: true }, { name: 'Couleur terminé', value: s.endedColor, inline: true }, { name: 'Bouton', value: `${s.emoji} ${s.buttonLabel}`.trim(), inline: true }, { name: 'Rôles gestionnaires', value: s.managerRoleIds.map((id) => `<@&${id}>`).join(', ') || 'Aucun (Gérer le serveur requis)' }, { name: 'Entrées par invitation', value: s.entriesPerInvite ? `+${s.entriesPerInvite} (max +${s.maxInviteEntries})` : 'Désactivé', inline: true }, { name: 'MP aux gagnants', value: s.dmWinners ? 'Oui' : 'Non', inline: true }, { name: 'Liste noire', value: `${s.blacklistUserIds.length} membre(s)`, inline: true })
            .setFooter({ text: 'Tout le reste se règle dans le dashboard, page Réglages > Giveaways' });
        return interaction.reply({ embeds: [embed], flags: ephemeral });
    },
};
const rerollMenu = {
    data: new ContextMenuCommandBuilder().setName('Relancer le giveaway').setType(ApplicationCommandType.Message),
    async execute(interaction, ctx) {
        if (!interaction.inCachedGuild())
            return;
        if (!canManageGiveaways(interaction.member, ctx.settings.get(interaction.guildId).giveaways)) {
            return interaction.reply({ content: 'Il faut la permission « Gérer le serveur » ou un rôle de gestion des giveaways.', flags: ephemeral });
        }
        const g = ctx.giveaways.byMessage(interaction.targetId);
        if (!g || g.guild_id !== interaction.guildId)
            return interaction.reply({ content: 'Ce message n\'est pas un giveaway.', flags: ephemeral });
        if (!g.ended)
            return interaction.reply({ content: 'Ce giveaway n\'est pas encore terminé.', flags: ephemeral });
        await interaction.deferReply({ flags: ephemeral });
        const winners = await rerollGiveaway(ctx, g, 1);
        return interaction.editReply(winners.length ? `🔁 Nouveau gagnant : <@${winners[0]}>` : 'Plus personne d\'éligible à tirer au sort.');
    },
};
export const giveawayCommands = [gstart, gcreate, gdrop, gedit, gparticipants, gend, greroll, gdelete, glist, gprogrammer, gblacklist, gsettings];
export const giveawayMenus = [rerollMenu];
