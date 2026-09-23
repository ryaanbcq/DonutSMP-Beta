import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diagnostiquerKick, diagnostiquerErreur, texteDuMotif, duree,
} from '../ingame/diagnostic.js';
import { lireCodeMsa } from '../src/ops/actions.js';

test('un motif de kick JSON est lu en texte brut', () => {
  const motif = JSON.stringify({ text: '', extra: [{ text: '§cYou are ' }, { text: 'banned', bold: true }] });
  assert.equal(texteDuMotif(motif), '§cYou are banned');
});

test('les kicks connus sont reconnus', () => {
  const cas = {
    'You are permanently banned from this server. Ban ID: #A1B2': 'Bot banni de DonutSMP',
    'You are already connected to this proxy!': 'Session fantôme',
    'Server is restarting': 'DonutSMP en maintenance',
    'Connection throttled! Please wait before reconnecting.': 'Reconnexion trop rapide',
    'Outdated client! Please use 1.21.11': 'Version Minecraft refusée',
    'You have been idle for too long': 'Kick pour inactivité',
    'Kicked for flying': 'Kick par l\'anticheat',
  };
  for (const [motif, titre] of Object.entries(cas)) {
    assert.equal(diagnostiquerKick(motif).titre, titre, motif);
  }
});

test('un kick inconnu garde son motif, sans couleurs', () => {
  const d = diagnostiquerKick('§eBye   bye');
  assert.equal(d.titre, 'Bot expulsé');
  assert.equal(d.motif, 'Bye bye');
});

test('les erreurs de connexion utiles sont reconnues, les banales ignorees', () => {
  assert.equal(diagnostiquerErreur('invalid_grant - The user could not be authenticated').titre, 'Compte Microsoft bloqué');
  assert.equal(diagnostiquerErreur('getaddrinfo ENOTFOUND donutsmp.net').titre, 'DNS en échec');
  assert.equal(diagnostiquerErreur('connect ECONNREFUSED 1.2.3.4:25565').titre, 'DonutSMP injoignable');
  assert.equal(diagnostiquerErreur("Profile not found: doesn't own minecraft").titre, 'Compte sans Minecraft');
  assert.equal(diagnostiquerErreur('read ECONNRESET'), null);
  assert.equal(diagnostiquerErreur('keepAliveError'), null);
});

test('duree lisible', () => {
  assert.equal(duree(45_000), '45 s');
  assert.equal(duree(12 * 60_000), '12 min');
  assert.equal(duree(3 * 3_600_000 + 12 * 60_000), '3 h 12 min');
  assert.equal(duree(26 * 3_600_000), '1 j 2 h');
});

test('le code Microsoft n est rendu que tant qu il est valable', async () => {
  const dossier = await mkdtemp(join(tmpdir(), 'msa-'));
  const f = join(dossier, 'msa-code.json');
  assert.equal(await lireCodeMsa(f), null, 'pas de fichier = pas de code');
  await writeFile(f, JSON.stringify({ code: 'ABCD1234', url: 'https://microsoft.com/link', expireA: 2_000 }));
  assert.equal((await lireCodeMsa(f, 1_000)).code, 'ABCD1234');
  assert.equal(await lireCodeMsa(f, 2_000), null, 'expire = plus rien');
});

test('des notes en rafale sont ecrites dans l ordre des appels', async () => {
  const dossier = await mkdtemp(join(tmpdir(), 'ev-'));
  process.env.EVENTS_FILE = join(dossier, 'events.jsonl');
  const { note } = await import(`../ingame/journal.js?ordre=${Date.now()}`);
  let derniere;
  for (let i = 0; i < 30; i += 1) derniere = note('info', `n${i}`, 'x');
  await derniere;
  const { readFile } = await import('node:fs/promises');
  const titres = (await readFile(process.env.EVENTS_FILE, 'utf8')).trim().split('\n').map((l) => JSON.parse(l).titre);
  assert.deepEqual(titres, Array.from({ length: 30 }, (_, i) => `n${i}`));
});

test('les pannes de compte proposent le relink, les autres non', () => {
  assert.deepEqual(diagnostiquerErreur('invalid_grant').actions, ['relink']);
  assert.deepEqual(diagnostiquerKick('You are banned. Ban ID: #1').actions, ['relink']);
  assert.equal(diagnostiquerErreur('connect ECONNREFUSED 1.2.3.4').actions, null);
  assert.equal(diagnostiquerKick('Server is restarting').actions, null);
});

test('l ordre de relink est depose, date et signe', async () => {
  const { demanderRelink } = await import('../src/ops/actions.js');
  const f = join(await mkdtemp(join(tmpdir(), 'ctl-')), 'ingame-control.json');
  await demanderRelink('ryan#0001', f);
  const { readFile } = await import('node:fs/promises');
  const o = JSON.parse(await readFile(f, 'utf8'));
  assert.equal(o.action, 'relink');
  assert.equal(o.par, 'ryan#0001');
  assert.ok(Date.now() - o.at < 5_000);
});
