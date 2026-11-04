// Doc officielle de DonutSMP pour le support : les conditions d utilisation
// (tos.donutsmp.net) et les regles (rules.donutsmp.net, vide au 04/11/2026),
// relues une fois par jour et gardees en base (kv support.docDonut) pour
// survivre a une panne du site. Le texte change rarement : le prompt reste
// en cache.

import { store } from '../db.js';

export const SOURCES = [
  { nom: 'Conditions d\'utilisation (Terms of Service)', url: 'https://tos.donutsmp.net' },
  { nom: 'Règles du serveur', url: 'https://rules.donutsmp.net' },
];
const VIDE = /isn't available yet|check back soon/i;

/** HTML -> texte lisible (pur, teste). */
export function texteDePage(html) {
  return String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(h[1-6]|li|p|br|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .filter((l) => !/^(Terms|Privacy|Terms · Privacy)$/.test(l))
    .join('\n');
}

const lire = () => { try { return JSON.parse(store.kvGet('support.docDonut') ?? '') ?? {}; } catch { return {}; } };

/** Relit les pages ; garde l ancienne version d une page qui ne repond pas. */
export async function rafraichirDoc({ fetchFn = fetch } = {}) {
  const doc = lire();
  for (const s of SOURCES) {
    try {
      const r = await fetchFn(s.url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'DonutFR-bot' } });
      if (!r.ok) continue;
      const texte = texteDePage(await r.text());
      if (texte.length < 200 || VIDE.test(texte)) { delete doc[s.url]; continue; }
      doc[s.url] = { nom: s.nom, texte: texte.slice(0, 12_000), at: Date.now() };
    } catch { /* site injoignable : on garde la copie */ }
  }
  store.kvSet('support.docDonut', JSON.stringify(doc));
  return Object.keys(doc).length;
}

/** Le bloc de connaissances, vide si rien n a encore ete lu. */
export function docDonutTexte() {
  const doc = lire();
  const pages = Object.entries(doc);
  if (!pages.length) return '';
  return ['## Documentation officielle de DonutSMP (site officiel, en anglais : traduis et résume, ne recopie pas)',
    ...pages.map(([url, p]) => `### ${p.nom} (${url})\n${p.texte}`)].join('\n');
}

export function demarrerDoc() {
  rafraichirDoc().then((n) => console.log(`[support] doc DonutSMP : ${n} page(s)`)).catch(() => {});
  setInterval(() => rafraichirDoc().catch(() => {}), 24 * 3_600_000).unref?.();
}
