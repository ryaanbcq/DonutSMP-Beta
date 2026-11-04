import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carteRelais } from '../src/support/relais-carte.js';

const ticket = { id: 42, channel_id: '999', categorie: 'Signalement de Joueur' };

test('relais : nom, resume, infos, bouton vers le ticket', () => {
  const c = carteRelais({ ticket, nom: 'Ryan_*', avatar: 'https://cdn/a.png', resume: 'Scam IRL PayPal par Zenor', infos: ['Visé : Zenor', '', 'Perte : 30 €'], guildId: '1' });
  const e = c.embeds[0].toJSON();
  assert.match(e.description, /Ryan\\_\\\* a besoin d'aide/);
  assert.match(e.description, /> Scam IRL PayPal par Zenor/);
  assert.equal(e.fields[0].value, '• Visé : Zenor\n• Perte : 30 €');
  assert.equal(e.thumbnail.url, 'https://cdn/a.png');
  assert.match(e.footer.text, /En attente.*#42.*Signalement/);
  assert.equal(c.components[0].toJSON().components[0].url, 'https://discord.com/channels/1/999');
});

test('relais : sans infos, pas de champ vide', () => {
  const e = carteRelais({ ticket, nom: 'X', resume: '', infos: [], guildId: '1' }).embeds[0].toJSON();
  assert.equal(e.fields, undefined);
  assert.match(e.description, /Demande à reprendre/);
});
