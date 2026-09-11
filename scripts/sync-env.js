// Ajoute dans .env les cles presentes dans .env.example mais absentes, avec
// leur valeur par defaut. Ne modifie jamais une ligne deja remplie.
//   node scripts/sync-env.js
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';

const keysOf = (text) => new Set(
  text.split('\n')
    .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
);

try {
  await access('.env');
} catch {
  await copyFile('.env.example', '.env');
  console.log('.env cree depuis .env.example.');
  process.exit(0);
}

const env = await readFile('.env', 'utf8');
const example = await readFile('.env.example', 'utf8');
const present = keysOf(env);

const missing = [];
let block = [];
let keepBlock = false;

// On recopie les lignes manquantes avec leur commentaire de section.
for (const line of example.split('\n')) {
  const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
  if (!key) {
    if (line.startsWith('#') || line.trim() === '') block.push(line);
    continue;
  }
  if (present.has(key)) { block = []; continue; }
  if (block.length && !keepBlock) { missing.push(...block); keepBlock = true; }
  missing.push(line);
  block = [];
}

if (missing.length === 0) {
  console.log('.env est deja complet.');
  process.exit(0);
}

await writeFile('.env', `${env.trimEnd()}\n${missing.join('\n').trim()}\n`, { mode: 0o600 });
console.log('Cles ajoutees a .env :');
for (const l of missing) {
  const key = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (key) console.log(`  ${key[1]}${key[2] ? ` = ${key[2]}` : '   (a remplir)'}`);
}
