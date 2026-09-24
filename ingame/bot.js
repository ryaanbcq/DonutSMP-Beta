// Bot en jeu du Discord FR : il se connecte a DonutSMP avec le compte receveur,
// et ecrit chaque paiement recu dans le flux que lit le bot Discord.
//
// Ce bot ne fait QUE recevoir. Aucune commande qui sort de l'argent n'est
// autorisee : il n'y a pas de chemin de code qui envoie /pay, et le garde
// `sendSafe` refuse la commande meme si quelqu'un l'ajoute par accident.

import mineflayer from 'mineflayer';
import { creerSuperviseur } from './superviseur.js';
import { note, noteSync, deposerCodeMsa, effacerCodeMsa } from './journal.js';
import { diagnostiquerKick, diagnostiquerErreur, duree } from './diagnostic.js';
import { shortMoney } from '../src/lib/format.js';
import { appendFile, writeFile, readFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import 'dotenv/config';
import { parsePayment, parsePaymentSent, parseBalance } from '../src/minecraft/payments.js';
import { RefundLedger } from './refunds.js';
import { Reversements } from './dons.js';
import { creerVerificateur } from './verifications.js';
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
  // Dons : tout /pay recu a partir de `min` (les /link vont de 1 a 1000).
  dons: {
    file: process.env.DONATION_FILE ?? './data/dons.json',
    min: Number(process.env.DONATION_MIN) || 10_000,
    beneficiaire: (process.env.DONATION_RECIPIENT ?? '').trim(),
    heure: Number(process.env.DONATION_FORWARD_HOUR) || 0,
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

// Une coupure = UN message si elle dure, une relance si elle s eternise, un
// message au retour avec sa duree. Une micro-coupure (retour en quelques
// secondes, vecu ~40 par jour le 23/09 : keepAlive perdu, retour en 8 s) ne
// dit rien : elle faisait trois messages a chaque fois. Seule leur repetition
// est signalee (« Connexion instable »).
let panne = null; // { depuis, tentatives, raison, alerte, annoncee, diag }
const PANNE_ALERTES_MIN = [10, 60, 360];
const ANNONCE_APRES_MS = 90_000;
const INSTABLE_PAR_HEURE = 6;
const INSTABLE_SILENCE_MS = 6 * 3_600_000;
const microCoupures = []; // { a, duree }
let instabiliteSignaleeA = 0;
let msaEnAttente = false;

// Un meme diagnostic (ban, maintenance...) revient a chaque tentative : on ne
// le reposte qu apres ce delai, ou si le motif change.
const DIAG_SILENCE_MS = 15 * 60_000;
const diagsVus = new Map();
function signaler(diag) {
  if (!diag) return;
  const cle = `${diag.titre}|${diag.motif}`;
  const vu = diagsVus.get(cle);
  if (vu && Date.now() - vu < DIAG_SILENCE_MS) return;
  diagsVus.set(cle, Date.now());
  if (panne) panne.raison = diag.titre;
  note(diag.niveau, diag.titre, diag.texte, {
    champs: { Motif: `\`${diag.motif.slice(0, 900)}\`` },
    actions: diag.actions,
  });
}

// Relances et chien de garde : voir ingame/superviseur.js.
const superviseur = creerSuperviseur({
  connecter: () => connect(),
  silenceMax: (Number(process.env.MC_WATCHDOG_MINUTES) || 5) * 60_000,
  journal: (m) => console.warn(`[mc] ${m}`),
});


async function feed(line, at, reel) {
  await mkdir(dirname(cfg.feed), { recursive: true });
  await appendFile(cfg.feed, JSON.stringify({ raw: line, at, ...(reel ? { reel } : {}) }) + '\n');
}

// Un seul canal de commandes : DonutSMP impose un delai entre deux commandes
// (« You need to wait another 0.25 seconds »), et le releve des soldes, les
// remboursements et la file admin se marchaient dessus. Un /pay avale par ce
// delai coutait un essai sur trois.
const ECART_COMMANDES_MS = 1_200;
let derniereCommandeA = 0;
const peutCommander = () => Date.now() - derniereCommandeA >= ECART_COMMANDES_MS;
function commander(texte) {
  derniereCommandeA = Date.now();
  bot.chat(texte);
}

let derniereConnexionA = 0;

/**
 * DonutSMP mange le point des pseudos Bedrock dans « X paid you » : .Steve et
 * Steve s y ecrivent pareil. La liste des joueurs, elle, porte le vrai pseudo.
 * Rend le pseudo exact s il n y a qu un candidat, sinon null (on ne sait pas).
 */
function pseudoReel(nom) {
  const cle = String(nom).toLowerCase().replace(/^\./, '');
  const candidats = Object.keys(bot?.players ?? {})
    .filter((n) => n.toLowerCase().replace(/^\./, '') === cle);
  return candidats.length === 1 ? candidats[0] : null;
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
  // `ceBot` est CETTE connexion. Les handlers ne doivent jamais passer par la
  // variable partagee : elle vaut null des qu on a rendu la main, et elle
  // pointe la connexion suivante une fois qu on a relance.
  const ceBot = mineflayer.createBot({
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
      // Le code part dans un fichier prive, JAMAIS dans le journal : le bouton
      // de l embed le montre a un admin, en ephemere.
      deposerCodeMsa(res).then((expireA) => {
        msaEnAttente = true;
        note('err', 'Connexion Microsoft requise',
          'Le jeton du bot a expiré : il ne peut plus entrer sur DonutSMP.'
          + ' Un admin clique sur **Afficher le code**, l\'entre sur la page Microsoft avec le compte du bot,'
          + ' et le bot repart tout seul. Sur la machine, `donut auth` marche aussi.',
          { champs: { 'Code valable': `jusqu'à <t:${Math.floor(expireA / 1000)}:t>` }, actions: ['msa', 'relink'] });
      }).catch((e) => console.error('[mc] code Microsoft non depose :', e.message));
    },
  });
  bot = ceBot;

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
    ceBot._client.on('packet', (data, meta) => {
      if (bruyants.has(meta.name)) return;
      console.log(`[pkt] ${meta.name} ${JSON.stringify(data).slice(0, 200)}`);
    });
  }

  // Sonde : DEBUG_WINDOW=true vide le contenu de toute interface qui s ouvre.
  ceBot.on('windowOpen', (fenetre) => {
    if (process.env.DEBUG_WINDOW === 'true') {
      console.log(`[gui] titre=${JSON.stringify(fenetre.title)} slots=${fenetre.slots.length}`);
      fenetre.slots.forEach((item, i) => {
        if (!item) return;
        const nom = item.customName ?? item.displayName ?? item.name;
        const lore = item.customLore ?? item.lore ?? null;
        console.log(`[gui] ${String(i).padStart(2)} ${item.name} | ${JSON.stringify(nom)}`);
        if (lore) console.log(`[gui]    lore=${JSON.stringify(lore)}`);
      });
    }
    // VECU LE 2026-09-23 : tant qu une fenetre reste ouverte, DonutSMP ignore
    // TOUTES les commandes du bot, en silence. Treize /balance de suite sans
    // une seule reponse, et ca vaut aussi pour les /pay de remboursement : le
    // bot parait en ligne et ne fait plus rien. On referme donc tout de suite
    // ce qu on n a pas demande.
    try { ceBot.closeWindow(fenetre); } catch { /* deja fermee */ }
    console.warn('[gui] fenetre fermee (une fenetre ouverte bloque les commandes)');
    note('warn', 'Fenetre ouverte en jeu',
      'Un menu s est ouvert sur le bot et a ete referme aussitot : une fenetre ouverte'
      + ' bloque toutes ses commandes.');
  });

  ceBot._client.on('show_dialog', traiterDialogue);

  ceBot.once('spawn', async () => {
    superviseur.connecte();
    derniereConnexionA = Date.now();
    console.log(`[mc] connecte en tant que ${ceBot.username}`);
    if (msaEnAttente) {
      msaEnAttente = false;
      effacerCodeMsa().catch(() => {});
      note('ok', 'Compte Microsoft reconnecté', 'Le code a été validé, le jeton est de nouveau en cache.',
        { champs: { Compte: ceBot.username }, joueur: ceBot.username });
    }
    if (panne?.annoncee) {
      note('ok', 'Bot en jeu reconnecté', 'Les paiements de vérification sont de nouveau vus.', {
        champs: { Coupure: duree(Date.now() - panne.depuis), Tentatives: panne.tentatives, Cause: panne.raison },
        joueur: ceBot.username,
      });
      panne = null;
    } else if (panne) {
      noterMicroCoupure(Date.now() - panne.depuis);
      panne = null;
    } else {
      note('ok', 'Bot en jeu connecté', `Connecté à **${cfg.host}**, les paiements de vérification sont vus.`,
        { champs: { Compte: ceBot.username }, joueur: ceBot.username });
    }
    if (cfg.expectedName && ceBot.username.toLowerCase() !== cfg.expectedName.toLowerCase()) {
      console.warn(`[mc] ATTENTION : connecte en ${ceBot.username} mais MC_LINK_ACCOUNT dit ${cfg.expectedName}.`);
      console.warn('[mc] les joueurs paieront le mauvais compte, corrige le .env.');
      note('err', 'Mauvais compte en jeu',
        'Les joueurs paient un autre compte : aucun paiement de vérification ne sera vu.'
        + ' Corrige `MC_LINK_ACCOUNT` ou reconnecte le bon compte (`donut auth`).',
        { champs: { Connecté: ceBot.username, Attendu: cfg.expectedName }, joueur: ceBot.username, actions: ['relink'] });
    }
    await saveStatus();
  });

  ceBot.on('message', (msg) => {
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
      const at = Date.now();
      const reel = pseudoReel(recu.from);
      lastPayment = { line: recu.raw, at };
      console.log(`[pay] recu ${recu.amount} de ${recu.from}${reel && reel !== recu.from ? ` (${reel})` : ''}`);
      feed(line, at, reel).catch((e) => console.error('[pay] ecriture impossible :', e.message));
      // Un don ne se rembourse pas : il part au beneficiaire avec le reversement du jour.
      if (dons?.estUnDon(recu.amount)) {
        if (dons.ajouterDon({ from: reel ?? recu.from, amount: recu.amount, at })) {
          console.log(`[don] ${recu.amount} de ${recu.from}, cumul a reverser ${dons.etat.cumul}`);
          dons.save().catch((e) => console.error('[don] ecriture impossible :', e.message));
        }
        return;
      }
      // Le remboursement part au vrai pseudo : « /pay Steve » ne paie pas .Steve.
      planifierRemboursement({ ...recu, from: reel ?? recu.from, receivedAt: at });
      return;
    }

    // Delai entre commandes : la derniere commande n est pas partie.
    if (/^You need to wait another [\d.]+ seconds? to execute a command/i.test(line.trim())) {
      const donEnVol = dons?.enVol();
      const enVol = ledger?.inFlight();
      if (donEnVol && Date.now() - donEnVol.sentAt < 3_000) {
        dons.annulerEnvoi(donEnVol.id);
        dons.save().catch(() => {});
        console.warn(`[don] /pay ${donEnVol.to} avale par le delai entre commandes, renvoi`);
      } else if (enVol && Date.now() - enVol.sentAt < 3_000) {
        ledger.annulerEnvoi(enVol.id);
        ledger.save().catch(() => {});
        console.warn(`[refund] /pay ${enVol.to} avale par le delai entre commandes, renvoi dans 2 s`);
      } else if (demande && Date.now() - demande.a < 3_000) {
        prioritaires.unshift({ type: demande.type, nom: demande.nom });
        demande = null;
      }
      derniereCommandeA = Date.now();
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
        // (Avant : on poussait la chaine seule, et le bot tapait /balance undefined.)
        if (!prioritaires.some((d) => d.type === 'solde' && memeJoueur(d.nom, entry.to))) {
          prioritaires.push({ type: 'solde', nom: entry.to });
        }
      } else if (dons?.matchConfirmation(envoye.to, envoye.amount)) {
        const v = dons.marquer(dons.enVol().id, 'paid', { paidAt: Date.now() });
        dons.save().catch(() => {});
        console.log(`[don] reverse ${v.amount} a ${v.to}`);
        note('ok', 'Dons reversés',
          `Les dons du jour sont partis à **${v.to}**.`,
          { champs: { Bénéficiaire: v.to, Montant: shortMoney(v.amount), Jour: v.jour }, joueur: v.to, canal: 'dons' });
      } else {
        console.warn(`[refund] confirmation sans entree en vol : ${envoye.raw}`);
      }
    }
  });

  ceBot.on('kicked', (reason) => {
    console.warn(`[mc] kick : ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
    saveStatus({ online: false }).catch(() => {});
    signaler(diagnostiquerKick(reason));
  });
  ceBot.on('error', (err) => {
    console.error(`[mc] erreur : ${err.message}`);
    // Une erreur AVANT d etre en jeu (ping de detection de version, DNS, TCP)
    // n est jamais suivie d un `end` : sans cette relance le bot ne repart
    // plus du tout. Vecu le 15/09, sept jours hors ligne.
    // En jeu, l erreur (« client timed out ») n est que l autre face de la
    // deconnexion qui suit : pas de diagnostic, le `end` s en charge.
    if (ceBot.player) return;
    // Couper pour de bon : une connexion laissee en vol peut arriver en jeu
    // apres qu on a relance, et deux clients sur le meme compte se chassent.
    try { ceBot.end('erreur avant connexion'); } catch { /* deja morte */ }
    rendreLaMain(`erreur avant connexion (${err.message})`, generation);
    // Le diagnostic attend que la coupure dure : un essai rate suivi d un
    // retour 5 s plus tard ne merite pas un message.
    const diag = diagnostiquerErreur(err.message);
    if (panne && diag) {
      panne.diag = diag;
      if (panne.annoncee) signaler(diag);
    }
  });
  ceBot.on('end', (reason) => rendreLaMain(`deconnecte (${reason})`, generation));
}

/** Coupe la connexion courante et laisse le superviseur programmer la suite. */
function rendreLaMain(raison, generation) {
  if (!superviseur.courante(generation)) return;
  bot = null;
  saveStatus({ online: false }).catch(() => {});
  const dans = superviseur.relancer(raison, generation);
  if (dans === null) return;
  if (panne) {
    panne.tentatives += 1;
    return;
  }
  panne = { depuis: Date.now(), tentatives: 1, raison, alerte: 0, annoncee: false, diag: null };
}

function annoncerPanne() {
  panne.annoncee = true;
  note('warn', 'Bot en jeu déconnecté',
    'Les paiements de vérification ne sont plus vus jusqu\'à la reconnexion.'
    + ' Un seul message par coupure : le retour sera annoncé ici.',
    { champs: { Raison: `\`${panne.raison}\``, Depuis: `<t:${Math.floor(panne.depuis / 1000)}:R>`, Tentatives: panne.tentatives } });
  if (panne.diag) signaler(panne.diag);
}

