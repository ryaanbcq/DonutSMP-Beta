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

/**
 * Que faire du role : 'donner', 'retirer' ou null. Ryan (04/11) : le role
 * n existe qu avec 2 boosts actifs, qu il ait ete pose par le bot ou a la main.
 * Seul le proprietaire du serveur garde un role pose a la main.
 */
export function decisionRole({ boosts, booste, aLeRole, proprietaire = false }) {
  const merite = booste && boosts >= SEUIL;
  if (merite && !aLeRole) return 'donner';
  if (!merite && aLeRole && !proprietaire) return 'retirer';
  return null;
}

/**
 * Texte du remerciement poste sous le message de boost. Les avantages ne sont
 * PAS ecrits ici : on renvoie vers le salon du serveur, que le staff modifie
 * quand il veut. roleSuper = mention du role (dans un embed, une mention ne ping personne).
 */
export function texteMerci({ boosts, total, devientSuper, roleSuper, salonAvantages }) {
  const lignes = [
    boosts >= 2
      ? `Merci énormément, c'est ton **${boosts}e boost** ! 💜`
      : 'Merci énormément pour ton boost ! 💜',
    salonAvantages ? `Tes avantages de booster t'attendent dans <#${salonAvantages}>.` : 'Ton soutien compte énormément pour la commu DonutSMP FR.',
  ];
  if (devientSuper && roleSuper) lignes.push(`\n💎 Avec 2 boosts, tu deviens ${roleSuper} !`);
  else if (boosts < 2 && roleSuper) lignes.push(`\n-# Un 2e boost et tu passes ${roleSuper}.`);
  if (total) lignes.push(`-# Le serveur compte maintenant ${total} boosts.`);
  return lignes.join('\n');
}
