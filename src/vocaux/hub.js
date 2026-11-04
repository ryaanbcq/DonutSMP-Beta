// Vocaux « rejoindre pour créer », repris du bot DonutPay.
//
// Un membre rejoint le salon hub : le bot cree son vocal perso dans la
// categorie des vocaux, l y deplace et poste dans le chat du vocal un panneau
// (Verrouiller, Ouvrir, Renommer, Limite, Expulser). Le vocal est supprime
// quand le dernier membre en sort. Etat dans la table vocaux_perso de
// bot.db (sauvegardee par donut export comme les autres tables).
//
// Pieges gardes de la source :
//   - l hote et les roles staff recoivent Connect EXPLICITEMENT a la
//     creation : verrouiller (Connect refuse a @everyone) leur couperait
//     sinon l acces au chat du vocal, et Discord rejette leurs clics avant
//     qu ils n atteignent le bot (« Échec de l'interaction »). Le
//     proprietaire du serveur contourne tout, d ou un bug invisible pour lui ;
//   - le panneau est EDITE sur place (interaction.update), jamais supprime
//     puis reposte : le chat d un vocal ne se rafraichit pas toujours ;
//   - deux boutons fixes Verrouiller et Ouvrir, pas un bouton qui bascule :
//     un affichage pas a jour reste cliquable.

import {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags, escapeMarkdown,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
} from 'discord.js';
import { db, store } from '../db.js';
import { config } from '../config.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import {
  nomVocal, nomParDefaut, sansPrefixe, bornerLimite, peutGerer, sortDuVocal, droitsManquants,
  DROITS_HOTE, DROITS_STAFF, droitsAccordables, LIMITE_MAX, NOM_MAX, dureeVocal,
} from './logique.js';

db.exec(`
CREATE TABLE IF NOT EXISTS vocaux_perso (
  channel_id TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  locked     INTEGER NOT NULL DEFAULT 0,
  limite     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);
// Nom choisi par un membre : repris a chacun de ses vocaux tant qu il ne le
// change pas.
db.exec('CREATE TABLE IF NOT EXISTS vocaux_noms (owner_id TEXT PRIMARY KEY, nom TEXT NOT NULL)');
// Logs : un message par vocal, poste a l ouverture et edite a la fermeture.
for (const col of ['log_message_id TEXT', 'nom TEXT', "participants TEXT NOT NULL DEFAULT '[]'", 'pic INTEGER NOT NULL DEFAULT 0', 'masque INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE vocaux_perso ADD COLUMN ${col}`); } catch { /* deja la */ }
}

const q = {
  get: db.prepare('SELECT * FROM vocaux_perso WHERE channel_id = ?'),
  deHote: db.prepare('SELECT * FROM vocaux_perso WHERE owner_id = ?'),
  tous: db.prepare('SELECT * FROM vocaux_perso'),
  creer: db.prepare('INSERT OR REPLACE INTO vocaux_perso (channel_id, owner_id, locked, limite, created_at) VALUES (?, ?, 0, 0, ?)'),
  verrou: db.prepare('UPDATE vocaux_perso SET locked = ? WHERE channel_id = ?'),
  limite: db.prepare('UPDATE vocaux_perso SET limite = ? WHERE channel_id = ?'),
  oublier: db.prepare('DELETE FROM vocaux_perso WHERE channel_id = ?'),
  nomPrefere: db.prepare('SELECT nom FROM vocaux_noms WHERE owner_id = ?'),
  poserNomPrefere: db.prepare('INSERT INTO vocaux_noms (owner_id, nom) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET nom = excluded.nom'),
  masque: db.prepare('UPDATE vocaux_perso SET masque = ? WHERE channel_id = ?'),
  hote: db.prepare('UPDATE vocaux_perso SET owner_id = ? WHERE channel_id = ?'),
  log: db.prepare('UPDATE vocaux_perso SET log_message_id = ? WHERE channel_id = ?'),
  nom: db.prepare('UPDATE vocaux_perso SET nom = ? WHERE channel_id = ?'),
  presence: db.prepare('UPDATE vocaux_perso SET participants = ?, pic = MAX(pic, ?) WHERE channel_id = ?'),
};