function noterMicroCoupure(ms) {
  const maintenant = Date.now();
  microCoupures.push({ a: maintenant, duree: ms });
  while (microCoupures.length && maintenant - microCoupures[0].a > 3_600_000) microCoupures.shift();
  if (microCoupures.length < INSTABLE_PAR_HEURE) return;
  if (maintenant - instabiliteSignaleeA < INSTABLE_SILENCE_MS) return;
  instabiliteSignaleeA = maintenant;
  const moyenne = microCoupures.reduce((t, c) => t + c.duree, 0) / microCoupures.length;
  note('warn', 'Connexion instable',
    'Le bot perd sa connexion à répétition mais revient seul en quelques secondes : rien à faire pour l\'instant.'
    + ' Si ça dure, regarde le réseau de la machine qui héberge le bot. Prochain rappel dans 6 h au plus tôt.',
    { champs: { 'Coupures (1 h)': microCoupures.length, 'Retour moyen': duree(moyenne) } });
}

// Coupure qui dure : annoncee apres 90 s, puis relance a 10 min, 1 h, 6 h.
setInterval(() => {
  if (!panne) return;
  if (!panne.annoncee) {
    if (Date.now() - panne.depuis >= ANNONCE_APRES_MS) annoncerPanne();
    return;
  }
  if (panne.alerte >= PANNE_ALERTES_MIN.length) return;
  const seuil = PANNE_ALERTES_MIN[panne.alerte];
  if (Date.now() - panne.depuis < seuil * 60_000) return;
  panne.alerte += 1;
  note('err', `Bot hors ligne depuis ${duree(seuil * 60_000)}`,
    'Les reconnexions automatiques échouent. Les `/link` sont refusés en attendant.'
    + (msaEnAttente ? ' Un code Microsoft attend d\'être validé (message plus haut).' : ''),
    { champs: { Tentatives: panne.tentatives, 'Dernière cause': panne.raison, Depuis: `<t:${Math.floor(panne.depuis / 1000)}:R>` } });
}, 10_000).unref();

