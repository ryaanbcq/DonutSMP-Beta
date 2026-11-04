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

/** Toutes les lignes « Libelle: valeur » d un texte multi-lignes. */
export function lignesLibellees(texte, dans = {}) {
  for (const brut of String(texte ?? '').split('\n')) {
    const m = brut.trim().match(/^([A-Za-z][A-Za-z ]{0,30}):\s*(.+)$/);
    if (m && !(m[1].trim() in dans)) dans[m[1].trim()] = m[2].trim();
  }
  return dans;
}

/** Boutons d un dialogue (notice, confirmation, multi_action, dialog_list). */
function boutons(d) {
  const out = [];
  for (const cle of ['action', 'yes', 'no', 'exit_action']) if (d?.[cle]) out.push(d[cle]);
  for (const cle of ['actions', 'dialogs']) if (Array.isArray(d?.[cle])) out.push(...d[cle]);
  return out.filter((b) => b && typeof b === 'object');
}

/**
 * Le bouton « voir le profil complet » d une fiche /stats, ou null.
 * Rend { label, action } avec l action telle que le serveur l a envoyee.
 */
export function boutonProfilComplet(simplifie) {
  const d = simplifie?.data ?? simplifie;
  for (const b of boutons(d)) {
    const label = rendreComposant(b.label).trim();
    if (/profil|profile|full|complet|more|plus|detail/i.test(label) && b.action) return { label, action: b.action };
  }
  return null;
}

/**
 * Lit la page « profil complet » : un dialogue (corps, et sous-dialogue
 * inline) dont on garde toutes les lignes « Libelle: valeur ».
 */
export function lireProfilComplet(simplifie) {
  const d = simplifie?.data ?? simplifie;
  if (!d) return {};
  const lignes = {};
  for (const bloc of Array.isArray(d.body) ? d.body : []) {
    lignesLibellees(rendreComposant(bloc?.contents), lignes);
    lignesLibellees(rendreComposant(bloc?.description?.contents ?? bloc?.description), lignes);
  }
  return lignes;
}

// Petites capitales Unicode de DonutSMP (« ѕʜᴀʀᴅѕ ») -> lettres normales.
const PETITES = { 'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm',
  'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r', 'ѕ': 's', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z', 'х': 'x' };

/** « ʙʟᴏᴄᴋѕ ᴘʟᴀᴄᴇᴅ » -> « Blocks Placed ». */
export function libelleLisible(texte) {
  const plat = [...String(texte ?? '')].map((c) => PETITES[c] ?? c).join('').replace(/[^A-Za-z ]/g, '').trim().toLowerCase();
  return plat.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Composant de texte, en NBT type ou deja simplifie, ou en JSON. */
function texteItem(x, simplifier) {
  if (x === null || x === undefined) return '';
  if (typeof x === 'string') { try { return x.startsWith('{') ? rendreComposant(JSON.parse(x)) : x; } catch { return x; } }
  if (x.type && 'value' in x && simplifier) { try { return rendreComposant(simplifier(x)); } catch { return ''; } }
  return rendreComposant(x);
}

/**
 * Menu « profil complet » : un objet par stat, nom = libelle (petites
 * capitales), premiere ligne de description = valeur. Rend { Libelle: valeur }.
 */
export function lireMenuProfil(items, simplifier = null) {
  const lignes = {};
  for (const it of items) {
    if (!it) continue;
    const nom = texteItem(it.nom, simplifier).trim();
    const lore = (Array.isArray(it.lore) ? it.lore : []).map((l) => texteItem(l, simplifier).trim()).filter(Boolean);
    if (nom.includes(':')) { lignesLibellees(nom, lignes); continue; }
    const cle = libelleLisible(nom);
    if (!cle || cle === 'Back' || !lore.length || /click/i.test(lore[0])) continue;
    lignes[cle] ??= lore[0];
  }
  return lignes;
}