export const vocaux = {
  get: (id) => q.get.get(String(id)) ?? null,
  deHote: (id) => q.deHote.all(String(id)),
  tous: () => q.tous.all(),
  creer: (channelId, ownerId) => q.creer.run(String(channelId), String(ownerId), Date.now()),
  poserVerrou: (id, v) => q.verrou.run(v ? 1 : 0, String(id)),
  poserLimite: (id, n) => q.limite.run(n, String(id)),
  oublier: (id) => q.oublier.run(String(id)),
  nomPrefere: (ownerId) => q.nomPrefere.get(String(ownerId))?.nom ?? null,
  poserNomPrefere: (ownerId, nom) => q.poserNomPrefere.run(String(ownerId), nom),
  poserMasque: (id, v) => q.masque.run(v ? 1 : 0, String(id)),
  poserHote: (id, ownerId) => q.hote.run(String(ownerId), String(id)),
  poserLog: (id, messageId) => q.log.run(messageId ? String(messageId) : null, String(id)),
  poserNom: (id, nom) => q.nom.run(nom, String(id)),
  /** Ajoute les membres presents aux participants et retient le pic. */
  noterPresents: (id, ids) => {
    const e = vocaux.get(id);
    if (!e) return;
    const avant = participantsDe(e);
    const tous = [...new Set([...avant, ...ids.map(String)])];
    q.presence.run(JSON.stringify(tous), ids.length, String(id));
  },
};

export function participantsDe(e) {
  try { const l = JSON.parse(e?.participants ?? '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
}

export const reglagesVocaux = {
  hub: () => store.kvGet('vocaux.hub') || null,
  categorie: () => store.kvGet('vocaux.categorie') || null,
  poserHub: (id) => store.kvSet('vocaux.hub', id ? String(id) : ''),
  poserCategorie: (id) => store.kvSet('vocaux.categorie', id ? String(id) : ''),
  salonLogs: () => store.kvGet('vocaux.salonLogs') || null,
  poserSalonLogs: (id) => store.kvSet('vocaux.salonLogs', id ? String(id) : ''),
};

const EPH = { flags: MessageFlags.Ephemeral };
const nomDe = (membre) => membre?.displayName ?? membre?.user?.globalName ?? membre?.user?.username ?? 'membre';

// ------------------------------------------------------------ panneau

// Facon VoiceMaster, en plus court : un bloc (Components V2), deux menus.
// Les options des menus ne changent jamais : un affichage pas a jour reste
// utilisable (meme logique que les deux boutons fixes de DonutPay).
const REGLAGES = [
  { value: 'rename', label: 'Renommer', emoji: '✏️', description: 'Changer le nom du vocal' },
  { value: 'limit', label: 'Limite de membres', emoji: '👥', description: 'De 0 (aucune) à 99' },
  { value: 'claim', label: 'Récupérer le vocal', emoji: '👑', description: 'Devenir l\'hôte si le sien est parti' },
];
const PERMISSIONS = [
  { value: 'lock', label: 'Verrouiller', emoji: '🔒', description: 'Plus personne ne peut entrer' },
  { value: 'unlock', label: 'Ouvrir', emoji: '🔓', description: 'Tout le monde peut entrer' },
  { value: 'hide', label: 'Masquer', emoji: '👻', description: 'Le vocal disparaît de la liste' },
  { value: 'show', label: 'Afficher', emoji: '👁️', description: 'Le vocal réapparaît' },
  { value: 'kick', label: 'Expulser quelqu\'un', emoji: '⏏️', description: 'Le déconnecter du vocal' },
];

function menu(id, placeholder, options) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder)
    .addOptions(options.map((o) => ({ ...o, emoji: { name: o.emoji } }))));
}

const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

