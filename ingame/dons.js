// Dons au bot, et reversement quotidien au beneficiaire.
//
// Tout /pay recu a partir de DONATION_MIN est un don : les montants de /link
// vont de 1 a 1000, les deux ne se confondent jamais. Le bot en jeu cumule ce
// qu il recoit et, une fois par jour, reverse le cumul au beneficiaire.
//
// C est de l argent qui sort, donc memes regles que les remboursements, en
// plus strict :
//   - on reverse le cumul des DONS vus, jamais le solde du compte (qui porte
//     aussi les remboursements a rendre) ;
//   - un seul reversement en vol, confirmation « You paid » exigee ;
//   - pas de confirmation = EN DOUTE, JAMAIS renvoye tout seul : le staff
//     verifie et tranche. Un gros /pay rejoue a l aveugle, c est payer deux fois ;
//   - le montant est arrondi a 3 chiffres significatifs vers le bas : DonutSMP
//     affiche « $12.3M » dans sa confirmation, un montant non arrondi ne se
//     reconnaitrait pas. Le reste part le lendemain ;
//   - un seul fichier, ecrit de facon atomique (tmp + rename) : un arret au
//     mauvais moment ne peut ni perdre le cumul ni le reverser deux fois.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { dayKey } from './refunds.js';

export const PENDING = 'pending';
export const SENT = 'sent';
export const PAID = 'paid';
export const DOUTE = 'doute';

/** 12 345 678 -> 12 300 000 : ce que DonutSMP affiche, au dollar pres. */
export function arrondiAffichable(n) {
  const v = Math.floor(Number(n) || 0);
  if (v < 1000) return v;
  const unite = 10 ** (Math.floor(Math.log10(v)) - 2);
  return Math.floor(v / unite) * unite;
}

const norm = (n) => String(n ?? '').toLowerCase().replace(/^\./, '');

/** Heure de Paris (0-23), pour l heure du reversement. */
export function heureParis(ts = Date.now()) {
  return Number(new Date(ts).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
}

export class Reversements {
  constructor({ file, min = 10_000, beneficiaire = '', heure = 0, plancher = 1000 } = {}) {
    this.file = file;
    this.min = min;
    this.beneficiaire = beneficiaire;
    this.heure = heure;
    this.plancher = plancher; // en dessous, on attend le lendemain
    this.etat = { cumul: 0, dernierJour: null, vus: [], versements: {} };
  }

  async load() {
    try {
      const brut = JSON.parse(await readFile(this.file, 'utf8'));
      this.etat = { ...this.etat, ...brut };
    } catch { /* premier demarrage */ }
    // Un reversement parti sans confirmation avant l arret : en doute.
    this.doutesAuChargement = [];
    for (const v of Object.values(this.etat.versements)) {
      if (v.status === SENT) {
        v.status = DOUTE;
        v.douteAt = Date.now();
        this.doutesAuChargement.push(v);
      }
    }
    return this;
  }

  async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.etat, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  estUnDon(amount) {
    return Number(amount) >= this.min;
  }

  /** Ajoute un don au cumul. Rend false si deja compte (meme ligne relue). */
  ajouterDon({ from, amount, at }) {
    const id = createHash('sha1').update(`${norm(from)}|${amount}|${at}`).digest('hex').slice(0, 16);
    if (this.etat.vus.includes(id)) return false;
    this.etat.vus.push(id);
    // Assez pour dedupliquer une relecture, sans grossir indefiniment.
    if (this.etat.vus.length > 500) this.etat.vus = this.etat.vus.slice(-500);
    this.etat.cumul += Math.floor(amount);
    return true;
  }

  enVol() {
    return Object.values(this.etat.versements).find((v) => v.status === SENT) ?? null;
  }

  aEnvoyer() {
    return Object.values(this.etat.versements).find((v) => v.status === PENDING) ?? null;
  }

  /**
   * Cree le reversement du jour quand l heure est passee. Le cumul quitte le
   * compteur au moment ou il entre dans un versement : les deux changent dans
   * la meme ecriture de fichier.
   */
  planifier(now = Date.now()) {
    if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(this.beneficiaire)) return null;
    const jour = dayKey(now);
    if (this.etat.dernierJour === jour || heureParis(now) < this.heure) return null;
    if (this.aEnvoyer() || this.enVol()) return null;
    this.etat.dernierJour = jour;
    const montant = arrondiAffichable(this.etat.cumul);
    if (montant < this.plancher) return null;
    const id = `${jour}-${montant}`;
    this.etat.cumul -= montant;
    this.etat.versements[id] = { id, to: this.beneficiaire, amount: montant, jour, status: PENDING, creeA: now };
    return this.etat.versements[id];
  }

  marquer(id, status, extra = {}) {
    const v = this.etat.versements[id];
    if (!v) return null;
    Object.assign(v, { status, ...extra });
    return v;
  }

  /** Le /pay a ete avale par le delai entre commandes : il n est pas parti. */
  annulerEnvoi(id) {
    const v = this.etat.versements[id];
    if (!v || v.status !== SENT) return null;
    v.status = PENDING;
    return v;
  }

  /**
   * Confirmation « You paid X $Y ». DonutSMP arrondit l affichage : on tolere
   * 1 % d ecart, le destinataire doit etre exact.
   */
  matchConfirmation(to, amount) {
    const v = this.enVol();
    if (!v || norm(v.to) !== norm(to)) return null;
    return Math.abs(v.amount - amount) <= v.amount * 0.01 ? v : null;
  }

  stats() {
    const vs = Object.values(this.etat.versements);
    return {
      cumul: this.etat.cumul,
      verse: vs.filter((v) => v.status === PAID).reduce((s, v) => s + v.amount, 0),
      doute: vs.filter((v) => v.status === DOUTE).length,
    };
  }
}
