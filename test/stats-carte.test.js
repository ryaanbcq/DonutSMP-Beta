import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lignesStats, tempsFr, ratio } from '../src/stats/carte.js';

test('stats : fiche du jeu (4 champs)', () => {
  const t = lignesStats({ argent: '$ 2.2B', kills: 93, morts: 312, killsTexte: '93', mortsTexte: '312', temps: '8d 9h', discordId: '42' });
  assert.match(t, /💰 \*\*Argent\*\* `\$ 2\.2B`/);
  assert.match(t, /K\/D\*\* `0\.30`/);
  assert.match(t, /Temps de jeu\*\* `8j 9h`/);
  assert.match(t, /<@42>/);
  assert.doesNotMatch(t, /Shards|Blocs|Mobs|ligne/);
});

test('stats : fiche de l API (tout)', () => {
  const t = lignesStats({ argent: '$2.2B', shards: 1500, kills: 10, morts: 0, temps: '1d 2h', poses: 12345, casses: 0, mobs: 7, enLigne: true, rang: 'DonutSMP+' });
  assert.match(t, /Shards\*\* `1 500`/);
  assert.match(t, /K\/D\*\* `10`/);
  assert.match(t, /Blocs posés\*\* `12 345`/);
  assert.match(t, /Blocs cassés\*\* `0`/);
  assert.match(t, /🟢 \*\*En ligne\*\* · DonutSMP\+/);
  assert.match(t, /pas lié/);
  assert.equal(tempsFr('26d 16h'), '26j 16h');
  assert.equal(ratio(1, null), null);
});

test('stats : profil complet lu en jeu (valeurs du jeu telles quelles)', () => {
  const t = lignesStats({ argent: '$ 2.2B', shardsTexte: '1K', killsTexte: '93', mortsTexte: '312', kills: 93, morts: 312, temps: '8d 9h', posesTexte: '8.2K', cassesTexte: '23K', mobsTexte: '170', vu: 'Online now', autres: { Rank: 'Elite' } });
  assert.match(t, /Shards\*\* `1K`/);
  assert.match(t, /Blocs posés\*\* `8\.2K`/);
  assert.match(t, /Mobs tués\*\* `170`/);
  assert.match(t, /▫️ \*\*Rank\*\* `Elite`/);
  assert.match(t, /🟢 \*\*En ligne\*\* maintenant/);
  assert.match(lignesStats({ vu: '2h ago' }), /👀 \*\*Vu\*\* 2h ago/);
});