export function panneau(entree, salon, hote, bienvenue = null) {
  // Le nom en texte : une mention s affiche en ID brut chez qui n a pas
  // charge le membre.
  const etat = [
    `👑 ${escapeMarkdown(hote ?? 'inconnu')}`,
    entree.locked ? '🔒 verrouillé' : '🔓 ouvert',
    entree.masque ? '👻 masqué' : null,
    entree.limite > 0 ? `👥 ${entree.limite} max` : '👥 sans limite',
  ].filter(Boolean).join('  ·  ');
  const bloc = new ContainerBuilder().setAccentColor(FR.bleu)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## 🎙️ ${escapeMarkdown(salon.name)}\n`
      + (bienvenue ? `Bienvenue <@${bienvenue}> ! ` : '')
      + 'Gère ton vocal avec les menus ci-dessous (hôte et staff seulement).\n'
      + `-# ${etat}`,
    ))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('### ⚙️ Réglages'))
    .addActionRowComponents(menu('voicehub:reglages', 'Changer les réglages du vocal', REGLAGES))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🔐 Permissions'))
    .addActionRowComponents(menu('voicehub:perms', 'Changer qui peut entrer', PERMISSIONS))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Supprimé automatiquement quand tout le monde est parti.'));
  return { components: [bloc], flags: MessageFlags.IsComponentsV2 };
}

async function hoteDe(guild, entree) {
  const m = guild.members.cache.get(entree.owner_id) ?? await guild.members.fetch(entree.owner_id).catch(() => null);
  return m ? nomDe(m) : null;
}

/** Edite le panneau sur place, jamais supprime puis reposte. */
async function majPanneau(interaction, entree) {
  const salon = interaction.channel;
  const { components } = panneau(entree, salon, await hoteDe(salon.guild, entree));
  try {
    // Un formulaire ouvert depuis un message ephemere (choix de l expulsion)
    // ne peut pas editer le panneau : on passe par le message.
    if (interaction.message?.flags?.has(MessageFlags.IsComponentsV2)) await interaction.update({ components });
    else await interaction.reply({ content: '✅ C\'est fait.', ...EPH });
  } catch (e) {
    console.warn('[vocaux] panneau :', e.message);
  }
}

/**
 * Un menu garde l option choisie affichee, et Discord n envoie rien quand on
 * rechoisit la meme : apres un formulaire ferme sans valider, « Renommer »
 * ne repondait plus. On remet le panneau a neuf des que le formulaire est
 * ouvert.
 */
async function remettreAZero(interaction, entree) {
  const m = interaction.message;
  if (!m) return;
  const { components } = panneau(entree, interaction.channel, await hoteDe(interaction.guild, entree));
  await m.edit({ components }).catch(() => {});
}

// ------------------------------------------------------------ logs

function nomsMembres(guild, ids, max = 15) {
  const noms = ids.slice(0, max).map((id) => {
    const m = guild.members.cache.get(id);
    return m ? escapeMarkdown(nomDe(m)) : `ID ${id}`;
  });
  return noms.join(', ') + (ids.length > max ? ` et ${ids.length - max} autre(s)` : '');
}

function carteLog(guild, e, fin = null) {
  const hote = guild.members.cache.get(e.owner_id);
  const debut = Math.floor(e.created_at / 1000);
  const champs = [
    { name: 'Hôte', value: `${hote ? escapeMarkdown(nomDe(hote)) : 'inconnu'}\n-# ${e.owner_id}`, inline: true },
    { name: 'Ouvert', value: `<t:${debut}:t>`, inline: true },
  ];
  if (fin) {
    const ids = participantsDe(e);
    champs.push(
      { name: 'Fermé', value: `<t:${Math.floor(fin.at / 1000)}:t> · ${dureeVocal(fin.at - e.created_at)}`, inline: true },
      { name: `Participants (${ids.length}, ${e.pic} en même temps au plus)`, value: nomsMembres(guild, ids) || 'aucun' },
    );
  }
  return embed(fin ? '⚫・VOCAL FERMÉ' : '🟢・VOCAL OUVERT', {
    couleur: fin ? 0x4f545c : FR.vert,
    image: 'aucune',
    description: `**${escapeMarkdown(fin?.nom ?? e.nom ?? 'vocal')}**${fin ? `\n${fin.raison}` : `\n<#${e.channel_id}>`}`,
  }).addFields(champs);
}

async function salonLogs(guild) {
  const id = reglagesVocaux.salonLogs();
  if (!id) return null;
  const s = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
  return s?.isTextBased?.() ? s : null;
}

