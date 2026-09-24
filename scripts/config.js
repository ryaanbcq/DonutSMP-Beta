// Menu de configuration du bot. Tout ce qui se regle sans ouvrir le .env :
// token, serveur, roles et salons choisis dans une liste lue sur Discord,
// admins, compte Minecraft, interrupteurs, valeurs.
//
//   donut config            (ou node scripts/config.js)
//
// Fleches pour naviguer, Entree pour ouvrir, q pour revenir. Sans clavier
// (entree redirigee) le meme menu s affiche numerote.

import 'dotenv/config';
import { readFile, writeFile, chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  menu, saisie, confirmer, pause, demander, fermer, effacer, banniere, degrade,
  masquer, entreeFermee, tty,
  RESET, GRAS, PALE, BLEU, OR, VERT, ROUGE, JAUNE, GRIS,
} from './lib/tui.js';
import { lienInvitation } from './lib/discord-setup.js';

const run = promisify(execFile);
const API = 'https://discord.com/api/v10';
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

const vide = `${PALE}vide${RESET}`;
const val = (v) => (v ? `${OR}${v}${RESET}` : vide);

// ------------------------------------------------------------------ discord
// Les noms de roles et de salons sont relus a chaque ecran mais le serveur ne
// change pas toutes les secondes : un cache evite de repayer trois appels par
// affichage, il saute des qu on ecrit quelque chose.
let cache = {};
const oublier = () => { cache = {}; };

async function api(chemin) {
  if (cache[chemin]) return cache[chemin];
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('pas de token');
  const res = await fetch(`${API}${chemin}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'donutsmp-fr-bot config' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
  cache[chemin] = await res.json();
  return cache[chemin];
}

const guilde = () => process.env.DISCORD_GUILD_ID;

async function roles() {
  try { return await api(`/guilds/${guilde()}/roles`); } catch { return null; }
}
async function salons() {
  try { return await api(`/guilds/${guilde()}/channels`); } catch { return null; }
}

async function nomRole(id) {
  if (!id) return '';
  const rs = await roles();
  if (!rs) return `${PALE}${id}${RESET}`;
  const r = rs.find((x) => x.id === id);
  return r ? `${OR}${r.name}${RESET}` : `${ROUGE}introuvable${RESET} ${PALE}${id}${RESET}`;
}

async function nomSalon(id) {
  if (!id) return '';
  const cs = await salons();
  const c = cs?.find((x) => x.id === id);
  return c ? `${OR}#${c.name}${RESET}` : `${ROUGE}introuvable${RESET} ${PALE}${id}${RESET}`;
}

/** Ecran de choix : la liste du serveur, plus « aucun » et « id a la main ». */
async function choisirDansListe({ titre, sous, elements, actuel }) {
  if (!elements) {
    effacer();
    banniere(titre, 'liste illisible');
    console.log(`\n  ${ROUGE}Discord n a pas repondu.${RESET} Verifie le token et le serveur.\n`);
    await pause();
    return undefined;
  }
  const items = elements.map((e) => ({
    cle: e.id,
    libelle: e.nom,
    etat: e.id === actuel ? 'ok' : undefined,
    note: e.id === actuel ? 'actuel' : '',
    valeur: `${PALE}${e.id}${RESET}`,
  }));
  items.push({ separateur: '' });
  items.push({ cle: '__vide', libelle: `${PALE}aucun (vider)${RESET}` });
  items.push({ cle: '__id', libelle: `${PALE}saisir un id a la main${RESET}` });

  const c = await menu({ titre, sous, items, aide: '↑↓ naviguer   ↵ choisir   q annuler' });
  if (c === null) return undefined;
  if (c === '__vide') return '';
  if (c === '__id') {
    const r = await saisie('Id Discord', actuel, { aide: 'clic droit sur le role ou le salon, Copier l identifiant' });
    return r;
  }
  return c;
}

async function choisirRole(cle, titre) {
  const rs = await roles();
  const elements = rs && rs
    .filter((r) => r.id !== guilde() && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, nom: r.name }));
  const choix = await choisirDansListe({ titre, sous: 'roles du serveur', elements, actuel: process.env[cle] });
  if (choix !== undefined) { await poser(cle, choix); oublier(); }
}

async function choisirSalon(cle, titre, types = [0]) {
  const cs = await salons();
  const cats = new Map((cs ?? []).filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const elements = cs && cs
    .filter((c) => types.includes(c.type))
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ id: c.id, nom: `#${c.name}  ${PALE}${cats.get(c.parent_id) ?? ''}${RESET}` }));
  const choix = await choisirDansListe({ titre, sous: 'salons du serveur', elements, actuel: process.env[cle] });
  if (choix !== undefined) { await poser(cle, choix); oublier(); }
}

