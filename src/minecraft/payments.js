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
const AMOUNT = String.raw`\$?\s*([\d,]+(?:\.\d+)?)\s*([KMBTkmbt])?`;
const NAME = String.raw`(\.?[A-Za-z0-9_]{1,24})`;

// Formes acceptees, toutes ancrees. `order` dit ou lire le pseudo et le montant.
// Seule la forme VUE en production est acceptee. « You received $N from X »
// et « [+] $N from X » etaient supposees : si DonutSMP ecrit ce genre de ligne
// pour une vente ou une recompense (« You received $5 from selling »), le bot
// aurait rembourse de l argent qu aucun joueur ne lui a envoye.
export const PATTERNS = [
  { re: new RegExp(`^${NAME} paid you ${AMOUNT}$`), name: 1, amount: 2, suffix: 3 },
];

const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

export function parseAmount(raw, suffix, { zeroOk = false } = {}) {
  const base = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = suffix ? SUFFIX[String(suffix).toLowerCase()] : 1;
  if (!mult) return null;
  const value = base * mult;
  if (!Number.isFinite(value)) return null;
  return value > 0 || (zeroOk && value === 0) ? value : null;
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

// Confirmation d un paiement SORTANT, pour savoir qu un remboursement est
// bien arrive. Meme discipline : ancre, et rejet de toute ligne de chat.
const SENT_PATTERNS = [
  { re: new RegExp(`^You paid ${NAME} ${AMOUNT}$`, 'i'), name: 1, amount: 2, suffix: 3 },
  { re: new RegExp(`^You paid ${AMOUNT} to ${NAME}$`, 'i'), name: 3, amount: 1, suffix: 2 },
];

/**
 * Rend { to, amount } si la ligne confirme un paiement envoye, sinon null.
 */
export function parsePaymentSent(line) {
  const clean = stripColors(line).trim();
  if (!clean || looksLikeChat(clean)) return null;
  for (const p of SENT_PATTERNS) {
    const m = clean.match(p.re);
    if (!m) continue;
    const to = m[p.name];
    const amount = parseAmount(m[p.amount], m[p.suffix]);
    if (!to || amount === null) return null;
    return { to, amount, raw: clean };
  }
  return null;
}

// Reponse de /balance. DonutSMP arrondit pour les autres joueurs
// (« SentiaZz has $ 79.9M ») et donne l exact pour soi (« You have $ 18,818,277 »).
const BALANCE = new RegExp(`^${NAME} has ${AMOUNT}$`);
const BALANCE_SOI = new RegExp(`^You have ${AMOUNT}$`, 'i');
const INCONNU = /^That player does not exist$/i;

export function parseBalance(line) {
  const clean = stripColors(line).trim();
  if (!clean || looksLikeChat(clean)) return null;

  if (INCONNU.test(clean)) return { inconnu: true };

  const soi = clean.match(BALANCE_SOI);
  if (soi) {
    const amount = parseAmount(soi[1], soi[2], { zeroOk: true });
    return amount === null ? null : { soi: true, amount, raw: clean };
  }

  const m = clean.match(BALANCE);
  if (!m) return null;
  // Un solde a 0 est une vraie reponse : la refuser laissait l ancien solde au
  // classement pour toujours (vecu Accoutrement_, 4e avec une valeur de 12 jours).
  const amount = parseAmount(m[2], m[3], { zeroOk: true });
  return amount === null ? null : { name: m[1], amount, raw: clean };
}
