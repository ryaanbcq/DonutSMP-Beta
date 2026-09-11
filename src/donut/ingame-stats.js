import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { Tailer } from '../lib/tail.js';
import { normName } from '../lib/names.js';

// Fiches /stats relevees en jeu. DonutSMP y repond par un dialogue vanilla que
// le bot en jeu lit et depose dans un flux, comme pour les soldes.

const enAttente = new Map();

function resoudre(cle, valeur) {
  const liste = enAttente.get(cle);
  if (!liste) return;
  enAttente.delete(cle);
  for (const ok of liste) ok(valeur);
}

export async function demanderStats(nom) {
  const propre = String(nom ?? '').trim();
  if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(propre)) return false;
  await mkdir(dirname(config.ingame.statsRequestFile), { recursive: true });
  await appendFile(config.ingame.statsRequestFile, propre + '\n');
  return true;
}

/**
 * Rend { nom, lignes } , { inconnu: true } , { invalide: true } , ou null si le
 * jeu n a pas repondu a temps.
 */
export async function consulterStats(nom, { timeoutMs = 30_000 } = {}) {
  const propre = String(nom ?? '').trim();
  if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(propre)) return { invalide: true };

  const cle = normName(propre);
  const attente = new Promise((resolve) => {
    if (!enAttente.has(cle)) enAttente.set(cle, []);
    enAttente.get(cle).push(resolve);
    setTimeout(() => resolve(null), timeoutMs);
  });

  await demanderStats(propre);
  return attente;
}

export function surveillerStats() {
  const tailer = new Tailer({
    file: config.ingame.statsFile,
    key: 'stats.offset',
    pollMs: config.payments.pollMs,
    onLine: (entree) => {
      const nom = typeof entree === 'object' ? entree.name : null;
      if (typeof nom !== 'string') return;
      const cle = normName(nom);
      if (entree.inconnu) return resoudre(cle, { inconnu: true });
      if (entree.lignes && typeof entree.lignes === 'object') {
        resoudre(cle, { nom, lignes: entree.lignes });
      }
    },
  });
  tailer.start().catch((e) => console.error('[stats] flux illisible :', e.message));
  return tailer;
}
