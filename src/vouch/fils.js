import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration, ChannelType, EmbedBuilder, AttachmentBuilder,
} from 'discord.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { calculerTrust, etoiles, ligneScore } from './trust.js';
import { journal } from '../ops/journal.js';

// Un post par joueur link dans le FORUM des vouches, nomme « ⭐ Pseudo » pour
// que la barre de recherche le trouve. Lecture seule : le bot seul y ecrit. Le
// message de depart du post est la carte de reputation, editee a chaque
// avis ; chaque avis est une carte en dessous. Le tag du post = son palier.

export const TITRE_REPUTATION = '⭐・RÉPUTATION';
const nomFil = (pseudo) => `⭐ ${pseudo}`.slice(0, 100);

async function salonVouch(client) {
  const id = settings.salonVouch();
  if (!id) return null;
  const salon = await client.channels.fetch(id).catch(() => null);
  return salon?.type === ChannelType.GuildForum ? salon : null;
}

// Tags du forum, un par palier : le forum se filtre par confiance.
const TAGS = [
  { name: 'Légende', emoji: '💎' }, { name: 'Trusted', emoji: '🥇' }, { name: 'De confiance', emoji: '🥈' },
  { name: 'Fiable', emoji: '🥉' }, { name: 'Douteux', emoji: '⚠️' }, { name: 'Nouveau', emoji: '🌱' },
  { name: 'Signalé', emoji: '☠️' },
];

async function tagsDuForum(forum) {
  const manquants = TAGS.filter((t) => !forum.availableTags.some((a) => a.name === t.name));
  if (manquants.length) {
    await forum.setAvailableTags([
      ...forum.availableTags,
      ...manquants.map((t) => ({ name: t.name, emoji: { id: null, name: t.emoji }, moderated: true })),
    ], 'Tags de réputation').catch((e) => console.warn('[vouch] tags :', e.message));
  }
  return forum.availableTags;
}

async function tagDe(forum, palier) {
  const tags = await tagsDuForum(forum);
  const tag = tags.find((t) => t.name === palier.nom);
  return tag ? [tag.id] : [];
}

async function fetchFil(client, id) {
  const fil = await client.channels.fetch(id).catch(() => null);
  return fil?.isThread?.() ? fil : null;
}

/**
 * Lecture seule par les PERMISSIONS du forum, jamais par le verrou du fil :
 * Discord grise les boutons d un fil verrouille pour tout non-modérateur
 * (vecu 11/10 : « Donner un avis » inclicable pour les joueurs, cliquable
 * pour le staff). Les membres lisent et cliquent, seul le bot ecrit.
 */
export async function lectureSeule(forum) {
  const everyone = forum.guild.roles.everyone;
  const moi = forum.guild.members.me;
  try {
    await forum.permissionOverwrites.edit(everyone,
      { SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false },
      { reason: 'Forum des vouches : seul le bot écrit' });
    if (moi) {
      await forum.permissionOverwrites.edit(moi,
        { ViewChannel: true, SendMessages: true, SendMessagesInThreads: true, CreatePublicThreads: true,
          ManageThreads: true, EmbedLinks: true, AttachFiles: true, ReadMessageHistory: true },
        { reason: 'Forum des vouches : le bot écrit' });
    }
    return true;
  } catch (e) {
    console.warn('[vouch] lecture seule du forum :', e.message);
    journal({
      niveau: 'err',
      titre: 'Forum des vouches : permission manquante',
      texte: `Le bot ne peut pas mettre <#${forum.id}> en lecture seule : il lui faut **Gérer les permissions** sur ce forum`
        + ' (ou Administrateur). En attendant, les joueurs peuvent écrire dans les profils. Le bot réessaie à chaque redémarrage.',
      champs: { Erreur: e.message.slice(0, 200) },
    });
    return false;
  }
}

/** Un fil archive ou verrouille a ses boutons grises : on le rouvre. */
async function reveiller(fil) {
  if (fil.archived) await fil.setArchived(false, 'Boutons actifs').catch(() => {});
  if (fil.locked) await fil.setLocked(false, 'Lecture seule par permissions').catch(() => {});
  return fil;
}

/**
 * Rend le fil du joueur, en le creant s il manque. Renomme si le pseudo a
 * change (delink/relink). null si aucun salon n est configure.
 */