async function logOuverture(guild, e) {
  const s = await salonLogs(guild);
  if (!s) return;
  const m = await s.send({ embeds: [carteLog(guild, e)], allowedMentions: { parse: [] } })
    .catch((err) => { console.warn('[vocaux] log :', err.message); return null; });
  if (m) vocaux.poserLog(e.channel_id, m.id);
}

/** Edite le log d ouverture (ou en poste un s il a disparu). */
async function logFermeture(guild, e, raison, nom = null) {
  const s = await salonLogs(guild);
  if (!s) return;
  const carte = carteLog(guild, e, { at: Date.now(), raison, nom: nom ?? e.nom });
  const m = e.log_message_id ? await s.messages.fetch(e.log_message_id).catch(() => null) : null;
  if (m) await m.edit({ embeds: [carte] }).catch((err) => console.warn('[vocaux] log :', err.message));
  else await s.send({ embeds: [carte], allowedMentions: { parse: [] } }).catch((err) => console.warn('[vocaux] log :', err.message));
}

// ------------------------------------------------------------ creation et suppression

const enCreation = new Set(); // un double passage par le hub ne cree qu un vocal

async function creerVocal(guild, membre) {
  // Il a deja un vocal (revenu par le hub) : on l y renvoie.
  for (const e of vocaux.deHote(membre.id)) {
    const salon = guild.channels.cache.get(e.channel_id);
    if (salon) {
      await membre.voice.setChannel(salon).catch((err) => console.warn('[vocaux] deplacement :', err.message));
      return;
    }
    vocaux.oublier(e.channel_id);
  }

  const moi = guild.members.me;
  const categorie = reglagesVocaux.categorie();
  const permsBot = categorie ? guild.channels.cache.get(categorie)?.permissionsFor(moi) : moi?.permissions;
  const salon = await guild.channels.create({
    name: vocaux.nomPrefere(membre.id) ?? nomParDefaut(nomDe(membre)),
    type: ChannelType.GuildVoice,
    parent: categorie || undefined,
    permissionOverwrites: [
      { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
      // Le bot garde la main meme verrouille.
      ...(moi ? [{ id: moi.id, allow: droitsAccordables(['ViewChannel', 'Connect', 'ManageChannels', 'MoveMembers', 'SendMessages', 'EmbedLinks'], permsBot) }] : []),
      { id: membre.id, allow: droitsAccordables(DROITS_HOTE, permsBot) },
      ...settings.rolesAdmin().filter((r) => guild.roles.cache.has(r))
        .map((r) => ({ id: r, allow: droitsAccordables(DROITS_STAFF, permsBot) })),
    ],
    reason: `Vocal perso de ${membre.user.tag}`,
  }).catch((e) => {
    console.error('[vocaux] creation :', e.message);
    journal({
      niveau: 'err',
      titre: 'Vocaux : création impossible',
      texte: `Le vocal de **${escapeMarkdown(nomDe(membre))}** n'a pas pu être créé. Vérifiez les droits du bot sur la catégorie des vocaux`
        + ' (Voir le salon, Se connecter, Gérer les salons, Déplacer des membres, Gérer les permissions).',
      champs: { Erreur: e.message.slice(0, 200) },
    });
    return null;
  });
  if (!salon) return;

  vocaux.creer(salon.id, membre.id);
  vocaux.poserNom(salon.id, salon.name);
  console.log(`[vocaux] vocal cree pour ${membre.user.tag} (${salon.id})`);
  const deplace = await membre.voice.setChannel(salon).then(() => true).catch((e) => {
    console.warn('[vocaux] deplacement :', e.message);
    return false;
  });
  // Parti du hub avant la fin de la creation : rien a garder.
  if (!deplace && !salon.members.size) {
    await salon.delete('Vocal perso jamais utilisé').catch(() => {});
    vocaux.oublier(salon.id);
    return;
  }
  vocaux.noterPresents(salon.id, [membre.id]);
  await logOuverture(guild, vocaux.get(salon.id));
  await salon.send({
    ...panneau(vocaux.get(salon.id), salon, nomDe(membre), membre.id),
    allowedMentions: { users: [membre.id] },
  }).catch((e) => console.warn('[vocaux] panneau :', e.message));
}

async function nettoyer(guild, salon, id, demarrage = false) {
  const sort = sortDuVocal(salon);
  if (sort === 'garder') return false;
  const e = vocaux.get(id);
  // Oublie d abord : channelDelete ne doit pas logguer une seconde fois.
  vocaux.oublier(id);
  if (sort === 'supprimer') await salon.delete('Vocal perso vide').catch((err) => console.warn('[vocaux] suppression :', err.message));
  if (e) {
    await logFermeture(guild, e, demarrage
      ? 'Vide au redémarrage du bot : supprimé au démarrage (heure de fermeture approximative).'
      : sort === 'supprimer' ? 'Tout le monde est parti.' : 'Le salon avait déjà disparu.', salon?.name);
  }
  return true;
}

export async function surVoiceState(avant, apres) {
  if (avant.channelId === apres.channelId) return; // micro, camera, partage d ecran
  if (apres.guild.id !== config.discord.guildId) return;
  const hub = reglagesVocaux.hub();

  if (hub && apres.channelId === hub) {
    const membre = apres.member ?? await apres.guild.members.fetch(apres.id).catch(() => null);
    if (membre && !membre.user.bot && !enCreation.has(membre.id)) {
      enCreation.add(membre.id);
      try { await creerVocal(apres.guild, membre); } finally { enCreation.delete(membre.id); }
    }
  }
  // Arrivee dans un vocal perso : participant retenu pour le log.
  if (apres.channelId && apres.channelId !== hub && vocaux.get(apres.channelId) && apres.channel) {
    vocaux.noterPresents(apres.channelId, [...apres.channel.members.keys()]);
  }
  if (avant.channelId && avant.channelId !== hub && vocaux.get(avant.channelId)) {
    await nettoyer(avant.guild, avant.channel ?? avant.guild.channels.cache.get(avant.channelId), avant.channelId);
  }
}

/**
 * Au demarrage : un vocal perso vide pendant que le bot etait arrete
 * resterait orphelin pour toujours. Vide = supprime, disparu = oublie.
 */
export async function balayerVocaux(client) {
  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) return 0;
  let n = 0;
  for (const e of vocaux.tous()) {
    const salon = guild.channels.cache.get(e.channel_id) ?? await guild.channels.fetch(e.channel_id).catch(() => null);
    if (await nettoyer(guild, salon, e.channel_id, true)) n += 1;
  }
  return n;
}

