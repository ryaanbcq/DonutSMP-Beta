// Anti-pub : un message qui contient une invitation vers un AUTRE serveur
// Discord est supprime, et son auteur recoit un avertissement (compte dans
// /warns). Au bout de N avertissements de pub en 24 h, mute automatique.
//
// Detection : liens d invitation Discord (discord.gg, discord.com/invite,
// dsc.gg, .gg/...), y compris les variantes espacees pour passer les filtres
// (« discord . gg / abc »). Les invitations vers CE serveur restent permises
// (le code est resolu aupres de Discord, en cache). Un message modifie pour
// ajouter un lien est controle aussi.
//
// Jamais touches : les bots, le staff (admins du bot et membres autorises a
// sanctionner), les roles et salons exemptes dans /setup general > Anti-pub.
// Il faut l intent Message Content (DISCORD_MESSAGE_CONTENT=true) : sans lui
// le texte des messages est vide et rien n est detecte.

import {
  ButtonBuilder, ButtonStyle, MessageFlags, ContextMenuCommandBuilder, ApplicationCommandType,
} from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import { registre, peutSanctionner } from './actions.js';
import { ecrireDuree } from './outils.js';
import {
  apprendre, desapprendre, probabilitePub, indices, elaguer, modeleDeDepart,
} from './classifieur.js';

const RAISON = 'Publicité : invitation vers un autre serveur Discord';
const RAISON_PHRASE = 'Publicité : message de pub';
const AVIS_SALON_MS = 8_000;
const H = 3_600_000;

// ------------------------------------------------------------------ detection

// Caracteres invisibles glisses dans un lien pour tromper les filtres.
const INVISIBLES = /[​-‏⁠﻿­]/g;
const MOTIF = /(?:discord(?:app)?\s*\.\s*(?:com|gg)\s*\/\s*(?:invite\s*\/\s*)?|dsc\s*\.\s*gg\s*\/\s*|(?:^|[\s(<])\.gg\s*\/\s*)([a-z0-9-]{2,32})/gi;

/** Codes d invitation trouves dans un texte (sans doublon). */
export function codesInvitation(texte) {
  const t = String(texte ?? '').normalize('NFKC').replace(INVISIBLES, '');
  return [...new Set([...t.matchAll(MOTIF)].map((m) => m[1]))];
}

// ------------------------------------------------------------------ reglages

const liste = (cle) => String(store.kvGet(cle) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const nombre = (cle, defaut, min, max) => {
  const brut = store.kvGet(cle);
  if (brut == null || brut === '') return defaut; // Number(null) vaut 0, pas « absent »
  const v = Number(brut);
  return Number.isFinite(v) && v >= min && v <= max ? v : defaut;
};

export const reglagesAntipub = {
  actif: () => store.kvGet('antipub.actif') === '1',
  poserActif: (v) => store.kvSet('antipub.actif', v ? '1' : '0'),
  salonsExemptes: () => liste('antipub.salons'),
  poserSalonsExemptes: (ids) => store.kvSet('antipub.salons', ids.join(',')),
  rolesExemptes: () => liste('antipub.roles'),
  poserRolesExemptes: (ids) => store.kvSet('antipub.roles', ids.join(',')),
  // 0 = jamais de mute automatique.
  avantMute: () => nombre('antipub.avantMute', 3, 0, 10),
  muteHeures: () => nombre('antipub.muteHeures', 24, 1, 672),
  // Pub SANS lien, jugee par le classifieur : 'off', 'alerte' (journal avec
  // boutons, rien n est supprime) ou 'supprimer'. Alerte par defaut, le temps
  // qu il apprenne.
  phrases: () => (['off', 'alerte', 'supprimer'].includes(store.kvGet('antipub.phrases')) ? store.kvGet('antipub.phrases') : 'alerte'),
  poserPhrases: (v) => store.kvSet('antipub.phrases', v),
  seuil: () => nombre('antipub.seuil', 95, 50, 99) / 100,
  poserSeuil: (pct) => store.kvSet('antipub.seuil', String(pct)),
  poserSanction: (avantMute, muteHeures) => {
    store.kvSet('antipub.avantMute', String(avantMute));
    store.kvSet('antipub.muteHeures', String(muteHeures));
  },
};

// ------------------------------------------------------------------ invitations

// code -> { serveur, at } : un meme code n est pas redemande a Discord.
const cache = new Map();
const CACHE_MS = 6 * H;

/** Vrai si toutes les invitations visent ce serveur. Une invitation illisible compte comme pub. */
async function versCeServeur(client, codes) {
  for (const code of codes) {
    const connu = cache.get(code);
    let serveur = connu && Date.now() - connu.at < CACHE_MS ? connu.serveur : undefined;
    if (serveur === undefined) {
      const inv = await client.fetchInvite(code).catch(() => null);
      serveur = inv?.guild?.id ?? null;
      cache.set(code, { serveur, at: Date.now() });
    }
    if (serveur !== config.discord.guildId) return false;
  }
  return true;
}

// ------------------------------------------------------------------ controle

function exempte(message) {
  const m = message.member;
  if (!m || message.author.bot) return true;
  if (estAdmin(m, { ...config.discord, adminRoleId: [] }) || peutSanctionner(m)) return true;
  const salon = message.channel;
  const salons = reglagesAntipub.salonsExemptes();
  if (salons.includes(salon.id) || (salon.parentId && salons.includes(salon.parentId))) return true;
  return reglagesAntipub.rolesExemptes().some((r) => m.roles.cache.has(r));
}

/** Avertissements de pub (lien ou phrase) de ce membre dans les dernieres 24 h. */
const pubsRecentes = (id, now = Date.now()) => registre.warns(id)
  .filter((w) => w.raison.startsWith('Publicité') && now - w.at < 24 * H).length;

// ------------------------------------------------------------------ modele

let modele = null;
let modeleSale = false;
export function lireModele() {
  if (!modele) {
    try { modele = JSON.parse(store.kvGet('antipub.modele') ?? ''); } catch { modele = null; }
    if (!modele?.docs) modele = modeleDeDepart();
  }
  return modele;
}
function noterModele() { modeleSale = true; }
function sauverModele() {
  if (!modeleSale || !modele) return;
  store.kvSet('antipub.modele', JSON.stringify(elaguer(modele)));
  modeleSale = false;
}
export function statsModele() {
  const m = lireModele();
  return { pub: m.docs.pub, normal: m.docs.normal };
}

// Detections en attente d une decision du staff (boutons du journal) :
// cle courte -> { texte, auteurId, salonId, messageId, warnAt, classe }.
const json = (cle, defaut) => { try { return JSON.parse(store.kvGet(cle) ?? '') ?? defaut; } catch { return defaut; } };
function retenir(cas) {
  const tous = json('antipub.attente', {});
  const cle = Math.random().toString(36).slice(2, 10);
  tous[cle] = { ...cas, at: Date.now() };
  const cles = Object.keys(tous);
  for (const k of cles.slice(0, Math.max(0, cles.length - 200))) delete tous[k];
  store.kvSet('antipub.attente', JSON.stringify(tous));
  return cle;
}
function reprendre(cle) {
  const tous = json('antipub.attente', {});
  const cas = tous[cle];
  delete tous[cle];
  store.kvSet('antipub.attente', JSON.stringify(tous));
  return cas ?? null;
}

const bouton = (id, label, emoji, style) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const citer = (t) => `\`\`\`\n${String(t).slice(0, 300).replace(/`/g, "'")}\n\`\`\``;

