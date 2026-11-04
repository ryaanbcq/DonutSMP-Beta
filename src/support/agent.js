// Assistant IA des tickets : quand le staff ne repond pas (delai court la
// nuit), il prend le debut du ticket, accueille, fait preciser, et repond
// seul aux questions simples de support technique (connaissances + FAQ
// validee par le staff). Il se tait pour de bon des que le staff ecrit ou
// prend le ticket, ou des qu il a transmis.
//
// Tous les messages des tickets sont notes (table support_messages, 14
// jours) : la revue quotidienne en tire des propositions de FAQ.

import { escapeMarkdown, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { embed, FR, logo, skin } from '../lib/brand.js';
import { cibleDe } from '../vouch/fils.js';
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
import { chercherFils } from './anciens.js';
import { imagesDuTicket } from './images.js';
import { publierRelais, marquerRelais } from './relais.js';
import { programmerSuppression } from '../tickets/fin.js';
import { demarrerDoc } from './doc-donut.js';

const minuteurs = new Map(); // channelId -> timeout

const simple = (n) => String(n ?? '').toLowerCase().replace(/^[.@]/, '').replace(/[^a-z0-9_]/g, '');

/**
 * Le compte lie qui correspond au pseudo donne par le membre : exact
 * d abord, sinon un candidat UNIQUE parmi les pseudos lies qui commencent
 * par lui ou le contiennent (« Zenor » pour ZENORX), ou parmi les noms
 * Discord. Rend { lie, approx } ou null.
 */
export function trouverLie(vise, guild, liens = store.allLinks()) {
  const exact = store.getLinkByName(vise) ?? store.getLinkByName(`.${vise}`);
  if (exact) return { lie: exact, approx: false };
  const v = simple(vise);
  if (v.length < 3) return null;
  const parPseudo = liens.filter((l) => simple(l.mc_name).startsWith(v) || simple(l.mc_name).includes(v));
  const parDiscord = guild ? liens.filter((l) => {
    const m = guild.members.cache.get(l.discord_id);
    return m && [m.displayName, m.user.username, m.user.globalName].some((n) => n && simple(n).includes(v));
  }) : [];
  const ids = [...new Set([...parPseudo, ...parDiscord].map((l) => l.discord_id))];
  if (ids.length === 1) return { lie: liens.find((l) => l.discord_id === ids[0]), approx: true };
  if (ids.length > 1 || !guild) return null;
  // Membre du Discord sans compte lie : il a aussi un profil de reputation.
  const lies = new Set(liens.map((l) => l.discord_id));
  const noms = (m) => [m.displayName, m.user.username, m.user.globalName].filter(Boolean).map(simple);
  const libres = [...guild.members.cache.values()].filter((m) => !m.user.bot && !lies.has(m.id));
  const exacts = libres.filter((m) => noms(m).includes(v));
  const proches = exacts.length ? exacts : libres.filter((m) => noms(m).some((n) => n.includes(v)));
  if (proches.length !== 1) return null;
  const m = proches[0];
  return { lie: { discord_id: m.id, mc_name: m.displayName, nonLie: true }, approx: !exacts.length };
}
const enCours = new Set();
const echecs = new Map(); // channelId -> nombre d echecs d affilee
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
  let ecrit = null;
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

    // « écrit… » tient 10 s chez Discord : on le relance pendant toute la redaction.
    await salon.sendTyping().catch(() => {});
    ecrit = setInterval(() => salon.sendTyping().catch(() => {}), 8000);
    const faqAutorisee = reglagesSupport.categoriesFond().includes(cleDe(ticket.categorie ?? ''));
    const rep = await repondreTicket({
      connaissances: connaissancesServeur(), faq: faqTexte(), categorie: ticket.categorie,
      sujet: ticket.sujet, transcript: transcriptPourIA(messages), faqAutorisee,
      // La fiche (liaison, paiements, bot en jeu) n a de sens que dans les
      // categories de support technique : un signalement n en a pas besoin.
      fiche: faqAutorisee ? await ficheMembre(ticket.discord_id).catch((e) => `(fiche indisponible : ${e.message})`) : '',
      images: await imagesDuTicket(salon, ticket.discord_id).catch(() => []),
    });
    const texte = String(rep.message ?? '').replace(/—/g, ',').trim().slice(0, 1800);
    if (!texte) return;
    const carte = embed('💬・SUPPORT DONUTSMP FR', { couleur: FR.bleu, description: texte })
      .setFooter({ text: rep.transmettre ? 'Un membre du staff prend le relais dès que possible' : 'Le staff peut reprendre la main à tout moment' });
    // Joueur signale : s il a lie son compte, un bouton ouvre le formulaire de
    // signalement de scam sur son profil (une seule fois par ticket).
    const components = [];
    let scamOffert = etat.scamOffert;
    const vise = String(rep.vise ?? '').trim().replace(/^@/, '');
    const cleNonLie = `non-lie:${vise.toLowerCase()}`;
    let aConfirmer = null;
    // Deja propose ou confirme : on ne repropose que pour un AUTRE pseudo,
    // apres un « non » ou un pseudo sans compte lie.
    const reessayable = !scamOffert || scamOffert.startsWith('non-lie:') || scamOffert.startsWith('non:');
    if (vise && reessayable && scamOffert !== cleNonLie) {
      const trouve = trouverLie(vise, salon.guild);
      const lie = trouve?.lie;
      if (lie && lie.discord_id !== ticket.discord_id && scamOffert !== `non:${lie.discord_id}`) {
        aConfirmer = lie;
        scamOffert = `propose:${lie.discord_id}`;
      } else if (!lie) {
        carte.addFields({ name: '⚠️ Réputation', value: `Personne sur le Discord ne correspond à **${escapeMarkdown(vise)}**. Donnez son pseudo Minecraft exact ou son nom Discord ; s'il n'est pas sur le Discord, il ne peut pas encore être signalé sur sa réputation.` });
        scamOffert = cleNonLie;
      }
    }
    // Anciens vouches : le bot retrouve le post du membre dans l ancien forum
    // (les membres n y ont plus acces) et propose l import au staff.
    let anciensOffert = false;
    if (rep.anciens_vouches && !etat.anciensOffert) {
      const { forum, fils, parAuteur } = await chercherFils(salon.guild, ticket.discord_id).catch(() => ({ forum: null, fils: [] }));
      anciensOffert = true;
      if (fils.length) {
        carte.addFields({
          name: '📥 Anciens vouches',
          value: `${parAuteur ? 'Post' : 'Post probable'} retrouvé dans ${forum} : ${fils.map((f) => `[${escapeMarkdown(f.name)}](${f.url})`).join(', ')}.\n`
            + 'Staff : le bouton ouvre la fiche d\'import (vous excluez ce qui ne va pas, puis vous importez).',
        });
        components.push(new ActionRowBuilder().addComponents(fils.map((f) => new ButtonBuilder()
          .setCustomId(`support:import:${f.id}:${ticket.discord_id}`).setLabel(`Importer · ${f.name}`.slice(0, 80))
          .setEmoji('📥').setStyle(ButtonStyle.Secondary))));
      } else {
        carte.addFields({ name: '📥 Anciens vouches', value: forum
          ? `Aucun post à son nom retrouvé dans ${forum} : le staff vérifiera à la main.`
          : 'Ancien forum introuvable : le staff vérifiera à la main.' });
      }
    }
    if (aConfirmer) await ajouterConfirmation(salon.guild, carte, components, aConfirmer);
    const m = await salon.send({ embeds: [carte], components, allowedMentions: { parse: [] } });
    memoire.noter({ id: m.id, channelId, role: 'ia', content: texte, at: m.createdTimestamp });
    memoire.poserEtat(channelId, { iaCount: etat.iaCount + 1, transmis: etat.transmis || rep.transmettre, resume: rep.resume, scamOffert, anciensOffert });
    console.log(`[support] ticket #${ticket.id} : reponse IA${rep.transmettre ? ', transmis au staff' : ''}`);
    // Relais humain : carte dans le salon du staff, mise a jour a chaque
    // nouvelle transmission ; sans salon, on garde l alerte du journal.
    const relaye = rep.transmettre
      ? await publierRelais(salon.guild, ticket, { resume: rep.resume, infos: rep.infos ?? [] }).catch((e) => { console.warn('[support] relais :', e.message); return false; })
      : false;
    if (rep.transmettre && !etat.transmis && !relaye) {
      journal({
        niveau: 'info',
        titre: `Support IA : ticket #${ticket.id} à reprendre`,
        texte: `<#${channelId}> · ${escapeMarkdown(ticket.categorie ?? 'sans catégorie')}\n> ${escapeMarkdown(String(rep.resume ?? '').slice(0, 300))}`,
      });
    }
    // Meme apres une transmission : le membre peut dire que c est regle.
    // Pas tant que la reponse porte ses propres boutons (bonne personne ?,
    // signalement, import) : une question a la fois.
    if (rep.resolu && !rep.transmettre && !components.length) await demanderResolution(salon, ticket).catch((e) => console.warn('[support] resolution :', e.message));
    echecs.delete(channelId);
  } catch (e) {
    console.warn('[support] reponse :', e.message);
    // Une API qui hoquette ne doit pas laisser le membre sans reponse : on
    // retente 30 s puis 2 min plus tard, puis on laisse au staff.
    const n = (echecs.get(channelId) ?? 0) + 1;
    echecs.set(channelId, n);
    if (n <= 2) setTimeout(() => planifier(channelId), n === 1 ? 30_000 : 120_000).unref?.();
  } finally {
    clearInterval(ecrit);
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
  if (r === 'staff') {
    clearTimeout(minuteurs.get(message.channelId)); minuteurs.delete(message.channelId);
    marquerRelais(message.guild, message.channelId, 'pris', message.member?.displayName ?? message.author.username).catch(() => {});
    return;
  }
  planifier(message.channelId);
}

