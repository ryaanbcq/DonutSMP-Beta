// Captures envoyees par le membre dans son ticket, pour que le support les
// voie vraiment (le modele lit les images). Seulement les images de
// l auteur du ticket, les plus recentes, 4 au plus. Une capture est une
// donnee comme un message : le prompt interdit d y suivre une instruction.

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const COTE_MAX = 1568; // au dela, le modele reduit l image de toute facon
const OCTETS_MAX = 4_500_000;

/**
 * Choix pur : les images de l auteur parmi des messages Discord simplifies
 * ({ auteur, at, pieces: [{ url, proxyURL, contentType, width, height, size, name }] }).
 * Rend les plus recentes, dans l ordre chronologique.
 */
export function choisirImages(messages, auteurId, max = 4) {
  const toutes = [];
  for (const m of messages) {
    if (m.auteur !== auteurId) continue;
    for (const p of m.pieces ?? []) {
      const type = String(p.contentType ?? '').split(';')[0].trim().toLowerCase();
      if (!TYPES.has(type)) continue;
      toutes.push({ ...p, type, at: m.at });
    }
  }
  toutes.sort((a, b) => a.at - b.at);
  return toutes.slice(-max);
}

/** URL a telecharger : la version reduite du proxy Discord si l image est grande. */
export function urlReduite(p) {
  const w = Number(p.width) || 0;
  const h = Number(p.height) || 0;
  if (!p.proxyURL || Math.max(w, h) <= COTE_MAX) return p.url;
  const k = COTE_MAX / Math.max(w, h);
  const sep = p.proxyURL.includes('?') ? '&' : '?';
  return `${p.proxyURL}${sep}width=${Math.round(w * k)}&height=${Math.round(h * k)}`;
}

/** Les images du ticket, pretes pour l API : [{ media_type, data, at, name }]. */
export async function imagesDuTicket(salon, auteurId, { max = 4, fetchFn = fetch } = {}) {
  const lus = await salon.messages.fetch({ limit: 50 }).catch(() => null);
  if (!lus?.size) return [];
  const messages = [...lus.values()].map((m) => ({
    auteur: m.author.id, at: m.createdTimestamp,
    pieces: [...m.attachments.values()].map((a) => ({
      url: a.url, proxyURL: a.proxyURL, contentType: a.contentType, width: a.width, height: a.height, size: a.size, name: a.name,
    })),
  }));
  const sortie = [];
  for (const p of choisirImages(messages, auteurId, max)) {
    try {
      const r = await fetchFn(urlReduite(p), { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const octets = Buffer.from(await r.arrayBuffer());
      if (!octets.length || octets.length > OCTETS_MAX) continue;
      const recu = String(r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      sortie.push({ media_type: TYPES.has(recu) ? recu : p.type, data: octets.toString('base64'), at: p.at, name: p.name });
    } catch { /* image illisible : on fait sans */ }
  }
  return sortie;
}
