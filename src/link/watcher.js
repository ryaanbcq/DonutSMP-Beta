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
    this.buffer = '';
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
    let offset = Number(store.kvGet(OFFSET_KEY) ?? 0);
    let size;
    try {
      ({ size } = await stat(this.file));
    } catch {
      return;
    }
    // Fichier tronque ou tourne : on repart de zero.
    if (size < offset) {
      offset = 0;
      this.buffer = '';
    }
    if (size === offset) return;

    const fh = await open(this.file, 'r');
    try {
      const len = size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      this.buffer += buf.toString('utf8');
    } finally {
      await fh.close();
    }

    const lines = this.buffer.split('\n');
    // La derniere tranche peut etre une ligne incomplete : on la garde.
    this.buffer = lines.pop() ?? '';
    const consumed = size - Buffer.byteLength(this.buffer, 'utf8');
    store.kvSet(OFFSET_KEY, consumed);

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
