// Fin des tickets, decision pure (testee) : un ticket ou c est au membre de
// repondre (le dernier message vient du staff ou du support) et qui reste
// muet 24 h recoit un avertissement ; 24 h de plus sans un mot de personne
// et il est supprime. Un ticket ou le membre a ecrit en dernier attend le
// staff : il n est jamais archive pour ca.

export const DELAI_INACTIF = 24 * 3_600_000;

/**
 * messages : [{ role: 'membre'|'staff'|'ia', at }] dans l ordre.
 * avertiAt : instant de l avertissement en cours, sinon null.
 * Rend 'rien' | 'avertir' | 'attendre' | 'annuler' | 'supprimer'.
 */
export function decisionInactivite({ messages, avertiAt = null, now = Date.now(), delai = DELAI_INACTIF }) {
  if (avertiAt) {
    if (messages.some((m) => (m.role === 'membre' || m.role === 'staff') && m.at > avertiAt)) return 'annuler';
    return now - avertiAt >= delai ? 'supprimer' : 'attendre';
  }
  const dernier = messages.at(-1);
  if (!dernier || dernier.role === 'membre') return 'rien';
  return now - dernier.at >= delai ? 'avertir' : 'rien';
}
