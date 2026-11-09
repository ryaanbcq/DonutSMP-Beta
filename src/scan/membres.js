import { config } from '../config.js';
import { db } from '../db.js';
import { estParti } from '../lib/membres.js';

// Envoie a DonutScan la liste des pseudos Minecraft lies sur le Discord : badge « Membre DonutSMP FR »
// sur la fiche joueur du site, qui renvoie vers le profil Discord du membre.
async function pousser() {
  if (!config.donutscan.apiKey) return;
  // Les comptes lies dont la personne a quitte le serveur ne gardent pas le badge.
  const membres = db.prepare('SELECT discord_id, mc_name FROM links').all().filter((r) => !estParti(r.discord_id)).map((r) => ({ mc: r.mc_name, discord: r.discord_id }));
  const res = await fetch(`${config.donutscan.base}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.donutscan.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ members: membres }),
    signal: AbortSignal.timeout(20_000),
  });
  // 403 = la cle de ce bot n'a pas le droit Partenaire (bot BETA) : la liste est tenue par le bot de prod.
  if (res.status === 403) { refuse = true; return undefined; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return membres.length;
}
let refuse = false;

/** Envoi immediat (apres la creation d'une cle API : son proprietaire doit etre connu de DonutScan). */
export async function pousserMaintenant() {
  if (refuse) return undefined;
  return pousser();
}

let dernier = '';
export function demarrerSyncMembres() {
  const tour = async () => {
    try {
      const n = await pousser();
      if (n !== undefined && String(n) !== dernier) { dernier = String(n); console.log(`[scan] ${n} membre(s) lie(s) envoye(s) a DonutScan`); }
      if (refuse && dernier !== 'refuse') { dernier = 'refuse'; console.log('[scan] liste des membres non envoyee : la cle DonutScan de ce bot n a pas le droit Partenaire (normal sur BETA)'); }
    } catch (e) { console.warn('[scan] sync membres :', e.message); }
  };
  setTimeout(tour, 30_000).unref(); // laisse le suivi des membres charger la liste des partis
  setInterval(tour, 10 * 60_000).unref();
}
