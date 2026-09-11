// Transfere des emojis vers l APPLICATION elle meme.
//
// Un bot ne peut afficher un emoji custom que s il est membre du serveur qui
// l heberge. Les emojis d application, eux, marchent partout ou l app poste,
// sans l inviter nulle part. On recupere donc l image sur le CDN public et on
// la reattache a l application.
//
//   node scripts/emojis-app.js list
//   node scripts/emojis-app.js add "<a:1Trophy:1537519553268023429>" ...
import 'dotenv/config';

const API = 'https://discord.com/api/v10';
const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_CLIENT_ID;
const h = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };

if (!token || !appId) {
  console.error('DISCORD_TOKEN et DISCORD_CLIENT_ID requis.');
  process.exit(1);
}

async function lister() {
  const res = await fetch(`${API}/applications/${appId}/emojis`, { headers: h });
  const body = await res.json();
  return body.items ?? [];
}

function analyser(texte) {
  const m = String(texte).match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d+)>$/);
  if (!m) return null;
  return { anime: m[1] === 'a', nom: m[2], id: m[3] };
}

async function telecharger({ id, anime }) {
  const url = `https://cdn.discordapp.com/emojis/${id}.${anime ? 'gif' : 'png'}?size=128`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image introuvable (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/${anime ? 'gif' : 'png'};base64,${buf.toString('base64')}`;
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list') {
  const items = await lister();
  if (!items.length) console.log("L'application ne possède aucun emoji.");
  for (const e of items) console.log(`  <${e.animated ? 'a' : ''}:${e.name}:${e.id}>`);
  process.exit(0);
}

if (cmd !== 'add' || args.length === 0) {
  console.log('usage: node scripts/emojis-app.js list');
  console.log('       node scripts/emojis-app.js add "<a:nom:id>" ["<:nom:id>" ...]');
  process.exit(1);
}

const existants = await lister();
const sortie = [];

for (const brut of args) {
  const e = analyser(brut);
  if (!e) {
    console.error(`  ${brut} : format non reconnu, attendu <a:nom:id> ou <:nom:id>`);
    process.exit(1);
  }

  const deja = existants.find((x) => x.name === e.nom);
  if (deja) {
    console.log(`  ${e.nom} : deja sur l application`);
    sortie.push(`<${deja.animated ? 'a' : ''}:${deja.name}:${deja.id}>`);
    continue;
  }

  const image = await telecharger(e);
  const res = await fetch(`${API}/applications/${appId}/emojis`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ name: e.nom, image }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`  ${e.nom} : refus de Discord (${res.status}) ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`  ${e.nom} : transfere`);
  sortie.push(`<${body.animated ? 'a' : ''}:${body.name}:${body.id}>`);
}

console.log('\nEmojis de l application :');
console.log('  ' + sortie.join(' '));
console.log('\nA poser dans le classement :');
console.log('  ' + sortie.join(' '));