/** Droits manquants du bot sur le hub et la categorie, en texte, ou []. */
export function problemesDroits(guild) {
  const moi = guild?.members.me;
  if (!moi) return [];
  const out = [];
  for (const [id, quoi] of [[reglagesVocaux.hub(), 'le hub'], [reglagesVocaux.categorie(), 'la catégorie des vocaux']]) {
    if (!id) continue;
    const salon = guild.channels.cache.get(id);
    if (!salon) { out.push(`${quoi} n'existe plus`); continue; }
    const manque = droitsManquants(salon.permissionsFor(moi));
    if (manque.length) out.push(`sur ${quoi} : **${manque.join('**, **')}**`);
  }
  return out;
}

export async function demarrerVocaux(client) {
  client.on('voiceStateUpdate', (a, b) => surVoiceState(a, b).catch((e) => console.error('[vocaux] :', e.message)));
  // Supprime a la main par le staff : log de fermeture quand meme.
  client.on('channelDelete', (salon) => {
    const e = vocaux.get(salon.id);
    if (!e) return;
    vocaux.oublier(salon.id);
    logFermeture(salon.guild, e, 'Salon supprimé à la main.', salon.name).catch(() => {});
  });
  if (!reglagesVocaux.hub()) return;
  const n = await balayerVocaux(client).catch((e) => { console.warn('[vocaux] balayage :', e.message); return 0; });
  console.log(`[vocaux] hub actif, ${n} vocal(aux) orphelin(s) nettoye(s)`);
  const guild = client.guilds.cache.get(config.discord.guildId);
  const pbs = problemesDroits(guild);
  if (pbs.length) {
    journal({
      niveau: 'err',
      titre: 'Vocaux : droits du bot manquants',
      texte: `Il manque au bot ${pbs.join(' ; ')}. Sans **Se connecter**, Discord répond « Missing Access » même avec Gérer les salons.`,
    });
  }
}