// ------------------------------------------------------------------ sanction

/**
 * Supprime le message (s il existe encore), avertit l auteur, mute au seuil.
 * Rend le compte rendu pour le journal.
 */
async function sanctionner({ message, guild, membre, auteur, salonId, raison, quoi }) {
  const supprime = message ? await message.delete().then(() => true, () => false) : false;
  const warnAt = Date.now();
  const n = registre.ajouterWarn(auteur.id, { at: warnAt, par: guild.client.user.id, raison });
  const recentes = pubsRecentes(auteur.id);
  const seuil = reglagesAntipub.avantMute();

  let mute = null;
  if (membre && seuil && recentes >= seuil && membre.moderatable) {
    const ms = reglagesAntipub.muteHeures() * H;
    mute = await membre.timeout(ms, `${raison} (${recentes} en 24 h)`).then(() => ms, () => null);
  }
  const suite = mute
    ? `Tu es mute ${ecrireDuree(mute)} après ${recentes} avertissements pour pub en 24 h.`
    : (seuil ? `Avertissement ${recentes}/${seuil} : au bout de ${seuil} en 24 h, mute ${ecrireDuree(reglagesAntipub.muteHeures() * H)}.` : '');
  const recu = await auteur.send(`⚠️ Ton message dans <#${salonId}> a été supprimé : ${quoi} est interdite sur **${guild.name}**. ${suite}`)
    .then(() => true, () => false);
  // MP fermes : un mot dans le salon, efface aussitot.
  if (!recu) {
    const salon = await guild.channels.fetch(salonId).catch(() => null);
    const avis = await salon?.send({
      content: `⚠️ <@${auteur.id}>, ${quoi} est interdite ici. ${suite}`,
      allowedMentions: { users: [auteur.id] },
    }).catch(() => null);
    if (avis) setTimeout(() => avis.delete().catch(() => {}), AVIS_SALON_MS).unref?.();
  }
  return { supprime, n, recentes, seuil, mute, warnAt };
}

