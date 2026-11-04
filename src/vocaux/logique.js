// Vocaux perso : la logique pure, testee sans Discord.

import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

export const NOM_MAX = 90;
export const LIMITE_MAX = 99;
export const PREFIXE_NOM = '🔊 ';

/** Nom du vocal : prefixe 🔊, espaces resserres, tronque a 90 caracteres. */
export function nomVocal(texte) {
  const brut = String(texte ?? '').replace(/^\s*🔊\s*/u, '').replace(/\s+/g, ' ').trim();
  if (!brut) return null;
  return [...`${PREFIXE_NOM}${brut}`].slice(0, NOM_MAX).join('');
}

/** Nom par defaut a la creation. */
export const nomParDefaut = (nomMembre) => nomVocal(`Vocal de ${nomMembre || 'membre'}`);

/** Le texte saisi dans le formulaire sans le prefixe, pour le pre-remplir. */
export const sansPrefixe = (nom) => String(nom ?? '').replace(/^\s*🔊\s*/u, '');

/** Limite saisie : entier de 0 (illimite) a 99, sinon null. */
export function bornerLimite(saisie) {
  const t = String(saisie ?? '').trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n > LIMITE_MAX ? null : n;
}

function aPermission(membre, bit) {
  const p = membre?.permissions;
  if (!p) return false;
  if (typeof p.has === 'function') return p.has(bit);
  try { return new PermissionsBitField(BigInt(p)).has(bit); } catch { return false; }
}

/**
 * Qui peut utiliser le panneau : l hote, un administrateur Discord, ou le
 * staff du bot (estStaff = estAdmin : roles admin du bot et « Gérer le
 * serveur »). Passe en parametre pour les tests.
 */
export function peutGerer(membre, entree, estStaff = () => false) {
  if (!membre || !entree) return false;
  const id = membre.id ?? membre.user?.id;
  if (id && id === entree.owner_id) return true;
  if (aPermission(membre, PermissionFlagsBits.Administrator)) return true;
  return Boolean(estStaff(membre));
}

/**
 * Ce qui reste a faire d un vocal perso a la sortie d un membre ou au
 * demarrage : 'supprimer' s il est vide, 'oublier' s il n existe plus,
 * 'garder' sinon.
 */
export function sortDuVocal(salon) {
  if (!salon) return 'oublier';
  return salon.members?.size ? 'garder' : 'supprimer';
}

// Droits que le bot doit avoir sur le hub et la categorie.
export const DROITS_BOT = [
  ['ViewChannel', 'Voir le salon'],
  ['Connect', 'Se connecter'],
  ['ManageChannels', 'Gérer les salons'],
  ['MoveMembers', 'Déplacer des membres'],
  // Verrouiller = modifier une permission du salon : Discord exige ce droit.
  ['ManageRoles', 'Gérer les permissions'],
];

/** Libelles des droits manquants dans un jeu de permissions (PermissionsBitField ou null). */
export function droitsManquants(perms, liste = DROITS_BOT) {
  if (!perms) return liste.map(([, l]) => l);
  return liste.filter(([cle]) => !perms.has(PermissionFlagsBits[cle])).map(([, l]) => l);
}

/**
 * Droits accordes a l hote de son vocal. On ne donne que ce que le bot a
 * lui meme : Discord refuse de creer un salon dont une permission accorde
 * plus que ce que possede le bot (Missing Permissions, salon jamais cree).
 */
export const DROITS_HOTE = ['ViewChannel', 'Connect', 'Speak', 'Stream', 'UseVAD', 'MoveMembers', 'MuteMembers', 'DeafenMembers'];
export const DROITS_STAFF = ['ViewChannel', 'Connect', 'Speak', 'MoveMembers'];

export function droitsAccordables(voulus, permsBot) {
  return voulus.filter((cle) => !permsBot || permsBot.has(PermissionFlagsBits.Administrator) || permsBot.has(PermissionFlagsBits[cle]))
    .map((cle) => PermissionFlagsBits[cle]);
}

/** Duree lisible : 45 s, 12 min, 2 h 05. */
export function dureeVocal(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------ repris de « vocaux temporaires »

/** Nom du salon depuis le modele : {pseudo} (sur le serveur), {utilisateur} (Discord). */
export function nomDepuisModele(modele, { pseudo, utilisateur }) {
  const nom = String(modele || '🔊 Vocal de {pseudo}')
    .replaceAll('{pseudo}', pseudo ?? 'membre')
    .replaceAll('{utilisateur}', utilisateur ?? 'membre')
    .trim().slice(0, 100);
  return nom || 'Vocal';
}

/** Temps restant avant de pouvoir reinviter (ms). */
export function attenteInvitation(derniere, minutes, maintenant = Date.now()) {
  return Math.max(0, minutes * 60_000 - (maintenant - derniere));
}

/** Un membre avec un role protege ne peut pas etre expulse ni refuse. */
export function estProtege(rolesMembre, rolesProteges) {
  const set = new Set(rolesProteges);
  for (const id of rolesMembre) if (set.has(id)) return true;
  return false;
}