// Le chien de garde : la ceinture quand aucun evenement n arrive.
setInterval(() => {
  if (superviseur.chienDeGarde(Boolean(bot?.player))) {
    if (!panne) panne = { depuis: Date.now(), tentatives: 0, raison: 'chien de garde', alerte: 0, annoncee: false, diag: null };
    panne.tentatives += 1;
    // Plusieurs minutes sans etre en jeu : ce n est plus une micro-coupure.
    if (!panne.annoncee) annoncerPanne();
    note('err', 'Chien de garde déclenché',
      'Aucun événement depuis trop longtemps et toujours pas en jeu : connexion relancée de force.'
      + ' Souvent un serveur qui accepte la connexion sans jamais faire entrer le bot.');
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
// Joueur -> demandes sans reponse d affilee. Au troisieme silence, le staff est
// prevenu une fois (pseudo change, compte supprime...) : vecu Accoutrement_,
// neuf jours de /balance dans le vide sans que personne ne le voie.
const silences = new Map();
const SILENCES_ALERTE = 3;
const inconnusSignales = new Set();

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
    if (!inconnusSignales.has(demande.nom)) {
      inconnusSignales.add(demande.nom);
      note('warn', 'Compte inconnu sur DonutSMP',
        `DonutSMP ne connaît pas **${demande.nom}** : pseudo changé ou compte supprimé.`
        + ' Son solde n\'apparaîtra plus au classement tant que le lien n\'est pas refait.',
        { champs: { Joueur: demande.nom }, joueur: demande.nom });
    }
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
  for (const nom of silences.keys()) if (memeJoueur(nom, lu.name)) silences.delete(nom);
  return true;
}

setInterval(() => {
  if (!cfg.soldes.enabled || !bot?.player) return;

  // Une demande sans reponse ne bloque pas la file indefiniment.
  if (demande) {
    if (Date.now() - demande.a > cfg.soldes.attenteMs) {
      console.warn(`[jeu] pas de reponse pour ${demande.type} ${demande.nom}`);
      const n = (silences.get(demande.nom) ?? 0) + 1;
      silences.set(demande.nom, n);
      if (n === SILENCES_ALERTE) {
        note('warn', 'Solde illisible',
          `DonutSMP ne répond plus à \`/${demande.type === 'stats' ? 'stats' : 'balance'} ${demande.nom}\`.`
          + ' Souvent un pseudo changé : le classement garde son ancien solde. Refais le lien ou retire le compte.',
          { champs: { Joueur: demande.nom, 'Sans réponse': `${n} fois de suite` }, joueur: demande.nom });
      }
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
  // Les remboursements passent avant les soldes : ils ont un vrai joueur qui attend.
  if (!peutCommander() || ledger?.due()) return;

  let entree;
  if (urgent) {
    entree = prioritaires.shift();
  } else {
    entree = { type: 'solde', nom: suivis[curseur % suivis.length] };
    curseur = (curseur + 1) % Math.max(1, suivis.length);
  }

  demande = { ...entree, a: Date.now() };
  dernierEnvoi = Date.now();
  commander(entree.type === 'stats' ? `/stats ${entree.nom}` : `/balance ${entree.nom}`);
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
    while (!peutCommander()) await new Promise((r) => setTimeout(r, 200));
    console.log(`[admin] ${ligne}`);
    if (sendSafe(ligne)) derniereCommandeA = Date.now();
  }
}, 2_000).unref();

// ---------------------------------------------------------------------------
// Relink demande depuis Discord (bouton du journal, admin, confirme). Le bot
// Discord depose data/ingame-control.json ; on le lit MEME hors ligne, c est
// justement quand le compte est casse qu on en a besoin. Le cache Microsoft
// n est pas supprime : il est mis de cote, date, et la connexion suivante
// n a plus de jeton, donc demande un code (embed « Connexion Microsoft requise »).
// ---------------------------------------------------------------------------

const CONTROLE = process.env.INGAME_CONTROL_FILE ?? './data/ingame-control.json';

setInterval(async () => {
  let ordre;
  try { ordre = JSON.parse(await readFile(CONTROLE, 'utf8')); } catch { return; }
  await rm(CONTROLE, { force: true });
  if (ordre?.action !== 'relink') return;
  // Un ordre oublie (bot arrete plusieurs heures) ne doit pas deconnecter au demarrage.
  if (!(Date.now() - Number(ordre.at) < 5 * 60_000)) {
    console.warn('[mc] ordre de relink perime ignore');
    return;
  }

  const sauvegarde = `${cfg.profilesFolder}.avant-relink-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    await rename(cfg.profilesFolder, sauvegarde);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('[mc] relink : cache non deplace :', e.message);
      note('err', 'Relink impossible', 'Le cache Microsoft du bot n\'a pas pu être mis de côté.',
        { champs: { Erreur: `\`${e.message}\`` } });
      return;
    }
  }
  console.warn(`[mc] relink demande par ${ordre.par}, cache mis de cote dans ${sauvegarde}`);
  note('info', 'Relink en cours',
    'Ancien jeton mis de côté, reconnexion Microsoft lancée. Le code arrive dans un nouveau message.',
    { champs: { Par: ordre.par ?? 'inconnu' } });
  if (bot) {
    try { bot.end('relink'); } catch { /* deja morte */ }
  }
  // Sans connexion ouverte, la relance deja programmee repartira sans jeton.
}, 2_000).unref();

