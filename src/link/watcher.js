import { EventEmitter } from 'node:events';
import { open, stat, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { store } from '../db.js';
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
    this.file = file;
    this.pollMs = pollMs;
    this.timer = null;
  }

  async start() {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, '');
    this.timer = setInterval(() => this.tick().catch((e) => this.emit('error', e)), this.pollMs);
    this.timer.unref?.();
    await this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const offset = Number(store.kvGet(OFFSET_KEY) ?? 0);
    let size;
    try {
      ({ size } = await stat(this.file));
    } catch {
      return;
    }
    // Fichier tronque ou tourne : on repart de zero.
    const from = size < offset ? 0 : offset;
    if (size === from) return;

    const fh = await open(this.file, 'r');
    let chunk;
    try {
      const len = size - from;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, from);
      chunk = buf.toString('utf8');
    } finally {
      await fh.close();
    }

    const lines = chunk.split('\n');
    // La derniere tranche peut etre une ligne encore en cours d ecriture. On ne
    // la garde PAS en memoire : on laisse l offset avant elle et on la relira
    // entiere au prochain tour. Ca la sauve aussi si le process redemarre au
    // milieu d une ecriture.
    const partial = lines.pop() ?? '';
    store.kvSet(OFFSET_KEY, size - Buffer.byteLength(partial, 'utf8'));

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        entry = trimmed;
      }
      const payment = normalizeEntry(entry);
      if (!payment) continue;
      const result = resolvePayment(payment);
      this.emit(result.outcome, result);
      this.emit('payment', result);
    }
  }
}
