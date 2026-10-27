// Tags de serveur interdits : la logique pure, sans Discord ni base.
//
// Un tag de serveur (« primary guild ») est la petite etiquette qu un membre
// affiche a cote de son pseudo pour montrer de quel serveur il vient. Une
// regle vise soit le TEXTE du tag (n importe quel serveur peut prendre le
// meme), soit l ID du serveur qui le distribue (fiable : un autre serveur ne
// peut pas l usurper).

export const SANCTIONS = {
  alerte: 'Alerte au staff seulement',
  role: 'Retirer le rôle Vérifié',
  exclure: 'Exclusion temporaire (timeout)',
  expulser: 'Expulser du serveur',
  bannir: 'Bannir du serveur',
};
export const SANCTION_DEFAUT = 'alerte';

// Un tag Discord fait 4 caracteres au plus ; on garde de la marge.
const TAG_MAX = 8;
const estId = (s) => /^\d{17,20}$/.test(s);

/** Comparaison insensible a la casse et aux espaces. */
export function normaliserTag(tag) {
  return String(tag ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/**
 * Lit ce que l admin a tape : un tag (« SCAM ») ou un ID de serveur.
 * Rend { type, valeur } ou { erreur }.
 */
export function lireSaisie(saisie) {
  const s = String(saisie ?? '').trim();
  if (!s) return { erreur: 'rien saisi' };
  if (estId(s)) return { type: 'serveur', valeur: s };
  const tag = normaliserTag(s);
  if (!tag) return { erreur: 'rien saisi' };
  if (tag.length > TAG_MAX) return { erreur: `« ${s} » est trop long pour un tag (4 caractères sur Discord)` };
  return { type: 'tag', valeur: tag };
}

/** Ajoute une regle sans doublon. Rend la nouvelle liste. */
export function ajouterRegle(regles, regle) {
  const liste = Array.isArray(regles) ? regles : [];
  if (liste.some((r) => r.type === regle.type && r.valeur === regle.valeur)) return liste;
  return [...liste, { type: regle.type, valeur: regle.valeur, ...(regle.note ? { note: regle.note } : {}) }];
}

export function retirerRegle(regles, cle) {
  return (regles ?? []).filter((r) => cleRegle(r) !== cle);
}

export const cleRegle = (r) => `${r.type}:${r.valeur}`;

/**
 * La regle qui vise ce tag affiche, ou null. Un tag que le membre a masque
 * (identityEnabled false) ne compte pas : il ne s affiche nulle part.
 */
export function regleVisee(primaryGuild, regles) {
  if (!primaryGuild || primaryGuild.identityEnabled === false) return null;
  const tag = normaliserTag(primaryGuild.tag);
  const serveur = primaryGuild.identityGuildId ? String(primaryGuild.identityGuildId) : '';
  if (!tag && !serveur) return null;
  return (regles ?? []).find((r) => (r.type === 'serveur' && serveur && r.valeur === serveur)
    || (r.type === 'tag' && tag && r.valeur === tag)) ?? null;
}

/** Libelle lisible d une regle, pour les panneaux et le journal. */
export function libelle(r) {
  if (r.type === 'serveur') return `serveur \`${r.valeur}\`${r.note ? ` (tag ${r.note})` : ''}`;
  return `tag \`${r.valeur.toUpperCase()}\``;
}

/**
 * Que faire de ce membre maintenant. `deja` = ce qu on a retenu de lui au
 * passage precedent (cle de la regle sanctionnee), pour ne pas re-alerter a
 * chaque balayage.
 *   - 'sanctionner' : tag interdit vu pour la premiere fois (ou nouvelle regle)
 *   - 'rien'        : deja traite, ou rien a signaler
 *   - 'leve'        : il portait un tag interdit et ne le porte plus
 */
export function decision({ primaryGuild, regles, deja, exempt }) {
  const r = exempt ? null : regleVisee(primaryGuild, regles);
  if (r) return cleRegle(r) === deja ? { action: 'rien', regle: r } : { action: 'sanctionner', regle: r };
  return deja ? { action: 'leve' } : { action: 'rien' };
}