// ---------------------------------------------------------------------------
// Remboursement : le micro-paiement n est qu une preuve, on le rend au joueur
// une a deux minutes plus tard. Seul endroit du bot ou de l argent sort.
// ---------------------------------------------------------------------------

let ledger = null;
const verificateur = creerVerificateur(process.env.DB_PATH ?? './data/bot.db');

function planifierRemboursement(payment) {
  if (!cfg.refunds.enabled || !ledger) return;
  const { entry, skipped } = ledger.queue({ ...payment, receivedAt: Date.now() });
  if (skipped) {
    console.warn(`[refund] pas rendu a ${payment.from} (${payment.amount}) : ${skipped}`);
    note('warn', 'Remboursement refusé',
      `**${payment.from}** ne sera pas remboursé automatiquement. À décider à la main.`,
      { champs: { Joueur: payment.from, Montant: shortMoney(payment.amount), Raison: skipped }, joueur: payment.from });
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
  commander(`/pay ${entry.to} ${entry.amount}`);
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
      // Deconnecte depuis l envoi : la confirmation a pu se perdre avec la
      // connexion alors que le /pay est passe. Renvoyer = payer deux fois.
      if (enVol.sentAt < derniereConnexionA) {
        ledger.mettreEnDoute(enVol.id);
        ledger.save().catch(() => {});
        signalerDoute(enVol, 'le bot a été déconnecté entre le /pay et sa confirmation');
        return;
      }
      const e = ledger.retryOrFail(enVol.id);
      if (e.status === 'failed') {
        console.error(`[refund] ABANDON : ${e.amount} a rendre a ${e.to} a la main`);
        note('err', 'Remboursement abandonné',
          `**${e.to}** attend toujours son argent. À rendre à la main.`,
          { champs: { Joueur: e.to, Montant: shortMoney(e.amount), Essais: e.attempts }, joueur: e.to });
      }
      ledger.save().catch(() => {});
    }
    return;
  }

  const suivant = ledger.due();
  // Un reversement de dons en vol : on attend sa confirmation.
  if (!suivant || !peutCommander() || dons?.enVol()) return;

  // Seuls les paiements de verification se rendent (voir verifications.js).
  const verdict = verificateur.rembourser(suivant, ledger.compteDuJour(suivant.to, suivant.day));
  if (!verdict.ok) {
    ledger.retenir(suivant.id, verdict.raison);
    ledger.save().catch(() => {});
    console.warn(`[refund] retenu : ${suivant.amount} de ${suivant.to} (${verdict.raison})`);
    note('warn', 'Remboursement retenu',
      `**${suivant.to}** a payé le bot sans vérification en cours : rien n'est rendu automatiquement.`
      + ' À rendre à la main si c\'est une erreur.',
      { champs: { Joueur: suivant.to, Montant: shortMoney(suivant.amount), Raison: verdict.raison }, joueur: suivant.to });
    return;
  }
  envoyerRemboursement(suivant);
}, 2_000).unref();

