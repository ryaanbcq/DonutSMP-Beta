/** Utilitaires de texte : variables de messages, durées, nombres. */
/**
 * Remplace les variables {nom} dans un message personnalisé.
 * Les variables inconnues sont laissées telles quelles pour que l'erreur soit visible.
 */
export function renderTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = vars[key];
        return value === undefined ? match : String(value);
    });
}
const UNITS = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    j: 86_400_000,
    w: 604_800_000,
};
/** "1h30m", "10m", "2d", "1j" → millisecondes. Retourne null si invalide. */
export function parseDuration(input) {
    const text = input.trim().toLowerCase().replace(/\s+/g, '');
    if (!text)
        return null;
    const re = /(\d+)([smhdjw])/g;
    let total = 0;
    let consumed = 0;
    let match;
    while ((match = re.exec(text))) {
        total += Number(match[1]) * UNITS[match[2]];
        consumed += match[0].length;
    }
    if (consumed !== text.length || total <= 0)
        return null;
    return total;
}
export function formatDuration(ms) {
    const parts = [];
    const units = [
        [86_400_000, 'j'],
        [3_600_000, 'h'],
        [60_000, 'min'],
        [1000, 's'],
    ];
    let rest = ms;
    for (const [size, label] of units) {
        const n = Math.floor(rest / size);
        if (n > 0) {
            parts.push(`${n}${label}`);
            rest -= n * size;
        }
    }
    return parts.join(' ') || '0s';
}
export function formatNumber(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
}
/** Limite de timeout Discord : 28 jours. */
export const MAX_TIMEOUT_MS = 28 * 86_400_000;
