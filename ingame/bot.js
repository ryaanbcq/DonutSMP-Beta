// Bot en jeu du Discord FR : il se connecte a DonutSMP avec le compte receveur,
// et ecrit chaque paiement recu dans le flux que lit le bot Discord.
//
// Ce bot ne fait QUE recevoir. Aucune commande qui sort de l'argent n'est
// autorisee : il n'y a pas de chemin de code qui envoie /pay, et le garde
// `sendSafe` refuse la commande meme si quelqu'un l'ajoute par accident.

import mineflayer from 'mineflayer';
import { appendFile, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import 'dotenv/config';
import { parsePayment, parsePaymentSent, parseBalance } from '../src/minecraft/payments.js';
import { RefundLedger } from './refunds.js';

const cfg = {
  host: process.env.MC_HOST ?? 'donutsmp.net',
  port: Number(process.env.MC_PORT) || 25565,
  username: process.env.MC_EMAIL ?? '',
  auth: process.env.MC_AUTH ?? 'microsoft',
  version: process.env.MC_VERSION || false,
  // Meme dossier que scripts/auth.js : le bot reutilise le jeton deja obtenu
  // au lieu de relancer une connexion Microsoft a chaque demarrage.
  profilesFolder: process.env.MC_PROFILES_FOLDER ?? './data/msa-cache',
  feed: process.env.PAYMENT_FILE ?? './data/payments.jsonl',
  status: process.env.INGAME_STATUS ?? './data/ingame-status.json',
  expectedName: process.env.MC_LINK_ACCOUNT ?? '',
  soldes: {
    // DonutSMP n a pas d API accessible : les soldes se lisent en jeu avec
    // /balance <joueur>. Le serveur arrondit pour les autres joueurs.
    enabled: (process.env.BALANCE_POLL ?? 'true') !== 'false',
    suivis: process.env.TRACKED_FILE ?? './data/tracked.json',
    sortie: process.env.BALANCE_FILE ?? './data/balances.jsonl',
    // Demandes prioritaires : un compte tout juste verifie ne doit pas
    // attendre son tour de cycle pour apparaitre au classement.
    priorite: process.env.BALANCE_PRIORITY_FILE ?? './data/balance-priority.txt',
    // Espacement PLANCHER entre deux /balance. DonutSMP et Paper coupent le
    // spam de commandes : on reste tres en dessous.
    intervalMs: (Number(process.env.BALANCE_INTERVAL_S) || 5) * 1000,
    // Duree visee pour relever tout le monde une fois. L espacement reel est
    // le plus grand des deux : a 2 comptes on ne redemande pas toutes les
    // 10 s, a 500 on ne descend pas sous le plancher.
    cycleMs: (Number(process.env.BALANCE_CYCLE_MINUTES) || 15) * 60_000,
    // Au dela, le flux est remis a zero : le bot Discord a deja tout range
    // en base, et le lecteur repart proprement d un fichier tronque.
    tailleMaxOctets: (Number(process.env.BALANCE_FILE_MAX_MB) || 5) * 1024 * 1024,
    attenteMs: (Number(process.env.BALANCE_TIMEOUT_S) || 10) * 1000,
  },
  refunds: {
    enabled: (process.env.REFUND_ENABLED ?? 'true') !== 'false',
    file: process.env.REFUND_FILE ?? './data/refunds.json',
    min: Number(process.env.LINK_AMOUNT_MIN) || 1,
    max: Number(process.env.LINK_AMOUNT_MAX) || 1000,
    dailyMax: Number(process.env.REFUND_DAILY_MAX) || 200_000,
    delayMin: (Number(process.env.REFUND_DELAY_MIN_S) || 60) * 1000,
    delayMax: (Number(process.env.REFUND_DELAY_MAX_S) || 120) * 1000,
    confirmMs: (Number(process.env.REFUND_CONFIRM_S) || 90) * 1000,
  },
};

if (!cfg.username) {
  console.error('MC_EMAIL manquant dans .env (le compte Microsoft du bot receveur).');
  process.exit(1);
}

// Commandes interdites : rien ne doit pouvoir sortir de l'argent de ce compte.
const FORBIDDEN = /^\/(pay|eco|give|trade|ah|sell|shop|drop)\b/i;

let bot = null;
let attempt = 0;
let lastPayment = null;

async function feed(line) {
  await mkdir(dirname(cfg.feed), { recursive: true });
  await appendFile(cfg.feed, JSON.stringify({ raw: line, at: Date.now() }) + '\n');
}

async function saveStatus(extra = {}) {
  await mkdir(dirname(cfg.status), { recursive: true });
  const rss = Math.round(process.memoryUsage().rss / 1048576);
  const heap = Math.round(process.memoryUsage().heapUsed / 1048576);
  await writeFile(cfg.status, JSON.stringify({
    online: Boolean(bot?.player),
    username: bot?.username ?? null,
    pos: bot?.entity ? {
      x: Math.round(bot.entity.position.x),
      y: Math.round(bot.entity.position.y),
      z: Math.round(bot.entity.position.z),
    } : null,
    lastPayment,
    refunds: ledger?.stats() ?? null,
    rssMb: rss,
    heapMb: heap,
    at: Date.now(),
    ...extra,
  }, null, 2));
}

function sendSafe(command) {
  if (FORBIDDEN.test(command)) {
    console.error(`[garde] commande refusee : ${command}`);
    return false;
  }
  bot?.chat(command);
  return true;
}

function connect() {
  console.log(`[mc] connexion a ${cfg.host}:${cfg.port} en ${cfg.auth}`);
  bot = mineflayer.createBot({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    auth: cfg.auth,
    version: cfg.version,
    profilesFolder: cfg.profilesFolder,
    hideErrors: false,
    // Si le jeton en cache a expire, le code s affiche dans les logs pm2
    // plutot que de laisser le process attendre en silence.
    onMsaCode: (res) => {
      console.warn('[mc] jeton expire, reconnexion Microsoft demandee');
      console.warn(`[mc] ouvre ${res.verification_uri} et saisis le code ${res.user_code}`);
      console.warn('[mc] ou lance : node scripts/auth.js --force');
    },
  });

  bot.once('spawn', async () => {
    attempt = 0;
    console.log(`[mc] connecte en tant que ${bot.username}`);
    if (cfg.expectedName && bot.username.toLowerCase() !== cfg.expectedName.toLowerCase()) {
      console.warn(`[mc] ATTENTION : connecte en ${bot.username} mais MC_LINK_ACCOUNT dit ${cfg.expectedName}.`);
      console.warn('[mc] les joueurs paieront le mauvais compte, corrige le .env.');
    }
    if (!process.env.DONUT_API_KEY && (process.env.DONUT_KEY_FETCH ?? 'true') !== 'false') {
      setTimeout(() => {
        cleDemandee = true;
        console.log('[api] demande de la cle avec /api');
        bot.chat('/api');
        // On arrete d ecouter au bout d une minute pour ne pas prendre
        // n importe quelle ligne de chat pour une cle.
        setTimeout(() => { cleDemandee = false; }, 60_000);
      }, 8_000);
    }

    await saveStatus();
  });

  bot.on('message', (msg) => {
    const line = msg.toString();

    // Mise au point : DEBUG_CHAT=true loggue le chat, en masquant toute suite
    // longue qui pourrait etre une cle.
    if (process.env.DEBUG_CHAT === 'true') {
      const sur = line.replace(/[A-Za-z0-9_\-]{24,}/g, (k) => `<${k.length} car. masques>`);
      if (sur.trim()) console.log(`[chat] ${sur}`);
    }

    // Paiement RECU. On ecrit la ligne brute pour le bot Discord, qui la
    // reparse de son cote ; ici on parse strictement parce que c est cette
    // lecture qui decide de rendre de l argent.
    const recu = parsePayment(line);
    if (recu) {
      lastPayment = { line: recu.raw, at: Date.now() };
      console.log(`[pay] recu ${recu.amount} de ${recu.from}`);
      feed(line).catch((e) => console.error('[pay] ecriture impossible :', e.message));
      planifierRemboursement(recu);
      return;
    }

    if (traiterReponseSolde(line)) return;
    if (capturerCle(line)) return;

    // Confirmation d un remboursement parti.
    const envoye = parsePaymentSent(line);
    if (envoye) {
      const entry = ledger?.matchConfirmation(envoye.to, envoye.amount);
      if (entry) {
        ledger.markPaid(entry.id);
        ledger.save().catch(() => {});
        console.log(`[refund] rendu ${entry.amount} a ${entry.to}`);
        // Le solde du joueur vient de remonter : le classement le connait
        // encore d avant le remboursement. On le relit tout de suite.
        if (!prioritaires.includes(entry.to)) prioritaires.push(entry.to);
      } else {
        console.warn(`[refund] confirmation sans entree en vol : ${envoye.raw}`);
      }
    }
  });

  bot.on('kicked', (reason) => {
    console.warn(`[mc] kick : ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
    saveStatus({ online: false }).catch(() => {});
  });
  bot.on('error', (err) => console.error(`[mc] erreur : ${err.message}`));
  bot.on('end', (reason) => {
    console.warn(`[mc] deconnecte (${reason}), reconnexion...`);
    bot = null;
    saveStatus({ online: false }).catch(() => {});
    const delay = Math.min(60_000, 5_000 * 2 ** attempt++);
    setTimeout(connect, delay);
  });
}

// ---------------------------------------------------------------------------
// Releve des soldes en jeu. Le bot Discord depose la liste des comptes
// verifies dans tracked.json ; on les interroge un par un avec /balance et on
// ecrit les reponses dans balances.jsonl, que le bot Discord relit.
// Une seule question en vol a la fois : la reponse ne porte pas toujours le
// pseudo (« That player does not exist »), donc on la rattache a la demande
// en cours.
// ---------------------------------------------------------------------------

let suivis = [];
let prioritaires = [];
let curseur = 0;
let demande = null;
let dernierEnvoi = 0;

async function chargerSuivis() {
  try {
    const brut = JSON.parse(await readFile(cfg.soldes.suivis, 'utf8'));
    const liste = Array.isArray(brut) ? brut : brut.joueurs ?? [];
    suivis = liste
      .map((j) => (typeof j === 'string' ? j : j.name))
      .filter((n) => typeof n === 'string' && /^\.?[A-Za-z0-9_]{1,24}$/.test(n));
  } catch {
    suivis = [];
  }
}

async function ecrireSolde(nom, montant) {
  await mkdir(dirname(cfg.soldes.sortie), { recursive: true });
  try {
    const { size } = await stat(cfg.soldes.sortie);
    if (size > cfg.soldes.tailleMaxOctets) {
      await writeFile(cfg.soldes.sortie, '');
      console.log('[solde] flux remis a zero (taille max atteinte)');
    }
  } catch { /* fichier absent : il va etre cree */ }
  await appendFile(cfg.soldes.sortie, JSON.stringify({ name: nom, money: montant, at: Date.now() }) + '\n');
}

function traiterReponseSolde(line) {
  if (!demande) return false;
  const lu = parseBalance(line);
  if (!lu) return false;

  // Reponse pour soi-meme : ce n est pas celle qu on attend.
  if (lu.soi) return false;

  if (lu.inconnu) {
    console.warn(`[solde] ${demande.nom} : compte inconnu sur DonutSMP`);
    demande = null;
    return true;
  }
  // Le serveur peut repondre pour un autre pseudo si une demande a traine.
  if (lu.name.toLowerCase().replace(/^\./, '') !== demande.nom.toLowerCase().replace(/^\./, '')) {
    return false;
  }

  ecrireSolde(lu.name, lu.amount).catch((e) => console.error('[solde] ecriture :', e.message));
  demande = null;
  return true;
}

setInterval(() => {
  if (!cfg.soldes.enabled || !bot?.player) return;

  // Une demande sans reponse ne bloque pas la file indefiniment.
  if (demande) {
    if (Date.now() - demande.a > cfg.soldes.attenteMs) {
      console.warn(`[solde] pas de reponse pour ${demande.nom}`);
      demande = null;
    }
    return;
  }
  const urgent = prioritaires.length > 0;
  if (!urgent && suivis.length === 0) return;

  // Une demande prioritaire ne saute pas le plancher anti-spam, seulement
  // l espacement long du cycle de fond.
  const espacement = urgent
    ? cfg.soldes.intervalMs
    : Math.max(cfg.soldes.intervalMs, Math.floor(cfg.soldes.cycleMs / suivis.length));
  if (Date.now() - dernierEnvoi < espacement) return;

  let nom;
  if (urgent) {
    nom = prioritaires.shift();
  } else {
    nom = suivis[curseur % suivis.length];
    curseur = (curseur + 1) % Math.max(1, suivis.length);
  }
  demande = { nom, a: Date.now() };
  dernierEnvoi = Date.now();
  bot.chat(`/balance ${nom}`);
}, 1000).unref();

setInterval(() => { chargerSuivis().catch(() => {}); }, 30_000).unref();

// File prioritaire : une ligne par pseudo, consommee puis videe.
setInterval(async () => {
  let contenu;
  try { contenu = await readFile(cfg.soldes.priorite, 'utf8'); } catch { return; }
  if (!contenu.trim()) return;
  await writeFile(cfg.soldes.priorite, '');
  for (const nom of contenu.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(nom)) continue;
    if (!prioritaires.includes(nom)) prioritaires.push(nom);
  }
  if (prioritaires.length) console.log(`[solde] ${prioritaires.length} demande(s) prioritaire(s)`);
}, 2_000).unref();

// ---------------------------------------------------------------------------
// File de commandes admin : une ligne par commande dans data/cmd-queue.txt,
// jouee sous 2 s puis le fichier est vide. Meme principe que le bot du casino.
// sendSafe filtre : rien qui sorte de l argent ne passe par ce canal.
// ---------------------------------------------------------------------------

const QUEUE = process.env.CMD_QUEUE ?? './data/cmd-queue.txt';

setInterval(async () => {
  if (!bot?.player) return;
  let contenu;
  try { contenu = await readFile(QUEUE, 'utf8'); } catch { return; }
  if (!contenu.trim()) return;
  await writeFile(QUEUE, '');
  for (const ligne of contenu.split('\n').map((l) => l.trim()).filter(Boolean)) {
    console.log(`[admin] ${ligne}`);
    sendSafe(ligne);
    await new Promise((r) => setTimeout(r, 600));
  }
}, 2_000).unref();

// ---------------------------------------------------------------------------
// Cle API DonutSMP : elle se recupere en jeu avec /api. Le bot la demande une
// fois au demarrage si elle manque, l ecrit dans .env et ne la loggue JAMAIS
// en clair.
// ---------------------------------------------------------------------------

const CLE = /\b([A-Za-z0-9_\-]{24,}(?:\.[A-Za-z0-9_\-]{8,}){0,2})\b/;
let cleDemandee = false;

const masque = (k) => `${k.slice(0, 4)}...${k.slice(-4)} (${k.length} car.)`;

async function ecrireCle(cle) {
  let contenu;
  try { contenu = await readFile('.env', 'utf8'); } catch { return false; }
  const ligne = `DONUT_API_KEY=${cle}`;
  contenu = /^DONUT_API_KEY=.*$/m.test(contenu)
    ? contenu.replace(/^DONUT_API_KEY=.*$/m, ligne)
    : `${contenu.trimEnd()}\n${ligne}\n`;
  await writeFile('.env', contenu, { mode: 0o600 });
  return true;
}

function capturerCle(line) {
  if (!cleDemandee || process.env.DONUT_API_KEY) return false;
  if (!/\bapi\b|\bkey\b|\btoken\b/i.test(line)) return false;
  const m = line.match(CLE);
  if (!m) {
    console.log('[api] reponse sans cle reconnue, ajuster le motif si besoin');
    return false;
  }
  const cle = m[1];
  process.env.DONUT_API_KEY = cle;
  ecrireCle(cle)
    .then((ok) => console.log(ok
      ? `[api] cle recuperee et ecrite dans .env : ${masque(cle)} (redemarre le bot Discord)`
      : `[api] cle recuperee mais .env introuvable : ${masque(cle)}`))
    .catch((e) => console.error('[api] ecriture impossible :', e.message));
  return true;
}

// ---------------------------------------------------------------------------
// Remboursement : le micro-paiement n est qu une preuve, on le rend au joueur
// une a deux minutes plus tard. Seul endroit du bot ou de l argent sort.
// ---------------------------------------------------------------------------

let ledger = null;

function planifierRemboursement(payment) {
  if (!cfg.refunds.enabled || !ledger) return;
  const { entry, skipped } = ledger.queue({ ...payment, receivedAt: Date.now() });
  if (skipped) {
    console.warn(`[refund] pas rendu a ${payment.from} (${payment.amount}) : ${skipped}`);
    return;
  }
  const dans = Math.round((entry.dueAt - Date.now()) / 1000);
  console.log(`[refund] ${entry.amount} a rendre a ${entry.to} dans ${dans}s`);
  ledger.save().catch(() => {});
}

/**
 * Construit et envoie le /pay. La commande n est JAMAIS assemblee a partir de
 * texte venu du chat : le pseudo est revalide et le montant doit etre un entier
 * dans la fourchette, sinon on refuse et on marque l entree en echec.
 */
function envoyerRemboursement(entry) {
  if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(entry.to)
      || !Number.isInteger(entry.amount)
      || entry.amount < cfg.refunds.min
      || entry.amount > cfg.refunds.max) {
    console.error(`[refund] entree refusee a l envoi : ${JSON.stringify(entry)}`);
    ledger.retryOrFail(entry.id, 0);
    return false;
  }
  bot.chat(`/pay ${entry.to} ${entry.amount}`);
  ledger.markSent(entry.id);
  ledger.save().catch(() => {});
  console.log(`[refund] /pay ${entry.to} ${entry.amount} envoye`);
  return true;
}

setInterval(() => {
  if (!cfg.refunds.enabled || !ledger || !bot?.player) return;

  // Un seul /pay en vol : on attend sa confirmation avant le suivant.
  const enVol = ledger.inFlight();
  if (enVol) {
    if (Date.now() - enVol.sentAt > cfg.refunds.confirmMs) {
      console.warn(`[refund] pas de confirmation pour ${enVol.to} (${enVol.amount}), essai ${enVol.attempts}`);
      const e = ledger.retryOrFail(enVol.id);
      if (e.status === 'failed') {
        console.error(`[refund] ABANDON : ${e.amount} a rendre a ${e.to} a la main`);
      }
      ledger.save().catch(() => {});
    }
    return;
  }

  const suivant = ledger.due();
  if (suivant) envoyerRemboursement(suivant);
}, 5_000).unref();

// Purge des entites hors de portee : sans ca le RSS grimpe en quelques heures
// sur un spawn charge (lecon du bot du casino).
setInterval(() => {
  if (!bot?.entity) return;
  const me = bot.entity.position;
  let purged = 0;
  for (const [id, e] of Object.entries(bot.entities)) {
    if (!e?.position || e === bot.entity) continue;
    if (e.position.distanceTo(me) > 64) { delete bot.entities[id]; purged++; }
  }
  if (purged > 50) console.log(`[mem] ${purged} entites hors portee purgees`);
}, 60_000).unref();

// Battement de coeur. Le bot Discord refuse les /link quand ce fichier est
// vieux : s il ralentissait, il bloquerait les liaisons pour rien.
setInterval(() => { saveStatus().catch(() => {}); }, 20_000).unref();

setInterval(() => {
  const { rss, heapUsed } = process.memoryUsage();
  console.log(`[mem] rss ${Math.round(rss / 1048576)}M heap ${Math.round(heapUsed / 1048576)}M`);
}, 120_000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('[mc] arret demande');
    await saveStatus({ online: false }).catch(() => {});
    bot?.quit?.();
    process.exit(0);
  });
}

if (cfg.refunds.enabled) {
  ledger = await new RefundLedger(cfg.refunds).load();
  const s = ledger.stats();
  console.log(`[refund] registre charge : ${s.pending} en attente, ${s.paid} rendus, ${s.failed} en echec, ${s.today} rendus aujourd hui`);
  console.log(`[refund] fourchette ${cfg.refunds.min}-${cfg.refunds.max}, plafond journalier ${cfg.refunds.dailyMax}`);
} else {
  console.warn('[refund] remboursements DESACTIVES (REFUND_ENABLED=false)');
}

if (cfg.soldes.enabled) {
  await chargerSuivis();
  const espacement = suivis.length
    ? Math.max(cfg.soldes.intervalMs, Math.floor(cfg.soldes.cycleMs / suivis.length))
    : cfg.soldes.cycleMs;
  console.log(`[solde] ${suivis.length} comptes a relever, un /balance toutes les `
    + `${Math.round(espacement / 1000)}s (cycle vise ${Math.round(cfg.soldes.cycleMs / 60_000)} min)`);
} else {
  console.warn('[solde] releve des soldes desactive (BALANCE_POLL=false)');
}

connect();
export { sendSafe };