// Reversement quotidien des dons. Passe apres les remboursements (jamais deux
// /pay en vol en meme temps) et n est JAMAIS renvoye sans confirmation.
let dons = null;
setInterval(() => {
  if (!dons || !bot?.player) return;
  const enVol = dons.enVol();
  if (enVol) {
    if (Date.now() - enVol.sentAt > cfg.refunds.confirmMs) {
      dons.marquer(enVol.id, 'doute', { douteAt: Date.now() });
      dons.save().catch(() => {});
      signalerDouteDon(enVol, 'aucune confirmation « You paid » dans les temps');
    }
    return;
  }
  if (dons.planifier()) dons.save().catch(() => {});
  const v = dons.aEnvoyer();
  if (!v || ledger?.inFlight() || !peutCommander()) return;
  if (!/^\.?[A-Za-z0-9_]{1,24}$/.test(v.to) || !Number.isInteger(v.amount) || v.amount <= 0) {
    dons.marquer(v.id, 'doute', { raison: 'entree invalide' });
    dons.save().catch(() => {});
    return;
  }
  commander(`/pay ${v.to} ${v.amount}`);
  dons.marquer(v.id, 'sent', { sentAt: Date.now() });
  dons.save().catch(() => {});
  console.log(`[don] /pay ${v.to} ${v.amount} envoye (reversement ${v.jour})`);
}, 2_000).unref();

