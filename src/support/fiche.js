// Fiche du membre pour l assistant : ce que le BOT sait deja de lui (compte
// lie, demandes de liaison, paiements recus, remboursements, etat du bot en
// jeu). Sans elle l assistant redemandait au membre des infos que le bot
// avait sous la main (Ryan : « ca sert a rien »). Faits seulement, lus en
// base et dans data/refunds.json ; seuls les pseudos lies a CE membre
// (compte lie et ses demandes) sont regardes.

import { readFileSync } from 'node:fs';
import { db, store } from '../db.js';
import { presence } from '../ingame/presence.js';
import { compteBot } from '../ingame/compte.js';

const q = {
  demandes: db.prepare('SELECT * FROM challenges WHERE discord_id = ? ORDER BY created_at DESC LIMIT 5'),
  paiements: db.prepare('SELECT * FROM payments WHERE from_norm = ? AND seen_at >= ? ORDER BY seen_at DESC LIMIT 5'),
};

const quand = (ms) => new Date(ms).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const norm = (n) => String(n ?? '').toLowerCase().replace(/^\./, '');

const DEMANDE = { pending: 'en cours', confirmed: 'réussie, compte lié', expired: 'expirée sans paiement reçu', cancelled: 'annulée (remplacée par une nouvelle)', conflict: 'refusée, ce pseudo était déjà lié à un autre Discord' };
const PAIEMENT = {
  linked: 'a servi à lier le compte',
  unmatched: 'ne correspondait à aucune demande en cours (mauvais montant, demande expirée ou pas de demande)',
  mauvais_compte: 'envoyé depuis un autre compte que celui demandé (Java au lieu de Bedrock ou inversement)',
  conflict: 'ce pseudo était déjà lié à un autre Discord',
  donation: 'compté comme un don',
};
const REMBOURSEMENT = {
  pending: 'prévu, pas encore envoyé', sent: 'envoyé, confirmation attendue', paid: 'rendu',
  failed: 'en échec, à voir par le staff', skipped: 'abandonné par le staff', doute: 'incertain, à voir par le staff',
};

function remboursements(noms, refundFile) {
  try {
    const j = JSON.parse(readFileSync(refundFile, 'utf8'));
    const l = Array.isArray(j) ? j : Object.values(j.entries ?? {});
    return l.filter((e) => noms.has(norm(e.to))).sort((a, b) => (b.receivedAt ?? 0) - (a.receivedAt ?? 0)).slice(0, 5);
  } catch { return []; }
}

export async function ficheMembre(discordId, { now = Date.now(), refundFile = process.env.REFUND_FILE ?? './data/refunds.json' } = {}) {
  const lignes = [];
  const lien = store.getLink(discordId);
  lignes.push(lien
    ? `Compte lié : ${lien.mc_name} (depuis le ${quand(lien.linked_at)}).`
    : 'Compte lié : aucun.');

  const demandes = q.demandes.all(String(discordId));
  if (demandes.length) {
    lignes.push('Demandes de liaison récentes :');
    for (const c of demandes) {
      const statut = c.status === 'pending' && c.expires_at < now ? 'expired' : c.status;
      lignes.push(`- ${quand(c.created_at)} : pseudo ${c.mc_name}, montant demandé ${c.amount} $, ${DEMANDE[statut] ?? statut}`
        + `${statut === 'pending' ? `, expire à ${quand(c.expires_at)}` : ''}.`);
    }
  } else {
    lignes.push('Demandes de liaison : aucune (le membre n\'a jamais cliqué sur Se connecter, ou c\'est très ancien).');
  }

  const noms = new Set([lien?.mc_name, ...demandes.map((c) => c.mc_name)].filter(Boolean).map(norm));
  const payes = [...noms].flatMap((n) => q.paiements.all(n, now - 14 * 86_400_000)).sort((a, b) => b.seen_at - a.seen_at).slice(0, 5);
  lignes.push(payes.length ? 'Paiements reçus par le bot depuis ces pseudos (14 derniers jours) :' : `Paiements reçus par le bot depuis ces pseudos (14 derniers jours) : aucun. Le bot voit les /pay envoyés à ${compteBot()} quand il est connecté.`);
  for (const p of payes) lignes.push(`- ${quand(p.seen_at)} : ${p.amount} $ de ${p.from_name}, ${PAIEMENT[p.outcome] ?? p.outcome}.`);

  const rembs = remboursements(noms, refundFile);
  for (const e of rembs) lignes.push(`Remboursement de ${e.amount} $ à ${e.to} (reçu le ${quand(e.receivedAt)}) : ${REMBOURSEMENT[e.status] ?? e.status}.`);

  const p = await presence().catch(() => ({ enLigne: false }));
  lignes.push(`Bot en jeu (${compteBot()}) : ${p.enLigne ? 'connecté, les liaisons et remboursements fonctionnent' : 'HORS LIGNE en ce moment, les /pay ne sont pas vus et les liaisons attendent'}.`);
  return lignes.join('\n');
}