export async function filDe(client, link) {
  const salon = await salonVouch(client);
  if (!salon) return null;

  const connu = store.getThread(link.discord_id);
  if (connu) {
    let fil = await fetchFil(client, connu.thread_id);
    // Un fil ouvert ailleurs (ancien salon, forum change) ne compte plus : on
    // repart dans le forum courant. L ancien est ARCHIVE et verrouille, jamais
    // supprime : il porte les captures des signalements, que rien ne
    // permettait de republier (un changement de forum par erreur les effacait
    // toutes).
    if (fil && fil.parentId !== salon.id) {
      await fil.setLocked(true, 'Forum des vouches déplacé').catch(() => {});
      await fil.setArchived(true, 'Forum des vouches déplacé').catch(() => {});
      for (const v of store.vouchAll(link.discord_id)) store.setVouchMessage(v.from_id, v.to_id, null);
      fil = null;
    }
    if (fil) {
      if (connu.mc_name !== link.mc_name) {
        await reveiller(fil);
        await fil.setName(nomFil(link.mc_name)).catch(() => {});
        store.setThread(link.discord_id, fil.id, connu.card_id, link.mc_name);
      }
      return fil;
    }
    store.removeThread(link.discord_id);
  }

  const fil = await salon.threads.create({
    name: nomFil(link.mc_name),
    message: carteReputation(link),
    appliedTags: await tagDe(salon, trustDe(link.discord_id).palier),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Post de réputation de ${link.mc_name}`,
  });
  // Dans un forum, le message de depart porte l id du post.
  store.setThread(link.discord_id, fil.id, fil.id, link.mc_name);
  console.log(`[vouch] fil ouvert pour ${link.mc_name}`);
  return fil;
}

export function trustDe(discordId) {
  return calculerTrust(store.vouchAll(discordId));
}

export function carteReputation(link) {
  const t = trustDe(link.discord_id);
  const dernier = store.vouchAll(link.discord_id)[0];
  const pct = t.n ? Math.round((t.pos / t.n) * 100) : null;

  const contenu = embed(TITRE_REPUTATION, {
    couleur: t.palier.emoji === '☠️' ? FR.rouge : t.trusted ? FR.or : FR.bleu,
    image: link.mc_name,
    description:
      `**${link.mc_name}** · <@${link.discord_id}>\n`
      + `## ${t.palier.emoji} ${t.palier.nom}\n`
      + `${etoiles(t.moyenne)} ${t.pos ? t.moyenne.toFixed(1) : 'sans note'} · `
      + `${t.n} avis${pct === null ? '' : ` · ${pct} % positifs`}\n`
      + ligneScore(t),
  }).addFields(
    { name: 'Vouches', value: `✅ ${t.pos}`, inline: true },
    { name: 'Signalements', value: `${t.neg ? '☠️' : '✅'} ${t.neg}`, inline: true },
    { name: 'Dernier avis', value: dernier ? `<t:${Math.floor(dernier.created_at / 1000)}:R>` : 'Aucun', inline: true },
  );
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vouch:noter:${link.discord_id}`)
      .setLabel(`Donner un avis sur ${link.mc_name}`).setEmoji('⭐').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [contenu], components: [boutons] };
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Les pieces d une carte. PIEGE : une piece jointe consommee par un embed
 * (attachment://) DISPARAIT de message.attachments, seule l URL de l image
 * de l embed reste. On lit donc les deux.
 */
export function piecesDe(message) {
  const pieces = [...message.attachments.values()].map((a) => ({ name: a.name, url: a.url }));
  for (const e of message.embeds ?? []) {
    const url = e.image?.url;
    if (!url || pieces.some((p) => p.url === url)) continue;
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'preuve.png');
    pieces.push({ name, url });
  }
  return pieces;
}

/** Retelecharge les pieces d une carte pour les renvoyer (les URL sont fraiches au fetch). */
export async function fichiersDe(message) {
  const files = [];
  for (const p of piecesDe(message)) {
    const res = await fetch(p.url).catch(() => null);
    if (res?.ok) files.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name: p.name }));
  }
  return files;
}

/**
 * Carte d un avis. noms : fichiers envoyes avec le message (attachment://) ;
 * les images vont DANS l embed (la premiere en grand, jusqu a trois autres
 * en galerie, meme URL de carte = Discord les groupe), le reste en piece jointe.
 */
export function carteAvis(vouch, auteurLink, cibleLink, { noms = [], lien = null } = {}) {
  const positif = vouch.value > 0;
  const preuves = noms.length ? noms.map((name) => ({ name })) : (() => {
    try { return JSON.parse(vouch.preuves ?? '[]'); } catch { return []; }
  })();
  const contenu = embed(positif ? '✅・VOUCH' : '⚠️・SIGNALEMENT', {
    couleur: positif ? FR.vert : FR.rouge,
    image: auteurLink?.mc_name ?? 'aucune',
    description:
      `**${auteurLink?.mc_name ?? 'Membre'}** <@${vouch.from_id}> `
      + (positif ? `· ${etoiles(vouch.stars ?? 5)}` : '· signale **' + cibleLink.mc_name + '**')
      + (vouch.comment ? `\n> ${vouch.comment.replace(/\n/g, '\n> ')}` : ''),
  }).setTimestamp(vouch.created_at);
  const n = preuves.length + (vouch.video ? 1 : 0);
  if (n) contenu.setFooter({ text: `📎 ${n} preuve(s) jointe(s)` });

  const embeds = [contenu];
  const images = noms.filter((n) => IMAGE.test(n)).slice(0, 4);
  if (images.length && lien) {
    contenu.setURL(lien).setImage(`attachment://${images[0]}`);
    for (const n of images.slice(1)) embeds.push(new EmbedBuilder().setURL(lien).setImage(`attachment://${n}`));
  }
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vouch:suppr:${vouch.from_id}:${vouch.to_id}`)
      .setLabel('Retirer (staff)').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
  );
  // Le lien en texte, hors de l embed : Discord affiche le lecteur du clip.
  return { content: vouch.video ? `🎬 ${vouch.video}` : '', embeds, components: [boutons] };
}

/**
 * Il y a eu une copie de la carte de reputation en dernier message du fil
 * (avec son bouton « Donner un avis »). Retiree le 13/10 : deux cartes
 * identiques dans le post. Seule la carte de depart reste ; la copie encore
 * en place dans les anciens fils est supprimee au passage.
 */
async function retirerPanelEnBas(fil, link) {
  const cle = `panel:${link.discord_id}`;
  const ancienId = store.kvGet(cle);
  if (!ancienId) return;
  await fil.messages.delete(ancienId).catch(() => {});
  store.kvSet(cle, '');
}

/** Reecrit la carte de reputation et pose ou retire le role Trusted. */
export async function rafraichir(client, discordId) {
  const link = store.getLink(discordId);
  if (!link) return;
  const fil = await filDe(client, link);
  if (fil) {
    await reveiller(fil);
    const carte = await fil.fetchStarterMessage().catch(() => null);
    if (carte) await carte.edit(carteReputation(link)).catch((e) => console.warn('[vouch] carte :', e.message));
    await retirerPanelEnBas(fil, link);
    const forum = await salonVouch(client);
    if (forum) await fil.setAppliedTags(await tagDe(forum, trustDe(discordId).palier)).catch(() => {});
  }
  await majRoleTrusted(client, discordId);
}

/**
 * Publie (ou reecrit) la carte d un avis dans le fil de la cible. Rend le fil.
 * fichiers : preuves a joindre (AttachmentBuilder ou { attachment, name }) ;
 * elles remplacent les anciennes quand l avis est modifie.
 */
// Un double clic sur « Publier » lancait deux publications en parallele :
// aucune ne voyait encore la carte de l autre, deux cartes partaient, et le
// retrait par le staff n en supprimait qu une (vecu le 31/10, EZblueberry sur
// T67T). Les publications d un meme avis passent donc l une apres l autre.
const enCours = new Map();
export function posterAvis(client, fromId, toId, opts = {}) {
  const cle = `${fromId}:${toId}`;
  const avant = enCours.get(cle) ?? Promise.resolve();
  const p = avant.catch(() => {}).then(() => posterAvisSeul(client, fromId, toId, opts));
  enCours.set(cle, p);
  p.finally(() => { if (enCours.get(cle) === p) enCours.delete(cle); }).catch(() => {});
  return p;
}

async function posterAvisSeul(client, fromId, toId, { fichiers = [] } = {}) {
  const vouch = store.getVouch(fromId, toId);
  const cible = store.getLink(toId);
  if (!vouch || !cible) return null;
  const fil = await filDe(client, cible);
  if (!fil) return null;
  await reveiller(fil);

  // Les URL d upload du formulaire expirent : la carte publiee dans le fil
  // devient la copie de reference, on memorise SES pieces jointes.
  const ancien = vouch.message_id ? await fil.messages.fetch(vouch.message_id).catch(() => null) : null;

  // Modification sans nouvelles preuves : les images vivent dans l embed en
  // attachment://, il faut donc renvoyer les fichiers. On les reprend sur
  // l ancienne carte, dont les liens sont frais au moment du fetch.
  let files = fichiers;
  if (!files.length && ancien) files = await fichiersDe(ancien);
  const lien = `https://discord.com/channels/${fil.guildId}/${fil.id}`;
  const carte = carteAvis(vouch, store.getLink(fromId), cible, { noms: files.map((f) => f.name), lien });
  let m;
  if (ancien) {
    m = await ancien.edit(files.length ? { ...carte, files, attachments: [] } : carte).catch((e) => { console.warn('[vouch] carte :', e.message); return null; });
  } else {
    m = await fil.send(files.length ? { ...carte, files } : carte);
  }
  if (m) store.setVouchMessage(fromId, toId, m.id, files.length ? piecesDe(m) : null);
  await rafraichir(client, toId);
  return fil;
}

