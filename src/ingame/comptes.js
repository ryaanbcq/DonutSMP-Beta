// Registre des comptes Minecraft du bot en jeu (/bot auth).
//
// Chaque compte a son PROPRE dossier de jetons Microsoft : on peut en ajouter
// un sans toucher a celui qui joue, puis basculer d un coup le jour ou le
// compte actif tombe (vecu le 08/11/2026 : DonutSMP_FR « placed on hold »).
//
// Lu par les deux process (bot Discord et bot en jeu) : un simple fichier
// JSON ecrit de facon atomique. Sans fichier, le compte du .env fait office
// de compte unique « principal », rien a migrer.

import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const FICHIER_COMPTES = () => process.env.BOT_ACCOUNTS_FILE ?? './data/comptes-bot.json';
export const DOSSIER_COMPTES = () => process.env.BOT_ACCOUNTS_DIR ?? './data/msa-comptes';
const FICHIER_ANCIEN = () => process.env.BOT_ACCOUNT_FILE ?? './data/compte.json';

/** Identifiant d un compte : son pseudo en minuscules, sans le point Bedrock. */
export const idDe = (nom) => String(nom ?? '').trim().toLowerCase().replace(/^\./, '');

function ancienNom() {
  try { return JSON.parse(readFileSync(FICHIER_ANCIEN(), 'utf8')).nom || null; } catch { return null; }
}

/** Le compte du .env, tel qu il tournait avant le registre. */
function compteDuEnv() {
  const nom = ancienNom() || process.env.MC_LINK_ACCOUNT || null;
  return {
    id: nom ? idDe(nom) : 'principal',
    nom,
    cle: process.env.MC_EMAIL ?? '',
    dossier: process.env.MC_PROFILES_FOLDER ?? './data/msa-cache',
    ajouteA: null,
    ajoutePar: '.env',
  };
}

let cache = { mtime: -1, reg: null };

export function lireRegistre() {
  let mtime = 0;
  try { mtime = statSync(FICHIER_COMPTES()).mtimeMs; } catch { mtime = 0; }
  if (mtime && mtime === cache.mtime && cache.reg) return structuredClone(cache.reg);
  let reg = null;
  if (mtime) {
    try { reg = JSON.parse(readFileSync(FICHIER_COMPTES(), 'utf8')); } catch { reg = null; }
  }
  if (!reg?.comptes?.length) {
    const c = compteDuEnv();
    reg = { actif: c.id, comptes: [c] };
  }
  if (!reg.comptes.some((c) => c.id === reg.actif)) reg.actif = reg.comptes[0].id;
  cache = { mtime, reg };
  return structuredClone(reg);
}

export function ecrireRegistre(reg) {
  const f = FICHIER_COMPTES();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(reg, null, 2), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
  cache = { mtime: -1, reg: null };
}

export function compteActif(reg = lireRegistre()) {
  return reg.comptes.find((c) => c.id === reg.actif) ?? reg.comptes[0];
}

export function trouverCompte(id, reg = lireRegistre()) {
  return reg.comptes.find((c) => c.id === idDe(id)) ?? null;
}

/** Dossier de jetons d un nouveau compte. */
export const dossierPour = (id) => join(DOSSIER_COMPTES(), idDe(id));

/** Ajoute ou remplace (meme pseudo) un compte. Ne change PAS le compte actif. */
export function ajouterCompte({ nom, uuid = null, cle, dossier, par = null }) {
  const reg = lireRegistre();
  const id = idDe(nom);
  const entree = { id, nom, uuid, cle, dossier, ajouteA: Date.now(), ajoutePar: par };
  const i = reg.comptes.findIndex((c) => c.id === id);
  if (i >= 0) reg.comptes[i] = { ...reg.comptes[i], ...entree };
  else reg.comptes.push(entree);
  ecrireRegistre(reg);
  return entree;
}

/** Retire un compte. Refuse le compte actif : il faut d abord basculer. */
export function retirerCompte(id) {
  const reg = lireRegistre();
  const c = trouverCompte(id, reg);
  if (!c) throw new Error('compte inconnu');
  if (c.id === reg.actif) throw new Error('compte actif');
  reg.comptes = reg.comptes.filter((x) => x.id !== c.id);
  ecrireRegistre(reg);
  return c;
}

/** Fait d un compte le compte actif (celui que les joueurs paient). */
export function activerCompte(id) {
  const reg = lireRegistre();
  const c = trouverCompte(id, reg);
  if (!c) throw new Error('compte inconnu');
  reg.actif = c.id;
  ecrireRegistre(reg);
  return c;
}

/** Complete un compte (pseudo reel, uuid, dernier etat connu). */
export function majCompte(id, patch) {
  const reg = lireRegistre();
  const i = reg.comptes.findIndex((c) => c.id === idDe(id));
  if (i < 0) return null;
  const nouveau = { ...reg.comptes[i], ...patch };
  // Le pseudo reel peut differer de l id provisoire (« principal ») : l id suit.
  if (patch.nom && idDe(patch.nom) !== nouveau.id && !reg.comptes.some((c) => c.id === idDe(patch.nom))) {
    if (reg.actif === nouveau.id) reg.actif = idDe(patch.nom);
    nouveau.id = idDe(patch.nom);
  }
  reg.comptes[i] = nouveau;
  ecrireRegistre(reg);
  return nouveau;
}
