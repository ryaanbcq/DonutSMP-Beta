// Journal du bot en jeu vers Discord.
//
// Ce process n a pas de client Discord : il ecrit une ligne par evenement, le
// bot Discord lit le fichier par offset (meme mecanique que les paiements) et
// poste l embed. Ecrire dans un fichier ne peut ni bloquer le bot ni le faire
// tomber si Discord est injoignable.

import { appendFile, appendFileSync, mkdir, mkdirSync, writeFile, rm } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const FICHIER = process.env.EVENTS_FILE ?? './data/events.jsonl';
// Le code Microsoft vit A PART, jamais dans le flux d evenements : ce flux
// finit dans un salon, et qui lit le code prend le compte. Le bot Discord ne
// le montre qu a un admin, en message ephemere, sur clic.
export const FICHIER_CODE_MSA = process.env.MSA_CODE_FILE ?? './data/msa-code.json';

const ajouter = promisify(appendFile);
const creerDossier = promisify(mkdir);
const ecrire = promisify(writeFile);
const supprimer = promisify(rm);

const ligne = (niveau, titre, texte, { champs = null, joueur = null, actions = null, canal = null } = {}) => JSON.stringify({
  at: Date.now(), source: 'jeu', niveau, titre, texte, champs, joueur, actions, ...(canal ? { canal } : {}),
});

/**
 * niveau  : ok | info | warn | err
 * champs  : paires affichees en colonnes (montant, delai...), hors cle de doublon
 * joueur  : pseudo dont la tete sert de vignette
 * actions : boutons a poser sous l embed (ex. ['msa'])
 * Jamais de secret ici : la ligne finit dans un salon Discord.
 */
// Une seule ecriture a la fois, dans l ordre des appels : lancees en
// parallele, deux notes rapprochees (kick puis deconnexion) s inversaient
// dans le fichier, et donc dans le salon (vu a la demo du 2026-09-23).
let file = Promise.resolve();

export function note(niveau, titre, texte, options = {}) {
  const l = ligne(niveau, titre, texte, options);
  file = file
    .then(() => creerDossier(dirname(FICHIER), { recursive: true }))
    .then(() => ajouter(FICHIER, `${l}\n`))
    .catch((e) => console.error('[journal] ecriture impossible :', e.message));
  return file;
}

/** Variante synchrone pour les derniers mots d un process qui va mourir. */
export function noteSync(niveau, titre, texte, options = {}) {
  try {
    mkdirSync(dirname(FICHIER), { recursive: true });
    appendFileSync(FICHIER, `${ligne(niveau, titre, texte, options)}\n`);
  } catch (e) {
    console.error('[journal] ecriture impossible :', e.message);
  }
}

/** Depose le code Microsoft en attente, lisible par le seul proprietaire. */
export async function deposerCodeMsa(res) {
  const expireA = Date.now() + (Number(res.expires_in) || 900) * 1000;
  await creerDossier(dirname(FICHIER_CODE_MSA), { recursive: true });
  await ecrire(FICHIER_CODE_MSA, JSON.stringify({
    code: res.user_code,
    url: res.verification_uri,
    expireA,
    a: Date.now(),
  }), { mode: 0o600 });
  return expireA;
}

export async function effacerCodeMsa() {
  await supprimer(FICHIER_CODE_MSA, { force: true });
}