async function choisirServeur() {
  let gs = [];
  try { gs = await api('/users/@me/guilds'); } catch { gs = []; }
  if (gs.length === 0) {
    effacer();
    banniere('Serveur', 'le bot n est sur aucun serveur');
    console.log(`\n  Invite le, puis reviens ici :\n`);
    console.log(`  ${BLEU}${lienInvitation(process.env.DISCORD_CLIENT_ID)}${RESET}\n`);
    await pause();
    return;
  }
  const choix = await choisirDansListe({
    titre: 'Serveur du bot',
    sous: 'la ou le bot est deja invite',
    elements: gs.map((g) => ({ id: g.id, nom: g.name })),
    actuel: guilde(),
  });
  if (choix) { await poser('DISCORD_GUILD_ID', choix); oublier(); }
}

// -------------------------------------------------------------------- ecrans
async function ecranDiscord() {
  for (;;) {
    const txt = await texteEnv();
    let identite = `${ROUGE}token absent${RESET}`;
    let etatToken = 'ko';
    if (lire(txt, 'DISCORD_TOKEN')) {
      try { const me = await api('/users/@me'); identite = `${VERT}${me.username}${RESET}`; etatToken = 'ok'; }
      catch { identite = `${ROUGE}refuse par Discord${RESET}`; }
    }
    let serveur = vide;
    let etatServeur = 'ko';
    if (guilde()) {
      try {
        const gs = await api('/users/@me/guilds');
        const g = gs.find((x) => x.id === guilde());
        if (g) { serveur = `${OR}${g.name}${RESET}`; etatServeur = 'ok'; }
        else serveur = `${ROUGE}le bot n y est pas${RESET}`;
      } catch { serveur = `${PALE}${guilde()}${RESET}`; etatServeur = 'tiede'; }
    }

    const c = await menu({
      titre: '  DISCORD',
      sous: 'identite du bot, serveur, roles et salons',
      items: [
        { cle: 'token', libelle: 'Token', valeur: masquer(lire(txt, 'DISCORD_TOKEN')) || vide, note: identite, etat: etatToken },
        { cle: 'serveur', libelle: 'Serveur', valeur: serveur, etat: etatServeur },
        { separateur: 'roles' },
        { cle: 'verifie', libelle: 'Role des verifies', valeur: (await nomRole(lire(txt, 'VERIFIED_ROLE_ID'))) || vide, etat: lire(txt, 'VERIFIED_ROLE_ID') ? 'ok' : 'off' },
        { cle: 'bypass', libelle: 'Role beta (bypass)', valeur: (await nomRole(lire(txt, 'BYPASS_ROLE_ID'))) || vide, note: lire(txt, 'BYPASS_ROLE_ID') ? 'a vider en prod' : '', etat: lire(txt, 'BYPASS_ROLE_ID') ? 'tiede' : 'off' },
        { cle: 'top', libelle: 'Role du premier', valeur: (await nomRole(lire(txt, 'BALTOP_TOP_ROLE_ID'))) || vide, etat: lire(txt, 'BALTOP_TOP_ROLE_ID') ? 'ok' : 'off' },
        { separateur: 'salons' },
        { cle: 'logs', libelle: 'Salon des logs', valeur: (await nomSalon(lire(txt, 'LOG_CHANNEL_ID'))) || vide, etat: lire(txt, 'LOG_CHANNEL_ID') ? 'ok' : 'off' },
        { cle: 'classement', libelle: 'Salon du classement', valeur: (await nomSalon(lire(txt, 'BALTOP_CHANNEL_ID'))) || vide, etat: lire(txt, 'BALTOP_CHANNEL_ID') ? 'ok' : 'off' },
        { cle: 'connexion', libelle: 'Salon de connexion', valeur: (await nomSalon(lire(txt, 'LINK_CHANNEL_ID'))) || vide, etat: lire(txt, 'LINK_CHANNEL_ID') ? 'ok' : 'off' },
        { cle: 'journal', libelle: 'Salon du journal', valeur: (await nomSalon(lire(txt, 'OPS_CHANNEL_ID'))) || vide, note: 'pannes et activite, staff', etat: lire(txt, 'OPS_CHANNEL_ID') ? 'ok' : 'off' },
        { separateur: '' },
        { cle: 'logo', libelle: 'Logo des embeds', valeur: val(lire(txt, 'LOGO_URL')), note: 'vide = avatar du bot' },
      ],
    });
    if (c === null) return;
    if (c === 'token') { await lancer(process.execPath, ['scripts/setup.js', '--new']); await recharger(); oublier(); }
    else if (c === 'serveur') await choisirServeur();
    else if (c === 'verifie') await choisirRole('VERIFIED_ROLE_ID', 'Role donne aux comptes verifies');
    else if (c === 'bypass') await choisirRole('BYPASS_ROLE_ID', 'Role beta qui saute le /link');
    else if (c === 'top') await choisirRole('BALTOP_TOP_ROLE_ID', 'Role du premier du classement');
    else if (c === 'logs') await choisirSalon('LOG_CHANNEL_ID', 'Salon des logs');
    else if (c === 'classement') await choisirSalon('BALTOP_CHANNEL_ID', 'Salon du classement');
    else if (c === 'connexion') await choisirSalon('LINK_CHANNEL_ID', 'Salon de connexion');
    else if (c === 'journal') await choisirSalon('OPS_CHANNEL_ID', 'Salon du journal du bot');
    else if (c === 'logo') await editer('LOGO_URL', 'Logo des embeds', 'URL publique, jamais une piece jointe Discord (elle expire)');
  }
}

