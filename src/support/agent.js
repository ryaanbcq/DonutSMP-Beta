// Assistant IA des tickets : quand le staff ne repond pas (delai court la
// nuit), il prend le debut du ticket, accueille, fait preciser, et repond
// seul aux questions simples de support technique (connaissances + FAQ
// validee par le staff). Il se tait pour de bon des que le staff ecrit ou
// prend le ticket, ou des qu il a transmis.
//
// Tous les messages des tickets sont notes (table support_messages, 14
// jours) : la revue quotidienne en tire des propositions de FAQ.

import { escapeMarkdown } from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { store } from '../db.js';
import { config } from '../config.js';
import { journal } from '../ops/journal.js';
import { estStaff } from '../tickets/manager.js';
import { cleDe } from '../tickets/reglages.js';
import { decider, budgetDispo, transcriptPourIA } from './logique.js';
import { memoire, reglagesSupport, faqTexte } from './reglages.js';
import { connaissancesServeur } from './connaissances.js';
import { repondreTicket, iaDisponible } from './ia.js';
import { ficheMembre } from './fiche.js';

const minuteurs = new Map(); // channelId -> timeout
const enCours = new Set();
let client = null;

export const supportActif = () => reglagesSupport.actif() && iaDisponible();

function role(message, ticket) {
  if (message.author.id === client?.user?.id) return null; // nos messages sont notes a l envoi
  if (message.author.bot) return null;
  // Dans son propre ticket, l auteur est le membre, meme s il est staff.
  if (message.author.id === ticket.discord_id) return 'membre';
  return estStaff(message.member) ? 'staff' : 'membre';
}

function planifier(channelId) {
  clearTimeout(minuteurs.get(channelId));
  minuteurs.delete(channelId);
  const ticket = store.getTicket(channelId);
  const d = decider({
    ticket, messages: memoire.messages(channelId), etat: memoire.etat(channelId),
    reglages: reglagesSupport.reglages(), actif: supportActif(), depuis: reglagesSupport.depuis(),
  });
  if (d.action === 'repondre') { intervenir(channelId).catch((e) => console.warn('[support] :', e.message)); return; }
  if (d.action === 'attendre') {
    const t = setTimeout(() => { minuteurs.delete(channelId); planifier(channelId); }, Math.min(d.dans + 1000, 2 ** 31 - 1));
    t.unref?.();
    minuteurs.set(channelId, t);
  }
}

async function intervenir(channelId) {
  if (enCours.has(channelId)) return;
  enCours.add(channelId);
  try {
    const ticket = store.getTicket(channelId);
    const salon = await client.channels.fetch(channelId).catch(() => null);
    if (!salon || !ticket) return;
    // Revalide juste avant d ecrire (le staff a pu repondre entre temps).
    const messages = memoire.messages(channelId);
    const etat = memoire.etat(channelId);
    const r = reglagesSupport.reglages();
    if (decider({ ticket, messages, etat, reglages: r, actif: supportActif(), depuis: reglagesSupport.depuis() }).action !== 'repondre') return;
    const budget = budgetDispo(reglagesSupport.compteur(), r.maxParJour);
    if (!budget.ok) { console.warn('[support] budget du jour atteint'); return; }
    reglagesSupport.poserCompteur(budget.suivant);

    await salon.sendTyping().catch(() => {});
    const faqAutorisee = reglagesSupport.categoriesFond().includes(cleDe(ticket.categorie ?? ''));
    const rep = await repondreTicket({
      connaissances: connaissancesServeur(), faq: faqTexte(), categorie: ticket.categorie,
      sujet: ticket.sujet, transcript: transcriptPourIA(messages), faqAutorisee,
      // La fiche (liaison, paiements, bot en jeu) n a de sens que dans les
      // categories de support technique : un signalement n en a pas besoin.
      fiche: faqAutorisee ? await ficheMembre(ticket.discord_id).catch((e) => `(fiche indisponible : ${e.message})`) : '',
    });
    const texte = String(rep.message ?? '').replace(/—/g, ',').trim().slice(0, 1800);
    if (!texte) return;
    const carte = embed('💬・SUPPORT DONUTSMP FR', { couleur: FR.bleu, description: texte })
      .setFooter({ text: rep.transmettre ? 'Un membre du staff prend le relais dès que possible' : 'Le staff peut reprendre la main à tout moment' });
    const m = await salon.send({ embeds: [carte], allowedMentions: { parse: [] } });
    memoire.noter({ id: m.id, channelId, role: 'ia', content: texte, at: m.createdTimestamp });
    memoire.poserEtat(channelId, { iaCount: etat.iaCount + 1, transmis: etat.transmis || rep.transmettre, resume: rep.resume });
    console.log(`[support] ticket #${ticket.id} : reponse IA${rep.transmettre ? ', transmis au staff' : ''}`);
    if (rep.transmettre && !etat.transmis) {
      journal({
        niveau: 'info',
        titre: `Support IA : ticket #${ticket.id} à reprendre`,
        texte: `<#${channelId}> · ${escapeMarkdown(ticket.categorie ?? 'sans catégorie')}\n> ${escapeMarkdown(String(rep.resume ?? '').slice(0, 300))}`,
      });
    }
  } catch (e) {
    console.warn('[support] reponse :', e.message);
  } finally {
    enCours.delete(channelId);
  }
}

/** Appele par le gestionnaire de tickets juste apres l ouverture. */
export function surTicketOuvert(channelId) {
  if (client) planifier(channelId);
}

async function surMessage(message) {
  if (!message.inGuild() || message.guildId !== config.discord.guildId) return;
  const ticket = store.getTicket(message.channelId);
  if (!ticket || ticket.etat !== 'ouvert') return;
  const r = role(message, ticket);
  if (!r) return;
  memoire.noter({
    id: message.id, channelId: message.channelId, role: r, content: message.content,
    pieces: message.attachments.size, at: message.createdTimestamp,
  });
  if (r === 'staff') { clearTimeout(minuteurs.get(message.channelId)); minuteurs.delete(message.channelId); return; }
  planifier(message.channelId);
}

/** Au demarrage : reprend les tickets ouverts qui attendaient une reponse. */
function reprendre() {
  for (const t of store.ticketsOuverts?.() ?? []) planifier(t.channel_id);
}

export function demarrerSupport(c) {
  client = c;
  c.on('messageCreate', (m) => surMessage(m).catch((e) => console.warn('[support] :', e.message)));
  reprendre();
  console.log(`[support] assistant IA ${supportActif() ? 'actif' : `à l'arrêt${iaDisponible() ? '' : ' (pas de clé ANTHROPIC_API_KEY)'}`}`);
}

/** Relance la planification de tous les tickets ouverts (apres un reglage). */
export const replanifier = reprendre;