/** Retire un avis : carte supprimee dans le fil, score recalcule. */
export async function retirerAvis(client, fromId, toId) {
  const vouch = store.getVouch(fromId, toId);
  if (!vouch) return false;
  if (vouch.message_id) {
    const connu = store.getThread(toId);
    const fil = connu ? await fetchFil(client, connu.thread_id) : null;
    if (fil) {
      await reveiller(fil);
      await fil.messages.delete(vouch.message_id).catch(() => {});
    }
  }
  store.removeVouch(fromId, toId);
  await rafraichir(client, toId);
  return true;
}

async function majRoleTrusted(client, discordId) {
  const roleId = settings.roleTrusted();
  const guildId = settings.salonVouch() ? (await client.channels.fetch(settings.salonVouch()).catch(() => null))?.guildId : null;
  if (!roleId || !guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const membre = await guild?.members.fetch(discordId).catch(() => null);
  if (!membre) return;
  const t = trustDe(discordId);
  const a = membre.roles.cache.has(roleId);
  if (t.trusted && !a) await membre.roles.add(roleId, 'Trust score').catch((e) => console.warn('[vouch] role :', e.message));
  if (!t.trusted && a) await membre.roles.remove(roleId, 'Trust score').catch((e) => console.warn('[vouch] role :', e.message));
}

/** Au demarrage et a chaque link : chaque compte verifie a son post. */
export async function assurerFils(client) {
  if (!settings.salonVouch()) return 0;
  const forum = await salonVouch(client);
  if (forum) await lectureSeule(forum);
  let n = 0;
  for (const link of store.allLinks()) {
    const avant = store.getThread(link.discord_id);
    const fil = await filDe(client, link).catch((e) => { console.warn(`[vouch] fil de ${link.mc_name} :`, e.message); return null; });
    if (fil && avant?.thread_id !== fil.id) n += 1;
    // Carte reecrite au passage : un changement d affichage se propage ainsi
    // a tous les posts existants au redemarrage.
    else if (fil) await rafraichir(client, link.discord_id).catch(() => {});
  }
  return n;
}

/**
 * Un post sans activite s archive au bout d une semaine, et ses boutons se
 * grisent : toutes les 6 h, on rouvre les posts archives du forum.
 */
export async function reveillerFils(client) {
  const forum = await salonVouch(client);
  if (!forum) return 0;
  let n = 0;
  let avant;
  for (let page = 0; page < 20; page++) {
    const r = await forum.threads.fetchArchived({ before: avant, limit: 100 }).catch(() => null);
    if (!r?.threads.size) break;
    for (const fil of r.threads.values()) {
      if (fil.ownerId !== client.user.id) continue;
      await reveiller(fil);
      n += 1;
    }
    if (!r.hasMore) break;
    avant = r.threads.last();
  }
  if (n) console.log(`[vouch] ${n} post(s) archivé(s) rouvert(s)`);
  return n;
}

