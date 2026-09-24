// Le compte en jeu qui encaisse (/pay pour se lier, pour donner). Apres un
// « Changer de compte » depuis /setup general, le bot en jeu retient le
// nouveau pseudo dans data/compte.json : il bat MC_LINK_ACCOUNT du .env.

import { readFileSync, statSync } from 'node:fs';
import { config } from '../config.js';

const FICHIER = process.env.BOT_ACCOUNT_FILE ?? './data/compte.json';
let cache = { mtime: -1, etat: {} };

function lire() {
  let mtime = 0;
  try { mtime = statSync(FICHIER).mtimeMs; } catch { return {}; }
  if (mtime !== cache.mtime) {
    try { cache = { mtime, etat: JSON.parse(readFileSync(FICHIER, 'utf8')) }; } catch { cache = { mtime, etat: {} }; }
  }
  return cache.etat;
}

/** Pseudo du compte receveur. */
export const compteBot = () => lire().nom || config.mc.linkAccount;

/** Vrai quand un changement de compte attend la connexion du nouveau compte. */
export const changementEnCours = () => Boolean(lire().changement);
