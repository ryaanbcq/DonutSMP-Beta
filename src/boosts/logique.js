// Super Booster, partie pure (testee).

/** Types de messages systeme de boost : simple, et passage de niveau 1, 2, 3. */
export const TYPES_BOOST = new Set([8, 9, 10, 11]);
export const SEUIL = 2;

/** Boosts portes par un message systeme : Discord met le nombre dans le texte s il y en a plusieurs d un coup. */
export function boostsDuMessage(contenu) {
  const n = Number.parseInt(String(contenu ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 && n < 100 ? n : 1;
}

/**
 * Boosts en cours par membre, depuis les messages de boost : on ne compte que
 * ceux posterieurs au debut de son boost actuel (premiumSince), les anciens
 * boosts retires ne comptent plus.
 * messages : [{ auteur, at, n }] ; debuts : Map auteur -> premiumSince (ms) ou null.
 */
export function compterBoosts(messages, debuts) {
  const out = new Map();
  for (const m of messages) {
    const debut = debuts.get(m.auteur);
    if (!debut || m.at < debut - 60_000) continue;
    out.set(m.auteur, (out.get(m.auteur) ?? 0) + m.n);
  }
  return out;
}

/** Que faire du role : 'donner', 'retirer' (seulement s il vient du bot) ou null. */
export function decisionRole({ boosts, booste, aLeRole, donneParBot }) {
  if (booste && boosts >= SEUIL && !aLeRole) return 'donner';
  if (!booste && aLeRole && donneParBot) return 'retirer';
  return null;
}
