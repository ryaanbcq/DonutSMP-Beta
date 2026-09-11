// Bot en jeu du Discord FR : il se connecte a DonutSMP avec le compte receveur,
// et ecrit chaque paiement recu dans le flux que lit le bot Discord.
//
// Ce bot ne fait QUE recevoir. Aucune commande qui sort de l'argent n'est
// autorisee : il n'y a pas de chemin de code qui envoie /pay, et le garde
// `sendSafe` refuse la commande meme si quelqu'un l'ajoute par accident.

import mineflayer from 'mineflayer';
import { appendFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import 'dotenv/config';

const cfg = {
  host: process.env.MC_HOST ?? 'donutsmp.net',
  port: Number(process.env.MC_PORT) || 25565,
  username: process.env.MC_EMAIL ?? '',
  auth: process.env.MC_AUTH ?? 'microsoft',
  version: process.env.MC_VERSION || false,
  feed: process.env.PAYMENT_FILE ?? './data/payments.jsonl',
  status: process.env.INGAME_STATUS ?? './data/ingame-status.json',
  expectedName: process.env.MC_LINK_ACCOUNT ?? '',
};

if (!cfg.username) {
  console.error('MC_EMAIL manquant dans .env (le compte Microsoft du bot receveur).');
  process.exit(1);
}

const PAID = /paid you \$/i;
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
    hideErrors: false,
  });

  bot.once('spawn', async () => {
    attempt = 0;
    console.log(`[mc] connecte en tant que ${bot.username}`);
    if (cfg.expectedName && bot.username.toLowerCase() !== cfg.expectedName.toLowerCase()) {
      console.warn(`[mc] ATTENTION : connecte en ${bot.username} mais MC_LINK_ACCOUNT dit ${cfg.expectedName}.`);
      console.warn('[mc] les joueurs paieront le mauvais compte, corrige le .env.');
    }
    await saveStatus();
  });

  // On ecrit la ligne BRUTE, sans la decouper : le bot Discord la reparse lui
  // meme avec des motifs ancres. Un joueur qui tape le motif dans le chat est
  // rejete de l'autre cote, pas ici.
  bot.on('message', (msg) => {
    const line = msg.toString();
    if (!PAID.test(line)) return;
    lastPayment = { line, at: Date.now() };
    console.log(`[pay] ${line}`);
    feed(line).catch((e) => console.error('[pay] ecriture impossible :', e.message));
  });

  bot.on('kicked', (reason) => console.warn(`[mc] kick : ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', (err) => console.error(`[mc] erreur : ${err.message}`));
  bot.on('end', (reason) => {
    console.warn(`[mc] deconnecte (${reason}), reconnexion...`);
    bot = null;
    const delay = Math.min(60_000, 5_000 * 2 ** attempt++);
    setTimeout(connect, delay);
  });
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

setInterval(() => {
  const { rss, heapUsed } = process.memoryUsage();
  console.log(`[mem] rss ${Math.round(rss / 1048576)}M heap ${Math.round(heapUsed / 1048576)}M`);
  saveStatus().catch(() => {});
}, 120_000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('[mc] arret demande');
    await saveStatus({ online: false }).catch(() => {});
    bot?.quit?.();
    process.exit(0);
  });
}

connect();
export { sendSafe };
