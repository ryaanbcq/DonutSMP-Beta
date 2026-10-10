// Trust score d un joueur, sur 100.
//
// Pas une moyenne bete : une moyenne bayesienne. On ajoute PRIOR_N avis
// fictifs a PRIOR (3,5 etoiles) : un joueur avec UN seul 5 etoiles ne passe
// pas devant un joueur a 4,8 sur quarante avis. Un scam vouch vaut POIDS_SCAM
// avis a zero etoile, et les avis vieillissent : de 1 a 0,6 sur six mois.
// Sur un gros profil, un scam pese au moins 10 % des avis positifs (sinon 99
// bons avis le noyaient : -3 points).

const PRIOR = 0.7;
const PRIOR_N = 5;
const POIDS_SCAM = 3;
const DEMI_VIE_JOURS = 180;
const PART_SCAM = 0.1;

export const PALIERS = [
  { min: 95, emoji: '💎', nom: 'Légende' },
  { min: 85, emoji: '🥇', nom: 'Trusted' },
  { min: 70, emoji: '🥈', nom: 'De confiance' },
  { min: 50, emoji: '🥉', nom: 'Fiable' },
  { min: 0, emoji: '⚠️', nom: 'Douteux' },
];
export const PALIER_NOUVEAU = { emoji: '🌱', nom: 'Nouveau' };
export const PALIER_SIGNALE = { emoji: '☠️', nom: 'Signalé' };
export const SEUIL_TRUSTED = 85;
export const MIN_AVIS = 10;
export const SCAMS_SIGNALE = 2;

function recence(createdAt, now) {
  const jours = Math.max(0, (now - createdAt) / 86_400_000);
  return 0.6 + 0.4 * Math.exp(-jours / DEMI_VIE_JOURS);
}

/**
 * avis : lignes vouches { value (+1|-1), stars (1-5, null = 5), created_at }.
 * Rend { score, n, pos, neg, moyenne, palier, trusted }.
 */
export function calculerTrust(avis, now = Date.now()) {
  let somme = PRIOR * PRIOR_N;
  let poids = PRIOR_N;
  let pos = 0;
  let neg = 0;
  let sommeEtoiles = 0;

  // Poids total des avis positifs : il fixe le poids minimal d'un scam.
  const poidsPositifs = avis.filter((a) => a.value > 0).reduce((t, a) => t + recence(a.created_at ?? now, now), 0);
  const poidsScam = Math.max(POIDS_SCAM, PART_SCAM * poidsPositifs);

  for (const a of avis) {
    const d = recence(a.created_at ?? now, now);
    if (a.value > 0) {
      const etoiles = Math.min(5, Math.max(1, a.stars ?? 5));
      somme += (etoiles / 5) * d;
      poids += d;
      pos += 1;
      sommeEtoiles += etoiles;
    } else {
      poids += poidsScam * d;
      neg += 1;
    }
  }

  const n = pos + neg;
  const score = Math.round((somme / poids) * 100);
  const moyenne = pos ? sommeEtoiles / pos : 0;

  let palier;
  if (neg >= SCAMS_SIGNALE) palier = PALIER_SIGNALE;
  else if (n < MIN_AVIS) palier = PALIER_NOUVEAU;
  else palier = PALIERS.find((p) => score >= p.min);

  return {
    score, n, pos, neg, moyenne,
    palier,
    trusted: palier !== PALIER_SIGNALE && n >= MIN_AVIS && score >= SEUIL_TRUSTED,
  };
}

export function etoiles(n) {
  const k = Math.round(Number(n) || 0);
  return '★'.repeat(Math.max(0, Math.min(5, k))) + '☆'.repeat(Math.max(0, 5 - k));
}

/** Ligne « barre + score », ou l attente tant qu il n y a pas assez d avis pour que le score veuille dire quelque chose. */
export function ligneScore(t, largeur = 10) {
  // Signale : un score de 93 a cote d'une tete de mort se contredisait.
  if (t.palier === PALIER_SIGNALE) return `*☠️ Trust score suspendu : ${t.neg} signalements*`;
  if (t.n < MIN_AVIS) return `*Trust score dès ${MIN_AVIS} avis (${t.n} / ${MIN_AVIS})*`;
  return `\`${barre(t.score, largeur)}\` **${t.score} / 100**`;
}

export function barre(score, largeur = 10) {
  const pleins = Math.round((Math.max(0, Math.min(100, score)) / 100) * largeur);
  return '█'.repeat(pleins) + '░'.repeat(largeur - pleins);
}