const champsSanction = (r) => ({
  'En 24 h': `${r.recentes}${r.seuil ? `/${r.seuil}` : ''}`,
  'Total avertissements': String(r.n),
  Supprimé: r.supprime ? 'oui' : '❌ non (déjà supprimé, ou droit « Gérer les messages » ?)',
  ...(r.mute ? { Mute: ecrireDuree(r.mute) } : {}),
});

// ------------------------------------------------------------------ controle

export async function controlerMessage(message) {
  if (!reglagesAntipub.actif() || !message.inGuild() || message.guildId !== config.discord.guildId) return;
  if (!message.content || exempte(message)) return;
  const texte = message.content;
  const auteur = message.author;

  // 1. Lien d invitation vers un autre serveur : supprime, sans hesiter.
  const codes = codesInvitation(texte);
  if (codes.length && !(await versCeServeur(message.client, codes))) {
    apprendre(lireModele(), texte, 'pub'); noterModele();
    const r = await sanctionner({
      message, guild: message.guild, membre: message.member, auteur, salonId: message.channelId,
      raison: RAISON, quoi: 'la pub pour d\'autres serveurs Discord',
    });
    console.log(`[antipub] lien ${auteur.tag} dans #${message.channel.name} : ${codes.join(', ')} (${r.recentes}/24 h)${r.mute ? ', mute' : ''}`);
    journal({
      niveau: r.mute ? 'err' : 'warn',
      titre: r.mute ? 'Anti-pub : mute automatique' : 'Anti-pub : invitation supprimée',
      texte: `<@${auteur.id}> (**${auteur.tag}**) dans <#${message.channelId}>.\n${citer(texte)}`,
      champs: { Invitations: codes.map((c) => `\`${c}\``).join(' '), ...champsSanction(r) },
    });
    return;
  }

  // 2. Phrase de pub sans lien : le classifieur juge.
  const mode = reglagesAntipub.phrases();
  if (mode === 'off') return;
  const m = lireModele();
  const p = probabilitePub(m, texte);
  if (p < reglagesAntipub.seuil()) {
    // Exemple « normal » pour qu il apprenne aussi les discussions ordinaires :
    // un message sur dix, seulement ceux qui ne ressemblent pas a de la pub.
    if (p < 0.5 && Math.random() < 0.1) { apprendre(m, texte, 'normal'); noterModele(); }
    return;
  }
  const score = `${Math.round(p * 100)} %`;
  const pourquoi = indices(m, texte).map((x) => `\`${x}\``).join(' ') || '?';

  if (mode === 'supprimer') {
    const r = await sanctionner({
      message, guild: message.guild, membre: message.member, auteur, salonId: message.channelId,
      raison: RAISON_PHRASE, quoi: 'la pub',
    });
    apprendre(m, texte, 'pub'); noterModele();
    const cle = retenir({ texte, auteurId: auteur.id, warnAt: r.warnAt, classe: 'pub' });
    console.log(`[antipub] phrase ${auteur.tag} (${score}) supprimee`);
    journal({
      niveau: 'warn',
      titre: 'Anti-pub : phrase de pub supprimée',
      texte: `<@${auteur.id}> (**${auteur.tag}**) dans <#${message.channelId}>.\n${citer(texte)}\nUne erreur ? **Pas de la pub** annule l'avertissement et apprend.`,
      champs: { Probabilité: score, Indices: pourquoi, ...champsSanction(r) },
      boutons: [bouton(`antipub:nonpub:${cle}`, 'Pas de la pub', '↩️', ButtonStyle.Secondary)],
    });
    return;
  }

  // mode alerte : rien n est supprime, le staff decide et le bot apprend.
  const cle = retenir({ texte, auteurId: auteur.id, salonId: message.channelId, messageId: message.id });
  console.log(`[antipub] phrase ${auteur.tag} (${score}) signalee au staff`);
  journal({
    niveau: 'info',
    titre: 'Anti-pub : pub probable',
    texte: `<@${auteur.id}> (**${auteur.tag}**) dans <#${message.channelId}> · [voir le message](${message.url})\n${citer(texte)}`,
    champs: { Probabilité: score, Indices: pourquoi },
    boutons: [
      bouton(`antipub:pub:${cle}`, 'C\'est de la pub', '🚫', ButtonStyle.Danger),
      bouton(`antipub:nonpub:${cle}`, 'Pas de la pub', '✅', ButtonStyle.Success),
    ],
  });
}

// ------------------------------------------------------------------ decisions du staff

const EPH = { flags: MessageFlags.Ephemeral };

