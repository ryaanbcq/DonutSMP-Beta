// Bot en jeu du Discord FR : il se connecte a DonutSMP avec le compte receveur,
// et ecrit chaque paiement recu dans le flux que lit le bot Discord.
//
// Ce bot ne fait QUE recevoir. Aucune commande qui sort de l'argent n'est
// autorisee : il n'y a pas de chemin de code qui envoie /pay, et le garde
// `sendSafe` refuse la commande meme si quelqu'un l'ajoute par accident.

import mineflayer from 'mineflayer';
import { creerSuperviseur } from './superviseur.js';
import { appendFile, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import 'dotenv/config';
import { parsePayment, parsePaymentSent, parseBalance } from '../src/minecraft/payments.js';
import { RefundLedger } from './refunds.js';
import nbt from 'prismarine-nbt';
import { lireDialogueStats } from '../src/minecraft/dialog.js';

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
    // /stats repond par un DIALOGUE vanilla, pas par du chat.
    statsDemandes: process.env.STATS_PRIORITY_FILE ?? './data/stats-priority.txt',
    statsSortie: process.env.STATS_FILE ?? './data/stats.jsonl',
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
let lastPayment = null;

// Relances et chien de garde : voir ingame/superviseur.js.
const superviseur = creerSuperviseur({
  connecter: () => connect(),
  silenceMax: (Number(process.env.MC_WATCHDOG_MINUTES) || 5) * 60_000,
  journal: (m) => console.warn(`[mc] ${m}`),
});


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
  // Chaque tentative porte un numero : une connexion abandonnee peut encore
  // emettre des evenements, ils ne doivent plus rien declencher.
  const generation = superviseur.nouvelleGeneration();
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

  // Sonde brute : DEBUG_PACKETS=true liste les paquets recus, pour decouvrir
  // par quel canal une commande repond.
  if (process.env.DEBUG_PACKETS === 'true') {
    const bruyants = new Set([
      'map_chunk', 'entity_move_look', 'rel_entity_move', 'entity_look',
      'entity_velocity', 'entity_teleport', 'update_time', 'keep_alive',
      'entity_head_rotation', 'entity_metadata', 'sound_effect', 'world_particles',
      'unload_chunk', 'update_light', 'block_change', 'multi_block_change',
      'spawn_entity', 'entity_destroy', 'player_info', 'position', 'animation',
      'entity_equipment', 'set_slot', 'ping', 'bundle_delimiter', 'chunk_biomes',
      'damage_event', 'entity_status', 'update_attributes', 'teams', 'scoreboard_score',
    ]);
    bot._client.on('packet', (data, meta) => {
      if (bruyants.has(meta.name)) return;
      console.log(`[pkt] ${meta.name} ${JSON.stringify(data).slice(0, 200)}`);
    });
  }

  // Sonde : DEBUG_WINDOW=true vide le contenu de toute interface qui s ouvre.
  bot.on('windowOpen', (fenetre) => {
    if (process.env.DEBUG_WINDOW !== 'true') return;
    console.log(`[gui] titre=${JSON.stringify(fenetre.title)} slots=${fenetre.slots.length}`);
    fenetre.slots.forEach((item, i) => {
      if (!item) return;
      const nom = item.customName ?? item.displayName ?? item.name;
      const lore = item.customLore ?? item.lore ?? null;
      console.log(`[gui] ${String(i).padStart(2)} ${item.name} | ${JSON.stringify(nom)}`);
      if (lore) console.log(`[gui]    lore=${JSON.stringify(lore)}`);
    });
  });

  bot._client.on('show_dialog', traiterDialogue);

  bot.once('spawn', async () => {
    superviseur.connecte();
    console.log(`[mc] connecte en tant que ${bot.username}`);
    if (cfg.expectedName && bot.username.toLowerCase() !== cfg.expectedName.toLowerCase()) {
      console.warn(`[mc] ATTENTION : connecte en ${bot.username} mais MC_LINK_ACCOUNT dit ${cfg.expectedName}.`);
      console.warn('[mc] les joueurs paieront le mauvais compte, corrige le .env.');
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
  bot.on('error', (err) => {
    console.error(`[mc] erreur : ${err.message}`);
    // Une erreur AVANT d etre en jeu (ping de detection de version, DNS, TCP)
    // n est jamais suivie d un `end` : sans cette relance le bot ne repart
    // plus du tout. Vecu le 15/09, sept jours hors ligne.
    if (!bot?.player) rendreLaMain(`erreur avant connexion (${err.message})`, generation);
  });
  bot.on('end', (reason) => rendreLaMain(`deconnecte (${reason})`, generation));
}

/** Coupe la connexion courante et laisse le superviseur programmer la suite. */
function rendreLaMain(raison, generation) {
  if (!superviseur.courante(generation)) return;
  bot = null;
  saveStatus({ online: false }).catch(() => {});
  superviseur.relancer(raison, generation);
}

// Le chien de garde : la ceinture quand aucun evenement n arrive.
setInterval(() => {
  if (superviseur.chienDeGarde(Boolean(bot?.player))) {
    try { bot?.end?.('watchdog'); } catch { /* deja mort */ }
    bot = null;
  }
}, 30_000).unref();

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

async function ecrireLigneSolde(objet) {
  await mkdir(dirname(cfg.soldes.sortie), { recursive: true });
  try {
    const { size } = await stat(cfg.soldes.sortie);
    if (size > cfg.soldes.tailleMaxOctets) {
      await writeFile(cfg.soldes.sortie, '');
      console.log('[solde] flux remis a zero (taille max atteinte)');
    }
  } catch { /* fichier absent : il va etre cree */ }
  await appendFile(cfg.soldes.sortie, JSON.stringify({ ...objet, at: Date.now() }) + '\n');
}

const ecrireSolde = (nom, montant) => ecrireLigneSolde({ name: nom, money: montant });

async function ecrireLigneStats(objet) {
  await mkdir(dirname(cfg.soldes.statsSortie), { recursive: true });
  await appendFile(cfg.soldes.statsSortie, JSON.stringify({ ...objet, at: Date.now() }) + '\n');
}

/**
 * DonutSMP repond a /stats par un dialogue vanilla. On ne le lit que si une
 * demande de fiche est en cours : le serveur ouvre aussi des dialogues pour
 * d autres choses, qui n ont rien a faire dans le flux.
 */
function traiterDialogue(paquet) {
  if (!demande || demande.type !== 'stats') return;
  let fiche = null;
  try {
    fiche = lireDialogueStats(nbt.simplify(paquet?.dialog?.data ?? paquet?.dialog));
  } catch (e) {
    console.error('[stats] dialogue illisible :', e.message);
  }
  if (!fiche) return;

  console.log(`[stats] ${fiche.nom} : ${Object.keys(fiche.lignes).join(', ')}`);
  ecrireLigneStats({ name: fiche.nom, lignes: fiche.lignes })
    .catch((e) => console.error('[stats] ecriture :', e.message));
  demande = null;
}

const memeJoueur = (a, b) =>
  String(a).toLowerCase().replace(/^\./, '') === String(b).toLowerCase().replace(/^\./, '');

function traiterReponseSolde(line) {
  const lu = parseBalance(line);
  if (!lu || lu.soi) return false;

  if (lu.inconnu) {
    // Seule reponse qui ne porte pas de pseudo : elle ne vaut que rattachee a
    // la demande en cours.
    if (!demande) return false;
    if (demande.type === 'stats') {
      ecrireLigneStats({ name: demande.nom, inconnu: true })
        .catch((e) => console.error('[stats] ecriture :', e.message));
      demande = null;
      return true;
    }
    console.warn(`[solde] ${demande.nom} : compte inconnu sur DonutSMP`);
    ecrireLigneSolde({ name: demande.nom, inconnu: true })
      .catch((e) => console.error('[solde] ecriture :', e.message));
    demande = null;
    return true;
  }

  // La reponse PORTE le pseudo : elle se suffit a elle meme. On la prend
  // toujours, meme si elle arrive en retard et ne correspond plus a la demande
  // en cours. Exiger la correspondance desynchronisait tout le pipeline : une
  // reponse tardive etait jetee, la suivante arrivait pour la demande d avant,
  // et plus une seule n etait acceptee (vecu le 2026-09-12).
  ecrireSolde(lu.name, lu.amount).catch((e) => console.error('[solde] ecriture :', e.message));
  if (demande && memeJoueur(lu.name, demande.nom)) demande = null;
  return true;
}

setInterval(() => {
  if (!cfg.soldes.enabled || !bot?.player) return;

  // Une demande sans reponse ne bloque pas la file indefiniment.
  if (demande) {
    if (Date.now() - demande.a > cfg.soldes.attenteMs) {
      console.warn(`[jeu] pas de reponse pour ${demande.type} ${demande.nom}`);
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

  let entree;
  if (urgent) {
    entree = prioritaires.shift();
  } else {
    entree = { type: 'solde', nom: suivis[curseur % suivis.length] };
    curseur = (curseur + 1) % Math.max(1, suivis.length);
  }

  demande = { ...entree, a: Date.now() };
  dernierEnvoi = Date.now();
  bot.chat(entree.type === 'stats' ? `/stats ${entree.nom}` : `/balance ${entree.nom}`);
}, 1000).unref();

setInterval(() => { chargerSuivis().catch(() => {}); }, 30_000).unref();

// Files prioritaires : une ligne par pseudo, consommee puis videe. Les deux
// types de demandes (solde et fiche) partagent la meme file d envoi, pour
// garder UNE seule commande en vol et UN seul espacement anti-spam.
async function lireFile(chemin, type) {
  let contenu;
  try { contenu = await readFile(chemin, 'utf8'); } catch { return 0; }
  if (!contenu.trim()) return 0;
  await writeFile(chemin, '');

  let ajoutes = 0;
  for (const nom of contenu.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(nom)) continue;
    if (prioritaires.some((d) => d.type === type && d.nom === nom)) continue;
    prioritaires.push({ type, nom });
    ajoutes += 1;
  }
  return ajoutes;
}

setInterval(async () => {
  const n = (await lireFile(cfg.soldes.priorite, 'solde'))
    + (await lireFile(cfg.soldes.statsDemandes, 'stats'));
  if (n) console.log(`[jeu] ${n} demande(s) prioritaire(s), ${prioritaires.length} en file`);
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
