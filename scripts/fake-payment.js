// Dev local : simule un paiement recu en jeu.
//   npm run pay -- Sp4cz 743
//   npm run pay -- "Sp4cz paid you \$743"
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../src/config.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: npm run pay -- <pseudo> <montant>   ou   npm run pay -- "<ligne de chat brute>"');
  process.exit(1);
}

const line = args.length >= 2
  ? `${args[0]} paid you $${args[1]}`
  : args[0];

await mkdir(dirname(config.payments.file), { recursive: true });
await appendFile(config.payments.file, JSON.stringify({ raw: line, at: Date.now() }) + '\n');
console.log(`ecrit dans ${config.payments.file} : ${line}`);