function signalerDouteDon(v, cause) {
  console.error(`[don] EN DOUTE : ${v.amount} a ${v.to} (${cause})`);
  note('err', 'Reversement incertain',
    `Le \`/pay\` des dons à **${v.to}** est peut-être parti, sans confirmation vue. Il n'est **pas** renvoyé`
    + ' automatiquement : vérifie avec le bénéficiaire, puis envoie à la main si besoin.',
    { champs: { Bénéficiaire: v.to, Montant: shortMoney(v.amount), Jour: v.jour, Cause: cause }, joueur: v.to, canal: 'dons' });
}

function signalerDoute(e, cause) {
  console.error(`[refund] EN DOUTE : ${e.amount} a ${e.to} (${cause})`);
  note('err', 'Remboursement incertain',
    `Le \`/pay\` à **${e.to}** est peut-être parti, sans confirmation vue. Il n'est **pas** renvoyé automatiquement`
    + ' pour éviter de payer deux fois : vérifie avec le joueur, puis rembourse à la main si besoin.',
    { champs: { Joueur: e.to, Montant: shortMoney(e.amount), Cause: cause }, joueur: e.to });
}

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

// Alerte memoire : pm2 tue le process a 700 Mo, on previent bien avant.
const MEMOIRE_ALERTE_MO = 450;
let memoireSignalee = false;
setInterval(() => {
  const { rss, heapUsed } = process.memoryUsage();
  const rssMo = Math.round(rss / 1048576);
  console.log(`[mem] rss ${rssMo}M heap ${Math.round(heapUsed / 1048576)}M`);
  if (rssMo >= MEMOIRE_ALERTE_MO && !memoireSignalee) {
    memoireSignalee = true;
    note('warn', 'Mémoire du bot en jeu élevée',
      'Un bot sain tient sous 150 Mo. À 700 Mo, pm2 le redémarre (coupure de quelques secondes).'
      + ' Si ça revient souvent, c\'est une fuite à chercher.',
      { champs: { RSS: `${rssMo} Mo`, Tas: `${Math.round(heapUsed / 1048576)} Mo`, Plafond: '700 Mo' } });
  } else if (rssMo < MEMOIRE_ALERTE_MO - 100) {
    memoireSignalee = false;
  }
}, 120_000).unref();

