import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { db, store } from '../db.js';
import { balances } from './balances.js';
import { config } from '../config.js';
import { Tailer } from '../lib/tail.js';
import { normName } from '../lib/names.js';

// DonutSMP n a pas d API accessible : les soldes viennent du bot en jeu, qui
// lit /balance et depose ses reponses dans un flux. Ici on publie la liste des
// comptes a relever et on consomme ce flux.

/** Ecrit la liste des comptes verifies pour le bot en jeu. */
export async function publierSuivis() {
  const liens = db.prepare('SELECT mc_name FROM links ORDER BY mc_name').all();
  await mkdir(dirname(config.ingame.trackedFile), { recursive: true });
  await writeFile(
    config.ingame.trackedFile,
    JSON.stringify({ joueurs: liens.map((l) => ({ name: l.mc_name })), majA: Date.now() }, null, 2),
  );
  return liens.length;
}

const q = {
  ecrire: db.prepare(`
    UPDATE balances SET money = ?, updated_at = ?, erreurs = 0
    WHERE mc_name_norm = ?
  `),
};

/**
 * Lit le flux des soldes releves en jeu.
 * `onUpdate` sert au panneau public, comme pour l ancienne boucle API.
 */
// Consultations en attente d une reponse du jeu, par pseudo normalise.
const enAttente = new Map();

function resoudre(cle, valeur) {
  const liste = enAttente.get(cle);
  if (!liste) return;
  enAttente.delete(cle);
  for (const ok of liste) ok(valeur);
}

/**
 * Demande le solde d un joueur QUELCONQUE et attend la reponse du jeu.
 * Rend { money } , { inconnu: true } , ou null si le jeu n a pas repondu.
 */
export async function consulterSolde(nom, { timeoutMs = 15_000 } = {}) {
  const propre = String(nom ?? '').trim();
  if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(propre)) return { invalide: true };

  const cle = normName(propre);
  const attente = new Promise((resolve) => {
    if (!enAttente.has(cle)) enAttente.set(cle, []);
    enAttente.get(cle).push(resolve);
    setTimeout(() => resolve(null), timeoutMs);
  });

  await demanderSolde(propre);
  return attente;
}

export function surveillerSoldes({ onUpdate = () => {} } = {}) {
  const tailer = new Tailer({
    file: config.ingame.balanceFile,
    key: 'balances.offset',
    pollMs: config.payments.pollMs,
    onLine: (entree) => {
      const nom = typeof entree === 'object' ? entree.name : null;
      if (typeof nom !== 'string') return;
      const cle = normName(nom);

      if (entree.inconnu) {
        resoudre(cle, { inconnu: true });
        return;
      }

      const montant = Number(entree.money);
      if (!Number.isFinite(montant) || montant < 0) return;
      resoudre(cle, { money: montant });
      // Seuls les comptes encore lies entrent dans le classement : une
      // consultation ponctuelle ne doit pas peupler le baltop.
      const lien = store.getLinkByName(cle);
      if (!lien) return;

      balances.suivre(lien);
      const res = q.ecrire.run(Math.round(montant), Date.now(), cle);
      if (res.changes > 0) onUpdate(lien, montant);
    },
  });

  tailer.start().catch((e) => console.error('[solde] flux illisible :', e.message));
  return tailer;
}

/** Demande au bot en jeu de relever ce compte en priorite. */
export async function demanderSolde(nom) {
  const propre = String(nom ?? '').trim();
  if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(propre)) return false;
  await mkdir(dirname(config.ingame.priorityFile), { recursive: true });
  await appendFile(config.ingame.priorityFile, propre + '\n');
  return true;
}

/**
 * Attend qu un solde frais arrive pour ce compte. Rend le montant, ou null si
 * rien n arrive a temps : on ne bloque jamais une confirmation pour ca.
 */
export async function attendreSolde(nom, { timeoutMs = 8000, pasMs = 400 } = {}) {
  const cle = normName(nom);
  const depart = Date.now();
  const avant = db.prepare('SELECT updated_at FROM balances WHERE mc_name_norm = ?').get(cle)?.updated_at ?? 0;

  while (Date.now() - depart < timeoutMs) {
    await new Promise((r) => setTimeout(r, pasMs));
    const row = db.prepare('SELECT money, updated_at FROM balances WHERE mc_name_norm = ?').get(cle);
    if (row && row.updated_at > avant && row.updated_at > 0) return row.money;
  }
  return null;
}