/** Au demarrage : reprend les tickets ouverts qui attendaient une reponse. */
function reprendre() {
  for (const t of store.ticketsOuverts?.() ?? []) planifier(t.channel_id);
}

export function demarrerSupport(c) {
  client = c;
  c.on('messageCreate', (m) => surMessage(m).catch((e) => console.warn('[support] :', e.message)));
  demarrerDoc();
  reprendre();
  console.log(`[support] assistant IA ${supportActif() ? 'actif' : `à l'arrêt${iaDisponible() ? '' : ' (pas de clé ANTHROPIC_API_KEY)'}`}`);
}

/** Relance la planification de tous les tickets ouverts (apres un reglage). */
export const replanifier = reprendre;

// ------------------------------------------------------------ confirmation du joueur vise

const CHAMP = '🔎 Est-ce la bonne personne ?';

/** Confirmation dans le MEME encadre : une ligne, skin en vignette, photo en icone, Oui / Non. */
async function ajouterConfirmation(guild, carte, components, lie) {
  const m = guild.members.cache.get(lie.discord_id) ?? await guild.members.fetch(lie.discord_id).catch(() => null);
  const ign = lie.mc_name.replace(/^\./, '');
  carte.addFields({ name: CHAMP, value: lie.nonLie
    ? `<@${lie.discord_id}> · ${escapeMarkdown(lie.mc_name)} · *compte Minecraft pas encore lié*`
    : `<@${lie.discord_id}> · \`${escapeMarkdown(lie.mc_name)}\`${m ? ` · ${escapeMarkdown(m.displayName)}` : ''}` });
  carte.setThumbnail(lie.nonLie ? (m?.displayAvatarURL({ size: 128, extension: 'png' }) ?? logo()) : skin(ign));
  if (m) carte.setAuthor({ name: '💬・SUPPORT DONUTSMP FR', iconURL: m.displayAvatarURL({ size: 64, extension: 'png' }) });
  components.unshift(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`support:vise:oui:${lie.discord_id}`).setLabel(`Oui, c'est ${ign}`.slice(0, 80)).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`support:vise:non:${lie.discord_id}`).setLabel('Non').setEmoji('❌').setStyle(ButtonStyle.Secondary),
  ));
}

