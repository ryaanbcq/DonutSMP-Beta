// Repris d'Orbit (src/modules/giveaways/rules.ts), adapte a DonutSMP FR :
// conditions « compte lié » et « vouchs minimum » a la place du niveau.
/**
 * Règles des giveaways, sans Discord : conditions de participation, entrées bonus
 * et tirage pondéré. Tout est pur, donc facile à tester et à modifier.
 */
import { normalizeImageRef } from './outils/images.js';
export const DAY_MS = 86_400_000;
export const MAX_GIVEAWAY_MS = 60 * DAY_MS;
export const MAX_WINNERS = 50;
export const MAX_BONUS_ENTRIES = 10;
const CUSTOM_EMOJI_RE = /^<a?:\w{2,32}:\d{17,20}>$/;
const UNICODE_EMOJI_RE = /^\p{Extended_Pictographic}/u;
/** Un seul emoji Unicode, ou un emoji personnalisé (<:nom:id>). */
export function isValidEmoji(value) {
    const v = value.trim();
    return CUSTOM_EMOJI_RE.test(v) || (UNICODE_EMOJI_RE.test(v) && [...v].length <= 8);
}
export function defaultOptions() {
    return {
        requiredRoleIds: [],
        blockedRoleIds: [],
        minLevel: 0,
        minMessages: 0,
        minAccountDays: 0,
        minMemberDays: 0,
        minInvites: 0,
        requireLink: false,
        minVouches: 0,
        bonusEntries: [],
        entriesPerInvite: 0,
        maxInviteEntries: 0,
        levelStep: 0,
        maxLevelEntries: 0,
        vouchStep: 0,
        maxVouchEntries: 0,
        pingRoleId: '',
        drop: false,
        claimHours: 0,
        reminderMinutes: 0,
        winnerRoleId: '',
        winnerRoleDays: 0,
        deleteChannelAfterHours: 0,
        image: '',
        thumbnail: '',
        color: '',
        endedColor: '',
    };
}
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '');
const snowflake = (v) => (typeof v === 'string' && /^\d{17,20}$/.test(v) ? v : '');
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && /^\d{17,20}$/.test(x)))] : []);
const int = (v, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
/** Options d'un giveaway enregistré (y compris ceux créés avant la mise à jour). */
export function optionsOf(g) {
    let raw = {};
    try {
        raw = JSON.parse(g.options || '{}');
    }
    catch {
        /* options illisibles : valeurs par défaut */
    }
    // Giveaways créés avant la mise à jour : on reprend les anciennes colonnes
    if (raw.minLevel === undefined && g.min_level)
        raw.minLevel = g.min_level;
    if (raw.requiredRoleIds === undefined && g.required_role)
        raw.requiredRoleIds = [g.required_role];
    return normalizeOptions(raw);
}
/** Nettoie des options venant de la base ou d'un formulaire (valeurs bornées, IDs valides). */
export function normalizeOptions(raw) {
    const o = (typeof raw === 'object' && raw !== null ? raw : {});
    const bonus = Array.isArray(o.bonusEntries) ? o.bonusEntries : [];
    const seen = new Set();
    return {
        requiredRoleIds: ids(o.requiredRoleIds),
        blockedRoleIds: ids(o.blockedRoleIds),
        minLevel: int(o.minLevel, 0, 1000),
        minMessages: int(o.minMessages, 0, 1_000_000),
        minAccountDays: int(o.minAccountDays, 0, 3650),
        minMemberDays: int(o.minMemberDays, 0, 3650),
        bonusEntries: bonus
            .map((b) => b)
            .filter((b) => typeof b.roleId === 'string' && /^\d{17,20}$/.test(b.roleId) && !seen.has(b.roleId) && seen.add(b.roleId))
            .map((b) => ({ roleId: b.roleId, entries: int(b.entries, 2, MAX_BONUS_ENTRIES) }))
            .slice(0, 10),
        entriesPerInvite: int(o.entriesPerInvite, 0, MAX_BONUS_ENTRIES),
        maxInviteEntries: int(o.maxInviteEntries, 0, 100),
        levelStep: int(o.levelStep, 0, 1000),
        maxLevelEntries: int(o.maxLevelEntries, 0, 100),
        minInvites: int(o.minInvites, 0, 10_000),
        requireLink: o.requireLink === true,
        minVouches: int(o.minVouches, 0, 10_000),
        vouchStep: int(o.vouchStep, 0, 1000),
        maxVouchEntries: int(o.maxVouchEntries, 0, 100),
        pingRoleId: snowflake(o.pingRoleId),
        drop: o.drop === true,
        claimHours: int(o.claimHours, 0, 168),
        reminderMinutes: int(o.reminderMinutes, 0, 10_080),
        winnerRoleId: snowflake(o.winnerRoleId),
        winnerRoleDays: int(o.winnerRoleDays, 0, 365),
        deleteChannelAfterHours: int(o.deleteChannelAfterHours, 0, 720),
        image: normalizeImageRef(o.image),
        thumbnail: normalizeImageRef(o.thumbnail),
        color: hex(o.color),
        endedColor: hex(o.endedColor),
    };
}
/** Retourne la raison du refus, ou null si la personne peut participer. */
export function checkRules(rules, m, now = Date.now()) {
    if (m.blacklisted)
        return 'Tu ne peux pas participer aux giveaways de ce serveur.';
    const blocked = rules.blockedRoleIds.find((id) => m.roleIds.has(id));
    if (blocked)
        return `Les membres avec le rôle <@&${blocked}> ne peuvent pas participer.`;
    if (rules.requiredRoleIds.length && !rules.requiredRoleIds.some((id) => m.roleIds.has(id))) {
        const list = rules.requiredRoleIds.map((id) => `<@&${id}>`).join(' ou ');
        return `Il faut le rôle ${list} pour participer.`;
    }
    if (rules.requireLink && !m.linked)
        return 'Il faut avoir lié ton compte Minecraft (panneau « Se connecter ») pour participer.';
    if (rules.minVouches > 0 && (m.vouches ?? 0) < rules.minVouches)
        return `Il faut au moins ${rules.minVouches} vouch(s) positif(s) (tu en as ${m.vouches ?? 0}).`;
    if (rules.minMessages > 0 && m.messages < rules.minMessages) {
        return `Il faut avoir envoyé ${rules.minMessages} messages sur le serveur (tu en as ${m.messages}).`;
    }
    if (rules.minAccountDays > 0 && now - m.accountCreatedAt < rules.minAccountDays * DAY_MS) {
        return `Ton compte Discord doit avoir au moins ${rules.minAccountDays} jour(s).`;
    }
    if (rules.minMemberDays > 0 && (m.joinedAt === null || now - m.joinedAt < rules.minMemberDays * DAY_MS)) {
        return `Il faut être sur le serveur depuis au moins ${rules.minMemberDays} jour(s).`;
    }
    if (rules.minInvites > 0 && (m.invites ?? 0) < rules.minInvites) {
        return `Il faut avoir invité ${rules.minInvites} personne(s) restée(s) sur le serveur (tu en as ${m.invites ?? 0}).`;
    }
    return null;
}
/** Nombre de tickets d'un membre : le meilleur bonus de ses rôles, sinon 1. */
export function entryWeight(bonus, roleIds) {
    let best = 1;
    for (const b of bonus)
        if (roleIds.has(b.roleId) && b.entries > best)
            best = b.entries;
    return best;
}
/**
 * Nombre de tickets d'un membre = tickets du meilleur rôle bonus (1 sans rôle)
 * + bonus d'invitations restées + bonus de niveau, chacun dans sa limite.
 */
export function ticketCount(o, m) {
    const roles = entryWeight(o.bonusEntries, m.roleIds);
    const invites = o.entriesPerInvite > 0 ? Math.min(o.maxInviteEntries || Infinity, (m.invites ?? 0) * o.entriesPerInvite) : 0;
    const vouches = o.vouchStep > 0 ? Math.min(o.maxVouchEntries || Infinity, Math.floor((m.vouches ?? 0) / o.vouchStep)) : 0;
    return { total: roles + invites + vouches, roles, invites, vouches, levels: 0 };
}
/**
 * Tire `count` gagnants différents. Chaque personne a autant de chances que de tickets
 * (`weight`). Sans remise : une personne ne peut gagner qu'une fois.
 */
export function drawWinners(pool, count, random = Math.random) {
    const remaining = pool.filter((p) => p.weight > 0).map((p) => ({ ...p }));
    const winners = [];
    while (winners.length < count && remaining.length) {
        const total = remaining.reduce((sum, p) => sum + p.weight, 0);
        let r = random() * total;
        let index = remaining.length - 1;
        for (let i = 0; i < remaining.length; i++) {
            r -= remaining[i].weight;
            if (r < 0) {
                index = i;
                break;
            }
        }
        winners.push(remaining[index].id);
        remaining.splice(index, 1);
    }
    return winners;
}
/** Lignes « Conditions » affichées sous le giveaway. */
export function describeRules(o) {
    const lines = [];
    if (o.requiredRoleIds.length)
        lines.push(`Rôle requis : ${o.requiredRoleIds.map((id) => `<@&${id}>`).join(' ou ')}`);
    if (o.blockedRoleIds.length)
        lines.push(`Rôle exclu : ${o.blockedRoleIds.map((id) => `<@&${id}>`).join(', ')}`);
    if (o.requireLink)
        lines.push('Compte Minecraft lié');
    if (o.minVouches)
        lines.push(`${o.minVouches} vouch(s) positif(s) minimum`);
    if (o.minMessages)
        lines.push(`${o.minMessages} messages minimum`);
    if (o.minMemberDays)
        lines.push(`Sur le serveur depuis ${o.minMemberDays} jour(s)`);
    if (o.minAccountDays)
        lines.push(`Compte Discord de plus de ${o.minAccountDays} jour(s)`);
    if (o.minInvites)
        lines.push(`${o.minInvites} invitation(s) restée(s) sur le serveur`);
    return lines;
}
/** Lignes « Entrées bonus » affichées sous le giveaway. */
export function describeBonus(o) {
    const lines = o.bonusEntries.map((b) => `<@&${b.roleId}> : ${b.entries} entrées`);
    if (o.entriesPerInvite) {
        lines.push(`+${o.entriesPerInvite} par invitation restée sur le serveur${o.maxInviteEntries ? ` (max +${o.maxInviteEntries})` : ''}`);
    }
    if (o.vouchStep)
        lines.push(`+1 tous les ${o.vouchStep} vouchs${o.maxVouchEntries ? ` (max +${o.maxVouchEntries})` : ''}`);
    return lines;
}
// ───────────────────────────── Programmation ─────────────────────────────
/**
 * Comprend une date de début écrite à la main, dans le fuseau du bot (TIMEZONE) :
 * « 2h », « dans 30m », « 18:00 » (aujourd'hui, ou demain si l'heure est passée),
 * « 25/10 18:00 », « 25/10/2026 18h30 ». Retourne un timestamp, ou null.
 */
export function parseStartInput(input, now = Date.now(), parseRelative) {
    const raw = input.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!raw)
        return null;
    // « dans 2h », « dans 3j » : relatif
    if (raw.startsWith('dans ')) {
        const rel = parseRelative(raw.slice(5).replace(/\s/g, ''));
        return rel ? now + rel : null;
    }
    const date = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:à\s*)?(.*))?$/.exec(raw);
    const clockText = date ? (date[4] ?? '').trim() : raw;
    // Heure : « 18h », « 18h30 », « 18:30 » (en français, « 18h » veut dire 18:00)
    const clock = /^(\d{1,2})\s*(?:h|:)\s*(\d{2})?$/.exec(clockText);
    if (!date && !clock) {
        // « 30m », « 3d », « 1j12h » sans « dans » : relatif aussi
        const rel = parseRelative(raw.replace(/\s/g, ''));
        return rel ? now + rel : null;
    }
    if (date && clockText && !clock)
        return null;
    const hours = clock ? Number(clock[1]) : 0;
    const minutes = clock?.[2] ? Number(clock[2]) : 0;
    if (hours > 23 || minutes > 59)
        return null;
    const base = new Date(now);
    if (date) {
        const day = Number(date[1]);
        const month = Number(date[2]) - 1;
        let year = date[3] ? Number(date[3]) : base.getFullYear();
        if (year < 100)
            year += 2000;
        const d = new Date(year, month, day, hours, minutes, 0, 0);
        if (d.getMonth() !== month || d.getDate() !== day)
            return null; // 31/02, etc.
        // « 05/01 » écrit en décembre sans année : c'est janvier prochain
        if (!date[3] && d.getTime() < now - 60_000)
            d.setFullYear(year + 1);
        return d.getTime();
    }
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
    if (d.getTime() <= now)
        d.setDate(d.getDate() + 1);
    return d.getTime();
}
/** Prochaine exécution d'un giveaway récurrent, en sautant les occurrences manquées. */
export function nextRunAfter(previous, repeatDays, now = Date.now()) {
    if (repeatDays <= 0)
        return null;
    const step = repeatDays * DAY_MS;
    let next = previous + step;
    if (next <= now)
        next += Math.ceil((now - next) / step) * step;
    if (next <= now)
        next += step;
    return next;
}
/** Nom du salon créé pour un giveaway. Variables : {prix} {numero} {date}. */
export function channelNameFrom(template, vars) {
    const dd = String(vars.date.getDate()).padStart(2, '0');
    const mm = String(vars.date.getMonth() + 1).padStart(2, '0');
    const name = (template.trim() || '🎉-giveaway')
        .replace(/\{prix\}/gi, vars.prize)
        .replace(/\{numero\}/gi, String(vars.number))
        .replace(/\{date\}/gi, `${dd}-${mm}`)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[#@:`]/g, '')
        .replace(/-+/g, '-')
        .slice(0, 100);
    return name || 'giveaway';
}
/** Trie par nombre d'entrées (le plus d'abord), puis les inéligibles à la fin. */
export function rankEntrants(list) {
    return [...list].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
}
export const ENTRANTS_PER_PAGE = 20;
/** Chance de gagner d'un participant (au moins une fois si plusieurs gagnants), en %. */
export function winChance(tickets, totalTickets, winners) {
    if (!tickets || !totalTickets)
        return 0;
    // Approximation simple : chance par tirage × nombre de gagnants, plafonnée à 100 %.
    return Math.min(100, (tickets / totalTickets) * winners * 100);
}
/** Une ligne du classement : « 1. @membre — 5 entrées (3 rôles, +2 invit.) · 12,5 % ». */
export function entrantLine(rank, e, totalTickets, winners) {
    if (!e.total)
        return `${rank}. <@${e.id}> — ❌ ${e.problem || 'ne compte pas'}`;
    const parts = [];
    if (e.roles > 1)
        parts.push(`${e.roles} rôle`);
    if (e.invites)
        parts.push(`+${e.invites} invit.`);
    if (e.vouches)
        parts.push(`+${e.vouches} vouchs`);
    const chance = winChance(e.total, totalTickets, winners);
    const pct = chance >= 10 ? chance.toFixed(0) : chance.toFixed(1);
    return `${rank}. <@${e.id}> — **${e.total}** entrée${e.total > 1 ? 's' : ''}${parts.length ? ` (${parts.join(', ')})` : ''} · ${pct.replace('.', ',')} %`;
}
