import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, statSync, readdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hostname } from 'node:os';
import { createHash } from 'node:crypto';

// Sauvegarde complete du bot en UN fichier, pour changer de serveur.
//
// Contenu : toutes les tables de bot.db (liens, avis, classement, dons,
// tickets, reglages... y compris celles qu'on ajoutera plus tard : la liste
// est lue dans la base, pas ecrite en dur) et les fichiers d'etat du bot en
// jeu. Les secrets (.env, session Microsoft) n'en font partie que sur demande.
//
// Les fichiers de flux (payments, events, balances, stats) voyagent AVEC la
// base : leurs offsets de lecture sont dans la table kv, les separer ferait
// relire ou perdre des lignes.

export const FORMAT = 'donutfr-sauvegarde';
export const VERSION = 1;

/** Fichiers d'etat copies tels quels. Memes variables d'environnement que le bot. */
export function fichiersEtat(env = process.env) {
  return [
    env.DONATION_FILE ?? './data/dons.json',
    env.REFUND_FILE ?? './data/refunds.json',
    env.TRACKED_FILE ?? './data/tracked.json',
    env.BOT_ACCOUNT_FILE ?? './data/compte.json',
    env.PAYMENT_FILE ?? './data/payments.jsonl',
    env.EVENTS_FILE ?? './data/events.jsonl',
    env.BALANCE_FILE ?? './data/balances.jsonl',
    env.STATS_FILE ?? './data/stats.jsonl',
  ];
}

/** Secrets : exportes seulement avec `secrets: true`. */
export function fichiersSecrets(env = process.env) {
  const msa = env.MC_PROFILES_FOLDER ?? './data/msa-cache';
  return ['./.env', ...(existsSync(msa) ? [msa] : [])];
}

// --- valeurs SQLite <-> JSON ---------------------------------------------

const versJson = (v) => (v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v);
const depuisJson = (v) => (v && typeof v === 'object' && '$b64' in v ? Buffer.from(v.$b64, 'base64') : v);

const idSql = (nom) => `"${String(nom).replace(/"/g, '""')}"`;

// --- fichiers ---------------------------------------------------------------

function lireFichier(chemin) {
  return { encodage: 'base64', contenu: readFileSync(chemin).toString('base64') };
}

function ajouterChemin(fichiers, chemin) {
  if (!existsSync(chemin)) return;
  if (statSync(chemin).isDirectory()) {
    for (const nom of readdirSync(chemin)) ajouterChemin(fichiers, join(chemin, nom));
    return;
  }
  fichiers[normaliser(chemin)] = lireFichier(chemin);
}

const normaliser = (chemin) => chemin.replace(/^\.\//, '');

function cheminSur(relatif) {
  // Une archive vient d'ailleurs : jamais de chemin absolu ni de remontee.
  const propre = normaliser(relatif);
  if (propre.startsWith('/') || propre.split('/').includes('..')) {
    throw new Error(`chemin refuse dans l'archive : ${relatif}`);
  }
  return propre;
}

// --- export ---------------------------------------------------------------

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ archive: Buffer, resume: { tables: Record<string, number>, fichiers: string[], secrets: boolean } }}
 */
export function exporter(db, { secrets = false, env = process.env, maintenant = new Date() } = {}) {
  const tables = {};
  const schema = [];

  // Une seule transaction de lecture : l'etat du bot en marche reste coherent.
  db.exec('BEGIN');
  try {
    const objets = db.prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name",
    ).all();
    for (const o of objets) schema.push({ type: o.type, name: o.name, table: o.tbl_name, sql: o.sql });

    const noms = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map((r) => r.name);
    for (const nom of noms) {
      const colonnes = db.prepare(`PRAGMA table_info(${idSql(nom)})`).all().map((c) => c.name);
      const lignes = db.prepare(`SELECT * FROM ${idSql(nom)}`).all()
        .map((r) => colonnes.map((c) => versJson(r[c])));
      tables[nom] = { colonnes, lignes };
    }
    // Compteurs AUTOINCREMENT : sans eux, un id supprime pourrait etre reattribue.
    const sequences = db.prepare('SELECT name, seq FROM sqlite_sequence').all();
    tables.sqlite_sequence = {
      colonnes: ['name', 'seq'],
      lignes: sequences.map((s) => [s.name, s.seq]),
    };
  } finally {
    db.exec('COMMIT');
  }

  const fichiers = {};
  for (const f of fichiersEtat(env)) ajouterChemin(fichiers, f);
  if (secrets) for (const f of fichiersSecrets(env)) ajouterChemin(fichiers, f);

  const contenu = {
    format: FORMAT,
    version: VERSION,
    cree: maintenant.toISOString(),
    hote: hostname(),
    secrets,
    schema,
    tables,
    fichiers,
  };
  const json = JSON.stringify(contenu);
  const archive = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });

  return {
    archive,
    resume: {
      tables: Object.fromEntries(Object.entries(tables).map(([n, t]) => [n, t.lignes.length])),
      fichiers: Object.keys(fichiers),
      secrets,
    },
  };
}

export function nomArchive(maintenant = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const d = maintenant;
  return `donutfr-sauvegarde-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json.gz`;
}