async function ecranAdmin() {
  for (;;) {
    const txt = await texteEnv();
    const ids = lire(txt, 'ADMIN_USER_IDS').split(',').map((s) => s.trim()).filter(Boolean);
    const c = await menu({
      titre: '  ADMINISTRATEURS',
      sous: 'qui a acces aux commandes staff du bot',
      entete: `\n  ${PALE}La permission Discord « Gerer le serveur » ouvre toujours l acces.${RESET}`
        + `\n  ${PALE}Ces deux reglages s y ajoutent, ils ne la remplacent pas.${RESET}`,
      items: [
        { cle: 'role', libelle: 'Role admin', valeur: (await nomRole(lire(txt, 'ADMIN_ROLE_ID'))) || vide, etat: lire(txt, 'ADMIN_ROLE_ID') ? 'ok' : 'off' },
        { cle: 'ids', libelle: 'Membres admin', valeur: ids.length ? `${OR}${ids.length} id(s)${RESET}  ${PALE}${ids.join(', ')}${RESET}` : vide, etat: ids.length ? 'ok' : 'off' },
      ],
    });
    if (c === null) return;
    if (c === 'role') await choisirRole('ADMIN_ROLE_ID', 'Role qui donne l acces staff');
    else if (c === 'ids') await editer('ADMIN_USER_IDS', 'Membres admin', 'ids Discord separes par des virgules');
  }
}

async function ecranMinecraft() {
  for (;;) {
    const txt = await texteEnv();
    const dossier = lire(txt, 'MC_PROFILES_FOLDER') || './data/msa-cache';
    let jeton = `${ROUGE}absent${RESET}`;
    let etatJeton = 'ko';
    if (await access(dossier, constants.F_OK).then(() => true, () => false)) {
      try { await run(process.execPath, ['scripts/auth.js', '--check'], { timeout: 60_000 }); jeton = `${VERT}valide${RESET}`; etatJeton = 'ok'; }
      catch { jeton = `${ROUGE}expire${RESET}`; }
    }
    const c = await menu({
      titre: '  COMPTE MINECRAFT',
      sous: 'le compte qui encaisse les paiements de verification',
      items: [
        { cle: 'pseudo', libelle: 'Pseudo receveur', valeur: val(lire(txt, 'MC_LINK_ACCOUNT')), note: 'jamais le compte du casino', etat: lire(txt, 'MC_LINK_ACCOUNT') ? 'ok' : 'ko' },
        { cle: 'mail', libelle: 'Adresse Microsoft', valeur: val(lire(txt, 'MC_EMAIL')), etat: lire(txt, 'MC_EMAIL') ? 'ok' : 'off' },
        { cle: 'auth', libelle: 'Jeton prismarine', valeur: jeton, note: dossier, etat: etatJeton },
        { separateur: '' },
        { cle: 'serveur', libelle: 'Serveur', valeur: `${OR}${lire(txt, 'MC_HOST')}:${lire(txt, 'MC_PORT')}${RESET}`, note: `version ${lire(txt, 'MC_VERSION') || 'auto'}` },
        { cle: 'api', libelle: 'Cle API DonutSMP', valeur: masquer(lire(txt, 'DONUT_API_KEY')) || vide, note: 'saisie a la main', etat: lire(txt, 'DONUT_API_KEY') ? 'ok' : 'off' },
      ],
    });
    if (c === null) return;
    if (c === 'pseudo') await editer('MC_LINK_ACCOUNT', 'Pseudo du compte receveur', 'jamais le compte du casino : un link serait relu comme un depot');
    else if (c === 'mail') await editer('MC_EMAIL', 'Adresse du compte Microsoft');
    else if (c === 'auth') {
      effacer();
      banniere('  CONNEXION MICROSOFT', 'un code a saisir dans un navigateur, aucun mot de passe ici');
      console.log('');
      await lancer(process.execPath, ['scripts/auth.js', '--force']);
      await pause();
    } else if (c === 'serveur') {
      await editer('MC_HOST', 'Hote du serveur');
      await editer('MC_PORT', 'Port');
      await editer('MC_VERSION', 'Version', 'vide = detection automatique');
    } else if (c === 'api') await editer('DONUT_API_KEY', 'Cle API DonutSMP', 'sans elle, pas de /baltop ni de /stats', true);
  }
}

