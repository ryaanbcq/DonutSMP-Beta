import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

// Charte DonutSMP FR : ligne d auteur « emoji・TITRE EN CAPITALES », vignette,
// bleu clair de la commu. Les embeds de marque portent le logo, les embeds
// qui parlent d un joueur portent sa tete de skin.

export const FR = {
  bleu: 0xaeefff,
  or: 0xfff36e,
  vert: 0x57f287,
  rouge: 0xed4245,
  jaune: 0xfee75c,
};

let logoUrl = null;

/** Appele une fois au demarrage : l avatar du bot sert de logo par defaut. */
export function setLogo(url) {
  logoUrl = config.discord.logoUrl || url || null;
}

export function logo() {
  return logoUrl;
}

// Tete de skin : mc-heads PAR UUID. Par pseudo, mc-heads comme minotar
// renvoyaient Steve pour de vrais comptes (ZKR5, Unagsuti, 06/11). Les UUID
// sont resolus aupres de Mojang par lib/uuids.js et poses ici ; sans UUID
// connu (Bedrock, pseudo inconnu), repli sur le pseudo.
const uuids = new Map();
export function poserUuid(name, uuid) {
  if (name && uuid) uuids.set(String(name).toLowerCase(), uuid);
}

export function skin(name) {
  const clean = String(name ?? '').replace(/^\./, '');
  if (!clean) return null;
  const uuid = uuids.get(clean.toLowerCase());
  return `https://mc-heads.net/avatar/${encodeURIComponent(uuid ?? clean)}/128`;
}

/**
 * Embed a la charte.
 *   titre   ligne d auteur, deja prefixee de son emoji
 *   couleur FR.bleu par defaut
 *   image   'logo' (defaut), 'aucune', ou un pseudo dont on prend la tete
 */
export function embed(titre, { couleur = FR.bleu, image = 'logo', description } = {}) {
  const e = new EmbedBuilder().setColor(couleur);
  if (titre) e.setAuthor({ name: titre });
  if (description) e.setDescription(description);

  if (image === 'logo') {
    if (logoUrl) e.setThumbnail(logoUrl);
  } else if (/^https?:\/\//.test(image ?? '')) {
    e.setThumbnail(image); // photo de profil d un membre non lie
  } else if (image && image !== 'aucune') {
    const url = skin(image);
    if (url) e.setThumbnail(url);
  }
  return e;
}

export const TITRES = {
  connexion: '🔗・SE CONNECTER',
  verification: '🔗・VÉRIFICATION',
  verifie: '✅・COMPTE VÉRIFIÉ',
  reserve: '🔒・ACCÈS RÉSERVÉ',
  profil: '👤・PROFIL',
  stats: '📊・STATISTIQUES',
  classement: '🏆・CLASSEMENT',
  reputation: '⭐・RÉPUTATION',
  avis: '📝・NOUVEL AVIS',
  staff: '🛠️・STAFF',
};
