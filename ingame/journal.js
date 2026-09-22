// Journal du bot en jeu vers Discord.
//
// Ce process n a pas de client Discord : il ecrit une ligne par evenement, le
// bot Discord lit le fichier par offset (meme mecanique que les paiements) et
// poste l embed. Ecrire dans un fichier ne peut ni bloquer le bot ni le faire
// tomber si Discord est injoignable.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const FICHIER = process.env.EVENTS_FILE ?? './data/events.jsonl';

/**
 * niveau : ok | info | warn | err
 * Jamais de secret ici : la ligne finit dans un salon Discord.
 */
export function note(niveau, titre, texte, champs = null) {
  const ligne = JSON.stringify({
    at: Date.now(), source: 'jeu', niveau, titre, texte, champs,
  });
  mkdir(dirname(FICHIER), { recursive: true })
    .then(() => appendFile(FICHIER, `${ligne}\n`))
    .catch((e) => console.error('[journal] ecriture impossible :', e.message));
}
