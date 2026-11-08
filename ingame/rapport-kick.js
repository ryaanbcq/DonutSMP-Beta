// Compte rendu IA d un refus de connexion.
//
// Les regles de diagnostic.js reconnaissent les pannes deja vecues. Le jour
// ou DonutSMP change sa formulation (« placed on hold » au lieu de « banned »,
// vecu le 08/11/2026), elles ratent. Haiku lit alors le texte COMPLET du kick
// et dit au staff ce qui se passe, et surtout si c est un ban : dans ce cas
// l alerte ban part meme si aucune regle ne l a vu.
//
// Un appel par motif distinct (cache memoire) : une boucle de reconnexion sur
// le meme kick ne coute qu un appel.

import { appelJSON, iaDisponible } from '../src/support/ia.js';

const TYPES = ['ban', 'ban_temporaire', 'compte_bloque', 'session_fantome', 'maintenance', 'anticheat', 'expulsion_staff', 'version', 'reseau', 'autre'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'ban', 'gravite', 'resume', 'que_faire', 'fin'],
  properties: {
    type: { type: 'string', enum: TYPES },
    ban: { type: 'boolean', description: 'Vrai si le compte du bot ne peut plus entrer (ban, suspension, compte bloque ou mis en attente), meme temporairement.' },
    gravite: { type: 'string', enum: ['info', 'warn', 'err'] },
    resume: { type: 'string', description: 'Ce qui se passe, en 1 a 3 phrases, en francais simple.' },
    que_faire: { type: 'string', description: 'Ce que le staff doit faire, concretement, en 1 a 3 phrases.' },
    fin: { type: ['string', 'null'], description: 'Fin du ban si le texte la donne (date ou duree), sinon null.' },
  },
};

const SYSTEM = `Tu lis le message de refus qu'un serveur Minecraft (DonutSMP) a envoyé au bot en jeu de la communauté DonutSMP FR, et tu fais un compte rendu court pour le staff, en français.

Le bot en jeu sert à lier les comptes : les joueurs lui envoient un petit /pay, il le voit dans le chat et lie le compte, puis rembourse. S'il ne peut plus entrer, plus aucune liaison ne passe.

Règles :
- Lis TOUT le texte : un même message peut mélanger une ligne technique de proxy (« already online », « proxy request-join-cache ») et le vrai motif (« account placed on hold », « Ban ID »). Le vrai motif l'emporte.
- « ban » est vrai dès que le compte ne peut plus entrer à cause d'une sanction ou d'une mise en attente (ban, suspension, blocage, « on hold », Ban ID, appel possible), même temporaire.
- Donne l'identifiant de ban et le site ou Discord d'appel s'ils figurent dans le texte.
- Si un autre compte est enregistré, rappelle que « /bot auth switch » bascule dessus.
- Pas de tiret cadratin. Phrases courtes. N'invente rien qui n'est pas dans le texte.`;

const vus = new Map();

/**
 * diag : sortie de diagnostiquerKick. contexte : { compte, autresComptes, avantSpawn }.
 * Rend { type, ban, gravite, resume, que_faire, fin } ou null (pas de cle, echec).
 */
export async function rapportKick(diag, contexte = {}, { appeler = appelJSON, dispo = iaDisponible } = {}) {
  if (!dispo()) return null;
  const cle = diag.motif;
  if (vus.has(cle)) return vus.get(cle);
  const promesse = appeler({
    system: SYSTEM,
    schema: SCHEMA,
    maxTokens: 4000,
    contenu: [
      `Compte du bot : ${contexte.compte ?? 'inconnu'}`,
      `Autres comptes enregistrés : ${contexte.autresComptes?.length ? contexte.autresComptes.join(', ') : 'aucun'}`,
      `Refusé ${contexte.avantSpawn ? 'AVANT d\'entrer en jeu (connexion refusée)' : 'après être entré en jeu'}.`,
      `Classement automatique (règles) : ${diag.titre}`,
      '',
      'Texte complet du message du serveur :',
      '"""',
      diag.motif,
      '"""',
    ].join('\n'),
  }).catch((e) => {
    console.error('[rapport] compte rendu IA impossible :', e.message);
    vus.delete(cle); // on retentera au prochain kick
    return null;
  });
  vus.set(cle, promesse);
  return promesse;
}

/** Pour les tests. */
export function oublierRapports() { vus.clear(); }
