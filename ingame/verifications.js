// Le bot en jeu doit-il rendre ce paiement ?
//
// Seuls les paiements de VERIFICATION se remboursent : le joueur avait lance
// un /link (bon montant ou erreur de frappe). Avant, tout paiement de 1 a 1000
// etait rendu : n importe qui pouvait vider le plafond du jour a cout nul
// (200 x 1000, tous rendus) et bloquer les vrais remboursements, et les bots de
// gambling qui envoient 1 $ recevaient une « mise » en retour.
//
// La base est celle du bot Discord, ouverte en LECTURE SEULE : ce process n y
// ecrit jamais. Le challenge est cree avant le paiement, donc la reponse ne
// depend pas de la vitesse du bot Discord.

import { DatabaseSync } from 'node:sqlite';

const AVANT_MS = 24 * 3_600_000; // challenge ouvert au plus 24 h avant
const APRES_MS = 60_000; // tolerance d horloge entre les deux process
export const MAX_PAR_JOUR = 3;

const norm = (n) => String(n ?? '').trim().toLowerCase().replace(/^\./, '');

/**
 * Rend { ok: true } ou { ok: false, raison }.
 * `compteDuJour` : remboursements deja accordes a ce joueur aujourd hui,
 * celui-ci compris.
 */
export function creerVerificateur(chemin) {
  let db = null;
  const ouvrir = () => {
    db ??= new DatabaseSync(chemin, { readOnly: true });
    return db;
  };

  return {
    rembourser({ to, receivedAt }, compteDuJour) {
      let trouve;
      try {
        trouve = ouvrir().prepare(
          'SELECT 1 FROM challenges WHERE mc_name_norm = ? AND created_at BETWEEN ? AND ? LIMIT 1',
        ).get(norm(to), receivedAt - AVANT_MS, receivedAt + APRES_MS);
      } catch (e) {
        // Base illisible : dans le doute, rien ne sort.
        db = null;
        return { ok: false, raison: `base illisible (${e.message})` };
      }
      if (!trouve) return { ok: false, raison: 'aucun /link à ce nom' };
      if (compteDuJour > MAX_PAR_JOUR) {
        return { ok: false, raison: `plus de ${MAX_PAR_JOUR} remboursements aujourd'hui` };
      }
      return { ok: true };
    },
    fermer() { try { db?.close(); } catch { /* deja fermee */ } db = null; },
  };
}
