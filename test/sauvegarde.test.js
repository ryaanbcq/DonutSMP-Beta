import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dossier = mkdtempSync(join(tmpdir(), 'sauvegarde-'));
process.env.DB_PATH = join(dossier, 'bot.db');
const { db, store } = await import('../src/db.js');
const { exporter, importer, lireArchive, apercu } = await import('../src/lib/sauvegarde.js');

// Les fichiers d etat sont relatifs au dossier courant, comme pour le bot.
process.chdir(dossier);
mkdirSync('data/msa-cache', { recursive: true });
writeFileSync('data/dons.json', '{"cumul":42}');
writeFileSync('data/payments.jsonl', '{"raw":"A paid you $ 5"}\n');
writeFileSync('data/msa-cache/x_live-cache.json', '{"jeton":"secret"}');
writeFileSync('.env', 'DISCORD_TOKEN=abc\n');

// Une table creee par un autre module que db.js (balances, dons...).
db.exec('CREATE TABLE IF NOT EXISTS balances (mc_name_norm TEXT PRIMARY KEY, money INTEGER NOT NULL)');
db.exec("INSERT INTO balances VALUES ('abc', 5000000000)");
db.exec("INSERT INTO links (discord_id, mc_name, mc_name_norm, linked_at) VALUES ('111', 'Alice', 'alice', 1000)");
db.exec("INSERT INTO vouches (from_id, to_id, value, comment, created_at) VALUES ('1','2',1,'ok',5)");
store.kvSet('baltop.salon', '999');

test('aller-retour : tout revient apres un ecrasement', () => {
  const { archive, resume } = exporter(db);
  assert.equal(resume.tables.links, 1);
  assert.equal(resume.tables.balances, 1);
  assert.ok(resume.fichiers.includes('data/dons.json'));
  assert.ok(!resume.fichiers.some((f) => f.includes('msa-cache') || f === '.env'), 'pas de secrets par defaut');

  db.exec('DELETE FROM links; DELETE FROM vouches; DELETE FROM balances');
  store.kvSet('baltop.salon', 'autre');
  writeFileSync('data/dons.json', '{"cumul":0}');

  const r = importer(db, lireArchive(archive), { dossierAvant: join(dossier, 'avant') });
  assert.deepEqual(r.avertissements, []);
  assert.equal(db.prepare('SELECT mc_name FROM links').get().mc_name, 'Alice');
  assert.equal(db.prepare('SELECT comment FROM vouches').get().comment, 'ok');
  assert.equal(db.prepare('SELECT money FROM balances').get().money, 5000000000);
  assert.equal(store.kvGet('baltop.salon'), '999');
  assert.equal(readFileSync('data/dons.json', 'utf8'), '{"cumul":42}');
  // L ancien etat a ete garde.
  assert.equal(readFileSync('avant/data/dons.json', 'utf8'), '{"cumul":0}');
  assert.ok(existsSync('avant/bot.db'));
});

test('secrets : exportes sur demande, restaures seulement avec le drapeau', () => {
  const { archive } = exporter(db, { secrets: true });
  const contenu = lireArchive(archive);
  assert.ok(apercu(contenu).secrets);
  assert.ok(apercu(contenu).fichiers.includes('.env'));

  writeFileSync('.env', 'DISCORD_TOKEN=nouveau\n');
  const sans = importer(db, contenu, {});
  assert.equal(readFileSync('.env', 'utf8'), 'DISCORD_TOKEN=nouveau\n');
  assert.ok(sans.avertissements.some((a) => a.includes('.env')));

  importer(db, contenu, { avecSecrets: true });
  assert.equal(readFileSync('.env', 'utf8'), 'DISCORD_TOKEN=abc\n');
});

test('une table inconnue est recreee, une colonne en trop est ignoree', () => {
  const { archive } = exporter(db);
  const contenu = lireArchive(archive);
  db.exec('DROP TABLE balances');
  contenu.tables.links.colonnes.push('colonne_future');
  contenu.tables.links.lignes.forEach((l) => l.push('x'));
  const r = importer(db, contenu, {});
  assert.equal(db.prepare('SELECT money FROM balances').get().money, 5000000000);
  assert.ok(r.avertissements.some((a) => a.includes('colonne_future')));
});

test('archive invalide ou piegee : refusee', () => {
  assert.throws(() => lireArchive(Buffer.from('pas du gzip')), /pas une sauvegarde/);
  const faux = gzipSync(JSON.stringify({ format: 'autre' }));
  assert.throws(() => lireArchive(faux), /format inconnu/);
  const piege = gzipSync(JSON.stringify({
    format: 'donutfr-sauvegarde', version: 1, tables: {}, fichiers: { '../../etc/passwd': { contenu: '' } },
  }));
  assert.throws(() => lireArchive(piege), /chemin refuse/);
  const futur = gzipSync(JSON.stringify({ format: 'donutfr-sauvegarde', version: 99, tables: {} }));
  assert.throws(() => lireArchive(futur), /donut update/);
});
