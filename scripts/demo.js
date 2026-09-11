// Demonstration hors ligne du flux de verification, sans Discord ni Minecraft.
//   node scripts/demo.js
import { rmSync } from 'node:fs';
import { writeFile, appendFile } from 'node:fs/promises';

process.env.DB_PATH = './data/demo.db';
process.env.PAYMENT_FILE = './data/demo.jsonl';
for (const f of ['./data/demo.db', './data/demo.db-wal', './data/demo.db-shm']) rmSync(f, { force: true });
await writeFile('./data/demo.jsonl', '');

const { startLink } = await import('../src/link/manager.js');
const { PaymentWatcher } = await import('../src/link/watcher.js');
const { store } = await import('../src/db.js');
const { config } = await import('../src/config.js');

const RYAN = '111', VOLEUR = '222';
const step = (t) => console.log(`\n>> ${t}`);

step('Ryan lance /link Sp4cz');
const ch = startLink(RYAN, 'Sp4cz');
console.log(`   le bot demande : /pay ${config.mc.linkAccount} ${ch.amount}`);

step('Un voleur lance /link RafT81 et apprend le montant de Ryan');
const chVoleur = startLink(VOLEUR, 'RafT81');
console.log(`   montant du voleur : ${chVoleur.amount} (different, garanti unique)`);

const watcher = new PaymentWatcher({ file: './data/demo.jsonl', pollMs: 40 });
const seen = [];
watcher.on('payment', (r) => seen.push(r.outcome));
await watcher.start();

const send = async (line) => {
  await appendFile('./data/demo.jsonl', JSON.stringify({ raw: line, at: Date.now() }) + '\n');
  await new Promise((r) => setTimeout(r, 120));
};

step('Le voleur paie le montant de Ryan depuis SON compte');
await send(`RafT81 paid you $${ch.amount}`);
console.log(`   resultat : ${seen.at(-1)} · lien de Ryan : ${store.getLink(RYAN)?.mc_name ?? 'aucun'}`);

step('Le voleur ecrit la ligne dans le chat public pour tromper le bot');
await send(`[VIP] RafT81: Sp4cz paid you $${ch.amount}`);
console.log(`   resultat : ligne ignoree (${seen.length} paiements retenus au total)`);

step('Sp4cz paie le bon montant');
await send(`Sp4cz paid you $${ch.amount}`);
console.log(`   resultat : ${seen.at(-1)} · lien de Ryan : ${store.getLink(RYAN)?.mc_name ?? 'aucun'}`);

step('Sp4cz essaie de relier son compte a un second Discord');
try { startLink('333', 'Sp4cz'); } catch (e) { console.log(`   refuse : ${e.code}`); }

watcher.stop();
console.log(`\n${store.countLinks()} compte(s) lie(s). Demo terminee.`);