const INTERRUPTEURS = [
  ['REFUND_ENABLED', 'Rembourser le paiement de verification', ''],
  ['BALANCE_POLL', 'Relever les soldes en jeu', '/balance, pour le classement'],
  ['DISCORD_MESSAGE_CONTENT', 'Intent Message Content', 'a cocher aussi dans le portail dev'],
  ['DONUT_MOCK', 'Faux soldes de developpement', 'jamais en prod'],
];

async function ecranInterrupteurs() {
  for (;;) {
    const txt = await texteEnv();
    const items = INTERRUPTEURS.map(([cle, nom, note]) => {
      const on = lire(txt, cle) === 'true';
      const danger = cle === 'DONUT_MOCK' && on;
      return {
        cle,
        libelle: nom,
        valeur: on ? `${danger ? ROUGE : VERT}on${RESET}` : `${PALE}off${RESET}`,
        note: danger ? `${ROUGE}de faux soldes seraient publies${RESET}` : note,
        etat: on ? (danger ? 'ko' : 'ok') : 'off',
      };
    });
    const source = lire(txt, 'PAYMENT_SOURCE');
    items.push({ separateur: '' });
    items.push({
      cle: 'PAYMENT_SOURCE',
      libelle: 'Source des paiements',
      valeur: source === 'jsonl' ? `${VERT}jsonl${RESET}` : `${JAUNE}mock${RESET}`,
      note: source === 'jsonl' ? 'le bot en jeu ecrit le fichier' : 'injection a la main, dev seulement',
      etat: source === 'jsonl' ? 'ok' : 'tiede',
    });

    const c = await menu({
      titre: '  INTERRUPTEURS',
      sous: 'Entree bascule la ligne',
      items,
      aide: '↑↓ naviguer   ↵ basculer   q revenir',
    });
    if (c === null) return;
    if (c === 'PAYMENT_SOURCE') await poser('PAYMENT_SOURCE', source === 'jsonl' ? 'mock' : 'jsonl');
    else await poser(c, lire(txt, c) === 'true' ? 'false' : 'true');
  }
}

const NOMBRES = [
  ['LINK_TTL_MINUTES', 'Validite d un challenge', 'minutes'],
  ['LINK_AMOUNT_MIN', 'Montant minimum tire', ''],
  ['LINK_AMOUNT_MAX', 'Montant maximum tire', ''],
  ['REFUND_DELAY_MIN_S', 'Delai avant remboursement, min', 'secondes'],
  ['REFUND_DELAY_MAX_S', 'Delai avant remboursement, max', 'secondes'],
  ['REFUND_DAILY_MAX', 'Total rembourse par jour', 'garde-fou'],
  ['BALTOP_CYCLE_MINUTES', 'Tour de classement complet', 'minutes'],
  ['BALANCE_INTERVAL_S', 'Espacement entre deux /balance', 'secondes'],
  ['BALANCE_CYCLE_MINUTES', 'Releve de tous les soldes', 'minutes'],
];

async function ecranNombres() {
  for (;;) {
    const txt = await texteEnv();
    const c = await menu({
      titre: '  VALEURS',
      sous: 'delais, montants, cycles',
      items: NOMBRES.map(([cle, nom, unite]) => ({
        cle, libelle: nom, valeur: val(lire(txt, cle)), note: unite,
      })),
    });
    if (c === null) return;
    const e = NOMBRES.find((x) => x[0] === c);
    await editer(c, e[1], e[2]);
  }
}

