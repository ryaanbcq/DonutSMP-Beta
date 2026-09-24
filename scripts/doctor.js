// Etat de sante d une installation. A lancer apres le setup, apres un update,
// ou quand quelque chose ne marche pas et qu on ne sait pas par ou commencer.
//
//   node scripts/doctor.js
//
// Rien n est modifie, rien de secret n est affiche. Code de sortie 1 si au
// moins un point bloquant est rouge.

import 'dotenv/config';
import { droitsManquants, lienInvitation } from './lib/discord-setup.js';
import { readFile, access, stat, mkdir, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const API = 'https://discord.com/api/v10';

let rouges = 0;
const ok = (m, d = '') => console.log(`  [ok]   ${m}${d ? `  ${d}` : ''}`);
const warn = (m, d = '') => console.log(`  [!]    ${m}${d ? `  ${d}` : ''}`);
const ko = (m, d = '') => { rouges++; console.log(`  [KO]   ${m}${d ? `  ${d}` : ''}`); };
const titre = (t) => console.log(`\n${t}`);

async function api(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'donutsmp-fr-bot doctor' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = new Error(`Discord ${res.status} sur ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const existe = (p) => access(p, constants.F_OK).then(() => true, () => false);

// ---------------------------------------------------------------- machine
titre('Machine');
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  const assez = maj > 22 || (maj === 22 && min >= 5);
  // node:sqlite arrive en 22.5, le bot ne demarre pas en dessous.
  (assez ? ok : ko)(`node ${process.versions.node}`, assez ? '' : '(22.5 minimum, node:sqlite)');

  if (await existe('node_modules')) ok('node_modules present');
  else ko('node_modules absent', 'npm ci');

  try {
    const { stdout } = await run('pm2', ['jlist'], { timeout: 10_000 });
    const procs = JSON.parse(stdout);
    for (const nom of ['fr-discord', 'fr-ingame']) {
      const p = procs.find((x) => x.name === nom);
      if (!p) warn(`pm2 ${nom} absent`, `pm2 start ecosystem.config.cjs --only ${nom}`);
      else if (p.pm2_env.status === 'online') ok(`pm2 ${nom} online`, `${p.pm2_env.restart_time} restarts`);
      else ko(`pm2 ${nom} ${p.pm2_env.status}`, `pm2 logs ${nom}`);
    }
  } catch {
    warn('pm2 introuvable', 'npm i -g pm2 (facultatif en dev)');
  }
}

// -------------------------------------------------------------------- .env
titre('Fichier .env');
let envBrut = '';
{
  if (!(await existe('.env'))) {
    ko('.env absent', 'cp .env.example .env puis node scripts/setup.js');
  } else {
    envBrut = await readFile('.env', 'utf8');
    const mode = (await stat('.env')).mode & 0o777;
    (mode === 0o600 ? ok : warn)(`.env droits ${mode.toString(8)}`, mode === 0o600 ? '' : 'chmod 600 .env');

    const cles = (txt) => txt.split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('=')[0]);
    const exemple = cles(await readFile('.env.example', 'utf8'));
    const miennes = new Set(cles(envBrut));
    const manquantes = exemple.filter((k) => !miennes.has(k));
    if (manquantes.length) warn(`${manquantes.length} cles absentes du .env`, `node scripts/sync-env.js  (${manquantes.slice(0, 4).join(', ')}${manquantes.length > 4 ? '...' : ''})`);
    else ok('toutes les cles de .env.example sont presentes');
  }

  for (const k of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'MC_LINK_ACCOUNT']) {
    if (process.env[k]) ok(`${k} rempli`);
    else ko(`${k} vide`, k === 'MC_LINK_ACCOUNT' ? 'donut auth' : 'donut setup');
  }

  // Le compte du casino encaisse de vrais depots joueurs : un paiement de link
  // y serait relu comme un depot si l auto-depot est rallume.
  if (/^outmindcompany$/i.test(process.env.MC_LINK_ACCOUNT ?? '')) {
    ko('MC_LINK_ACCOUNT est le compte du casino', 'prendre un compte dedie');
  }
  if (process.env.DONUT_MOCK === 'true') ko('DONUT_MOCK=true', 'de faux soldes seraient publies en prod');
  if (process.env.BYPASS_ROLE_ID) warn('BYPASS_ROLE_ID pose', 'role beta qui saute le /link, a vider en prod');
  if (!process.env.OPS_CHANNEL_ID) warn('OPS_CHANNEL_ID vide', 'aucun journal Discord : les pannes ne se voient que dans les logs');
}

// ----------------------------------------------------------------- discord
titre('Discord');
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token) {
  ko('pas de token, controles Discord sautes');
} else {
  try {
    const me = await api('/users/@me', token);
    ok('token valide', `${me.username} (${me.id})`);

    const app = await api('/oauth2/applications/@me', token);
    const MESSAGE_CONTENT = (1 << 18) | (1 << 19);
    const veutContenu = process.env.DISCORD_MESSAGE_CONTENT === 'true';
    const aContenu = Boolean(app.flags & MESSAGE_CONTENT);
    if (veutContenu && !aContenu) ko('intent Message Content demande mais pas coche', 'portail dev > Bot > Privileged Gateway Intents');
    else if (veutContenu) ok('intent Message Content actif');
    else warn('Message Content desactive', 'les transcripts de tickets sortent sans texte');

    const guilds = await api('/users/@me/guilds', token).catch(() => []);
    const g = guilds.find((x) => x.id === guildId);
    if (!g) {
      ko('le bot n est pas sur DISCORD_GUILD_ID', `serveurs vus : ${guilds.map((x) => x.id).join(', ') || 'aucun'}  (donut setup)`);
    } else {
      ok(`present sur ${g.name}`, g.id);

      const roles = await api(`/guilds/${guildId}/roles`, token);
      const membre = await api(`/guilds/${guildId}/members/${me.id}`, token);
      const siens = roles.filter((r) => membre.roles.includes(r.id) || r.id === guildId);
      const perms = siens.reduce((acc, r) => acc | BigInt(r.permissions), 0n);
      // Meme liste que le lien d invitation de setup.js.
      const absentes = droitsManquants(perms);
      if (absentes.length) ko(`permissions manquantes : ${absentes.join(', ')}`, `reautoriser le bot : ${lienInvitation(me.id, guildId)}`);
      else ok('permissions suffisantes');

      const maPosition = Math.max(...siens.map((r) => r.position), 0);
      const sousLeBot = (id, quoi) => {
        if (!id) return;
        const r = roles.find((x) => x.id === id);
        if (!r) return ko(`${quoi} introuvable`, id);
        if (r.position >= maPosition) ko(`${quoi} est au dessus du bot`, `${r.name} : le bot ne pourra pas le donner`);
        else ok(`${quoi} donnable`, r.name);
      };
      sousLeBot(process.env.VERIFIED_ROLE_ID, 'VERIFIED_ROLE_ID');
      if (process.env.ADMIN_ROLE_ID) {
        const r = roles.find((x) => x.id === process.env.ADMIN_ROLE_ID);
        // Pas besoin d etre sous le bot : ce role n est jamais donne, seulement lu.
        (r ? ok : ko)('ADMIN_ROLE_ID', r ? r.name : `introuvable : ${process.env.ADMIN_ROLE_ID}`);
      }
      const admins = (process.env.ADMIN_USER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      if (admins.length) ok(`${admins.length} membre(s) admin par id`);
      if (!process.env.ADMIN_ROLE_ID && !admins.length) warn('aucun admin configure', 'seuls les « Gerer le serveur » ont les commandes staff');
      sousLeBot(process.env.BALTOP_TOP_ROLE_ID, 'BALTOP_TOP_ROLE_ID');

      for (const [cle, quoi] of [['LOG_CHANNEL_ID', 'salon de logs'], ['BALTOP_CHANNEL_ID', 'salon du classement'], ['LINK_CHANNEL_ID', 'salon de connexion'], ['OPS_CHANNEL_ID', 'salon du journal']]) {
        const id = process.env[cle];
        if (!id) continue;
        try {
          const ch = await api(`/channels/${id}`, token);
          if (ch.guild_id !== guildId) ko(`${cle} est sur un autre serveur`, ch.guild_id);
          else ok(`${quoi} lisible`, `#${ch.name}`);
        } catch (e) { ko(`${quoi} injoignable`, `${cle}=${id} (${e.status ?? e.message})`); }
      }

      const locales = (await readdir('src/commands')).filter((f) => f.endsWith('.js')).length;
      const posees = await api(`/applications/${me.id}/guilds/${guildId}/commands`, token).catch(() => []);
      if (posees.length === 0) ko('aucune slash command enregistree', 'npm run deploy');
      else if (posees.length < locales) warn(`${posees.length} commandes en ligne pour ${locales} fichiers`, 'npm run deploy');
      else ok(`${posees.length} slash commands enregistrees`);
    }
  } catch (e) {
    if (e.status === 401) ko('token refuse par Discord', 'il a ete regenere : node scripts/setup.js --new');
    else ko('Discord injoignable', e.message);
  }
}

