// Recupere l'identite de l'application Discord a partir du token et remplit .env.
//
// Le TOKEN ne se pull pas : Discord ne l'expose par aucune API, il n'est visible
// qu'une fois dans le portail dev (Applications > ton app > Bot > Reset Token).
// Tout le reste se deduit de lui : id de l'application, nom, serveurs, lien
// d'invitation. On lit le token sur stdin pour qu'il ne traine pas dans
// l'historique du shell ni dans la liste des process.
//
//   node scripts/setup.js
//   pbpaste | node scripts/setup.js        (token deja dans le presse papier)

import { createInterface } from 'node:readline/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';

const API = 'https://discord.com/api/v10';

// Vue + Envoyer des messages + Integrer des liens + Historique + Gerer les roles
const PERMISSIONS = 1024 + 2048 + 16384 + 65536 + 268435456;

const mask = (t) => (t.length > 12 ? `${t.slice(0, 6)}...${t.slice(-4)}` : '***');

async function api(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'donutsmp-fr-bot setup' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new Error('Token refuse par Discord. Il a peut etre ete regenere depuis.');
  if (!res.ok) throw new Error(`Discord ${res.status} sur ${path}`);
  return res.json();
}

async function readToken() {
  if (!stdin.isTTY) {
    const piped = await new Promise((resolve) => {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { buf += c; });
      stdin.on('end', () => resolve(buf));
    });
    return piped.trim();
  }
  const rl = createInterface({ input: stdin, output: stdout });
  console.log('Portail dev > ton application > Bot > Reset Token, puis colle le ici.');
  const token = (await rl.question('Token du bot : ')).trim();
  rl.close();
  return token;
}

async function patchEnv(values) {
  let content = '';
  try { content = await readFile('.env', 'utf8'); }
  catch { content = await readFile('.env.example', 'utf8'); }

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  }
  await writeFile('.env', content, { mode: 0o600 });
}

const token = await readToken();
if (!token) {
  console.error('Aucun token fourni.');
  process.exit(1);
}
if (!/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(token)) {
  console.error('Ca ne ressemble pas a un token de bot. Attendu trois blocs separes par des points.');
  console.error('Note : le CLIENT SECRET et le token sont deux choses differentes, il faut le token.');
  process.exit(1);
}

try {
  console.log(`\nToken lu (${mask(token)}), interrogation de Discord...\n`);

  const app = await api('/oauth2/applications/@me', token);
  const me = await api('/users/@me', token);
  const guilds = await api('/users/@me/guilds', token).catch(() => []);

  console.log(`Application : ${app.name}`);
  console.log(`  id            ${app.id}`);
  console.log(`  bot           ${me.username} (${me.id})`);
  console.log(`  public        ${app.bot_public ? 'oui' : 'non'}`);
  if (app.owner) console.log(`  proprietaire  ${app.owner.username ?? app.owner.id}`);

  const values = { DISCORD_TOKEN: token, DISCORD_CLIENT_ID: app.id };

  if (guilds.length === 0) {
    console.log('\nLe bot n est sur aucun serveur. Invite le avec ce lien, puis relance ce script :');
  } else {
    console.log(`\nServeurs (${guilds.length}) :`);
    for (const g of guilds) console.log(`  ${g.id}  ${g.name}`);
    if (guilds.length === 1) {
      values.DISCORD_GUILD_ID = guilds[0].id;
      console.log(`\nUn seul serveur, DISCORD_GUILD_ID pose sur ${guilds[0].name}.`);
    } else {
      console.log('\nPlusieurs serveurs : choisis le tien et mets son id dans DISCORD_GUILD_ID.');
    }
  }

  const invite = `https://discord.com/oauth2/authorize?client_id=${app.id}`
    + `&scope=bot%20applications.commands&permissions=${PERMISSIONS}`;
  console.log(`\nLien d invitation :\n  ${invite}`);

  await patchEnv(values);
  console.log('\n.env mis a jour (chmod 600). Le token n a jamais ete affiche en clair.');
  console.log('Suite : npm run deploy puis npm start');
} catch (err) {
  console.error(`\nEchec : ${err.message}`);
  if (/refuse/.test(err.message)) {
    console.error('Regenere le token dans le portail dev et relance ce script.');
  }
  process.exit(1);
}
