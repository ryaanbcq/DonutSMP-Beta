import { store } from '../db.js';

// Reglages du systeme de tickets, tous poses par /panel ticket et gardes en
// base : un changement prend effet tout de suite, sans redemarrage.
//
//   ticket.salon      salon ou le panneau membres est publie
//   ticket.dossier    categorie Discord ou naitront les salons de ticket
//   ticket.logs       salon staff qui recoit les transcripts
//   ticket.roles      roles staff qui voient les tickets, separes par |
//   ticket.categories JSON [{ cle, emoji, nom, description, slug, dossier? }]
//                     dossier = categorie Discord propre (sinon ticket.dossier)
//                     slug = identifiant court dans le nom du salon de ticket
//                     (pseudo-slug-001), a-z0-9 uniquement

const lire = (cle) => store.kvGet(cle) || null;

// Les huit categories de la commu, posees au premier lancement. Le staff
// peut ensuite en retirer ou en ajouter, la liste en base fait foi.
export const CATEGORIES_DEFAUT = [
  { emoji: '📬', nom: 'Support Général & Technique', slug: 'support',
    description: 'Problèmes techniques, bugs in-game/Discord, questions sur le serveur ou contestation de sanction.' },
  { emoji: '🚨', nom: 'Signalement de Joueur', slug: 'signalement',
    description: 'Comportement toxique, insultes, envoi de fichiers dangereux/grabbers, ou non-respect des règles du serveur.' },
  { emoji: '🎩', nom: 'Service Middleman', slug: 'middleman',
    description: "Demande d'un intermédiaire officiel du staff pour sécuriser vos échanges et gros trades." },
  { emoji: '🤝', nom: 'Partenariat & Média', slug: 'partenariat',
    description: 'Demande de partenariat pour votre serveur ou statut Média (assurez-vous de respecter les prérequis).' },
  { emoji: '🏗️', nom: 'Service Build', slug: 'build',
    description: 'Commandes personnalisées de builds et projets architecturaux.' },
  { emoji: '🛒', nom: 'Trusted Market', slug: 'market',
    description: 'Achats, transactions et questions relatifs aux objets du salon Trusted Market.' },
  { emoji: '🎁', nom: 'Récupération de Giveaway', slug: 'giveaway',
    description: "Réclamation de vos récompenses remportées lors d'un événement ou d'un concours." },
  { emoji: '❓', nom: 'Autre Demande', slug: 'autre',
    description: 'Pour toute requête ne correspondant à aucune catégorie ci-dessus.' },
].map((c) => ({ cle: cleDe(c.nom), ...c }));

/** Identifiant court pour le nom du salon : a-z0-9, 16 caracteres. Vide si rien d utilisable. */
export function slugDe(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16);
}

/** Le slug d une categorie, avec repli sur le premier mot de son nom pour les anciennes entrees. */
export function slugCategorie(c) {
  return c?.slug || slugDe(String(c?.nom ?? '').split(/\s+/)[0]) || 'ticket';
}

/** Identifiant stable d une categorie, derive de son nom : « Service Build » → service-build. */
export function cleDe(nom) {
  return String(nom ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function lireCategories() {
  const brut = lire('ticket.categories');
  if (brut === null) return CATEGORIES_DEFAUT.map((c) => ({ ...c }));
  try {
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

export const reglagesTickets = {
  salonPanneau: () => lire('ticket.salon'),
  poserSalonPanneau: (id) => store.kvSet('ticket.salon', String(id)),

  dossier: () => lire('ticket.dossier'),
  poserDossier: (id) => store.kvSet('ticket.dossier', id ? String(id) : ''),

  salonLogs: () => lire('ticket.logs'),
  poserSalonLogs: (id) => store.kvSet('ticket.logs', id ? String(id) : ''),

  roles: () => (lire('ticket.roles') ?? '').split('|').filter(Boolean),
  ajouterRole(id) {
    const liste = this.roles();
    if (liste.includes(String(id))) return false;
    store.kvSet('ticket.roles', [...liste, String(id)].join('|'));
    return true;
  },
  retirerRole(id) {
    const liste = this.roles();
    const reste = liste.filter((r) => r !== String(id));
    if (reste.length === liste.length) return false;
    store.kvSet('ticket.roles', reste.join('|'));
    return true;
  },

  categories: lireCategories,
  categorie(cle) {
    return lireCategories().find((c) => c.cle === cle) ?? null;
  },
  /** Ajoute ou remplace (meme cle) une categorie. Refuse au dela de 25, la limite d un menu Discord. */
  poserCategorie({ emoji, nom, description, slug }) {
    const cle = cleDe(nom);
    if (!cle) throw new Error('nom de catégorie vide');
    const avant = lireCategories().find((c) => c.cle === cle);
    const liste = lireCategories().filter((c) => c.cle !== cle);
    if (liste.length >= 25) throw new Error('25 catégories au maximum, la limite du menu Discord');
    const court = slugDe(slug) || slugDe(String(nom).split(/\s+/)[0]);
    // Modifier une categorie garde son dossier.
    liste.push({ cle, emoji: emoji || '📩', nom: String(nom).trim(), description: String(description ?? '').trim(), slug: court, ...(avant?.dossier ? { dossier: avant.dossier } : {}) });
    store.kvSet('ticket.categories', JSON.stringify(liste));
    return cle;
  },
  /** Dossier Discord propre a une categorie ; id vide = revient au dossier general. */
  poserDossierCategorie(cle, id) {
    const liste = lireCategories();
    const c = liste.find((x) => x.cle === cle);
    if (!c) return false;
    if (id) c.dossier = String(id); else delete c.dossier;
    store.kvSet('ticket.categories', JSON.stringify(liste));
    return true;
  },
  retirerCategorie(nomOuCle) {
    const cle = cleDe(nomOuCle);
    const liste = lireCategories();
    const reste = liste.filter((c) => c.cle !== cle);
    if (reste.length === liste.length) return false;
    store.kvSet('ticket.categories', JSON.stringify(reste));
    return true;
  },
};
