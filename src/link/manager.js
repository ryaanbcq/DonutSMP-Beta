import { randomInt } from 'node:crypto';
import { store } from '../db.js';
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
    throw new LinkError('saturated', 'Toutes les sommes de vérification sont prises, réessaie dans quelques minutes.');
  }
  for (let i = 0; i < 64; i++) {
    const n = randomInt(min, max + 1);
    if (!taken.has(n)) return n;
  }
  // Tirage sature localement : on prend le premier libre.
  for (let n = min; n <= max; n++) if (!taken.has(n)) return n;
  throw new LinkError('saturated', 'Toutes les sommes de vérification sont prises, réessaie dans quelques minutes.');
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
    throw new LinkError('already_linked', `Ton Discord est déjà lié à **${existing.mc_name}**. Fais \`/unlink\` d'abord.`);
  }

  const taken = store.getLinkByName(name);
  if (taken) {
    throw new LinkError('name_taken', `Le compte **${name}** est déjà lié à un autre membre. Ouvre un ticket si c'est le tien.`);
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

  // Le pseudo a pu etre lie entre l'ouverture du challenge et le paiement.
  if (store.getLinkByName(payment.from) || store.getLink(challenge.discord_id)) {
    store.closeChallenge(challenge.id, 'conflict');
    store.recordPayment(payment, 'conflict', challenge.id);
    return { outcome: 'conflict', payment, challenge };
  }

  store.createLink(challenge.discord_id, challenge.mc_name, payment.amount);
  store.closeChallenge(challenge.id, 'confirmed');
  store.recordPayment(payment, 'linked', challenge.id);
  return { outcome: 'linked', payment, challenge, discordId: challenge.discord_id };
}

export { normName };
