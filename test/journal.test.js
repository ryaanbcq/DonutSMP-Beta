import test from 'node:test';
import assert from 'node:assert/strict';
import { journal, poserSalon, attendreJournal } from '../src/ops/journal.js';

function faux() {
  const envois = [];
  const salon = {
    name: 'logs-bot',
    send: async (payload) => {
      const message = { payload, edits: [], edit: async (p) => { message.edits.push(p); } };
      envois.push(message);
      return message;
    },
  };
  poserSalon(salon);
  return envois;
}

const donnees = (m) => m.payload.embeds[0].data;

test('un evenement devient un embed colore et titre', async () => {
  const envois = faux();
  journal({ niveau: 'err', titre: 'Bot en jeu deconnecte', texte: 'keepAliveError', champs: { Joueur: 'ZKR5' } });
  await attendreJournal();
  assert.equal(envois.length, 1);
  const e = donnees(envois[0]);
  assert.match(e.title, /Bot en jeu deconnecte/);
  assert.equal(e.color, 0xed4245);
  assert.equal(e.description, 'keepAliveError');
  assert.deepEqual(e.fields, [{ name: 'Joueur', value: 'ZKR5', inline: true }]);
});

test('le meme evenement repete est compte, pas repose', async () => {
  const envois = faux();
  for (let i = 0; i < 4; i += 1) journal({ niveau: 'warn', titre: 'Deconnexion', texte: 'timeout' });
  await attendreJournal();
  assert.equal(envois.length, 1, 'une seule ligne dans le salon');
  assert.equal(envois[0].edits.length, 3);
  assert.match(envois[0].edits.at(-1).embeds[0].data.footer.text, /4 fois/);
});

test('deux evenements differents font deux messages', async () => {
  const envois = faux();
  journal({ niveau: 'ok', titre: 'Connecte' });
  journal({ niveau: 'warn', titre: 'Deconnecte' });
  await attendreJournal();
  assert.equal(envois.length, 2);
});

test('sans salon configure, journal() ne fait rien et ne jette pas', async () => {
  poserSalon(null);
  assert.doesNotThrow(() => journal({ niveau: 'err', titre: 'Peu importe' }));
  await attendreJournal();
});

test('un salon qui refuse l envoi ne casse pas l appelant', async () => {
  poserSalon({ name: 'x', send: async () => { throw new Error('Missing Access'); } });
  journal({ niveau: 'err', titre: 'Panne' });
  await assert.doesNotReject(attendreJournal());
});

test('la ligne d auteur dit quel process parle', async () => {
  const envois = faux();
  journal({ niveau: 'ok', titre: 'Connecte', source: 'jeu' });
  journal({ niveau: 'ok', titre: 'Demarre' });
  await attendreJournal();
  assert.match(donnees(envois[0]).author.name, /BOT EN JEU/);
  assert.match(donnees(envois[1]).author.name, /BOT DISCORD/);
});

test('un evenement sur un joueur porte sa tete en vignette', async () => {
  const envois = faux();
  journal({ niveau: 'warn', titre: 'Remboursement refuse', joueur: '.Farex_ZZone' });
  journal({ niveau: 'ok', titre: 'Sans joueur' });
  await attendreJournal();
  assert.match(donnees(envois[0]).thumbnail.url, /mc-heads\.net\/avatar\/Farex_ZZone/);
  assert.equal(donnees(envois[1]).thumbnail, undefined);
});

test('une reconnexion dont le delai grandit reste un seul message', async () => {
  const envois = faux();
  for (const s of [5, 10, 20]) {
    journal({ niveau: 'warn', titre: 'Deconnecte', texte: 'pas vus', champs: { Relance: `dans ${s} s` }, source: 'jeu' });
  }
  await attendreJournal();
  assert.equal(envois.length, 1);
  const dernier = envois[0].edits.at(-1).embeds[0].data;
  assert.equal(dernier.fields[0].value, 'dans 20 s', 'l edition montre le dernier delai');
  assert.match(dernier.footer.text, /3 fois/);
});

test('un texte trop long est coupe au lieu d etre refuse par Discord', async () => {
  const envois = faux();
  journal({ niveau: 'err', titre: 'x'.repeat(400), texte: 'y'.repeat(5000), champs: { Pile: 'z'.repeat(2000) } });
  await attendreJournal();
  const e = donnees(envois[0]);
  assert.ok(e.title.length <= 256);
  assert.ok(e.description.length <= 4096);
  assert.ok(e.fields[0].value.length <= 1024);
});

test('les champs vides ne font pas de colonne', async () => {
  const envois = faux();
  journal({ niveau: 'info', titre: 'Avis', champs: { Score: '80/100', Raison: '', Autre: null } });
  await attendreJournal();
  assert.deepEqual(donnees(envois[0]).fields.map((f) => f.name), ['Score']);
});

test('un evenement qui demande un bouton le porte, et le garde a l edition', async () => {
  const envois = faux();
  journal({ niveau: 'err', titre: 'Connexion Microsoft requise', actions: ['msa'] });
  journal({ niveau: 'err', titre: 'Connexion Microsoft requise', actions: ['msa'] });
  journal({ niveau: 'ok', titre: 'Sans bouton', actions: ['inconnu'] });
  await attendreJournal();
  const bouton = envois[0].payload.components[0].components[0].data;
  assert.equal(bouton.custom_id, 'ops:msa');
  assert.equal(envois[0].edits[0].components[0].components[0].data.custom_id, 'ops:msa');
  assert.deepEqual(envois[1].payload.components, [], 'action inconnue = aucun bouton');
});