// ---------------------------------------------------------------- donnees
titre('Donnees et bot en jeu');
{
  const chemins = [
    [process.env.DB_PATH ?? './data/bot.db', 'base sqlite'],
    [process.env.PAYMENT_FILE ?? './data/payments.jsonl', 'journal des paiements'],
  ];
  for (const [p, quoi] of chemins) {
    const dir = dirname(p);
    try {
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      ok(`${quoi} : ${dir} accessible en ecriture`, (await existe(p)) ? '' : '(fichier pas encore cree)');
    } catch (e) { ko(`${quoi} : ${dir} non ecrivable`, e.message); }
  }

  const cache = process.env.MC_PROFILES_FOLDER ?? './data/msa-cache';
  if (!(await existe(cache))) {
    ko('pas de cache Microsoft', 'donut auth');
  } else {
    try {
      await run(process.execPath, ['scripts/auth.js', '--check'], { timeout: 60_000 });
      ok('cache Microsoft valide', cache);
    } catch (e) {
      if (e.code === 2) ko('cache Microsoft vide ou expire', 'node scripts/auth.js');
      else warn('verification du cache Microsoft impossible', (e.stderr || e.message || '').trim().split('\n')[0]);
    }
  }

  const statut = process.env.INGAME_STATUS ?? './data/ingame-status.json';
  if (await existe(statut)) {
    try {
      const s = JSON.parse(await readFile(statut, 'utf8'));
      const age = Math.round((Date.now() - (s.at ?? s.updatedAt ?? 0)) / 1000);
      if (!Number.isFinite(age) || age > 300) warn('statut du bot en jeu perime', `${age} s`);
      else if (s.online) ok('bot en jeu connecte a DonutSMP', s.username ?? '');
      // Le process peut tourner tout en ayant lache la connexion : dans cet
      // etat plus personne n encaisse les paiements de link, donc plus aucun
      // /link ne se termine. C est bloquant, pas cosmetique.
      else ko('bot en jeu deconnecte de DonutSMP', 'les paiements de link ne sont plus vus : pm2 logs fr-ingame');
    } catch { warn('statut du bot en jeu illisible', statut); }
  } else {
    warn('bot en jeu jamais demarre', `pm2 start ecosystem.config.cjs --only fr-ingame`);
  }
}

console.log(rouges === 0
  ? '\nTout est vert.\n'
  : `\n${rouges} point(s) bloquant(s). Corrige les [KO] puis relance node scripts/doctor.js\n`);
process.exit(rouges === 0 ? 0 : 1);