/** Boutons « C'est de la pub » / « Pas de la pub » du journal. */
export async function onBoutonAntipub(interaction) {
  if (!peutSanctionner(interaction.member)) return interaction.reply({ content: '🔒 Réservé à ceux qui peuvent sanctionner.', ...EPH });
  const [, action, cle] = interaction.customId.split(':');
  const cas = reprendre(cle);
  if (!cas) return interaction.reply({ content: '➖ Déjà traité, ou trop ancien.', ...EPH });
  const m = lireModele();
  const par = `<@${interaction.user.id}>`;
  const fermer = (texte) => interaction.update({ components: [], content: texte });

  if (action === 'nonpub') {
    if (cas.classe === 'pub') desapprendre(m, cas.texte, 'pub');
    apprendre(m, cas.texte, 'normal'); noterModele();
    let annule = '';
    if (cas.warnAt) {
      const i = registre.warns(cas.auteurId).findIndex((w) => w.at === cas.warnAt);
      if (i >= 0) { registre.retirerWarns(cas.auteurId, i + 1); annule = ' Avertissement retiré.'; }
    }
    console.log(`[antipub] ${interaction.user.tag} : pas de la pub (appris)`);
    return fermer(`✅ ${par} : **pas de la pub**, appris.${annule}`);
  }

  // « C'est de la pub » sur une alerte : on sanctionne maintenant.
  apprendre(m, cas.texte, 'pub'); noterModele();
  const guild = interaction.guild;
  const salon = await guild.channels.fetch(cas.salonId).catch(() => null);
  const message = await salon?.messages.fetch(cas.messageId).catch(() => null);
  const auteur = await interaction.client.users.fetch(cas.auteurId).catch(() => null);
  if (!auteur) return fermer(`🚫 ${par} : **de la pub**, appris (auteur introuvable, pas d'avertissement).`);
  const membre = await guild.members.fetch(cas.auteurId).catch(() => null);
  const r = await sanctionner({ message, guild, membre, auteur, salonId: cas.salonId, raison: RAISON_PHRASE, quoi: 'la pub' });
  console.log(`[antipub] ${interaction.user.tag} : pub de ${auteur.tag} (appris, sanctionne)`);
  return fermer(`🚫 ${par} : **de la pub**, appris. Message ${r.supprime ? 'supprimé' : 'déjà parti'}, avertissement ${r.recentes}${r.seuil ? `/${r.seuil}` : ''}${r.mute ? `, mute ${ecrireDuree(r.mute)}` : ''}.`);
}

/** Clic droit > Applications > Signaler comme pub. */
export const commandeSignaler = {
  data: new ContextMenuCommandBuilder().setName('Signaler comme pub').setType(ApplicationCommandType.Message),
  requiresLink: false,
  async execute(interaction) {
    if (!peutSanctionner(interaction.member)) return interaction.reply({ content: '🔒 Réservé à ceux qui peuvent sanctionner.', ...EPH });
    const message = interaction.targetMessage;
    if (!message.content) return interaction.reply({ content: '❌ Ce message n\'a pas de texte.', ...EPH });
    if (message.author.bot) return interaction.reply({ content: '❌ C\'est un bot.', ...EPH });
    await interaction.deferReply(EPH);
    apprendre(lireModele(), message.content, 'pub'); noterModele(); sauverModele();
    const membre = await interaction.guild.members.fetch(message.author.id).catch(() => null);
    const r = await sanctionner({
      message, guild: interaction.guild, membre, auteur: message.author, salonId: message.channelId, raison: RAISON_PHRASE, quoi: 'la pub',
    });
    journal({
      niveau: 'warn',
      titre: 'Anti-pub : signalé par le staff',
      texte: `<@${message.author.id}> (**${message.author.tag}**) dans <#${message.channelId}>, signalé par <@${interaction.user.id}>.\n${citer(message.content)}`,
      champs: champsSanction(r),
    });
    const s = statsModele();
    return interaction.editReply(`🚫 Appris comme pub et sanctionné (avertissement ${r.recentes}${r.seuil ? `/${r.seuil}` : ''}${r.mute ? `, mute ${ecrireDuree(r.mute)}` : ''}). Le détecteur connaît ${s.pub} exemples de pub.`);
  },
};

// ------------------------------------------------------------------ branchement

export function demarrerAntipub(client) {
  if (!config.discord.messageContent) {
    console.log('[antipub] intent Message Content absent : anti-pub a l arret');
    return;
  }
  lireModele();
  const verifier = (m) => controlerMessage(m).catch((e) => console.warn('[antipub] :', e.message));
  client.on('messageCreate', verifier);
  client.on('messageUpdate', (avant, apres) => {
    if (apres.partial || avant.content === apres.content) return;
    verifier(apres);
  });
  setInterval(sauverModele, 60_000).unref();
  const s = statsModele();
  console.log(`[antipub] ${reglagesAntipub.actif() ? 'actif' : 'inactif (a activer dans /setup general)'}, phrases ${reglagesAntipub.phrases()}, modele ${s.pub} pub / ${s.normal} normal`);
}
