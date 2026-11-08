import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

// Presence du bot en jeu, lue dans le fichier d etat qu il reecrit toutes les
// 20 secondes.
//
// Pourquoi c est vital : si le bot n est pas connecte quand un joueur paie,
// personne ne voit le paiement. Pas de lien, et pas de remboursement non plus
// puisque c est la ligne de chat qui le declenche. Le joueur perd son argent
// sans rien obtenir. On refuse donc d ouvrir une verification dans ce cas.

const PERIME_MS = 75_000; // trois battements manques

export async function presence() {
  let etat;
  try {
    etat = JSON.parse(await readFile(config.ingame.statusFile, 'utf8'));
  } catch {
    // Fichier absent : le bot n a jamais tourne, ou pas encore ecrit.
    return { enLigne: false, raison: 'jamais_demarre', age: null };
  }

  const age = Date.now() - Number(etat.at ?? 0);
  if (!etat.online) {
    // Le bot en jeu ecrit le diagnostic de son dernier kick : on rend la vraie
    // raison (« Compte du bot bloqué par DonutSMP », Ban ID…) plutot que
    // « deconnecte ».
    const k = etat.kick;
    if (k?.titre) {
      return {
        enLigne: false, raison: k.titre, motif: k.motif ?? null, banId: k.banId ?? null,
        bloquant: Boolean(k.bloquant), kickA: k.at ?? null, rapport: k.rapport ?? null, age, username: etat.username,
      };
    }
    return { enLigne: false, raison: 'deconnecte', age, username: etat.username };
  }
  if (age > PERIME_MS) return { enLigne: false, raison: 'muet', age, username: etat.username };

  return { enLigne: true, age, username: etat.username, pos: etat.pos ?? null };
}

export const PERIME = PERIME_MS;
