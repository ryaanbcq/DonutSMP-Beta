// Branche le bot sur Discord, de bout en bout, sans id a copier coller.
//
//   1. token       colle une fois (le seul secret qu une machine ne devine pas)
//   2. serveur     lien d invitation, puis on ATTEND que le bot arrive ;
//                  plusieurs serveurs : on choisit dans une liste
//   3. droits      verifies, et relien d invitation si il en manque
//   4. intent      Message Content (import des anciens vouches, transcripts) :
//                  on attend qu il soit coche dans le portail
//   5. roles et salons manquants : crees a la demande
//
// Le TOKEN ne se pull pas : Discord ne l expose par aucune API, il n est visible
// qu une fois dans le portail dev (Applications > ton app > Bot > Reset Token).
// Il est lu sur stdin pour ne trainer ni dans l historique du shell ni dans la
// liste des process.
//
//   node scripts/setup.js            (relancable : saute ce qui est fait)
//   node scripts/setup.js --new      saisir un autre token
//   node scripts/setup.js --auto     aucune question ni attente (CI)
//   pbpaste | node scripts/setup.js  token deja dans le presse papier

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { stdin } from 'node:process';
import {
  menu, demander, confirmer, fermer, RESET, PALE, BLEU, VERT, JAUNE, ROUGE, GRAS,
} from './lib/tui.js';
import {
  client, lienInvitation, lienPortailBot, aMessageContent, droitsDuBot, droitsManquants,
  attendre, creerManquants, A_CREER,
} from './lib/discord-setup.js';

const AUTO = process.argv.includes('--auto');
const interactif = Boolean(stdin.isTTY) && !AUTO;

const mask = (t) => (t.length > 12 ? `${t.slice(0, 6)}...${t.slice(-4)}` : '***');
const ok = (t) => console.log(`  ${VERT}✓${RESET} ${t}`);
const attention = (t) => console.log(`  ${JAUNE}!${RESET} ${t}`);
const etape = (t) => console.log(`\n${GRAS}${t}${RESET}`);
const lien = (u) => console.log(`\n    ${BLEU}${u}${RESET}\n`);

function echec(message, conseil = '') {
  console.error(`\n  ${ROUGE}✗${RESET} ${message}`);
  if (conseil) console.error(`    ${conseil}`);
  fermer();
  process.exit(1);
}

async function readToken() {
  // Deja configure : on reutilise le token plutot que de le redemander.
  if (process.env.DISCORD_TOKEN && !process.argv.includes('--new')) {
    ok(`token repris du .env (${mask(process.env.DISCORD_TOKEN.trim())})`);
    return process.env.DISCORD_TOKEN.trim();
  }
  if (!stdin.isTTY) {
    const piped = await new Promise((resolve) => {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { buf += c; });
      stdin.on('end', () => resolve(buf));
    });
    return piped.trim();
  }
  console.log(`  Ouvre ${BLEU}https://discord.com/developers/applications${RESET}`);
  console.log('  > ton application (ou « New Application ») > Bot > Reset Token, puis colle le ici.');
  return (await demander('  Token du bot : ')).trim();
}

async function patchEnv(values) {
  let content = '';
  try { content = await readFile('.env', 'utf8'); }
  catch { content = await readFile('.env.example', 'utf8'); }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
    process.env[key] = value;
  }
  await writeFile('.env', content, { mode: 0o600 });
}

// ------------------------------------------------------------------- token
etape('Discord : token');
const token = await readToken();
if (!token) echec('Aucun token fourni.');
if (!/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(token)) {
  echec('Ca ne ressemble pas a un token de bot (trois blocs separes par des points).',
    'Le CLIENT SECRET et le token sont deux choses differentes : il faut le token, onglet Bot.');
}

const api = client(token);
let app;
let me;
try {
  app = await api.get('/oauth2/applications/@me');
  me = await api.get('/users/@me');
} catch (e) {
  if (e.status === 401) echec('Token refuse par Discord.', 'Il a sans doute ete regenere : Reset Token, puis `donut token`.');
  echec(`Discord ne repond pas (${e.message}).`, 'Verifie la connexion internet de la machine.');
}
await patchEnv({ DISCORD_TOKEN: token, DISCORD_CLIENT_ID: app.id });
ok(`bot ${me.username}, application ${app.name}`);

// ----------------------------------------------------------------- serveur
etape('Discord : serveur');
const serveurs = async () => api.get('/users/@me/guilds');
let guilds = await serveurs().catch(() => []);