/** Oui / Non sur la confirmation : l auteur du ticket ou le staff. Edite le meme encadre. */
export async function onBoutonVise(interaction) {
  const [, , choix, id] = interaction.customId.split(':');
  const ticket = store.getTicket(interaction.channelId);
  if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est plus un ticket.', flags: 64 });
  if (interaction.user.id !== ticket.discord_id && !estStaff(interaction.member)) {
    return interaction.reply({ content: '🔒 Seul l\'auteur du ticket (ou le staff) peut répondre.', flags: 64 });
  }
  const lie = cibleDe(interaction.client, id);
  const etat = memoire.etat(interaction.channelId);
  const ign = lie?.mc_name ?? 'ce joueur';
  const oui = choix === 'oui' && lie;
  const carte = EmbedBuilder.from(interaction.message.embeds[0]);
  const champs = (carte.data.fields ?? []).filter((f) => f.name !== CHAMP);
  carte.setFields(...champs, oui
    ? { name: '✅ Joueur confirmé', value: `<@${id}> · ${lie?.nonLie ? escapeMarkdown(ign) : `\`${escapeMarkdown(ign)}\``} : le bouton ci-dessous ouvre un signalement de scam sur sa réputation (preuve obligatoire).` }
    : { name: '❌ Ce n\'est pas lui', value: `Ce n'est pas \`${escapeMarkdown(ign)}\` : donnez son pseudo Minecraft exact dans le ticket.` });
  if (!oui) carte.setThumbnail(logo() ?? null);
  // Les autres boutons du message (import des anciens vouches) restent.
  const autres = interaction.message.components.filter((r) => !r.components.some((c) => c.customId?.startsWith('support:vise:')));
  const rangs = oui
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vouch:scam:${id}`)
      .setLabel(`Signaler ${ign} sur sa réputation`.slice(0, 80)).setEmoji('⚠️').setStyle(ButtonStyle.Danger)), ...autres]
    : autres;
  memoire.poserEtat(interaction.channelId, { ...etat, scamOffert: oui ? id : `non:${id}` });
  memoire.noter({ id: `${interaction.id}`, channelId: interaction.channelId, role: 'membre', at: Date.now(),
    content: oui ? `[Le membre a confirmé que le joueur visé est ${ign} (${lie?.nonLie ? 'membre du Discord, compte Minecraft pas encore lié' : 'compte lié au Discord'}).]`
      : `[Le membre a répondu que le joueur visé n'est PAS ${ign} : il faut son pseudo Minecraft exact.]` });
  await interaction.update({ embeds: [carte], components: rangs });
  // L assistant enchaine (quelques secondes apres, comme pour un message).
  planifier(interaction.channelId);
}

// ------------------------------------------------------------ probleme resolu ?

const TITRE_RESOLU = '✅・PROBLÈME RÉSOLU ?';
const resolutionEnAttente = new Set(); // une seule question a la fois par ticket

async function demanderResolution(salon, ticket) {
  if (resolutionEnAttente.has(salon.id)) return;
  resolutionEnAttente.add(salon.id);
  await salon.send({
    embeds: [embed(TITRE_RESOLU, {
      couleur: FR.vert,
      description: '### Votre problème est-il résolu ?\n-# Un clic suffit : on ferme le ticket, ou on continue.',
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('support:resolu:oui').setLabel('Oui, c\'est réglé').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('support:resolu:non').setLabel('Non, pas encore').setEmoji('💬').setStyle(ButtonStyle.Secondary),
    )],
  });
  console.log(`[support] ticket #${ticket.id} : resolution demandee`);
}

/** Boutons support:resolu:oui|non (auteur du ticket ou staff). */
export async function onBoutonResolu(interaction) {
  const oui = interaction.customId.endsWith(':oui');
  resolutionEnAttente.delete(interaction.channelId);
  const ticket = store.getTicket(interaction.channelId);
  if (!ticket || ticket.etat === 'supprime') return interaction.reply({ content: '❌ Ce salon n\'est plus un ticket.', flags: 64 });
  if (interaction.user.id !== ticket.discord_id && !estStaff(interaction.member)) {
    return interaction.reply({ content: '🔒 Seul l\'auteur du ticket (ou le staff) peut répondre.', flags: 64 });
  }
  if (oui) {
    const fin = Math.floor((Date.now() + 60_000) / 1000);
    await interaction.update({
      embeds: [embed('✅・PROBLÈME RÉSOLU', {
        couleur: FR.vert,
        description: `### Merci, ravi d'avoir pu aider !\nBon jeu sur DonutSMP.\n\n-# Ce ticket disparaîtra <t:${fin}:R>.`,
      })],
      components: [],
    });
    clearTimeout(minuteurs.get(interaction.channelId)); minuteurs.delete(interaction.channelId);
    programmerSuppression(interaction.channelId, 60_000);
    console.log(`[support] ticket #${ticket.id} resolu, suppression dans 1 min`);
    return;
  }
  await interaction.update({
    embeds: [embed('💬・ON CONTINUE', { couleur: FR.bleu, description: 'D\'accord, dites-nous ce qui bloque encore.' })],
    components: [],
  });
  memoire.noter({ id: `${interaction.id}`, channelId: interaction.channelId, role: 'membre', at: Date.now(),
    content: '[Le membre a indiqué que son problème N\'EST PAS résolu.]' });
  planifier(interaction.channelId);
}