// ----------------------------------------------------------------- communs
async function editer(cle, libelle, aide = '', secret = false) {
  const actuel = lire(await texteEnv(), cle);
  const r = await saisie(libelle, actuel, { secret, aide: `${aide}${aide ? '   ' : ''}Entree = garder, « - » = vider` });
  if (r !== undefined) await poser(cle, r);
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

async function redemarrer() {
  for (const app of ['fr-discord', 'fr-ingame']) {
    try {
      await run('pm2', ['describe', app]);
      await run('pm2', ['delete', app]);
      await run('pm2', ['start', 'ecosystem.config.cjs', '--only', app]);
      console.log(`  ${VERT}●${RESET} ${app} redemarre`);
    } catch {
      console.log(`  ${PALE}○ ${app} n est pas gere par pm2${RESET}`);
    }
  }
}

// -------------------------------------------------------------------- boucle
await recharger();

for (;;) {
  const txt = await texteEnv();
  const aToken = Boolean(lire(txt, 'DISCORD_TOKEN'));
  const aServeur = Boolean(lire(txt, 'DISCORD_GUILD_ID'));
  const aCompte = Boolean(lire(txt, 'MC_LINK_ACCOUNT'));
  const pret = aToken && aServeur && aCompte;
  const admins = Boolean(lire(txt, 'ADMIN_ROLE_ID') || lire(txt, 'ADMIN_USER_IDS'));

  const c = await menu({
    titre: '  DONUTSMP FR  ·  configuration',
    sous: process.cwd(),
    entete: pret
      ? `\n  ${VERT}●${RESET} ${PALE}token, serveur et compte en jeu sont poses${RESET}`
      : `\n  ${JAUNE}●${RESET} ${PALE}il manque ${[!aToken && 'le token', !aServeur && 'le serveur', !aCompte && 'le compte en jeu'].filter(Boolean).join(', ')}${RESET}`,
    items: [
      { cle: 'discord', libelle: 'Discord', note: 'token, serveur, roles, salons', etat: aToken && aServeur ? 'ok' : 'ko' },
      { cle: 'admin', libelle: 'Administrateurs', note: 'acces aux commandes staff', etat: admins ? 'ok' : 'off' },
      { cle: 'mc', libelle: 'Compte Minecraft', note: 'pseudo, Microsoft, cle API', etat: aCompte ? 'ok' : 'ko' },
      { cle: 'switch', libelle: 'Interrupteurs', note: 'remboursements, releves, mock' },
      { cle: 'nombres', libelle: 'Valeurs', note: 'delais, montants, cycles' },
      { separateur: '' },
      { cle: 'doctor', libelle: 'Diagnostic', note: 'relance le doctor' },
      { cle: 'quitter', libelle: 'Quitter', note: modifiees.size ? `${modifiees.size} reglage(s) modifie(s)` : '' },
    ],
    aide: '↑↓ naviguer   ↵ ouvrir   1-9 acces direct   q quitter',
  });

  if (c === null || c === 'quitter') break;
  if (c === 'discord') await ecranDiscord();
  else if (c === 'admin') await ecranAdmin();
  else if (c === 'mc') await ecranMinecraft();
  else if (c === 'switch') await ecranInterrupteurs();
  else if (c === 'nombres') await ecranNombres();
  else if (c === 'doctor') {
    effacer();
    banniere('  DIAGNOSTIC', 'rien n est modifie');
    console.log('');
    await lancer(process.execPath, ['scripts/doctor.js']);
    await pause();
  }
}

effacer();
banniere('  DONUTSMP FR  ·  configuration');
if (modifiees.size) {
  console.log(`\n  ${GRAS}${modifiees.size} reglage(s) modifie(s)${RESET}  ${PALE}${[...modifiees].join(', ')}${RESET}\n`);
  if (entreeFermee()) {
    console.log(`  ${PALE}Entree fermee : applique avec${RESET} ${BLEU}donut restart${RESET}\n`);
  } else if (await confirmer('Redemarrer les process maintenant ?')) {
    console.log('');
    await redemarrer();
    console.log('');
  } else {
    console.log(`\n  ${PALE}A appliquer plus tard avec${RESET} ${BLEU}donut restart${RESET}\n`);
  }
} else {
  console.log(`\n  ${PALE}Rien de modifie.${RESET}\n`);
}
fermer();
process.exit(0);