if (guilds.length === 0) {
  console.log('  Le bot n est encore sur aucun serveur. Ouvre ce lien et choisis ton serveur :');
  lien(lienInvitation(app.id));
  if (!interactif) echec('Invite le bot puis relance.');
  console.log(`  ${PALE}J attends qu il arrive (Ctrl+C pour abandonner)...${RESET}`);
  guilds = await attendre(async () => {
    const g = await serveurs();
    return g.length ? g : null;
  }) ?? echec('Toujours aucun serveur au bout de 15 min.', 'Relance `donut setup` une fois le bot invite.');
}

let guild = guilds.find((g) => g.id === process.env.DISCORD_GUILD_ID);
if (!guild && guilds.length === 1) [guild] = guilds;
if (!guild) {
  if (!interactif) echec('Le bot est sur plusieurs serveurs : choisis le tien avec `donut config`.');
  const id = await menu({
    titre: '  SERVEUR DU BOT',
    sous: 'le bot est invite sur plusieurs serveurs',
    items: guilds.map((g) => ({ cle: g.id, libelle: g.name, note: g.id })),
    aide: '↑↓ naviguer   ↵ choisir',
  });
  guild = guilds.find((g) => g.id === id) ?? echec('Aucun serveur choisi.');
}
await patchEnv({ DISCORD_GUILD_ID: guild.id });
ok(`serveur ${guild.name}`);

// ------------------------------------------------------------------ droits
etape('Discord : droits du bot');
let manquants = droitsManquants(await droitsDuBot(api, guild.id, me.id));
if (manquants.length) {
  attention(`il manque : ${manquants.join(', ')}`);
  console.log('  Reautorise le bot avec ce lien (il ne quitte pas le serveur, ses droits sont juste completes) :');
  lien(lienInvitation(app.id, guild.id));
  if (interactif) {
    console.log(`  ${PALE}J attends...${RESET}`);
    await attendre(async () => droitsManquants(await droitsDuBot(api, guild.id, me.id)).length === 0);
    manquants = droitsManquants(await droitsDuBot(api, guild.id, me.id));
  }
}
if (manquants.length) attention('droits encore incomplets : tickets, fils ou role des verifies peuvent echouer');
else ok('tous les droits necessaires');

// ------------------------------------------------------------------ intent
etape('Discord : lecture des messages');
if (aMessageContent(app)) {
  ok('intent Message Content actif');
  await patchEnv({ DISCORD_MESSAGE_CONTENT: 'true' });
} else {
  console.log('  Pour importer les anciens vouches, le bot doit pouvoir lire le texte des messages.');
  console.log('  Sur cette page, active « Message Content Intent » puis « Save Changes » :');
  lien(lienPortailBot(app.id));
  let actif = false;
  if (interactif) {
    console.log(`  ${PALE}J attends...${RESET}`);
    actif = Boolean(await attendre(async () => aMessageContent(await api.get('/oauth2/applications/@me')), { delaiMs: 10 * 60_000 }));
  }
  // Demander l intent sans qu il soit coche : Discord refuse la connexion.
  await patchEnv({ DISCORD_MESSAGE_CONTENT: actif ? 'true' : 'false' });
  if (actif) ok('intent Message Content actif');
  else attention('intent absent : le bot tourne, mais sans import de vouches ni texte dans les transcripts');
}

// ------------------------------------------------------- roles et salons
etape('Discord : roles et salons');
const aFaire = A_CREER.filter((x) => !process.env[x.cle]);
if (!aFaire.length) {
  ok('deja configures (a changer : `donut config`)');
} else {
  console.log(`  A poser : ${aFaire.map((x) => (x.type === 'role' ? `role ${x.nom}` : `#${x.nom}`)).join(', ')}`);
  // Sans clavier (script, CI) : on cree, sauf --auto qui ne touche a rien.
  const creer = interactif
    ? await confirmer('Je les cree sur ton serveur ? (non = les choisir toi meme avec `donut config`)')
    : !AUTO;
  if (creer) {
    try {
      const poses = await creerManquants(api, {
        guildId: guild.id,
        botId: me.id,
        env: process.env,
        adminRoleId: process.env.ADMIN_ROLE_ID ?? '',
        journal: ok,
      });
      await patchEnv(poses);
    } catch (e) {
      attention(`creation interrompue (${e.message}) : relance \`donut setup\`, rien ne sera cree en double`);
    }
  } else {
    attention('a choisir avec `donut config` > Discord');
  }
}

console.log(`\n  ${VERT}Discord est branche.${RESET} ${PALE}.env ecrit en chmod 600, le token n a jamais ete affiche.${RESET}`);
fermer();
process.exit(0);
