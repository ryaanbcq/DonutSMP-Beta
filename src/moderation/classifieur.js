// Classifieur de pub qui apprend : bayesien naif sur les mots et les paires
// de mots, la logique pure, sans Discord ni base.
//
// Deux classes : « pub » et « normal ». Chaque exemple appris ajoute ses mots
// a la classe. Pour un nouveau message, on compare la probabilite qu il vienne
// de chaque classe (lissage de Laplace) et on rend la probabilite « pub ».
//
// Il apprend de trois sources (voir antipub.js) :
//   - le staff signale un message (clic droit > Applications > Signaler comme pub) ;
//   - le staff corrige une detection dans le journal (« C'est de la pub » /
//     « Pas de la pub ») ;
//   - un echantillon des messages ordinaires des membres, comme exemples
//     « normal », pour qu il sache aussi a quoi ressemble une discussion.
// Il demarre avec quelques phrases de pub typiques pour ne pas partir de zero.

const INVISIBLES = /[​-‏⁠﻿­]/g;
const VIDES = new Set(['le', 'la', 'les', 'un', 'une', 'de', 'des', 'du', 'et', 'a', 'en', 'je', 'tu', 'il', 'on', 'the', 'to', 'and', 'is']);

/** Mots normalises (sans accents ni ponctuation) et paires de mots voisins. */
export function jetons(texte) {
  const mots = String(texte ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(INVISIBLES, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' lienweb ')
    .replace(/\d+/g, '0')
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 2 && !VIDES.has(m));
  const paires = mots.slice(1).map((m, i) => `${mots[i]}_${m}`);
  return [...new Set([...mots, ...paires])];
}

export const MODELE_VIDE = () => ({
  docs: { pub: 0, normal: 0 },
  mots: { pub: {}, normal: {} },
  total: { pub: 0, normal: 0 },
});

// Phrases de depart : pub typique de serveurs et de services sur DonutSMP.
export const GRAINES_PUB = [
  'rejoignez mon serveur discord',
  'venez sur mon serveur, lien en mp',
  'nouveau serveur minecraft rejoins nous',
  'mp moi pour le lien du serveur',
  'je recrute pour mon serveur, dm moi',
  'join my discord server link in bio',
  'dm me for the server invite',
  'venez on fait un giveaway sur mon serveur',
  'abonne toi a ma chaine youtube',
  'je vends des comptes pas cher mp moi',
  'gagnez de l argent facile, contactez moi en prive',
  'serveur actif recrute staff venez nombreux',
];
export const GRAINES_NORMAL = [
  'salut ca va',
  'quelqu un pour jouer ce soir',
  'gg bien joue',
  'tu as combien sur donut',
  'je cherche quelqu un pour un trade',
  'le bot marche pas pour mon link',
  'merci pour le don',
  'on fait un vocal',
  'c est quoi le meilleur farm',
  'bonne nuit tout le monde',
];

export function apprendre(modele, texte, classe, poids = 1) {
  const m = modele ?? MODELE_VIDE();
  const j = jetons(texte);
  if (!j.length) return m;
  m.docs[classe] += poids;
  for (const t of j) {
    m.mots[classe][t] = (m.mots[classe][t] ?? 0) + poids;
    m.total[classe] += poids;
  }
  return m;
}

/** Retire un exemple appris par erreur (correction du staff). */
export function desapprendre(modele, texte, classe) {
  const j = jetons(texte);
  if (!j.length || modele.docs[classe] <= 0) return modele;
  modele.docs[classe] -= 1;
  for (const t of j) {
    if (!modele.mots[classe][t]) continue;
    modele.mots[classe][t] -= 1;
    modele.total[classe] -= 1;
    if (modele.mots[classe][t] <= 0) delete modele.mots[classe][t];
  }
  return modele;
}

/**
 * Probabilite que le texte soit de la pub, entre 0 et 1. Un texte trop court
 * (moins de 3 mots) rend 0 : « gg », « mp moi » ne se jugent pas seuls.
 */
export function probabilitePub(modele, texte) {
  const j = jetons(texte);
  const mots = j.filter((t) => !t.includes('_'));
  if (mots.length < 3 || !modele.docs.pub || !modele.docs.normal) return 0;
  const vocab = new Set([...Object.keys(modele.mots.pub), ...Object.keys(modele.mots.normal)]).size + 1;
  const docs = modele.docs.pub + modele.docs.normal;
  let lp = Math.log(modele.docs.pub / docs);
  let ln = Math.log(modele.docs.normal / docs);
  for (const t of j) {
    // On ne compte que les jetons deja vus : un mot inconnu ne dit rien.
    const p = modele.mots.pub[t] ?? 0;
    const n = modele.mots.normal[t] ?? 0;
    if (!p && !n) continue;
    lp += Math.log((p + 1) / (modele.total.pub + vocab));
    ln += Math.log((n + 1) / (modele.total.normal + vocab));
  }
  return 1 / (1 + Math.exp(ln - lp));
}

/** Les jetons qui pesent le plus vers la pub, pour expliquer une detection. */
export function indices(modele, texte, n = 4) {
  const vocab = new Set([...Object.keys(modele.mots.pub), ...Object.keys(modele.mots.normal)]).size + 1;
  return jetons(texte)
    .map((t) => {
      const p = (modele.mots.pub[t] ?? 0); const q = (modele.mots.normal[t] ?? 0);
      if (!p) return null;
      return [t, Math.log((p + 1) / (modele.total.pub + vocab)) - Math.log((q + 1) / (modele.total.normal + vocab))];
    })
    .filter((x) => x && x[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t.replace('_', ' '));
}

/**
 * Garde le modele de taille raisonnable : au dela de `max` jetons, on retire
 * ceux vus une seule fois dans une seule classe.
 */
export function elaguer(modele, max = 20_000) {
  const tous = new Set([...Object.keys(modele.mots.pub), ...Object.keys(modele.mots.normal)]);
  if (tous.size <= max) return modele;
  for (const t of tous) {
    const p = modele.mots.pub[t] ?? 0; const q = modele.mots.normal[t] ?? 0;
    if (p + q <= 1) {
      for (const c of ['pub', 'normal']) {
        if (modele.mots[c][t]) { modele.total[c] -= modele.mots[c][t]; delete modele.mots[c][t]; }
      }
    }
  }
  return modele;
}

export function modeleDeDepart() {
  const m = MODELE_VIDE();
  for (const t of GRAINES_PUB) apprendre(m, t, 'pub');
  for (const t of GRAINES_NORMAL) apprendre(m, t, 'normal');
  return m;
}
