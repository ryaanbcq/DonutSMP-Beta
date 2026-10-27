import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { db } from '../src/db.js';
import {
  exporter, importer, lireArchive, apercu, nomArchive,
} from '../src/lib/sauvegarde.js';

// Appele par `donut export` et `donut import` (voir bin/donut).
//
//   node scripts/sauvegarde.js export [dossier] [--avec-secrets]
//   node scripts/sauvegarde.js import <fichier> [--oui] [--avec-secrets]

const [action, ...reste] = process.argv.slice(2);
const drapeaux = new Set(reste.filter((a) => a.startsWith('--')));
const args = reste.filter((a) => !a.startsWith('--'));

const taille = (n) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

function afficherTables(tables) {
  const largeur = Math.max(...Object.keys(tables).map((n) => n.length));
  for (const [n, c] of Object.entries(tables)) console.log(`  ${n.padEnd(largeur)}  ${c}`);
}

function dossierDefaut() {
  const bureau = join(homedir(), 'Desktop');
  if (process.platform === 'darwin' && existsSync(bureau)) return { dossier: bureau, bureau: true };
  return { dossier: resolve('exports'), bureau: false };
}

function faireExport() {
  const secrets = drapeaux.has('--avec-secrets');
  let dossier;
  let bureau = false;
  if (args[0]) dossier = isAbsolute(args[0]) ? args[0] : resolve(args[0]);
  else ({ dossier, bureau } = dossierDefaut());
  mkdirSync(dossier, { recursive: true });

  const { archive, resume } = exporter(db, { secrets });
  const fichier = join(dossier, nomArchive());
  writeFileSync(fichier, archive, { mode: 0o600 });

  console.log('\nTables exportees (lignes) :');
  afficherTables(resume.tables);
  console.log(`\nFichiers d'etat : ${resume.fichiers.length ? resume.fichiers.join(', ') : 'aucun'}`);
  console.log(`\nSauvegarde ecrite : ${fichier}  (${taille(archive.length)})`);
  if (secrets) {
    console.log('\nATTENTION : cette archive contient le .env (token Discord) et la session Microsoft.');
    console.log('Ne la partagez avec personne, supprimez-la apres l\'import.');
  } else {
    console.log('\nSans secrets : le .env et la session Microsoft ne sont pas inclus (--avec-secrets pour les ajouter).');
  }
  if (!bureau) {
    console.log('\nPour la telecharger depuis votre ordinateur :');
    console.log(`  scp ${process.env.USER ?? 'root'}@${hostname()}:${fichier} .`);
    console.log('(remplacez le nom de machine par l\'adresse IP du serveur si besoin)');
  }
  console.log('\nSur le nouveau serveur : donut import <fichier>\n');
}

async function demander(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

async function faireImport() {
  const source = args[0];
  if (!source) {
    console.error('Usage : donut import <fichier.json.gz> [--oui] [--avec-secrets]');
    process.exit(1);
  }
  if (!existsSync(source) || !statSync(source).isFile()) {
    console.error(`Fichier introuvable : ${source}`);
    process.exit(1);
  }

  const contenu = lireArchive(readFileSync(source));
  const ap = apercu(contenu);
  const avecSecrets = drapeaux.has('--avec-secrets');

  console.log(`\nSauvegarde du ${ap.cree} (serveur d'origine : ${ap.hote})`);
  console.log('\nContenu :');
  afficherTables(ap.tables);
  console.log(`\nFichiers d'etat : ${ap.fichiers.length ? ap.fichiers.join(', ') : 'aucun'}`);
  if (ap.secrets) console.log(avecSecrets ? '\nSecrets inclus : ils seront restaures (.env, session Microsoft).' : '\nL\'archive contient des secrets, ils seront ignores (--avec-secrets pour les restaurer).');

  console.log('\nL\'import REMPLACE les donnees actuelles de ce serveur (liens, avis, dons, reglages...).');
  if (!drapeaux.has('--oui')) {
    const rep = await demander('Continuer ? [o/N] ');
    if (!['o', 'oui', 'y', 'yes'].includes(rep)) {
      console.log('Annule, rien n\'a ete modifie.');
      process.exit(2);
    }
  }

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dossierAvant = resolve('data', `avant-import-${horodatage}`);
  const { avertissements, restaures } = importer(db, contenu, { dossierAvant, avecSecrets });

  console.log(`\nImport termine : ${Object.keys(ap.tables).length} tables, ${restaures.length} fichiers restaures.`);
  for (const a of avertissements) console.log(`  ! ${a}`);
  console.log(`Ancien etat conserve dans : ${dossierAvant}\n`);
}

try {
  if (action === 'export') faireExport();
  else if (action === 'import') await faireImport();
  else {
    console.error('Usage : node scripts/sauvegarde.js export|import ...');
    process.exit(1);
  }
} catch (err) {
  console.error(`\nEchec : ${err.message}\n`);
  process.exit(1);
}
