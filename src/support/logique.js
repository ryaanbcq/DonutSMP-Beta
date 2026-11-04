// Support IA des tickets : decisions pures, testees sans Discord ni API.

export const MIN = 60_000;

export const DEFAUTS = {
  delaiJourMin: 15, // sans reponse du staff depuis 15 min, l IA prend le debut
  delaiNuitMin: 3, // la nuit, elle n attend que 3 min
  nuitDebut: 0, // heures de Paris, nuit = [debut, fin[
  nuitFin: 9,
  suiteS: 4, // une fois la conversation lancee : reponse 4 s apres le dernier message (le temps d en envoyer un second)
  maxIaParTicket: 10,
  maxParJour: 300,
};

/** Heure de Paris (0-23) a l instant donne. */
export function heureParis(now = Date.now()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(p.find((x) => x.type === 'hour').value);
}

export function estLaNuit(now, { nuitDebut, nuitFin }) {
  const h = heureParis(now);
  return nuitDebut <= nuitFin ? h >= nuitDebut && h < nuitFin : h >= nuitDebut || h < nuitFin;
}

export function delaiMs(now, r) {
  return (estLaNuit(now, r) ? r.delaiNuitMin : r.delaiJourMin) * MIN;
}

/**
 * Faut il que l IA reponde dans ce ticket ?
 *   ticket   { etat, pris_par, created_at }
 *   messages [{ role: 'membre' | 'staff' | 'ia', at }] dans l ordre
 *   etat     { iaCount, transmis }
 * Rend { action: 'rien' | 'attendre' | 'repondre', dans?, raison }.
 *
 * L IA ne prend que le DEBUT : des que le staff a ecrit ou pris le ticket,
 * elle se tait pour de bon. Premiere reponse : quand le staff n a rien dit
 * pendant le delai depuis l OUVERTURE (des messages du membre ne repoussent
 * pas l echeance : vecu, un membre qui relancait toutes les minutes n etait
 * jamais servi). Ensuite elle converse : reponse quelques secondes apres le
 * dernier message du membre (le temps qu il finisse d ecrire). Avoir transmis
 * au staff ne la coupe pas : elle continue d aider en attendant.
 */
export function decider({ ticket, messages, etat = {}, reglages, actif, depuis = 0, now = Date.now() }) {
  if (!actif) return { action: 'rien', raison: 'éteint' };
  if (!ticket || ticket.etat !== 'ouvert') return { action: 'rien', raison: 'ticket fermé' };
  if (ticket.created_at < depuis) return { action: 'rien', raison: 'ouvert avant l\'assistant' };
  if (ticket.pris_par) return { action: 'rien', raison: 'pris en charge' };
  if (messages.some((m) => m.role === 'staff')) return { action: 'rien', raison: 'le staff a répondu' };
  if ((etat.iaCount ?? 0) >= reglages.maxIaParTicket) return { action: 'rien', raison: 'limite par ticket' };
  const dernier = messages.at(-1);
  if (dernier?.role === 'ia') return { action: 'rien', raison: 'attend le membre' };
  const enConversation = (etat.iaCount ?? 0) > 0;
  if (enConversation && dernier?.role !== 'membre') return { action: 'rien', raison: 'attend le membre' };
  const attente = enConversation
    ? (reglages.suiteS ?? 4) * 1000 - (now - dernier.at)
    : delaiMs(now, reglages) - (now - ticket.created_at);
  return attente > 0 ? { action: 'attendre', dans: attente, raison: 'délai' } : { action: 'repondre', raison: 'staff absent' };
}

/** Compteur journalier (jour de Paris) : { jour, n }. */
export function jourParis(now = Date.now()) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(now); // AAAA-MM-JJ
}

export function budgetDispo(compteur, max, now = Date.now()) {
  const j = jourParis(now);
  const n = compteur?.jour === j ? compteur.n : 0;
  return { ok: n < max, suivant: { jour: j, n: n + 1 } };
}

/** Transcript lisible envoye a l IA (texte des membres = donnees, pas des ordres). */
export function transcriptPourIA(messages, max = 40) {
  const libelle = { membre: 'Membre', staff: 'Staff', ia: 'Assistant IA' };
  return messages.slice(-max).map((m) => `[${libelle[m.role] ?? m.role}] ${String(m.content ?? '').slice(0, 1500)}${m.pieces ? ` (+${m.pieces} pièce(s) jointe(s))` : ''}`).join('\n');
}