// ------------------------------------------------------------ panneau : clics

export async function onVoicehub(interaction) {
  const id = interaction.customId.slice('voicehub:'.length);
  // Menus : l action est l option choisie. kick = le choix du membre.
  const action = (id === 'reglages' || id === 'perms') ? interaction.values?.[0]
    : id === 'kick' && interaction.isUserSelectMenu() ? 'kickpick' : id;
  const entree = vocaux.get(interaction.channelId);
  if (!entree) return interaction.reply({ content: '❌ Ce salon n\'est pas un vocal perso.', ...EPH });

  // Recuperer : n importe qui DANS le vocal, si l hote n y est plus.
  if (action === 'claim') return recuperer(interaction, entree);

  if (!peutGerer(interaction.member, entree, estAdmin)) {
    await remettreAZero(interaction, entree);
    return interaction.reply({ content: '🔒 Seul l\'hôte de ce vocal (ou le staff) peut faire ça.', ...EPH });
  }
  const salon = interaction.channel;
  console.log(`[vocaux] ${interaction.user.tag} : ${action} sur ${salon.name}`);

  if (action === 'lock' || action === 'unlock') {
    const verrou = action === 'lock';
    const ok = await salon.permissionOverwrites.edit(salon.guild.id, { Connect: !verrou }, { reason: `${verrou ? 'Verrouillé' : 'Ouvert'} par ${interaction.user.tag}` })
      .then(() => true).catch((e) => { console.warn('[vocaux] verrou :', e.message); return false; });
    if (!ok) return interaction.reply({ content: '❌ Je n\'ai pas pu changer l\'accès du vocal (droits du bot).', ...EPH });
    vocaux.poserVerrou(salon.id, verrou);
    return majPanneau(interaction, vocaux.get(salon.id));
  }

  if (action === 'hide' || action === 'show') {
    const masque = action === 'hide';
    const ok = await salon.permissionOverwrites.edit(salon.guild.id, { ViewChannel: !masque }, { reason: `${masque ? 'Masqué' : 'Affiché'} par ${interaction.user.tag}` })
      .then(() => true).catch((e) => { console.warn('[vocaux] masque :', e.message); return false; });
    if (!ok) return interaction.reply({ content: '❌ Je n\'ai pas pu changer la visibilité du vocal (droits du bot).', ...EPH });
    vocaux.poserMasque(salon.id, masque);
    return majPanneau(interaction, vocaux.get(salon.id));
  }

  if (action === 'rename') {
    setTimeout(() => remettreAZero(interaction, entree), 1500).unref?.();
    return interaction.showModal(new ModalBuilder().setCustomId('voicehub:renameform').setTitle('Renommer le vocal')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('nom').setLabel('Nouveau nom').setStyle(TextInputStyle.Short)
          .setRequired(true).setMaxLength(NOM_MAX - 2).setValue(sansPrefixe(salon.name).slice(0, NOM_MAX - 2)),
      )));
  }
  if (action === 'renameform') {
    const nom = nomVocal(interaction.fields.getTextInputValue('nom'));
    if (!nom) return interaction.reply({ content: '❌ Nom vide.', ...EPH });
    const ok = await salon.setName(nom, `Renommé par ${interaction.user.tag}`).then(() => true)
      .catch((e) => { console.warn('[vocaux] renommer :', e.message); return false; });
    // Discord limite les renommages (2 toutes les 10 minutes par salon).
    if (ok) {
      vocaux.poserNom(salon.id, nom);
      // Retenu pour l hote : ses prochains vocaux porteront ce nom.
      if (interaction.user.id === entree.owner_id) vocaux.poserNomPrefere(entree.owner_id, nom);
    }
    if (!ok) return interaction.reply({ content: '❌ Discord refuse le renommage pour l\'instant (2 changements toutes les 10 min au plus). Réessayez plus tard.', ...EPH });
    return majPanneau(interaction, entree);
  }

  if (action === 'limit') {
    setTimeout(() => remettreAZero(interaction, entree), 1500).unref?.();
    return interaction.showModal(new ModalBuilder().setCustomId('voicehub:limitform').setTitle('Limite de membres')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('limite').setLabel(`Nombre maximum (0 à ${LIMITE_MAX}, 0 = aucune)`)
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(entree.limite ?? 0)),
      )));
  }
  if (action === 'limitform') {
    const n = bornerLimite(interaction.fields.getTextInputValue('limite'));
    if (n === null) return interaction.reply({ content: `❌ Entrez un nombre entier de 0 à ${LIMITE_MAX}.`, ...EPH });
    const ok = await salon.setUserLimit(n, `Limite posée par ${interaction.user.tag}`).then(() => true)
      .catch((e) => { console.warn('[vocaux] limite :', e.message); return false; });
    if (!ok) return interaction.reply({ content: '❌ Je n\'ai pas pu changer la limite (droits du bot).', ...EPH });
    vocaux.poserLimite(salon.id, n);
    return majPanneau(interaction, vocaux.get(salon.id));
  }

  if (action === 'kick') {
    await remettreAZero(interaction, entree);
    return interaction.reply({
      content: '⏏️ Qui veux-tu expulser du vocal ?',
      components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('voicehub:kick')
        .setPlaceholder('Choisir un membre').setMinValues(1).setMaxValues(1))],
      ...EPH,
    });
  }
  if (action === 'kickpick') {
    const cible = interaction.values?.[0];
    const membre = cible ? await salon.guild.members.fetch(cible).catch(() => null) : null;
    if (!membre || membre.voice.channelId !== salon.id) {
      return interaction.reply({ content: '❌ Ce membre n\'est pas dans le vocal.', ...EPH });
    }
    if (membre.id === interaction.user.id) return interaction.reply({ content: '❌ Vous ne pouvez pas vous expulser vous-même.', ...EPH });
    // L hote n expulse pas le staff ; le staff peut tout.
    if (!estAdmin(interaction.member) && (estAdmin(membre) || membre.id === entree.owner_id)) {
      return interaction.reply({ content: '❌ Vous ne pouvez pas expulser ce membre.', ...EPH });
    }
    await membre.voice.disconnect(`Expulsé du vocal par ${interaction.user.tag}`).catch(() => {});
    return interaction.update({ content: `⏏️ **${escapeMarkdown(nomDe(membre))}** a été expulsé du vocal.`, components: [] });
  }
  return interaction.reply({ content: '❌ Action inconnue.', ...EPH });
}