// Derniers mots : ecrits en synchrone, le bot Discord les poste meme si ce
// process est deja mort. pm2 le relance, comme sans ces handlers.
for (const evt of ['uncaughtException', 'unhandledRejection']) {
  process.on(evt, (err) => {
    console.error(`[crash] ${evt} :`, err);
    noteSync('err', 'Bot en jeu planté',
      'Le process s\'est arrêté sur une erreur non gérée. pm2 le relance, la pile est ci-dessous.',
      { champs: { Erreur: `\`\`\`\n${String(err?.stack ?? err).slice(0, 900)}\n\`\`\`` } });
    process.exit(1);
  });
}

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
  for (const e of ledger.doutesAuChargement) signalerDoute(e, 'arrêt du bot entre le /pay et sa confirmation');
  if (ledger.doutesAuChargement.length) await ledger.save();
  const s = ledger.stats();
  console.log(`[refund] registre charge : ${s.pending} en attente, ${s.paid} rendus, ${s.failed} en echec, ${s.today} rendus aujourd hui`);
  console.log(`[refund] fourchette ${cfg.refunds.min}-${cfg.refunds.max}, plafond journalier ${cfg.refunds.dailyMax}`);
} else {
  console.warn('[refund] remboursements DESACTIVES (REFUND_ENABLED=false)');
}

dons = await new Reversements(cfg.dons).load();
// Le beneficiaire se regle sur Discord (/setup general), le .env n est que la
// valeur par defaut. Relu chaque minute : pas besoin de relancer le bot en jeu.
const lireBeneficiaire = () => {
  const pose = verificateur.kv('dons.beneficiaire');
  const b = (pose ?? cfg.dons.beneficiaire).trim();
  if (b !== dons.beneficiaire) console.log(`[don] beneficiaire : ${b || 'aucun'}`);
  dons.beneficiaire = b;
};
lireBeneficiaire();
setInterval(lireBeneficiaire, 60_000).unref();
for (const v of dons.doutesAuChargement) signalerDouteDon(v, 'arrêt du bot entre le /pay et sa confirmation');
if (dons.doutesAuChargement.length) await dons.save();
console.log(dons.beneficiaire
  ? `[don] dons a partir de ${cfg.dons.min}, reverses chaque jour a ${cfg.dons.heure} h (Paris) a ${dons.beneficiaire}, cumul ${dons.etat.cumul}`
  : `[don] dons a partir de ${cfg.dons.min}, AUCUN beneficiaire (/setup general) : cumul ${dons.etat.cumul} garde`);

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
