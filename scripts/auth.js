// Authentifie le compte Microsoft du bot en jeu, une fois, et met le jeton en
// cache pour que `node ingame/bot.js` demarre ensuite sans rien demander.
//
//   node scripts/auth.js              utilise MC_EMAIL du .env
//   node scripts/auth.js mail@ex.com  force un autre compte
//   node scripts/auth.js --force      oublie le cache et refait l auth
//   node scripts/auth.js --check      verifie le cache sans rien afficher d autre
//
// Aucun mot de passe ne passe par ce script : Microsoft rend un code a saisir
// sur leur propre page. On ne voit jamais les identifiants du compte.

import prismarineAuth from 'prismarine-auth';
const { Authflow, Titles } = prismarineAuth;
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

const args = process.argv.slice(2);
const force = args.includes('--force');
const check = args.includes('--check');
const emailArg = args.find((a) => !a.startsWith('--'));

const cacheDir = process.env.MC_PROFILES_FOLDER ?? './data/msa-cache';
const expected = process.env.MC_LINK_ACCOUNT ?? '';

let username = emailArg ?? process.env.MC_EMAIL ?? '';
let askedForEmail = false;

if (!username) {
  // --check tourne sans sortie visible (vps-install.sh) : ne jamais poser de question.
  if (check) process.exit(2);
  if (!stdin.isTTY) {
    console.error('Aucun compte. Renseigne MC_EMAIL dans .env ou passe le en argument :');
    console.error('  node scripts/auth.js mail@exemple.com');
    process.exit(1);
  }
  console.log("L adresse du compte Microsoft du bot (celle qui possede le compte Minecraft).");
  console.log("Ce n est pas ton compte perso : c est le nouveau compte qui encaissera les paiements.\n");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    username = (await rl.question('Adresse Microsoft du bot : ')).trim();
  } catch {
    username = ''; // stdin ferme avant la reponse
  } finally {
    rl.close();
  }
  askedForEmail = true;
  if (!username) {
    console.error('\nAucune adresse saisie.');
    process.exit(1);
  }
  console.log('');
}

// Les memes reglages que mineflayer, sinon le bot ne reutiliserait pas ce cache.
const options = {
  flow: 'live',
  authTitle: Titles.MinecraftNintendoSwitch,
  deviceType: 'Nintendo',
};

function copyToClipboard(text) {
  if (process.platform !== 'darwin') return false;
  return spawnSync('pbcopy', { input: text }).status === 0;
}

function onMsaCode(res) {
  const copied = copyToClipboard(res.user_code);
  console.log('\n================ CONNEXION MICROSOFT ================');
  console.log(`  1. Ouvre   ${res.verification_uri}`);
  console.log(`  2. Code    ${res.user_code}${copied ? '   (copie dans le presse papier)' : ''}`);
  console.log(`  3. Connecte toi avec le compte du bot, pas ton compte perso.`);
  console.log(`\n  Le code expire dans ${Math.round((res.expires_in ?? 900) / 60)} min. J attends...`);
  console.log('====================================================\n');
}

async function patchEnv(key, value) {
  let content;
  try { content = await readFile('.env', 'utf8'); } catch { return false; }
  const re = new RegExp(`^${key}=.*$`, 'm');
  content = re.test(content) ? content.replace(re, `${key}=${value}`) : `${content.trimEnd()}\n${key}=${value}\n`;
  await writeFile('.env', content, { mode: 0o600 });
  return true;
}

try {
  if (force) {
    await rm(cacheDir, { recursive: true, force: true });
    console.log(`Cache ${cacheDir} efface.`);
  }
  await mkdir(cacheDir, { recursive: true });

  if (askedForEmail) await patchEnv('MC_EMAIL', username);
  if (!check) console.log(`Compte  : ${username}\nCache   : ${cacheDir}\n`);

  const flow = new Authflow(username, cacheDir, options, check ? () => {
    console.error('Le cache est vide ou expire. Relance sans --check pour refaire l auth.');
    process.exit(2);
  } : onMsaCode);

  const { profile, entitlements } = await flow.getMinecraftJavaToken({ fetchProfile: true });

  if (!profile?.name) {
    console.error('Authentifie, mais aucun profil Minecraft. Ce compte possede t il le jeu ?');
    process.exit(1);
  }

  console.log('\nConnecte.');
  console.log(`  pseudo en jeu   ${profile.name}`);
  console.log(`  uuid            ${profile.id}`);
  if (entitlements?.items?.length) console.log(`  licences        ${entitlements.items.length}`);

  if (!expected) {
    await patchEnv('MC_LINK_ACCOUNT', profile.name);
    console.log(`\nMC_LINK_ACCOUNT pose sur ${profile.name} dans .env.`);
  } else if (expected.toLowerCase() !== profile.name.toLowerCase()) {
    console.warn(`\nATTENTION : MC_LINK_ACCOUNT dit "${expected}" mais le compte est "${profile.name}".`);
    console.warn('Les joueurs paieraient le mauvais compte. Corrige .env avant de lancer le bot.');
    process.exit(1);
  }

  console.log('\nJeton en cache. `node ingame/bot.js` demarrera sans rien redemander.');
} catch (err) {
  const msg = String(err?.message ?? err);
  console.error(`\nEchec : ${msg}`);
  if (/Not Found|profile/i.test(msg)) console.error('Verifie que ce compte possede bien Minecraft Java.');
  if (/expired|timed out/i.test(msg)) console.error('Le code a expire, relance le script.');
  process.exit(1);
}
