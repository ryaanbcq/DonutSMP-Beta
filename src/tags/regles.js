// Tags de serveur interdits : la logique pure, sans Discord ni base.
//
// Un tag de serveur (« primary guild ») est la petite etiquette qu un membre
// affiche a cote de son pseudo pour montrer de quel serveur il vient. Une
// regle vise soit le TEXTE du tag (n importe quel serveur peut prendre le
// meme), soit l ID du serveur qui le distribue (fiable : un autre serveur ne
// peut pas l usurper). Chaque regle a un nom libre et sa propre sanction.
//
// Sanction progressive (par defaut), un delai entre chaque etape pour laisser
// le membre retirer son tag :
//   1. avertissement (MP + salon public)
//   2. mute + 2e avertissement
//   3. ban temporaire
//   4. a son retour, toujours le tag : dernier avertissement
//   5. ban definitif
// Un membre qui retire son tag n avance plus. S il le remet avant d avoir ete
// oublie, il passe directement a l etape suivante (pas de nouveau delai de
// grace : sinon retirer/remettre toutes les 24 h le protegerait a vie).

export const SANCTIONS = {
  progressif: 'Progressive : avertissement, mute, ban temporaire, ban',
  alerte: 'Alerte au staff seulement',
  role: 'Retirer le rôle Vérifié',
  exclure: 'Mute (timeout)',
  expulser: 'Expulser du serveur',
  bannir: 'Bannir du serveur',
};
export const SANCTION_DEFAUT = 'progressif';

export const ETAPES = [null, 'avertissement', 'mute', 'ban_temp', 'dernier_avertissement', 'ban_def'];
export const DERNIERE_ETAPE = ETAPES.length - 1;

export const PARAMS_DEFAUT = {
  delaiMs: 24 * 3_600_000,     // entre deux etapes
  muteMs: 24 * 3_600_000,
  banTempMs: 7 * 86_400_000,
  oubliMs: 30 * 86_400_000,    // tag retire depuis tout ce temps : casier efface
};

// Un tag Discord fait 4 caracteres au plus ; on garde de la marge.
const TAG_MAX = 8;
const NOM_MAX = 40;
const estId = (s) => /^\d{17,20}$/.test(s);

/** Comparaison insensible a la casse, aux espaces et a la pleine chasse. */
export function normaliserTag(tag) {
  return String(tag ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/**
 * Lit ce que l admin a tape : un tag (« SCAM ») ou un ID de serveur, et un
 * nom facultatif. Rend { type, valeur, nom } ou { erreur }.
 */
export function lireSaisie(saisie, nom = '') {
  const s = String(saisie ?? '').trim();
  const n = String(nom ?? '').trim().slice(0, NOM_MAX);
  if (!s) return { erreur: 'rien saisi' };
  if (estId(s)) return { type: 'serveur', valeur: s, ...(n ? { nom: n } : {}) };
  const tag = normaliserTag(s);
  if (!tag) return { erreur: 'rien saisi' };
  if (tag.length > TAG_MAX) return { erreur: `« ${s} » est trop long pour un tag (4 caractères sur Discord)` };
  return { type: 'tag', valeur: tag, ...(n ? { nom: n } : {}) };
}

export const cleRegle = (r) => `${r.type}:${r.valeur}`;
export const sanctionDe = (r) => (SANCTIONS[r?.sanction] ? r.sanction : SANCTION_DEFAUT);

/** Ajoute une regle sans doublon. Rend la nouvelle liste. */
export function ajouterRegle(regles, regle) {
  const liste = Array.isArray(regles) ? regles : [];
  if (liste.some((r) => cleRegle(r) === cleRegle(regle))) return liste;
  return [...liste, {
    type: regle.type,
    valeur: regle.valeur,
    ...(regle.nom ? { nom: regle.nom } : {}),
    sanction: SANCTIONS[regle.sanction] ? regle.sanction : SANCTION_DEFAUT,
  }];
}

export function retirerRegle(regles, cle) {
  return (regles ?? []).filter((r) => cleRegle(r) !== cle);
}

/** Modifie une regle (nom, sanction). Rend la nouvelle liste. */
export function modifierRegle(regles, cle, changes) {
  return (regles ?? []).map((r) => {
    if (cleRegle(r) !== cle) return r;
    const n = { ...r };
    if ('nom' in changes) {
      const nom = String(changes.nom ?? '').trim().slice(0, NOM_MAX);
      if (nom) n.nom = nom; else delete n.nom;
    }
    if (SANCTIONS[changes.sanction]) n.sanction = changes.sanction;
    return n;
  });
}

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
  const cible = r.type === 'serveur' ? `serveur \`${r.valeur}\`` : `tag \`${r.valeur.toUpperCase()}\``;
  return r.nom ? `**${r.nom}** (${cible})` : cible;
}

/**
 * Que faire de ce membre maintenant. `etat` = son casier retenu en base :
 *   { regle, mode, etape?, prochaine?, leveA?, maj }
 * Rend { action, etat, regle?, sanction?, etape? } :
 *   - 'appliquer' : appliquer `sanction` (etape de l escalade ou sanction directe)
 *   - 'rien'      : rien a faire (en attente du delai, deja sanctionne...)
 *   - 'leve'      : il ne porte plus de tag interdit
 *   - 'oublier'   : tag retire depuis longtemps, le casier peut etre efface
 * `etat` rendu est le nouvel etat a enregistrer (null = effacer).
 */
export function evaluer({ primaryGuild, regles, etat, exempt = false, now = Date.now(), params = PARAMS_DEFAUT }) {
  const p = { ...PARAMS_DEFAUT, ...params };
  const r = exempt ? null : regleVisee(primaryGuild, regles);

  if (!r) {
    if (!etat) return { action: 'rien', etat: null };
    if (etat.leveA == null) return { action: 'leve', etat: { ...etat, leveA: now, prochaine: null, maj: now } };
    if (now - etat.leveA > p.oubliMs) return { action: 'oublier', etat: null };
    return { action: 'rien', etat };
  }

  const cle = cleRegle(r);
  const mode = sanctionDe(r);

  if (mode !== 'progressif') {
    if (etat && etat.regle === cle && etat.mode === mode && etat.leveA == null) return { action: 'rien', etat, regle: r };
    return { action: 'appliquer', sanction: mode, regle: r, etat: { regle: cle, mode, maj: now } };
  }

  // Le casier progressif suit le MEMBRE, quel que soit le tag interdit porte.
  const casier = etat?.mode === 'progressif' ? etat : null;
  let etape;
  if (!casier) etape = 1;
  else if (casier.leveA != null) etape = casier.etape + 1;                    // recidive
  else if (casier.prochaine != null && now >= casier.prochaine) etape = casier.etape + 1;
  else return { action: 'rien', etat, regle: r };
  if (etape > DERNIERE_ETAPE) return { action: 'rien', etat, regle: r };

  // Ban temporaire : la suite (dernier avertissement) tombe des son retour.
  const prochaine = etape === DERNIERE_ETAPE ? null : (ETAPES[etape] === 'ban_temp' ? now : now + p.delaiMs);
  return {
    action: 'appliquer',
    sanction: ETAPES[etape],
    etape,
    regle: r,
    etat: { regle: cle, mode, etape, prochaine, maj: now },
  };
}

/** Ancien format (une simple cle de regle) : vu comme une sanction directe. */
export function lireEtat(v) {
  if (!v) return null;
  if (typeof v === 'string') return { regle: v, mode: 'ancien', maj: 0 };
  return v;
}
