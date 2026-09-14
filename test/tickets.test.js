import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

process.env.DB_PATH = './data/test-tickets.db';
for (const f of ['.db', '.db-wal', '.db-shm']) rmSync('./data/test-tickets' + f, { force: true });

const { store } = await import('../src/db.js');
const { reglagesTickets, CATEGORIES_DEFAUT, cleDe } = await import('../src/tickets/reglages.js');
const { rendreTranscript } = await import('../src/tickets/transcript.js');
const { panneauTicket, boutonsTicket } = await import('../src/tickets/panel.js');

test('les huit categories de la commu sont la par defaut, avec des cles stables', () => {
  const cats = reglagesTickets.categories();
  assert.equal(cats.length, 8);
  assert.equal(cats[0].cle, 'support-general-technique');
  assert.equal(cleDe('Récupération de Giveaway'), 'recuperation-de-giveaway');
  assert.equal(CATEGORIES_DEFAUT.find((c) => c.cle === 'autre-demande').emoji, '❓');
});

test('ajouter, remplacer et retirer une categorie', () => {
  reglagesTickets.poserCategorie({ nom: 'Recrutement', emoji: '📝', description: 'Rejoindre le staff' });
  assert.equal(reglagesTickets.categories().length, 9);
  reglagesTickets.poserCategorie({ nom: 'recrutement', emoji: '🧑', description: 'Nouvelle description' });
  assert.equal(reglagesTickets.categories().length, 9, 'meme cle = remplacement, pas doublon');
  assert.equal(reglagesTickets.categorie('recrutement').emoji, '🧑');
  assert.equal(reglagesTickets.retirerCategorie('Recrutement'), true);
  assert.equal(reglagesTickets.retirerCategorie('Recrutement'), false);
  assert.equal(reglagesTickets.categories().length, 8);
});

test('pas plus de 25 categories, la limite du menu Discord', () => {
  for (let i = 0; i < 17; i += 1) reglagesTickets.poserCategorie({ nom: `Cat ${i}` });
  assert.equal(reglagesTickets.categories().length, 25);
  assert.throws(() => reglagesTickets.poserCategorie({ nom: 'Une de trop' }), /25/);
  for (let i = 0; i < 17; i += 1) reglagesTickets.retirerCategorie(`Cat ${i}`);
});

test('roles staff : pas de doublon, retrait propre', () => {
  assert.equal(reglagesTickets.ajouterRole('111'), true);
  assert.equal(reglagesTickets.ajouterRole('111'), false);
  assert.equal(reglagesTickets.ajouterRole('222'), true);
  assert.deepEqual(reglagesTickets.roles(), ['111', '222']);
  assert.equal(reglagesTickets.retirerRole('111'), true);
  assert.deepEqual(reglagesTickets.roles(), ['222']);
});

test('le panneau liste les categories numerotees et porte le menu', () => {
  const p = panneauTicket();
  const desc = p.embeds[0].data.description;
  assert.match(desc, /> 📬 \*\*1\. Support Général & Technique\*\*/);
  assert.match(desc, /> ❓ \*\*8\. Autre Demande\*\*/);
  assert.equal(p.embeds[0].data.color, 0x5e5efd);
  const menu = p.components[0].components[0].toJSON();
  assert.equal(menu.custom_id, 'ticket:cat');
  assert.equal(menu.options.length, 8);
});

test('un ticket par membre, etats et prise en charge', () => {
  const id = store.createTicket('salon-1', 'membre-a', 'Service Build', 'Une maison');
  assert.equal(id, 1);
  assert.equal(store.ticketEnCours('membre-a').channel_id, 'salon-1');
  store.setTicketEtat('salon-1', 'ferme');
  assert.equal(store.getTicket('salon-1').etat, 'ferme');
  assert.ok(store.getTicket('salon-1').closed_at, 'la fermeture est datee');
  assert.ok(store.ticketEnCours('membre-a'), 'ferme mais pas supprime : toujours son ticket');
  store.setTicketPris('salon-1', 'staff-x');
  assert.equal(store.getTicket('salon-1').pris_par, 'staff-x');
  store.setTicketEtat('salon-1', 'supprime');
  assert.equal(store.ticketEnCours('membre-a'), null);
  store.renommerTicket('salon-1', 'salon-final');
  assert.equal(store.getTicket('salon-final').id, 1);
});

test('les boutons suivent l etat du ticket', () => {
  const ids = (etat) => boutonsTicket(etat)[0].components.map((b) => b.data.custom_id);
  assert.ok(ids('ouvert').includes('ticket:close'));
  assert.ok(!ids('ouvert').includes('ticket:reopen'));
  assert.ok(ids('ferme').includes('ticket:reopen'));
});

test('le transcript est chronologique et signale un contenu illisible', () => {
  const messages = [
    { createdTimestamp: 2000, author: { tag: 'staff#1', bot: false }, content: 'Bonjour, je regarde.' },
    { createdTimestamp: 1000, author: { tag: 'ryan#0', bot: false }, content: 'Mon build a disparu',
      attachments: new Map([['a', { name: 'preuve.png', url: 'https://x/preuve.png' }]]) },
    { createdTimestamp: 500, author: { tag: 'Bot#0', bot: true }, content: '',
      embeds: [{ author: { name: '📩・TICKET' }, description: 'Bonjour' }] },
  ];
  const ticket = { id: 7, categorie: 'Service Build', discord_id: '1', auteur: 'ryan#0', created_at: 0, sujet: 'Build' };
  const t = rendreTranscript({ ticket, messages });
  const lignes = t.trim().split('\n');
  assert.match(lignes[0], /^Ticket #7 : Service Build/);
  const iBot = lignes.findIndex((l) => l.includes('Bot#0 [bot]'));
  const iRyan = lignes.findIndex((l) => l.includes('Mon build a disparu'));
  const iStaff = lignes.findIndex((l) => l.includes('je regarde'));
  assert.ok(iBot < iRyan && iRyan < iStaff, 'ordre chronologique');
  assert.match(t, /\[fichier\] preuve\.png/);
  assert.match(t, /\[embed\] 📩・TICKET : Bonjour/);
  assert.doesNotMatch(t, /intent Message Content/);

  const sans = rendreTranscript({ ticket, messages, contenuDisponible: false });
  assert.match(sans, /intent Message Content/);
});