async function recuperer(interaction, entree) {
  const salon = interaction.channel;
  await remettreAZero(interaction, entree);
  if (interaction.user.id === entree.owner_id) return interaction.reply({ content: '👑 Tu es déjà l\'hôte de ce vocal.', ...EPH });
  if (interaction.member?.voice?.channelId !== salon.id) {
    return interaction.reply({ content: '❌ Rejoins le vocal pour le récupérer.', ...EPH });
  }
  if (salon.members.has(entree.owner_id) && !estAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ L\'hôte est toujours là.', ...EPH });
  }
  const permsBot = salon.permissionsFor(interaction.guild.members.me);
  const ok = await salon.permissionOverwrites.edit(interaction.user.id,
    Object.fromEntries(DROITS_HOTE.filter((c) => droitsAccordables([c], permsBot).length).map((c) => [c, true])),
    { reason: `Vocal récupéré par ${interaction.user.tag}` }).then(() => true).catch((e) => { console.warn('[vocaux] recuperer :', e.message); return false; });
  if (!ok) return interaction.reply({ content: '❌ Je n\'ai pas pu te donner le vocal (droits du bot).', ...EPH });
  await salon.permissionOverwrites.delete(entree.owner_id, 'Ancien hôte').catch(() => {});
  vocaux.poserHote(salon.id, interaction.user.id);
  const maj = vocaux.get(salon.id);
  await interaction.message?.edit({ components: panneau(maj, salon, nomDe(interaction.member)).components }).catch(() => {});
  return interaction.reply({ content: '👑 Tu es maintenant l\'hôte de ce vocal.', ...EPH });
}