// --- lecture / validation ---------------------------------------------------

export function lireArchive(buffer) {
  let contenu;
  try {
    contenu = JSON.parse(gunzipSync(buffer).toString('utf8'));
  } catch {
    throw new Error("ce fichier n'est pas une sauvegarde du bot (gzip ou JSON illisible)");
  }
  if (contenu?.format !== FORMAT) throw new Error("ce fichier n'est pas une sauvegarde du bot (format inconnu)");
  if (contenu.version > VERSION) {
    throw new Error(`sauvegarde de version ${contenu.version}, ce bot sait lire jusqu'a la ${VERSION} : mettez-le a jour (donut update)`);
  }
  for (const [nom, t] of Object.entries(contenu.tables ?? {})) {
    if (!Array.isArray(t?.colonnes) || !Array.isArray(t?.lignes)) throw new Error(`table abimee dans l'archive : ${nom}`);
    for (const l of t.lignes) {
      if (!Array.isArray(l) || l.length !== t.colonnes.length) throw new Error(`ligne abimee dans la table ${nom}`);
    }
  }
  for (const chemin of Object.keys(contenu.fichiers ?? {})) cheminSur(chemin);
  return contenu;
}

/** Ce que l'import va faire, sans rien toucher. */
export function apercu(contenu) {
  return {
    cree: contenu.cree,
    hote: contenu.hote,
    secrets: Boolean(contenu.secrets),
    tables: Object.fromEntries(
      Object.entries(contenu.tables).filter(([n]) => n !== 'sqlite_sequence').map(([n, t]) => [n, t.lignes.length]),
    ),
    fichiers: Object.keys(contenu.fichiers ?? {}),
  };
}

// --- import ---------------------------------------------------------------

/**
 * Remplace le contenu de la base et des fichiers d'etat par celui de l'archive.
 * Les process doivent etre arretes (bin/donut s'en charge). L'ancien etat est
 * copie dans `dossierAvant` avant toute ecriture ; la base est modifiee dans
 * une seule transaction, un echec la laisse intacte.
 */
export function importer(db, contenu, { dossierAvant, avecSecrets = false, env = process.env } = {}) {
  const avertissements = [];
  const restaures = [];

  if (dossierAvant) {
    mkdirSync(dossierAvant, { recursive: true });
    // VACUUM INTO : copie coherente meme avec le journal WAL.
    const cible = join(dossierAvant, 'bot.db');
    db.exec(`VACUUM INTO '${cible.replace(/'/g, "''")}'`);
  }

  const presentes = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    // Tables inconnues de ce code (archive plus recente ou module absent) : on les cree d'apres l'archive.
    for (const o of contenu.schema ?? []) {
      if (o.type === 'table' && !presentes.has(o.name)) {
        db.exec(o.sql);
        presentes.add(o.name);
      }
    }
    for (const o of contenu.schema ?? []) {
      if (o.type === 'index') {
        try { db.exec(o.sql); } catch { /* existe deja */ }
      }
    }

    for (const [nom, t] of Object.entries(contenu.tables)) {
      if (!presentes.has(nom)) {
        avertissements.push(`table ${nom} ignoree (absente de cette version du bot)`);
        continue;
      }
      const reelles = new Set(db.prepare(`PRAGMA table_info(${idSql(nom)})`).all().map((c) => c.name));
      const gardees = t.colonnes.map((c, i) => [c, i]).filter(([c]) => reelles.has(c));
      if (gardees.length < t.colonnes.length) {
        const perdues = t.colonnes.filter((c) => !reelles.has(c));
        avertissements.push(`table ${nom} : colonnes ignorees (${perdues.join(', ')})`);
      }
      db.exec(`DELETE FROM ${idSql(nom)}`);
      if (!gardees.length) continue;
      const ins = db.prepare(
        `INSERT INTO ${idSql(nom)} (${gardees.map(([c]) => idSql(c)).join(', ')}) VALUES (${gardees.map(() => '?').join(', ')})`,
      );
      for (const ligne of t.lignes) ins.run(...gardees.map(([, i]) => depuisJson(ligne[i])));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  // Fusionne le WAL dans le fichier principal : il est copie ou lu tel quel ensuite.
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* sans importance */ }

  const secretsPaths = new Set(fichiersSecrets(env).map(normaliser));
  const estSecret = (chemin) => [...secretsPaths].some((s) => chemin === s || chemin.startsWith(`${s}/`));

  for (const [relatif, f] of Object.entries(contenu.fichiers ?? {})) {
    const chemin = cheminSur(relatif);
    if (estSecret(chemin) && !avecSecrets) {
      avertissements.push(`${chemin} ignore (secret : relancer avec --avec-secrets pour le restaurer)`);
      continue;
    }
    if (dossierAvant && existsSync(chemin)) {
      const copie = join(dossierAvant, chemin);
      mkdirSync(dirname(copie), { recursive: true });
      copyFileSync(chemin, copie);
    }
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, Buffer.from(f.contenu, 'base64'));
    if (estSecret(chemin)) chmodSync(chemin, 0o600);
    restaures.push(chemin);
  }

  return { avertissements, restaures };
}

export const empreinte = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 16);
