// Menu de configuration. Tout ce qui se regle sans ouvrir le .env a la main :
// token, serveur, roles et salons choisis dans une liste lue sur Discord,
// admins, compte Minecraft, interrupteurs, valeurs numeriques.
//
//   donut config            (ou node scripts/config.js)
//
// Rien n est ecrit tant qu une valeur n est pas validee. Les secrets ne sont
// jamais reaffiches en clair, seulement masques.

import 'dotenv/config';
import { readFile, writeFile, chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const API = 'https://discord.com/api/v10';
const rl = createInterface({ input: stdin, output: stdout });

// stdin ferme (Ctrl+D, entree redirigee, session qui tombe) : on sort du menu
// proprement au lieu de jeter un ERR_USE_AFTER_CLOSE sur la question suivante.
let ferme = false;
rl.on('close', () => { ferme = true; });
async function demander(question) {
  if (ferme) return '0';
  try { return await rl.question(question); } catch { ferme = true; return '0'; }
}

const G = '\x1b[1m'; const N = '\x1b[0m'; const V = '\x1b[32m';
const R = '\x1b[31m'; const J = '\x1b[33m'; const D = '\x1b[2m';

const modifiees = new Set();

// ------------------------------------------------------------------ fichier
async function texteEnv() {
  try { return await readFile('.env', 'utf8'); }
  catch { return readFile('.env.example', 'utf8'); }
}

function lire(txt, cle) {
  const m = txt.match(new RegExp(`^${cle}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

async function poser(cle, valeur) {
  let txt = await texteEnv();
  const ligne = `${cle}=${valeur}`;
  const re = new RegExp(`^${cle}=.*$`, 'm');
  txt = re.test(txt) ? txt.replace(re, ligne) : `${txt.trimEnd()}\n${ligne}\n`;
  await writeFile('.env', txt, { mode: 0o600 });
  await chmod('.env', 0o600);
  process.env[cle] = valeur;
  modifiees.add(cle);
}

const masque = (v) => (v ? (v.length > 12 ? `${v.slice(0, 6)}...${v.slice(-4)}` : '******') : '');
const vide = `${D}(vide)${N}`;
const affiche = (v) => (v ? v : vide);

// ------------------------------------------------------------------ discord
async function api(chemin) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('pas de token');
  const res = await fetch(`${API}${chemin}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'donutsmp-fr-bot config' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  return res.json();
}

// Liste numerotee : entree vide = on ne touche a rien, 0 = on efface,
// un id colle a la main passe aussi (utile pour un salon d une autre categorie).
async function choisir(titre, elements, actuel) {
  console.log(`\n${G}${titre}${N}`);
  elements.forEach((e, i) => {
    const ici = e.id === actuel ? `  ${V}<= actuel${N}` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${e.nom}${ici}`);
  });
  console.log(`   0. ${D}aucun (vider)${N}`);
  const r = (await demander('\nNumero, id, ou Entree pour garder : ')).trim();
  if (!r) return undefined;
  if (r === '0') return '';
  if (/^\d{15,}$/.test(r)) return r;
  const i = Number(r);
  if (Number.isInteger(i) && i >= 1 && i <= elements.length) return elements[i - 1].id;
  console.log(`${J}Choix ignore.${N}`);
  return undefined;
}

async function choisirRole(cle, titre) {
  let roles;
  try { roles = await api(`/guilds/${process.env.DISCORD_GUILD_ID}/roles`); }
  catch (e) { console.log(`${R}Roles illisibles (${e.message}).${N}`); return; }
  const liste = roles
    .filter((r) => r.id !== process.env.DISCORD_GUILD_ID && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, nom: `${r.name}${D} (${r.id})${N}` }));
  const choix = await choisir(titre, liste, process.env[cle]);
  if (choix !== undefined) await poser(cle, choix);
}

async function choisirSalon(cle, titre, types = [0]) {
  let salons;
  try { salons = await api(`/guilds/${process.env.DISCORD_GUILD_ID}/channels`); }
  catch (e) { console.log(`${R}Salons illisibles (${e.message}).${N}`); return; }
  const cats = new Map(salons.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const liste = salons
    .filter((c) => types.includes(c.type))
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, nom: `#${c.name}${D} ${cats.get(c.parent_id) ?? ''} (${c.id})${N}` }));
  const choix = await choisir(titre, liste, process.env[cle]);
  if (choix !== undefined) await poser(cle, choix);
}

// -------------------------------------------------------------------- menus
async function menuDiscord() {
  for (;;) {
    const txt = await texteEnv();
    let identite = '';
    try {
      const me = await api('/users/@me');
      identite = `${V}${me.username}${N}`;
    } catch { identite = `${R}token refuse ou absent${N}`; }

    let serveur = lire(txt, 'DISCORD_GUILD_ID');
    try {
      const gs = await api('/users/@me/guilds');
      const g = gs.find((x) => x.id === serveur);
      serveur = g ? `${g.name} ${D}(${g.id})${N}` : `${R}le bot n y est pas${N} ${serveur}`;
    } catch { /* deja signale plus haut */ }

    console.log(`\n${G}Discord${N}`);
    console.log(`  1. Token                ${masque(lire(txt, 'DISCORD_TOKEN')) || vide}   ${identite}`);
    console.log(`  2. Serveur              ${serveur || vide}`);
    console.log(`  3. Role des verifies    ${affiche(await nomRole(lire(txt, 'VERIFIED_ROLE_ID')))}`);
    console.log(`  4. Role beta (bypass)   ${affiche(await nomRole(lire(txt, 'BYPASS_ROLE_ID')))}`);
    console.log(`  5. Role du premier      ${affiche(await nomRole(lire(txt, 'BALTOP_TOP_ROLE_ID')))}`);
    console.log(`  6. Salon des logs       ${affiche(await nomSalon(lire(txt, 'LOG_CHANNEL_ID')))}`);
    console.log(`  7. Salon du classement  ${affiche(await nomSalon(lire(txt, 'BALTOP_CHANNEL_ID')))}`);
    console.log(`  8. Salon de connexion   ${affiche(await nomSalon(lire(txt, 'LINK_CHANNEL_ID')))}`);
    console.log(`  9. Logo des embeds      ${affiche(lire(txt, 'LOGO_URL'))}`);
    console.log(`  0. Retour`);

    const c = (await demander('\n> ')).trim();
    if (c === '0' || c === '') return;
    if (c === '1') { rl.pause(); await lancer(process.execPath, ['scripts/setup.js', '--new']); rl.resume(); await recharger(); }
    else if (c === '2') await choisirServeur();
    else if (c === '3') await choisirRole('VERIFIED_ROLE_ID', 'Role donne aux comptes verifies');
    else if (c === '4') await choisirRole('BYPASS_ROLE_ID', 'Role beta qui saute le /link (vide en prod)');
    else if (c === '5') await choisirRole('BALTOP_TOP_ROLE_ID', 'Role du premier du classement');
    else if (c === '6') await choisirSalon('LOG_CHANNEL_ID', 'Salon des logs');
    else if (c === '7') await choisirSalon('BALTOP_CHANNEL_ID', 'Salon du classement');
    else if (c === '8') await choisirSalon('LINK_CHANNEL_ID', 'Salon de connexion');
    else if (c === '9') await saisir('LOGO_URL', 'URL du logo (vide = avatar du bot)');
  }
}

async function nomRole(id) {
  if (!id) return '';
  try {
    const roles = await api(`/guilds/${process.env.DISCORD_GUILD_ID}/roles`);
    const r = roles.find((x) => x.id === id);
    return r ? `${r.name} ${D}(${id})${N}` : `${R}introuvable${N} ${id}`;
  } catch { return id; }
}

async function nomSalon(id) {
  if (!id) return '';
  try { const c = await api(`/channels/${id}`); return `#${c.name} ${D}(${id})${N}`; }
  catch { return `${R}introuvable${N} ${id}`; }
}

async function choisirServeur() {
  let gs = [];
  try { gs = await api('/users/@me/guilds'); } catch (e) { console.log(`${R}${e.message}${N}`); return; }
  if (gs.length === 0) {
    console.log(`\n${J}Le bot n est sur aucun serveur.${N} Invite le, puis reviens ici.`);
    console.log(`https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&scope=bot%20applications.commands&permissions=268954112\n`);
    return;
  }
  const choix = await choisir('Serveur du bot', gs.map((g) => ({ id: g.id, nom: `${g.name} ${D}(${g.id})${N}` })), process.env.DISCORD_GUILD_ID);
  if (choix !== undefined && choix !== '') await poser('DISCORD_GUILD_ID', choix);
}

async function menuAdmin() {
  for (;;) {
    const txt = await texteEnv();
    console.log(`\n${G}Administrateurs du bot${N}`);
    console.log(`${D}  Qui peut utiliser les commandes staff. La permission Discord${N}`);
    console.log(`${D}  « Gerer le serveur » ouvre toujours l acces, ceci s ajoute.${N}`);
    console.log(`  1. Role admin           ${affiche(await nomRole(lire(txt, 'ADMIN_ROLE_ID')))}`);
    console.log(`  2. Membres admin        ${affiche(lire(txt, 'ADMIN_USER_IDS'))}`);
    console.log(`  0. Retour`);
    const c = (await demander('\n> ')).trim();
    if (c === '0' || c === '') return;
    if (c === '1') await choisirRole('ADMIN_ROLE_ID', 'Role qui donne l acces staff');
    else if (c === '2') await saisir('ADMIN_USER_IDS', 'Ids Discord separes par des virgules');
  }
}

async function menuMinecraft() {
  for (;;) {
    const txt = await texteEnv();
    let cache = `${R}absent${N}`;
    if (await access(process.env.MC_PROFILES_FOLDER ?? './data/msa-cache', constants.F_OK).then(() => true, () => false)) {
      try { await run(process.execPath, ['scripts/auth.js', '--check'], { timeout: 60_000 }); cache = `${V}valide${N}`; }
      catch { cache = `${R}expire${N}`; }
    }
    console.log(`\n${G}Compte Minecraft${N}`);
    console.log(`  1. Pseudo receveur      ${affiche(lire(txt, 'MC_LINK_ACCOUNT'))}`);
    console.log(`  2. Adresse Microsoft    ${affiche(lire(txt, 'MC_EMAIL'))}`);
    console.log(`  3. Jeton (prismarine)   ${cache}   ${D}${lire(txt, 'MC_PROFILES_FOLDER')}${N}`);
    console.log(`  4. Serveur              ${lire(txt, 'MC_HOST')}:${lire(txt, 'MC_PORT')}   version ${affiche(lire(txt, 'MC_VERSION'))}`);
    console.log(`  5. Cle API DonutSMP     ${masque(lire(txt, 'DONUT_API_KEY')) || vide}`);
    console.log(`  0. Retour`);
    const c = (await demander('\n> ')).trim();
    if (c === '0' || c === '') return;
    if (c === '1') await saisir('MC_LINK_ACCOUNT', 'Pseudo du compte qui encaisse (jamais celui du casino)');
    else if (c === '2') await saisir('MC_EMAIL', 'Adresse du compte Microsoft');
    else if (c === '3') {
      console.log(`${D}Microsoft affiche un code a saisir dans un navigateur.${N}`);
      rl.pause();
      await lancer(process.execPath, ['scripts/auth.js', '--force']);
      rl.resume();
    } else if (c === '4') {
      await saisir('MC_HOST', 'Hote');
      await saisir('MC_PORT', 'Port');
      await saisir('MC_VERSION', 'Version (vide = detection auto)');
    } else if (c === '5') await saisir('DONUT_API_KEY', 'Cle API (/api en jeu)', true);
  }
}

const INTERRUPTEURS = [
  ['REFUND_ENABLED', 'Rembourser le paiement de verification'],
  ['BALANCE_POLL', 'Relever les soldes en jeu avec /balance'],
  ['DONUT_KEY_FETCH', 'Demander la cle API en jeu au demarrage'],
  ['DISCORD_MESSAGE_CONTENT', 'Intent Message Content (texte dans les transcripts)'],
  ['DONUT_MOCK', 'Faux soldes de developpement'],
];

async function menuInterrupteurs() {
  for (;;) {
    const txt = await texteEnv();
    console.log(`\n${G}Interrupteurs${N}`);
    INTERRUPTEURS.forEach(([cle, nom], i) => {
      const on = lire(txt, cle) === 'true';
      const etat = on ? `${V}[on] ${N}` : `${D}[off]${N}`;
      const alerte = cle === 'DONUT_MOCK' && on ? `  ${R}de faux soldes seraient publies${N}` : '';
      const alerte2 = cle === 'DISCORD_MESSAGE_CONTENT' && !on ? `  ${D}a cocher aussi dans le portail dev${N}` : '';
      console.log(`  ${i + 1}. ${etat} ${nom}${alerte}${alerte2}`);
    });
    const source = lire(txt, 'PAYMENT_SOURCE');
    console.log(`  ${INTERRUPTEURS.length + 1}. ${source === 'jsonl' ? `${V}[jsonl]${N}` : `${J}[mock]${N} `} Source des paiements`);
    console.log(`  0. Retour`);
    const c = (await demander('\n> ')).trim();
    if (c === '0' || c === '') return;
    const i = Number(c) - 1;
    if (INTERRUPTEURS[i]) {
      const [cle] = INTERRUPTEURS[i];
      await poser(cle, lire(txt, cle) === 'true' ? 'false' : 'true');
    } else if (Number(c) === INTERRUPTEURS.length + 1) {
      await poser('PAYMENT_SOURCE', source === 'jsonl' ? 'mock' : 'jsonl');
    }
  }
}

const NOMBRES = [
  ['LINK_TTL_MINUTES', 'Validite d un challenge, en minutes'],
  ['LINK_AMOUNT_MIN', 'Montant minimum tire'],
  ['LINK_AMOUNT_MAX', 'Montant maximum tire'],
  ['REFUND_DELAY_MIN_S', 'Delai avant remboursement, min (s)'],
  ['REFUND_DELAY_MAX_S', 'Delai avant remboursement, max (s)'],
  ['REFUND_DAILY_MAX', 'Total rembourse par jour, garde-fou'],
  ['BALTOP_CYCLE_MINUTES', 'Duree d un tour de classement (min)'],
  ['BALANCE_INTERVAL_S', 'Espacement entre deux /balance (s)'],
  ['BALANCE_CYCLE_MINUTES', 'Duree d un releve complet (min)'],
];

async function menuNombres() {
  for (;;) {
    const txt = await texteEnv();
    console.log(`\n${G}Valeurs${N}`);
    NOMBRES.forEach(([cle, nom], i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${nom.padEnd(40)} ${lire(txt, cle) || vide}`);
    });
    console.log(`   0. Retour`);
    const c = (await demander('\n> ')).trim();
    if (c === '0' || c === '') return;
    const e = NOMBRES[Number(c) - 1];
    if (e) await saisir(e[0], e[1]);
  }
}

// ----------------------------------------------------------------- communs
async function saisir(cle, question, secret = false) {
  const actuel = lire(await texteEnv(), cle);
  const vu = secret ? masque(actuel) : actuel;
  const r = (await demander(`\n${question}\n${D}actuel : ${vu || 'vide'}${N}\nNouvelle valeur (Entree = garder, "-" = vider) : `)).trim();
  if (!r) return;
  await poser(cle, r === '-' ? '' : r);
}

function lancer(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('close', () => resolve());
  });
}

async function recharger() {
  const txt = await texteEnv();
  for (const ligne of txt.split('\n')) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// -------------------------------------------------------------------- main
await recharger();

for (;;) {
  const txt = await texteEnv();
  const pret = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'MC_LINK_ACCOUNT'].every((k) => lire(txt, k));
  console.log(`\n${G}Configuration du bot DonutSMP FR${N}`);
  console.log(`${D}${process.cwd()}${N}`);
  console.log(pret ? `${V}  configuration minimale complete${N}` : `${J}  il manque le token, le serveur ou le compte en jeu${N}`);
  console.log(`\n  1. Discord            token, serveur, roles, salons`);
  console.log(`  2. Administrateurs    qui a acces aux commandes staff`);
  console.log(`  3. Compte Minecraft   pseudo, Microsoft, cle API`);
  console.log(`  4. Interrupteurs      remboursements, releves, mock`);
  console.log(`  5. Valeurs            delais, montants, cycles`);
  console.log(`  6. Diagnostic         relance le doctor`);
  console.log(`  0. Quitter`);

  const c = (await demander('\n> ')).trim();
  if (c === '0' || c === '') break;
  if (c === '1') await menuDiscord();
  else if (c === '2') await menuAdmin();
  else if (c === '3') await menuMinecraft();
  else if (c === '4') await menuInterrupteurs();
  else if (c === '5') await menuNombres();
  else if (c === '6') { rl.pause(); await lancer(process.execPath, ['scripts/doctor.js']); rl.resume(); }
}

if (modifiees.size) {
  console.log(`\n${G}${modifiees.size} reglage(s) modifie(s)${N} : ${[...modifiees].join(', ')}`);
  const r = ferme ? 'n' : (await demander('Redemarrer les process maintenant ? [O/n] ')).trim();
  if (!ferme) rl.close();
  if (ferme) console.log('Entree fermee : applique avec  donut restart');
  if (!/^n/i.test(r)) {
    // delete + start : un pm2 restart ne relit ni ecosystem.config.cjs ni le .env.
    for (const app of ['fr-discord', 'fr-ingame']) {
      try {
        await run('pm2', ['describe', app]);
        await run('pm2', ['delete', app]);
        await run('pm2', ['start', 'ecosystem.config.cjs', '--only', app]);
        console.log(`  ${V}${app} redemarre${N}`);
      } catch { console.log(`  ${D}${app} non gere par pm2, rien a faire${N}`); }
    }
  }
} else {
  console.log(`\n${D}Rien de modifie.${N}`);
  if (!ferme) rl.close();
}
