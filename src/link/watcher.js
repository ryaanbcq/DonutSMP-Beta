import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { Tailer } from '../lib/tail.js';
import { parsePayment } from '../minecraft/payments.js';
import { resolvePayment } from './manager.js';

const OFFSET_KEY = 'payments.offset';

/**
 * Convertit une entree du flux en paiement sur.
 * Le bot mineflayer peut poster soit la ligne de chat brute, soit un objet
 * deja decoupe. Quand la ligne brute est la, elle FAIT FOI : on la reparse
 * nous memes plutot que de faire confiance a des champs recopies.
 */
export function normalizeEntry(entry) {
  if (typeof entry === 'string') return parsePayment(entry);
  if (!entry || typeof entry !== 'object') return null;

  const raw = entry.raw ?? entry.line ?? entry.message;
  if (typeof raw === 'string') {
    const parsed = parsePayment(raw);
    // `reel` : pseudo exact lu par le bot en jeu dans la liste des joueurs
    // (garde le point Bedrock que le message de paiement a mange). Il ne vaut
    // que s il designe bien le meme nom que la ligne brute.
    const reel = typeof entry.reel === 'string' ? entry.reel.trim() : null;
    if (parsed && reel && /^\.?[A-Za-z0-9_]{1,24}$/.test(reel)
        && reel.toLowerCase().replace(/^\./, '') === parsed.from.toLowerCase().replace(/^\./, '')) {
      return { ...parsed, reel };
    }
    if (parsed) return parsed;
  }

  const from = entry.from ?? entry.player ?? entry.sender;
  const amount = Number(entry.amount);
  if (typeof from === 'string' && /^\.?[A-Za-z0-9_]{1,24}$/.test(from.trim())
      && Number.isFinite(amount) && amount > 0) {
    return { from: from.trim(), amount, raw: typeof raw === 'string' ? raw : null };
  }
  return null;
}

export class PaymentWatcher extends EventEmitter {
  constructor({ file = config.payments.file, pollMs = config.payments.pollMs } = {}) {
    super();
    this.tailer = new Tailer({
      file,
      key: OFFSET_KEY,
      pollMs,
      onLine: (entree) => {
        const payment = normalizeEntry(entree);
        if (!payment) return;
        const result = resolvePayment(payment);
        this.emit(result.outcome, result);
        this.emit('payment', result);
      },
    });
  }

  start() {
    return this.tailer.start();
  }

  stop() {
    this.tailer.stop();
  }
}
