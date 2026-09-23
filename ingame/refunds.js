// Registre des remboursements. Le micro-paiement n est qu une preuve : le bot
// le rend au joueur une a deux minutes plus tard.
//
// C est le SEUL endroit du projet ou de l argent sort. Les regles sont donc
// strictes et persistees, pour qu un redemarrage ne rembourse ni deux fois ni
// zero fois :
//   - un remboursement par paiement recu, identifie et fige sur le disque ;
//   - jamais plus que la somme recue, jamais hors de la fourchette de link ;
//   - un seul /pay en vol, confirmation exigee avant le suivant ;
//   - plafond journalier, au dela on arrete et on loggue.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

export const PENDING = 'pending';
export const SENT = 'sent';
export const PAID = 'paid';
export const FAILED = 'failed';
export const SKIPPED = 'skipped';
// Un /pay est peut-etre parti mais sa confirmation n a jamais ete vue (arret
// ou deconnexion entre les deux) : on ne sait pas, donc on ne renvoie JAMAIS
// tout seul. Le staff tranche (journal « Remboursement incertain »).
export const DOUTE = 'doute';
// Paiement qui ne vient d aucune verification : rien ne part.
export const RETENU = 'retenu';

// Statuts dont l argent est peut-etre deja sorti ou va sortir : comptes dans
// le plafond du jour. Avant, seuls PAID et SENT comptaient, et dix paiements
// recus avant le premier envoi passaient tous sous le plafond.
const COMPTE_DANS_LE_PLAFOND = new Set([PENDING, SENT, PAID, DOUTE]);

export function idOf(to, amount, receivedAt) {
  return createHash('sha1').update(`${to}|${amount}|${receivedAt}`).digest('hex').slice(0, 16);
}

