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
