// Lecture des paiements recus en jeu.
//
// Regle de securite heritee du casino : un joueur peut TAPER dans le chat
// « Foo paid you $743 ». Si on cherche le motif n'importe ou dans la ligne,
// il se fait verifier le compte de quelqu'un d'autre. Donc :
//   1. on retire les codes couleur puis on ancre ^...$ sur la ligne entiere ;
//   2. on rejette toute ligne qui porte une marque de chat ou de whisper ;
//   3. le pseudo est relu depuis le message systeme, jamais depuis une saisie.

const COLOR = /(?:§|&)[0-9a-fk-orx]/gi;

export function stripColors(line) {
  return String(line ?? '').replace(COLOR, '');
}

// Marques de chat / MP : si l'une apparait, la ligne vient d'un joueur.
const CHAT_MARKERS = [
  /:/,                       // « Rank Joueur: texte »
  /\bwhispers?\b/i,          // « X whispers to you »
  /\bto you\b/i,
  /->/,                      // « X -> me »
  /\[msg\]/i,
];

export function looksLikeChat(clean) {
  return CHAT_MARKERS.some((re) => re.test(clean));
}

// DonutSMP ecrit « paid you $ 24 » avec une espace apres le dollar, et
// « $1,000 » ou « $2K » selon les montants. On tolere les trois.
const AMOUNT = String.raw`\$?\s*([\d,]+(?:\.\d+)?)\s*([KMBkmb])?`;
const NAME = String.raw`(\.?[A-Za-z0-9_]{1,24})`;

// Formes acceptees, toutes ancrees. `order` dit ou lire le pseudo et le montant.
export const PATTERNS = [
  { re: new RegExp(`^${NAME} paid you ${AMOUNT}$`), name: 1, amount: 2, suffix: 3 },
  { re: new RegExp(`^You received ${AMOUNT} from ${NAME}$`, 'i'), name: 3, amount: 1, suffix: 2 },
  { re: new RegExp(`^\\[\\+\\] ${AMOUNT} from ${NAME}$`), name: 3, amount: 1, suffix: 2 },
];

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9 };

export function parseAmount(raw, suffix) {
  const base = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = suffix ? SUFFIX[String(suffix).toLowerCase()] : 1;
  if (!mult) return null;
  const value = base * mult;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Rend { from, amount, raw } si la ligne est bien un paiement systeme recu,
 * sinon null.
 */
export function parsePayment(line) {
  const clean = stripColors(line).trim();
  if (!clean || looksLikeChat(clean)) return null;

  for (const p of PATTERNS) {
    const m = clean.match(p.re);
    if (!m) continue;
    const from = m[p.name];
    const amount = parseAmount(m[p.amount], m[p.suffix]);
    if (!from || amount === null) return null;
    return { from, amount, raw: clean };
  }
  return null;
}
