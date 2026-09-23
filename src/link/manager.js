import { randomInt } from 'node:crypto';
import { store, cleOrpheline } from '../db.js';
import { config } from '../config.js';
import { normName, isValidName } from '../lib/names.js';

export class LinkError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Tire un montant libre dans [min, max]. Deux challenges en cours ne peuvent
 * jamais porter le meme montant : sinon deux joueurs qui paient la meme somme
 * rendent la verification ambigue.
 */
export function allocateAmount() {
  const { amountMin: min, amountMax: max } = config.link;
  const taken = store.takenAmounts();
  const span = max - min + 1;
  if (taken.size >= span) {
    throw new LinkError('saturated', 'Toutes les sommes de vérification sont prises, réessayez dans quelques minutes.');
  }
  for (let i = 0; i < 64; i++) {
    const n = randomInt(min, max + 1);
    if (!taken.has(n)) return n;
  }
  // Tirage sature localement : on prend le premier libre.
  for (let n = min; n <= max; n++) if (!taken.has(n)) return n;
  throw new LinkError('saturated', 'Toutes les sommes de vérification sont prises, réessayez dans quelques minutes.');
}

/**
 * Ouvre un challenge de verification pour un membre Discord.
 */
export function startLink(discordId, mcName) {
  store.expireStale();

  const name = String(mcName ?? '').trim();
  if (!isValidName(name)) {
    throw new LinkError('bad_name', 'Pseudo Minecraft invalide. Lettres, chiffres et underscore uniquement.');
  }

  const existing = store.getLink(discordId);
  if (existing) {
    throw new LinkError('already_linked', `Votre profil est déjà associé à **${existing.mc_name}**. Utilisez \`/unlink\` d'abord.`);
  }

  const taken = store.getLinkByName(name);
  if (taken) {
    throw new LinkError('name_taken', `Le compte **${name}** est déjà associé à un autre membre. Ouvrez un ticket si c'est le vôtre.`);
  }

  const pending = store.getPending(discordId);
  if (pending) {
    return { ...pending, amount: pending.amount, expiresAt: pending.expires_at, resumed: true };
  }

  const amount = allocateAmount();
  const ch = store.createChallenge(discordId, name, amount, config.link.ttlMs);
  return { ...ch, mc_name: name, resumed: false };
}

export function cancelLink(discordId) {
  const pending = store.getPending(discordId);
  if (!pending) return false;
  store.closeChallenge(pending.id, 'cancelled');
  return true;
}

/**
 * Confronte un paiement vu en jeu aux challenges en cours.
 * Rend { outcome, ... } ; outcome vaut 'linked', 'conflict' ou 'unmatched'.
 */
export function resolvePayment(payment) {
  store.expireStale();

  const challenge = store.findChallenge(payment.from, payment.amount);
  if (!challenge) {
    store.recordPayment(payment, 'unmatched');
    return { outcome: 'unmatched', payment };
  }

  // DonutSMP ecrit « Steve paid you » pour Steve (Java) comme pour .Steve
  // (Bedrock). Quand le bot en jeu a pu lire le vrai pseudo, on exige que ce
  // soit le compte demande : sinon un joueur Bedrock liait le compte Java du
  // meme nom (et inversement). Le challenge reste ouvert pour le bon compte.
  const estBedrock = (n) => String(n).trim().startsWith('.');
  if (payment.reel && estBedrock(payment.reel) !== estBedrock(challenge.mc_name)) {
    store.recordPayment(payment, 'mauvais_compte', challenge.id);
    return { outcome: 'unmatched', payment, raison: 'mauvais_compte', challenge };
  }
  const nomReel = payment.reel ?? payment.from;

  // Le pseudo a pu etre lie entre l'ouverture du challenge et le paiement.
  if (store.getLinkByName(nomReel) || store.getLink(challenge.discord_id)) {
    store.closeChallenge(challenge.id, 'conflict');
    store.recordPayment(payment, 'conflict', challenge.id);
    return { outcome: 'conflict', payment, challenge };
  }

  // Le message systeme de DonutSMP porte la casse officielle du pseudo :
  // elle bat celle tapee par le membre, qui peut etre en minuscules.
  // Reputation : elle suit le compte Minecraft. Ce que ce Discord portait pour
  // un ancien pseudo (delie avant ce mecanisme) retourne a cet ancien pseudo,
  // et le pseudo lie recupere la sienne, meme depuis un autre Discord.
  const ancien = store.getThread(challenge.discord_id);
  if (ancien && normName(ancien.mc_name) !== normName(nomReel)) {
    store.transfererReputation(challenge.discord_id, cleOrpheline(ancien.mc_name));
  }
  for (const cle of store.orphelinsDuPseudo(nomReel, challenge.discord_id)) {
    store.transfererReputation(cle, challenge.discord_id);
  }
  store.createLink(challenge.discord_id, nomReel, payment.amount);
  store.closeChallenge(challenge.id, 'confirmed');
  store.recordPayment(payment, 'linked', challenge.id);
  return {
    outcome: 'linked',
    payment,
    challenge: { ...challenge, mc_name: nomReel },
    discordId: challenge.discord_id,
  };
}

export { normName };
