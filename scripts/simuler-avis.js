// Simulation : 100 avis factices sur un joueur (BETA uniquement).
// node scripts/simuler-avis.js <discord_id cible>   -> poste les avis
// node scripts/simuler-avis.js <discord_id cible> --retirer -> les efface
// Les auteurs factices ont un id qui commence par 9000000000.
import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../src/config.js';
import { db, store } from '../src/db.js';
import { posterAvis, retirerAvis, rafraichir } from '../src/vouch/fils.js';

const cible = process.argv[2];
const retirer = process.argv.includes('--retirer');
const FAUX = '9000000000';
const COMMENTAIRES = [
  'Trade rapide, rien à dire', 'Super fiable, je recommande', 'Payé direct', 'Clean, merci',
  'Deuxième trade avec lui, toujours nickel', 'Un peu lent à répondre mais honnête', 'Top vendeur',
  'Elytra reçue en 2 min', 'Il a envoyé en premier, respect', 'RAS', 'Très bon middleman',
  'Prix correct et livraison rapide', null, null, null,
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(config.discord.token);
await new Promise((r) => client.once('clientReady', r));

if (retirer) {
  const faux = store.vouchAll(cible).filter((v) => v.from_id.startsWith(FAUX));
  for (const v of faux) await retirerAvis(client, v.from_id, cible);
  console.log(`${faux.length} avis factices retirés`);
} else {
  const now = Date.now();
  const avis = [];
  for (let i = 0; i < 99; i++) {
    const r = Math.random();
    avis.push({ value: 1, stars: r < 0.8 ? 5 : r < 0.95 ? 4 : 3, jours: Math.random() * 365, comment: COMMENTAIRES[i % COMMENTAIRES.length] });
  }
  avis.push({ value: -1, stars: null, jours: 20, comment: 'M\'a pris 50M et a bloqué (simulation)' });
  avis.sort((a, b) => b.jours - a.jours);
  const maj = db.prepare('UPDATE vouches SET created_at = ? WHERE from_id = ? AND to_id = ?');
  let k = 0;
  for (const a of avis) {
    const from = FAUX + String(100000000 + k++);
    store.setVouch(from, cible, a.value, a.comment, a.stars);
    maj.run(Math.round(now - a.jours * 86_400_000), from, cible);
    await posterAvis(client, from, cible);
    if (k % 10 === 0) console.log(`${k}/100`);
  }
}
await rafraichir(client, cible);
console.log(JSON.stringify(Object.fromEntries(Object.entries((await import('../src/vouch/fils.js')).trustDe(cible)).filter(([k]) => k !== 'palier'))), (await import('../src/vouch/fils.js')).trustDe(cible).palier.nom);
await client.destroy();
