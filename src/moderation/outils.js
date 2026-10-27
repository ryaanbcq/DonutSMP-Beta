// Moderation : la logique pure (durees, ids), sans Discord ni base.

const UNITES = {
  s: 1000, sec: 1000,
  m: 60_000, min: 60_000, mn: 60_000,
  h: 3_600_000,
  j: 86_400_000, d: 86_400_000,
  sem: 7 * 86_400_000, w: 7 * 86_400_000,
};

/**
 * « 10m », « 2h », « 3j », « 1sem », « 1j12h » -> millisecondes, ou null.
 * Un nombre seul est lu en minutes.
 */
export function lireDuree(texte) {
  const s = String(texte ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 60_000;
  const morceaux = [...s.matchAll(/(\d+)(sem|sec|min|mn|[smhjdw])/g)];
  if (!morceaux.length || morceaux.map((m) => m[0]).join('') !== s) return null;
  const ms = morceaux.reduce((t, [, n, u]) => t + Number(n) * UNITES[u], 0);
  return ms > 0 ? ms : null;
}

/** Duree lisible : « 3 jours », « 2 h », « 1 jour 12 h », « 10 min ». */
export function ecrireDuree(ms) {
  const j = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  const parts = [];
  if (j) parts.push(`${j} jour${j > 1 ? 's' : ''}`);
  if (h) parts.push(`${h} h`);
  if (m && !j) parts.push(`${m} min`);
  return parts.join(' ') || 'moins d\'une minute';
}

/** « <@123> », « <@!123> » ou « 123 » -> l id, sinon null. */
export function lireIdUtilisateur(texte) {
  const m = /^(?:<@!?)?(\d{17,20})>?$/.exec(String(texte ?? '').trim());
  return m ? m[1] : null;
}

/** Plafond Discord d un timeout : 28 jours. */
export const MUTE_MAX_MS = 28 * 86_400_000;
