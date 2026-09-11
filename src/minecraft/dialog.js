// DonutSMP repond a /stats par un DIALOGUE vanilla (paquet show_dialog des
// 1.21.6), pas par du chat ni par un inventaire. Le texte des stats est dans
// le corps du dialogue, en composants de texte.

/** Aplati un composant de texte Minecraft en chaine. */
export function rendreComposant(c) {
  if (c === null || c === undefined) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(rendreComposant).join('');
  if (typeof c !== 'object') return String(c);

  let out = typeof c.text === 'string' ? c.text : '';
  if (Array.isArray(c.extra)) out += c.extra.map(rendreComposant).join('');
  return out;
}

/**
 * Extrait les stats d un dialogue deja simplifie (prismarine-nbt simplify).
 * Rend { nom, lignes } ou null si ce dialogue n est pas une fiche de stats.
 */
export function lireDialogueStats(simplifie) {
  const d = simplifie?.data ?? simplifie;
  if (!d) return null;

  const nom = rendreComposant(d.title).trim();
  const corps = Array.isArray(d.body) ? d.body : [];
  if (!nom || corps.length === 0) return null;

  const lignes = {};
  for (const bloc of corps) {
    const texte = rendreComposant(bloc?.contents).trim();
    // « Money: $ 10M », « Kills: 72 », « Playtime: 4d 7h »
    const m = texte.match(/^([A-Za-z][A-Za-z ]{0,30}):\s*(.+)$/);
    if (m) lignes[m[1].trim()] = m[2].trim();
  }

  return Object.keys(lignes).length ? { nom, lignes } : null;
}

const NOMBRE = /^[\d,\.]+\s*[KMBkmb]?$/;

/** Convertit « $ 10M » ou « 1,234 » en nombre. Rend null si ce n est pas un. */
export function valeurNumerique(texte) {
  const propre = String(texte ?? '').replace(/^\$\s*/, '').trim();
  if (!NOMBRE.test(propre)) return null;
  const m = propre.match(/^([\d,\.]+)\s*([KMBkmb])?$/);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[String(m[2] ?? '').toLowerCase()] ?? 1;
  return base * mult;
}