// Jour calendaire a Paris, comme les quotas du casino.
export function dayKey(ts = Date.now()) {
  return new Date(ts).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

export class RefundLedger {
  constructor({ file, min = 1, max = 1000, dailyMax = 200_000, delayMin = 60_000, delayMax = 120_000, random = Math.random } = {}) {
    this.file = file;
    this.min = min;
    this.max = max;
    this.dailyMax = dailyMax;
    this.delayMin = delayMin;
    this.delayMax = delayMax;
    this.random = random;
    this.entries = new Map();
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      for (const [id, e] of Object.entries(raw.entries ?? {})) this.entries.set(id, e);
    } catch { /* premier demarrage */ }
    // Un /pay parti sans confirmation avant l arret : le repasser en attente
    // le RENVOYAIT aussitot (echeance deja passee), d ou un double
    // remboursement a chaque redemarrage dans la fenetre. Il passe en doute.
    this.doutesAuChargement = [];
    for (const e of this.entries.values()) {
      if (e.status === SENT) {
        e.status = DOUTE;
        e.douteAt = Date.now();
        this.doutesAuChargement.push(e);
      }
    }
    return this;
  }

  async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const entries = Object.fromEntries(this.entries);
    await writeFile(this.file, JSON.stringify({ entries, savedAt: Date.now() }, null, 2));
  }

  totalForDay(day = dayKey()) {
    let total = 0;
    for (const e of this.entries.values()) {
      if (e.day === day && COMPTE_DANS_LE_PLAFOND.has(e.status)) total += e.amount;
    }
    return total;
  }

  /**
   * Met un paiement recu en file de remboursement.
   * Rend l entree, ou null avec une raison si on ne rembourse pas.
   */
  queue(payment, now = Date.now()) {
    const amount = Number(payment.amount);
    const to = String(payment.from ?? '').trim();

    if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(to)) return { skipped: 'pseudo invalide' };
    if (!Number.isInteger(amount) || amount < this.min) return { skipped: 'sous le minimum' };
    // Au dessus de la fourchette de link, on ne rend RIEN automatiquement :
    // un gros virement est traite a la main, jamais par une boucle.
    if (amount > this.max) return { skipped: `au dessus du plafond (${this.max})` };

    const id = idOf(to, amount, payment.receivedAt ?? now);
    if (this.entries.has(id)) return { skipped: 'deja en file' };

    const day = dayKey(now);
    if (this.totalForDay(day) + amount > this.dailyMax) return { skipped: 'plafond journalier atteint' };

    const delay = this.delayMin + Math.floor(this.random() * (this.delayMax - this.delayMin + 1));
    const entry = {
      id, to, amount, day,
      receivedAt: payment.receivedAt ?? now,
      dueAt: now + delay,
      status: PENDING,
      attempts: 0,
    };
    this.entries.set(id, entry);
    return { entry };
  }

  due(now = Date.now()) {
    for (const e of this.entries.values()) {
      if (e.status === PENDING && e.dueAt <= now) return e;
    }
    return null;
  }

  inFlight() {
    for (const e of this.entries.values()) if (e.status === SENT) return e;
    return null;
  }

  markSent(id, now = Date.now()) {
    const e = this.entries.get(id);
    if (!e) return null;
    e.status = SENT;
    e.attempts += 1;
    e.sentAt = now;
    return e;
  }

  markPaid(id, now = Date.now()) {
    const e = this.entries.get(id);
    if (!e) return null;
    e.status = PAID;
    e.paidAt = now;
    return e;
  }

  /** Le /pay a ete refuse par le delai entre commandes : pas un vrai essai. */
  annulerEnvoi(id, now = Date.now()) {
    const e = this.entries.get(id);
    if (!e || e.status !== SENT) return null;
    e.status = PENDING;
    e.attempts = Math.max(0, e.attempts - 1);
    e.dueAt = now + 2_000;
    return e;
  }

  /** On ne sait pas si le /pay est parti : plus aucun envoi automatique. */
  mettreEnDoute(id, now = Date.now()) {
    const e = this.entries.get(id);
    if (!e) return null;
    e.status = DOUTE;
    e.douteAt = now;
    return e;
  }

  /** Paiement qui ne sera pas rendu automatiquement (hors verification). */
  retenir(id, raison, now = Date.now()) {
    const e = this.entries.get(id);
    if (!e) return null;
    e.status = RETENU;
    e.raison = raison;
    e.retenuAt = now;
    return e;
  }

  /** Remboursements deja accordes a ce joueur aujourd hui (tous statuts sortants). */
  compteDuJour(to, day = dayKey()) {
    const norm = String(to).toLowerCase().replace(/^\./, '');
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.day !== day || !COMPTE_DANS_LE_PLAFOND.has(e.status)) continue;
      if (e.to.toLowerCase().replace(/^\./, '') === norm) n += 1;
    }
    return n;
  }

  /** Renvoie en attente, ou abandonne definitivement apres `maxAttempts`. */
  retryOrFail(id, maxAttempts = 3, now = Date.now()) {
    const e = this.entries.get(id);
    if (!e) return null;
    if (e.attempts >= maxAttempts) {
      e.status = FAILED;
      e.failedAt = now;
    } else {
      e.status = PENDING;
      e.dueAt = now + 30_000;
    }
    return e;
  }

  /** Retrouve l entree en vol correspondant a une confirmation de paiement. */
  matchConfirmation(to, amount) {
    const norm = String(to).toLowerCase().replace(/^\./, '');
    for (const e of this.entries.values()) {
      if (e.status !== SENT) continue;
      if (e.amount !== amount) continue;
      if (e.to.toLowerCase().replace(/^\./, '') !== norm) continue;
      return e;
    }
    return null;
  }

  stats() {
    let pending = 0, sent = 0, paid = 0, failed = 0, doute = 0, retenu = 0;
    for (const e of this.entries.values()) {
      if (e.status === PENDING) pending++;
      else if (e.status === SENT) sent++;
      else if (e.status === PAID) paid++;
      else if (e.status === FAILED) failed++;
      else if (e.status === DOUTE) doute++;
      else if (e.status === RETENU) retenu++;
    }
    return { pending, sent, paid, failed, doute, retenu, today: this.totalForDay() };
  }
}
