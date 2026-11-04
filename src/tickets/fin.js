// Fin des tickets, partie Discord.
//
//   kv tickets.fin  JSON { channelId: { type: 'inactif', avertiAt, msgId }
//                        | { type: 'resolu', supprimerAt } }
//
// Toutes les minutes : avertissement apres 24 h sans reponse du membre
// (fin-logique.js), annulation des que quelqu un ecrit, suppression 24 h
// plus tard ; suppression des tickets resolus une minute apres le « Oui ».


import { store } from '../db.js';
import { config } from '../config.js';
import { embed, FR } from '../lib/brand.js';
import { memoire } from '../support/reglages.js';
import { decisionInactivite, DELAI_INACTIF } from './fin-logique.js';
import { supprimerTicketAuto } from './manager.js';

let client = null;
const lire = () => { try { return JSON.parse(store.kvGet('tickets.fin') ?? '') ?? {}; } catch { return {}; } };
const ecrire = (t) => store.kvSet('tickets.fin', JSON.stringify(t));
const poser = (id, v) => { const t = lire(); if (v) t[id] = v; else delete t[id]; ecrire(t); };

const guilde = () => client?.guilds.cache.get(config.discord.guildId) ?? null;

/** Ticket resolu : suppression dans `dansMs`. */
export function programmerSuppression(channelId, dansMs = 60_000) {
  poser(channelId, { type: 'resolu', supprimerAt: Date.now() + dansMs });
  setTimeout(() => tour().catch(() => {}), dansMs + 1000).unref?.();
}

async function avertir(guild, ticket) {
  const salon = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!salon) return;
  const fin = Math.floor((Date.now() + DELAI_INACTIF) / 1000);
  const m = await salon.send({
    content: `<@${ticket.discord_id}>`,
    embeds: [embed('⏳・TICKET INACTIF', {
      couleur: FR.jaune,
      description: '### Toujours là ?\nAucune nouvelle de votre part depuis **24 h**.\n\n'
        + `Sans message, ce ticket sera **archivé et supprimé <t:${fin}:R>** (<t:${fin}:f>).\n`
        + '-# Écrivez simplement ici pour le garder ouvert.',
    })],
    allowedMentions: { users: [ticket.discord_id] },
  }).catch(() => null);
  if (m) poser(ticket.channel_id, { type: 'inactif', avertiAt: Date.now(), msgId: m.id });
  console.log(`[ticket] #${ticket.id} inactif depuis 24 h : avertissement`);
}

async function annuler(guild, ticket, entree) {
  poser(ticket.channel_id, null);
  const salon = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  const m = salon && entree.msgId ? await salon.messages.fetch(entree.msgId).catch(() => null) : null;
  if (m) {
    await m.edit({ content: '', embeds: [embed('✅・TICKET GARDÉ OUVERT', { couleur: FR.vert, description: 'Quelqu\'un a répondu : l\'archivage est annulé.' })] }).catch(() => {});
  }
  console.log(`[ticket] #${ticket.id} : archivage annule`);
}

let enCours = false;
async function tour() {
  if (enCours) return;
  enCours = true;
  try {
    const guild = guilde();
    if (!guild) return;
    const fin = lire();
    const ouverts = new Map(store.ticketsOuverts().map((t) => [t.channel_id, t]));
    // Entrees orphelines (ticket ferme ou supprime a la main) : on oublie.
    for (const id of Object.keys(fin)) if (!ouverts.has(id) && !store.getTicket(id)) poser(id, null);
    for (const ticket of ouverts.values()) {
      const entree = fin[ticket.channel_id];
      if (entree?.type === 'resolu') {
        if (Date.now() >= entree.supprimerAt) { poser(ticket.channel_id, null); await supprimerTicketAuto(guild, ticket, 'problème résolu'); }
        continue;
      }
      const d = decisionInactivite({ messages: memoire.messages(ticket.channel_id), avertiAt: entree?.avertiAt ?? null });
      if (d === 'avertir') await avertir(guild, ticket);
      else if (d === 'annuler') await annuler(guild, ticket, entree);
      else if (d === 'supprimer') { poser(ticket.channel_id, null); await supprimerTicketAuto(guild, ticket, 'inactif 48 h'); }
    }
    // Un ticket resolu peut avoir ete ferme entre temps : on le supprime quand meme.
    for (const [id, e] of Object.entries(lire())) {
      if (e.type === 'resolu' && !ouverts.has(id) && Date.now() >= e.supprimerAt) {
        const t = store.getTicket(id);
        poser(id, null);
        if (t && t.etat !== 'supprime') await supprimerTicketAuto(guild, t, 'problème résolu');
      }
    }
  } finally {
    enCours = false;
  }
}

/** Message humain dans un ticket averti : annulation tout de suite. */
async function surMessage(message) {
  if (message.author.bot || !message.inGuild()) return;
  const entree = lire()[message.channelId];
  if (entree?.type !== 'inactif') return;
  const ticket = store.getTicket(message.channelId);
  if (ticket) await annuler(message.guild, ticket, entree);
}

export function demarrerFin(c) {
  client = c;
  c.on('messageCreate', (m) => surMessage(m).catch(() => {}));
  setInterval(() => tour().catch((e) => console.warn('[ticket] fin :', e.message)), 60_000).unref?.();
  setTimeout(() => tour().catch(() => {}), 20_000).unref?.();
}

