// Vocaux temporaires, repris du fichier « vocaux-temporaires.js » (panneau
// facon VoiceMaster en Components V2) et adapte au bot : reglages en base,
// DA DonutFR, logs d ouverture et de fermeture, nom retenu, balayage au
// demarrage.
//
// Un membre rejoint le hub (« ➕ Créer un vocal ») : le bot cree son salon,
// l y deplace et poste le panneau dans le chat du vocal. Le salon est supprime
// des qu il est vide ; si le proprietaire part, il passe a quelqu un qui est
// encore dedans.
//   - camera et partage, soundboard, invitations : reserves aux boosters 💎
//   - region : reservee au proprietaire du serveur
//   - roles proteges : jamais expulses ni refuses
//   - staff (roles admin du bot, « Gérer le serveur » ou « Gérer les salons ») :
//     gere n importe quel salon et peut le donner a n importe qui
//
//   table vocaux_perso    un salon ouvert (proprietaire, panneau, log, participants)
//   table vocaux_noms     dernier nom choisi par un membre, repris a ses prochains salons
//   table vocaux_profils  reglages sauvegardes (« Sauvegarder mes réglages »)
//   kv vocaux.hub | vocaux.categorie | vocaux.salonLogs | vocaux.conf (modele, limite, rolesProteges, attenteInvitations)
//
// Pieges gardes :
//   - le proprietaire et les roles staff recoivent Connect EXPLICITEMENT :
//     verrouiller leur couperait sinon le chat du vocal (« Échec de l'interaction ») ;
//   - le proprietaire n a pas « Gérer les salons » : c est le bot qui agit ;
//   - on n accorde que les droits que le bot possede, sinon Discord refuse
//     de creer le salon (Missing Permissions) ;
//   - un menu garde l option choisie : le panneau est reecrit apres chaque usage.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, MentionableSelectMenuBuilder,
  MessageFlags, ModalBuilder, OverwriteType, PermissionFlagsBits, SectionBuilder, SeparatorBuilder,
  SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
  ThumbnailBuilder, UserSelectMenuBuilder, escapeMarkdown,
} from 'discord.js';
import { db, store } from '../db.js';
import { config } from '../config.js';
import { settings } from '../settings.js';
import { embed, FR, logo } from '../lib/brand.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import {
  bornerLimite, droitsManquants, dureeVocal, sortDuVocal, nomDepuisModele, attenteInvitation, estProtege,
} from './logique.js';

const P = PermissionFlagsBits;
const EPH = MessageFlags.Ephemeral;
const COOLDOWN_CREATION_MS = 10_000;

// ------------------------------------------------------------ base

db.exec(`
CREATE TABLE IF NOT EXISTS vocaux_perso (
  channel_id TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  locked     INTEGER NOT NULL DEFAULT 0,
  limite     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vocaux_noms (owner_id TEXT PRIMARY KEY, nom TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vocaux_profils (owner_id TEXT PRIMARY KEY, profil TEXT NOT NULL);
`);
for (const col of ['log_message_id TEXT', 'nom TEXT', "participants TEXT NOT NULL DEFAULT '[]'", 'pic INTEGER NOT NULL DEFAULT 0',
  'masque INTEGER NOT NULL DEFAULT 0', 'panneau_id TEXT']) {
  try { db.exec(`ALTER TABLE vocaux_perso ADD COLUMN ${col}`); } catch { /* deja la */ }
}

const q = {
  get: db.prepare('SELECT * FROM vocaux_perso WHERE channel_id = ?'),
  tous: db.prepare('SELECT * FROM vocaux_perso'),
  creer: db.prepare('INSERT OR REPLACE INTO vocaux_perso (channel_id, owner_id, locked, limite, created_at) VALUES (?, ?, 0, 0, ?)'),
  oublier: db.prepare('DELETE FROM vocaux_perso WHERE channel_id = ?'),
  hote: db.prepare('UPDATE vocaux_perso SET owner_id = ? WHERE channel_id = ?'),
  log: db.prepare('UPDATE vocaux_perso SET log_message_id = ? WHERE channel_id = ?'),
  nom: db.prepare('UPDATE vocaux_perso SET nom = ? WHERE channel_id = ?'),
  panneau: db.prepare('UPDATE vocaux_perso SET panneau_id = ? WHERE channel_id = ?'),
  presence: db.prepare('UPDATE vocaux_perso SET participants = ?, pic = MAX(pic, ?) WHERE channel_id = ?'),
  nomPrefere: db.prepare('SELECT nom FROM vocaux_noms WHERE owner_id = ?'),
  poserNomPrefere: db.prepare('INSERT INTO vocaux_noms (owner_id, nom) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET nom = excluded.nom'),
  profil: db.prepare('SELECT profil FROM vocaux_profils WHERE owner_id = ?'),
  poserProfil: db.prepare('INSERT INTO vocaux_profils (owner_id, profil) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET profil = excluded.profil'),
};

export function participantsDe(e) {
  try { const l = JSON.parse(e?.participants ?? '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
}

export const vocaux = {
  get: (id) => q.get.get(String(id)) ?? null,
  tous: () => q.tous.all(),
  creer: (channelId, ownerId) => q.creer.run(String(channelId), String(ownerId), Date.now()),
  oublier: (id) => q.oublier.run(String(id)),
  poserHote: (id, ownerId) => q.hote.run(String(ownerId), String(id)),
  poserLog: (id, messageId) => q.log.run(messageId ? String(messageId) : null, String(id)),
  poserNom: (id, nom) => q.nom.run(nom, String(id)),
  poserPanneau: (id, messageId) => q.panneau.run(messageId ? String(messageId) : null, String(id)),
  nomPrefere: (ownerId) => q.nomPrefere.get(String(ownerId))?.nom ?? null,
  poserNomPrefere: (ownerId, nom) => q.poserNomPrefere.run(String(ownerId), nom),
  profil: (ownerId) => { try { return JSON.parse(q.profil.get(String(ownerId))?.profil ?? 'null'); } catch { return null; } },
  poserProfil: (ownerId, p) => q.poserProfil.run(String(ownerId), JSON.stringify(p)),
  noterPresents: (id, ids) => {
    const e = vocaux.get(id);
    if (!e) return;
    const tous = [...new Set([...participantsDe(e), ...ids.map(String)])];
    q.presence.run(JSON.stringify(tous), ids.length, String(id));
  },
};

export const DEFAUTS_VOCAUX = { modele: '🔊 Vocal de {pseudo}', limite: 0, rolesProteges: [], attenteInvitations: 5 };

const confJson = () => { try { return JSON.parse(store.kvGet('vocaux.conf') ?? '') ?? {}; } catch { return {}; } };

export const reglagesVocaux = {
  hub: () => store.kvGet('vocaux.hub') || null,
  categorie: () => store.kvGet('vocaux.categorie') || null,
  poserHub: (id) => store.kvSet('vocaux.hub', id ? String(id) : ''),
  poserCategorie: (id) => store.kvSet('vocaux.categorie', id ? String(id) : ''),
  salonLogs: () => store.kvGet('vocaux.salonLogs') || null,
  poserSalonLogs: (id) => store.kvSet('vocaux.salonLogs', id ? String(id) : ''),
  conf: () => ({ ...DEFAUTS_VOCAUX, ...confJson() }),
  poserConf: (patch) => store.kvSet('vocaux.conf', JSON.stringify({ ...confJson(), ...patch })),
};

// ------------------------------------------------------------ droits

const nomDe = (m) => m?.displayName ?? m?.user?.globalName ?? m?.user?.username ?? 'membre';
const mention = (c) => (c.type === OverwriteType.Role ? `<@&${c.id}>` : `<@${c.id}>`);
const humains = (salon) => salon.members.filter((m) => !m.user.bot).size;

/** Staff : roles admin du bot, « Gérer le serveur », ou « Gérer les salons ». */
const estStaff = (m) => Boolean(m && (estAdmin(m) || m.permissions?.has(P.ManageChannels)));
const peutGerer = (m, e) => e.owner_id === m.id || estStaff(m);
const peutChangerRegion = (m) => m.id === m.guild.ownerId;
/** Boosters du serveur (et admins / proprietaire du serveur, pour tester). */
const estBooster = (m) => Boolean(m.premiumSinceTimestamp) || m.permissions.has(P.Administrator) || m.id === m.guild.ownerId;

const PERMS_PROPRIO = ['ViewChannel', 'Connect', 'Speak', 'Stream', 'UseVAD', 'SendMessages', 'ReadMessageHistory'];
const PERMS_BOT = ['ViewChannel', 'Connect', 'ManageChannels', 'ManageRoles', 'MoveMembers', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'];
const PERMS_STAFF = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'ReadMessageHistory'];
const BOOSTERS = '💎 Cette option est réservée aux **boosters** du serveur. Booste le serveur pour la débloquer !';

/** Seulement les droits que le bot possede lui meme (sinon Missing Permissions). */
function accordables(guild, noms) {
  const cat = reglagesVocaux.categorie();
  const perms = cat ? guild.channels.cache.get(cat)?.permissionsFor(guild.members.me) : guild.members.me?.permissions;
  return noms.filter((n) => !perms || perms.has(P.Administrator) || perms.has(P[n]));
}
const objetDroits = (guild, noms) => Object.fromEntries(accordables(guild, noms).map((n) => [n, true]));

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

const overwritesDeBase = (guild, proprioId, refusEveryone = []) => [
  { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: refusEveryone },
  { id: proprioId, type: OverwriteType.Member, allow: accordables(guild, PERMS_PROPRIO) },
  { id: guild.members.me.id, type: OverwriteType.Member, allow: accordables(guild, PERMS_BOT) },
  // Le staff garde l acces meme quand le salon est verrouille.
  ...settings.rolesAdmin().filter((r) => guild.roles.cache.has(r))
    .map((r) => ({ id: r, type: OverwriteType.Role, allow: accordables(guild, PERMS_STAFF) })),
];

// ------------------------------------------------------------ etat du salon

/** Discord n autorise que 2 renommages par 10 min : discord.js attend alors en silence. */
async function renommer(salon, nom, proprioId = null) {
  const propre = String(nom).trim().slice(0, 100);
  if (!propre) return '❌ Le nom ne peut pas être vide.';
  const r = await Promise.race([
    salon.setName(propre).then(() => 'ok'),
    new Promise((res) => setTimeout(() => res('attente'), 4000)),
  ]);
  vocaux.poserNom(salon.id, propre);
  // Le nom choisi est repris a ses prochains vocaux, tant qu il ne le change pas.
  if (proprioId) vocaux.poserNomPrefere(proprioId, propre);
  return r === 'ok'
    ? `✅ Salon renommé en **${escapeMarkdown(propre)}**.`
    : '⏳ Discord limite à 2 changements de nom par 10 minutes : le nom changera dès que possible.';
}

function etatSalon(salon) {
  const everyone = salon.permissionOverwrites.cache.get(salon.guild.roles.everyone.id);
  return {
    verrouille: Boolean(everyone?.deny.has(P.Connect)),
    cameraCoupee: Boolean(everyone?.deny.has(P.Stream)),
    soundboardCoupe: Boolean(everyone?.deny.has(P.UseSoundboard)),
  };
}

function acces(salon, e) {
  const autorises = [];
  const refuses = [];
  const staff = new Set(settings.rolesAdmin());
  for (const ow of salon.permissionOverwrites.cache.values()) {
    if (ow.id === salon.guild.roles.everyone.id || ow.id === salon.client.user.id || ow.id === e.owner_id || staff.has(ow.id)) continue;
    const c = { id: ow.id, type: ow.type, mention: mention(ow) };
    if (ow.deny.has(P.Connect)) refuses.push(c);
    else if (ow.allow.has(P.Connect)) autorises.push(c);
  }
  return { autorises, refuses };
}

// ------------------------------------------------------------ panneau (Components V2)

const REGLAGES = [
  { value: 'nom', emoji: '✏️', label: 'Nom', description: 'Changer le nom du salon' },
  { value: 'limite', emoji: '👥', label: 'Limite', description: 'Nombre maximum de personnes' },
  { value: 'statut', emoji: '💬', label: 'Statut', description: 'Texte affiché sous le nom du salon' },
  { value: 'camera', emoji: '📹', label: 'Caméra et partage 💎', description: 'Boosters : autoriser ou couper caméra et partage d\'écran' },
  { value: 'soundboard', emoji: '🔊', label: 'Soundboard 💎', description: 'Boosters : autoriser ou couper le soundboard' },
  { value: 'region', emoji: '🌍', label: 'Région', description: 'Réservé au propriétaire du serveur' },
  { value: 'reset', emoji: '♻️', label: 'Réinitialiser', description: 'Remettre le salon par défaut' },
  { value: 'sauver', emoji: '💾', label: 'Sauvegarder mes réglages', description: 'Remis à chacun de tes prochains salons' },
];
const PERMISSIONS = [
  { value: 'verrouiller', emoji: '🔒', label: 'Verrouiller', description: 'Plus personne ne peut entrer' },
  { value: 'deverrouiller', emoji: '🔓', label: 'Déverrouiller', description: 'Tout le monde peut entrer' },
  { value: 'autoriser', emoji: '✅', label: 'Autoriser', description: 'Laisser entrer des membres ou des rôles' },
  { value: 'refuser', emoji: '⛔', label: 'Refuser', description: 'Bloquer et expulser des membres ou des rôles' },
  { value: 'inviter', emoji: '📨', label: 'Inviter 💎', description: 'Boosters : envoyer une invitation en message privé' },
  { value: 'expulser', emoji: '👢', label: 'Expulser', description: 'Déconnecter quelqu\'un du salon' },
  { value: 'transferer', emoji: '🔁', label: 'Transférer', description: 'Donner le salon à quelqu\'un d\'autre' },
  { value: 'acces', emoji: '📋', label: 'Voir les accès', description: 'Qui est autorisé ou refusé' },
];

const texte = (c) => new TextDisplayBuilder().setContent(c);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const menu = (id, placeholder, options) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
  .setCustomId(id).setPlaceholder(placeholder).addOptions(options.map((o) => ({ ...o, emoji: { name: o.emoji } }))));

export function construirePanneau(salon) {
  const e = vocaux.get(salon.id);
  const proprio = e ? salon.guild.members.cache.get(e.owner_id) : null;
  const etat = etatSalon(salon);
  // Le nom en texte : une mention s affiche en ID brut chez qui n a pas le membre en cache.
  const ligne = [
    `👑 ${escapeMarkdown(proprio ? nomDe(proprio) : 'inconnu')}`,
    etat.verrouille ? '🔒 verrouillé' : '🔓 ouvert',
    salon.userLimit ? `👥 ${salon.userLimit} max` : '👥 sans limite',
    etat.cameraCoupee ? '📹 caméra coupée' : null,
    etat.soundboardCoupe ? '🔇 soundboard coupé' : null,
  ].filter(Boolean).join('  ·  ');
  const entete = new SectionBuilder()
    .addTextDisplayComponents(
      texte(`## 🎙️ ${escapeMarkdown(salon.name)}\nBienvenue dans ton vocal temporaire ! Gère-le avec les menus ci-dessous, ou avec \`/vocal\`.\n-# ${ligne}`),
      texte('💾 **Sauvegarder mes réglages** (menu) les garde pour tes prochains salons, **Charger** les remet ici.\n'
        + '-# Options 💎 réservées aux boosters du serveur. `/vocal panneau` reposte ce panneau.'),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(logo() ?? salon.client.user.displayAvatarURL({ size: 256 })));

  const bloc = new ContainerBuilder().setAccentColor(FR.bleu)
    .addSectionComponents(entete)
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(texte('### ⚙️ Réglages'))
    .addActionRowComponents(menu(`voicehub:reglages:${salon.id}`, 'Changer les réglages du salon', REGLAGES))
    .addTextDisplayComponents(texte('### 🔐 Permissions'))
    .addActionRowComponents(menu(`voicehub:perms:${salon.id}`, 'Changer qui peut entrer', PERMISSIONS))
    .addSeparatorComponents(sep())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`voicehub:charger:${salon.id}`).setLabel('Charger mes réglages').setEmoji('📥').setStyle(ButtonStyle.Primary),
    ))
    .addTextDisplayComponents(texte('-# Supprimé automatiquement quand tout le monde est parti.'));
  return { components: [bloc], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function rafraichir(salon) {
  const e = salon ? vocaux.get(salon.id) : null;
  if (!e?.panneau_id) return;
  const msg = await salon.messages.fetch(e.panneau_id).catch(() => null);
  if (msg) await msg.edit(construirePanneau(salon)).catch((err) => console.warn('[vocaux] panneau :', err.message));
}

async function posterPanneau(salon) {
  const msg = await salon.send(construirePanneau(salon)).catch((e) => { console.warn('[vocaux] panneau :', e.message); return null; });
  if (msg) vocaux.poserPanneau(salon.id, msg.id);
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
  const champs = [
    { name: 'Propriétaire', value: `${hote ? escapeMarkdown(nomDe(hote)) : 'inconnu'}\n-# ${e.owner_id}`, inline: true },
    { name: 'Ouvert', value: `<t:${Math.floor(e.created_at / 1000)}:t>`, inline: true },
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

async function logFermeture(guild, e, raison, nom = null) {
  const s = await salonLogs(guild);
  if (!s) return;
  const carte = carteLog(guild, e, { at: Date.now(), raison, nom: nom ?? e.nom });
  const m = e.log_message_id ? await s.messages.fetch(e.log_message_id).catch(() => null) : null;
  if (m) await m.edit({ embeds: [carte] }).catch((err) => console.warn('[vocaux] log :', err.message));
  else await s.send({ embeds: [carte], allowedMentions: { parse: [] } }).catch((err) => console.warn('[vocaux] log :', err.message));
}

// ------------------------------------------------------------ creation, transfert, suppression

const derniereCreation = new Map();
const derniereInvitation = new Map();
const enCreation = new Set();

async function donnerA(salon, e, nouveau) {
  await salon.permissionOverwrites.delete(e.owner_id).catch(() => {});
  await salon.permissionOverwrites.edit(nouveau.id, objetDroits(salon.guild, PERMS_PROPRIO), { type: OverwriteType.Member });
  vocaux.poserHote(salon.id, nouveau.id);
}

/** Le proprietaire part : le salon passe a quelqu un qui est encore dedans. */
async function passerLaMain(salon, e, partantId) {
  const heritier = salon.members.find((m) => !m.user.bot && m.id !== partantId);
  if (!heritier) return;
  await donnerA(salon, e, heritier);
  await salon.send({ content: `👑 <@${partantId}> a quitté le salon : ${heritier} est maintenant propriétaire.`, allowedMentions: { users: [heritier.id] } }).catch(() => {});
}

async function creerSalon(membre) {
  const guild = membre.guild;
  const conf = reglagesVocaux.conf();
  if (Date.now() - (derniereCreation.get(membre.id) ?? 0) < COOLDOWN_CREATION_MS) {
    return membre.voice.disconnect('Création de salon trop rapide').catch(() => {});
  }
  derniereCreation.set(membre.id, Date.now());

  const profil = vocaux.profil(membre.id) ?? {};
  const hub = guild.channels.cache.get(reglagesVocaux.hub());
  const cat = reglagesVocaux.categorie();
  const parent = cat && guild.channels.cache.get(cat)?.type === ChannelType.GuildCategory ? cat : hub?.parentId ?? null;
  const refusEveryone = [];
  if (profil.verrouille) refusEveryone.push(P.Connect);
  // Options boosters : remises seulement si le membre booste encore.
  if (profil.cameraCoupee && estBooster(membre)) refusEveryone.push(P.Stream);
  if (profil.soundboardCoupe && estBooster(membre)) refusEveryone.push(P.UseSoundboard);
  const nom = profil.nom || vocaux.nomPrefere(membre.id)
    || nomDepuisModele(conf.modele, { pseudo: nomDe(membre), utilisateur: membre.user.username });

  let salon;
  try {
    salon = await guild.channels.create({
      name: nom.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent,
      userLimit: Math.max(0, Math.min(99, profil.limite ?? conf.limite)),
      permissionOverwrites: overwritesDeBase(guild, membre.id, refusEveryone),
      reason: `Vocal temporaire de ${membre.user.username}`,
    });
  } catch (err) {
    console.error('[vocaux] création impossible :', err.message);
    journal({
      niveau: 'err',
      titre: 'Vocaux : création impossible',
      texte: `Le vocal de **${escapeMarkdown(nomDe(membre))}** n'a pas pu être créé. Vérifiez les droits du bot sur la catégorie des vocaux`
        + ' (Voir le salon, Se connecter, Gérer les salons, Déplacer des membres, Gérer les permissions).',
      champs: { Erreur: err.message.slice(0, 200) },
    });
    return membre.voice.disconnect('Création impossible').catch(() => {});
  }
  vocaux.creer(salon.id, membre.id);
  vocaux.poserNom(salon.id, salon.name);
  console.log(`[vocaux] vocal cree pour ${membre.user.tag} (${salon.id})`);

  // Acces sauvegardes, un par un : un membre ou un role disparu ne bloque pas le reste.
  const proteges = new Set(conf.rolesProteges);
  for (const a of profil.autorises ?? []) {
    if (a.id !== membre.id) await salon.permissionOverwrites.edit(a.id, { ViewChannel: true, Connect: true }, { type: a.type }).catch(() => {});
  }
  for (const r of profil.refuses ?? []) {
    if (r.id !== membre.id && !proteges.has(r.id)) await salon.permissionOverwrites.edit(r.id, { ViewChannel: false, Connect: false }, { type: r.type }).catch(() => {});
  }

  const deplace = await membre.voice.setChannel(salon, 'Salon vocal temporaire').then(() => true).catch(() => false);
  if (!deplace) {
    vocaux.oublier(salon.id);
    return salon.delete('Vocal temporaire jamais utilisé').catch(() => {});
  }
  vocaux.noterPresents(salon.id, [membre.id]);
  await logOuverture(guild, vocaux.get(salon.id));
  await posterPanneau(salon);
}

async function supprimerSalon(guild, salon, raison) {
  const e = vocaux.get(salon.id);
  vocaux.oublier(salon.id); // avant : channelDelete ne doit pas logguer une seconde fois
  await salon.delete('Salon vocal temporaire vide').catch((err) => console.warn('[vocaux] suppression :', err.message));
  if (e) await logFermeture(guild, e, raison, salon.name);
}

export async function surVoiceState(ancien, nouveau) {
  if (ancien.channelId === nouveau.channelId) return; // micro, camera, partage d ecran
  if (nouveau.guild.id !== config.discord.guildId) return;
  const membre = nouveau.member ?? ancien.member ?? await nouveau.guild.members.fetch(nouveau.id).catch(() => null);
  if (!membre || membre.user.bot) return;

  // Depart d un salon temporaire
  if (ancien.channelId && vocaux.get(ancien.channelId)) {
    const salon = ancien.channel ?? ancien.guild.channels.cache.get(ancien.channelId);
    if (!salon) {
      const e = vocaux.get(ancien.channelId);
      vocaux.oublier(ancien.channelId);
      if (e) await logFermeture(ancien.guild, e, 'Le salon avait déjà disparu.');
    } else if (humains(salon) === 0) {
      await supprimerSalon(ancien.guild, salon, 'Tout le monde est parti.');
    } else {
      const e = vocaux.get(salon.id);
      if (e.owner_id === membre.id) await passerLaMain(salon, e, membre.id);
      await rafraichir(salon);
    }
  }

  // Arrivee : hub = toujours un NOUVEAU salon
  if (nouveau.channelId) {
    if (nouveau.channelId === reglagesVocaux.hub()) {
      if (enCreation.has(membre.id)) return;
      enCreation.add(membre.id);
      try { await creerSalon(membre); } finally { enCreation.delete(membre.id); }
      return;
    }
    if (vocaux.get(nouveau.channelId) && nouveau.channel) {
      vocaux.noterPresents(nouveau.channelId, [...nouveau.channel.members.keys()]);
      await rafraichir(nouveau.channel);
    }
  }
}

/** Au demarrage : un salon vide pendant que le bot etait arrete est supprime, un disparu oublie. */
export async function balayerVocaux(client) {
  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) return 0;
  let n = 0;
  for (const e of vocaux.tous()) {
    const salon = guild.channels.cache.get(e.channel_id) ?? await guild.channels.fetch(e.channel_id).catch(() => null);
    const sort = sortDuVocal(salon);
    if (sort === 'garder') continue;
    vocaux.oublier(e.channel_id);
    if (sort === 'supprimer') await salon.delete('Vocal temporaire vide').catch(() => {});
    await logFermeture(guild, e, 'Vide au redémarrage du bot : supprimé au démarrage (heure de fermeture approximative).', salon?.name);
    n += 1;
  }
  return n;
}

// ------------------------------------------------------------ actions

async function verrouiller(salon, oui) {
  await salon.permissionOverwrites.edit(salon.guild.roles.everyone, { Connect: oui ? false : null });
  return oui ? '🔒 Salon verrouillé : seuls les membres autorisés peuvent entrer.' : '🔓 Salon déverrouillé.';
}

async function autoriser(salon, cibles) {
  const ok = [];
  for (const c of cibles) {
    if (c.id === salon.client.user.id) continue;
    await salon.permissionOverwrites.edit(c.id, { ViewChannel: true, Connect: true }, { type: c.type });
    ok.push(mention(c));
  }
  return ok.length ? `✅ Autorisé : ${ok.join(', ')}` : 'Personne à autoriser.';
}

async function refuser(salon, e, cibles) {
  const proteges = reglagesVocaux.conf().rolesProteges;
  const staff = settings.rolesAdmin();
  const ok = [];
  const ignores = [];
  for (const c of cibles) {
    if (c.id === e.owner_id || c.id === salon.client.user.id || c.id === salon.guild.roles.everyone.id) continue;
    const membre = c.type === OverwriteType.Member
      ? salon.guild.members.cache.get(c.id) ?? await salon.guild.members.fetch(c.id).catch(() => null) : null;
    if ((c.type === OverwriteType.Role && (proteges.includes(c.id) || staff.includes(c.id)))
      || (membre && (estProtege(membre.roles.cache.keys(), proteges) || estStaff(membre)))) {
      ignores.push(mention(c));
      continue;
    }
    await salon.permissionOverwrites.edit(c.id, { ViewChannel: false, Connect: false }, { type: c.type });
    ok.push(mention(c));
    for (const m of salon.members.values()) {
      if (m.id === e.owner_id || m.user.bot || estProtege(m.roles.cache.keys(), proteges) || estStaff(m)) continue;
      const vise = c.type === OverwriteType.Member ? m.id === c.id : m.roles.cache.has(c.id);
      if (vise) await m.voice.disconnect('Refusé par le propriétaire du salon').catch(() => {});
    }
  }
  return [
    ok.length ? `⛔ Refusé : ${ok.join(', ')}` : '',
    ignores.length ? `🛡️ Protégé (staff ou rôle protégé), impossible de le refuser : ${ignores.join(', ')}` : '',
  ].filter(Boolean).join('\n') || 'Personne à refuser (tu ne peux pas te refuser toi-même).';
}

async function transferer(salon, e, cible, par) {
  if (!cible || cible.user.bot) return '❌ Membre introuvable (les bots ne peuvent pas être propriétaires).';
  if (cible.id === e.owner_id) return 'C\'est déjà le propriétaire.';
  if (!estStaff(par) && !salon.members.has(cible.id)) return '❌ Le nouveau propriétaire doit être dans le salon.';
  await donnerA(salon, e, cible);
  return `👑 ${cible} est maintenant propriétaire du salon.`;
}

async function basculer(salon, flag, texteOn, texteOff) {
  const coupe = Boolean(salon.permissionOverwrites.cache.get(salon.guild.roles.everyone.id)?.deny.has(P[flag]));
  await salon.permissionOverwrites.edit(salon.guild.roles.everyone, { [flag]: coupe ? null : false });
  return coupe ? texteOn : texteOff;
}

async function reinitialiser(salon, e) {
  const conf = reglagesVocaux.conf();
  await salon.permissionOverwrites.set(overwritesDeBase(salon.guild, e.owner_id));
  await salon.setUserLimit(conf.limite);
  const proprio = await salon.guild.members.fetch(e.owner_id).catch(() => null);
  if (proprio) {
    const nom = nomDepuisModele(conf.modele, { pseudo: nomDe(proprio), utilisateur: proprio.user.username });
    if (nom !== salon.name) await renommer(salon, nom);
  }
  return '♻️ Salon remis par défaut (permissions, limite, nom).';
}

function profilDepuisSalon(salon, e) {
  const { autorises, refuses } = acces(salon, e);
  return {
    nom: salon.name,
    limite: salon.userLimit,
    ...etatSalon(salon),
    autorises: autorises.map(({ id, type }) => ({ id, type })),
    refuses: refuses.map(({ id, type }) => ({ id, type })),
  };
}

async function appliquerProfil(salon, e, membre, p) {
  const booster = estBooster(membre);
  await salon.permissionOverwrites.edit(salon.guild.roles.everyone, {
    Connect: p.verrouille ? false : null,
    Stream: booster && p.cameraCoupee ? false : null,
    UseSoundboard: booster && p.soundboardCoupe ? false : null,
  });
  const proteges = new Set(reglagesVocaux.conf().rolesProteges);
  for (const a of p.autorises ?? []) await salon.permissionOverwrites.edit(a.id, { ViewChannel: true, Connect: true }, { type: a.type }).catch(() => {});
  for (const r of p.refuses ?? []) {
    if (r.id !== e.owner_id && !proteges.has(r.id)) await salon.permissionOverwrites.edit(r.id, { ViewChannel: false, Connect: false }, { type: r.type }).catch(() => {});
  }
  await salon.setUserLimit(p.limite ?? 0);
  const nom = p.nom && p.nom !== salon.name ? await renommer(salon, p.nom) : '';
  return `📥 Réglages chargés.${nom.startsWith('⏳') ? `\n${nom}` : ''}`;
}

// ------------------------------------------------------------ interactions du panneau

function cibler(interaction, channelId, { proprio = true } = {}) {
  const e = channelId ? vocaux.get(channelId) : null;
  const salon = channelId ? interaction.guild.channels.cache.get(channelId) : null;
  if (!e || salon?.type !== ChannelType.GuildVoice) return { erreur: '❌ Ce salon temporaire n\'existe plus.' };
  if (proprio && !peutGerer(interaction.member, e)) {
    const p = interaction.guild.members.cache.get(e.owner_id);
    return { erreur: `🔒 Seul le propriétaire du salon (**${escapeMarkdown(p ? nomDe(p) : 'inconnu')}**) ou le staff peut faire ça.` };
  }
  return { e, salon };
}

async function repondre(interaction, contenu) {
  const charge = typeof contenu === 'string' ? { content: contenu } : contenu;
  if (interaction.deferred || interaction.replied) return interaction.editReply({ ...charge, allowedMentions: { parse: [] } });
  return interaction.reply({ ...charge, flags: EPH, allowedMentions: { parse: [] } });
}

function modal(id, titre, champs) {
  const m = new ModalBuilder().setCustomId(id).setTitle(titre);
  for (const c of champs) {
    const input = new TextInputBuilder().setCustomId(c.id).setLabel(c.label)
      .setStyle(c.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(c.requis ?? true).setMaxLength(c.max ?? 100);
    if (c.valeur !== undefined && c.valeur !== null && String(c.valeur) !== '') input.setValue(String(c.valeur).slice(0, c.max ?? 100));
    if (c.placeholder) input.setPlaceholder(c.placeholder);
    m.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return m;
}

const choix = (composant) => ({ components: [new ActionRowBuilder().addComponents(composant)] });

async function regions(client, actuelle) {
  const liste = await client.fetchVoiceRegions().catch(() => null);
  const options = [{ label: 'Automatique', value: 'auto', default: !actuelle }];
  for (const r of liste?.values() ?? []) {
    if (r.deprecated || options.length >= 25) continue;
    options.push({ label: r.name, value: r.id, default: actuelle === r.id, ...(r.optimal ? { description: 'La plus proche du bot' } : {}) });
  }
  return options;
}

async function surReglage(interaction, salon, e, valeur) {
  const membre = interaction.member;
  switch (valeur) {
    case 'nom':
      return interaction.showModal(modal(`voicehub:m:nom:${salon.id}`, 'Nom du salon', [{ id: 'v', label: 'Nouveau nom', valeur: salon.name }]));
    case 'limite':
      return interaction.showModal(modal(`voicehub:m:limite:${salon.id}`, 'Limite de personnes', [{ id: 'v', label: 'Nombre de places (0 = illimité, max 99)', valeur: salon.userLimit, max: 2 }]));
    case 'statut':
      return interaction.showModal(modal(`voicehub:m:statut:${salon.id}`, 'Statut du salon', [{ id: 'v', label: 'Statut (vide = l\'enlever)', requis: false, max: 500, long: true, placeholder: 'Ex : on cherche un 4e pour une base' }]));
    case 'region':
      if (!peutChangerRegion(membre)) return repondre(interaction, '🔒 La région des salons est réservée au propriétaire du serveur.');
      return repondre(interaction, { content: '🌍 Région du salon :', ...choix(new StringSelectMenuBuilder().setCustomId(`voicehub:s:region:${salon.id}`).addOptions(await regions(interaction.client, salon.rtcRegion))) });
    case 'camera':
    case 'soundboard':
      if (!estBooster(membre)) return repondre(interaction, BOOSTERS);
      break;
    default:
      break;
  }
  await interaction.deferReply({ flags: EPH });
  switch (valeur) {
    case 'camera': return repondre(interaction, await basculer(salon, 'Stream', '📹 Caméra et partage d\'écran autorisés.', '🚫 Caméra et partage d\'écran coupés.'));
    case 'soundboard': return repondre(interaction, await basculer(salon, 'UseSoundboard', '🔊 Soundboard autorisé.', '🔇 Soundboard coupé.'));
    case 'reset': return repondre(interaction, await reinitialiser(salon, e));
    case 'sauver':
      vocaux.poserProfil(interaction.user.id, profilDepuisSalon(salon, e));
      return repondre(interaction, '💾 Réglages sauvegardés (nom, limite, verrouillage, accès) : ils seront remis à chacun de tes prochains salons.');
    default:
      return repondre(interaction, 'Option inconnue.');
  }
}

async function surPermission(interaction, salon, e, valeur) {
  switch (valeur) {
    case 'autoriser':
      return repondre(interaction, { content: '✅ Qui peut entrer ? (membres ou rôles)', ...choix(new MentionableSelectMenuBuilder().setCustomId(`voicehub:s:autoriser:${salon.id}`).setMinValues(1).setMaxValues(10)) });
    case 'refuser':
      return repondre(interaction, { content: '⛔ Qui bloquer ? Ceux qui sont déjà dans le salon seront déconnectés.', ...choix(new MentionableSelectMenuBuilder().setCustomId(`voicehub:s:refuser:${salon.id}`).setMinValues(1).setMaxValues(10)) });
    case 'inviter': {
      if (!estBooster(interaction.member)) return repondre(interaction, BOOSTERS);
      const reste = attenteInvitation(derniereInvitation.get(interaction.user.id) ?? 0, reglagesVocaux.conf().attenteInvitations);
      if (reste > 0) return repondre(interaction, `⏳ Tu pourras réinviter dans ${Math.ceil(reste / 60_000)} min.`);
      return repondre(interaction, { content: '📨 Qui inviter ? Ils seront autorisés et recevront le lien en privé.', ...choix(new UserSelectMenuBuilder().setCustomId(`voicehub:s:inviter:${salon.id}`).setMinValues(1).setMaxValues(5)) });
    }
    case 'expulser':
      return repondre(interaction, { content: '👢 Qui déconnecter du salon ?', ...choix(new UserSelectMenuBuilder().setCustomId(`voicehub:s:expulser:${salon.id}`).setMinValues(1).setMaxValues(10)) });
    case 'transferer':
      return repondre(interaction, {
        content: estStaff(interaction.member) ? '🔁 À qui donner le salon ? (staff : n\'importe quel membre)' : '🔁 À qui donner le salon ? (il doit être dedans)',
        ...choix(new UserSelectMenuBuilder().setCustomId(`voicehub:s:transferer:${salon.id}`).setMaxValues(1)),
      });
    case 'acces': {
      const { autorises, refuses } = acces(salon, e);
      const etat = etatSalon(salon);
      const p = interaction.guild.members.cache.get(e.owner_id);
      return repondre(interaction, [
        `**${escapeMarkdown(salon.name)}** · ${etat.verrouille ? '🔒 verrouillé' : '🔓 ouvert'}${etat.cameraCoupee ? ' · 📹 caméra coupée' : ''}${etat.soundboardCoupe ? ' · 🔇 soundboard coupé' : ''}`,
        `👑 Propriétaire : **${escapeMarkdown(p ? nomDe(p) : 'inconnu')}**`,
        `✅ Autorisés : ${autorises.map((a) => a.mention).join(', ') || 'personne'}`,
        `⛔ Refusés : ${refuses.map((r) => r.mention).join(', ') || 'personne'}`,
      ].join('\n'));
    }
    default:
      break;
  }
  await interaction.deferReply({ flags: EPH });
  if (valeur === 'verrouiller') return repondre(interaction, await verrouiller(salon, true));
  if (valeur === 'deverrouiller') return repondre(interaction, await verrouiller(salon, false));
  return repondre(interaction, 'Option inconnue.');
}

async function surSousMenu(interaction, salon, e, action) {
  await interaction.deferUpdate();
  const fin = (contenu) => interaction.editReply({ content: contenu, components: [], allowedMentions: { parse: [] } });
  const cibles = () => [
    ...(interaction.users?.map((u) => ({ id: u.id, type: OverwriteType.Member })) ?? []),
    ...(interaction.roles?.map((r) => ({ id: r.id, type: OverwriteType.Role })) ?? []),
  ];
  switch (action) {
    case 'region': {
      if (!peutChangerRegion(interaction.member)) return fin('🔒 La région des salons est réservée au propriétaire du serveur.');
      const v = interaction.values[0];
      await salon.setRTCRegion(v === 'auto' ? null : v);
      return fin(`🌍 Région : **${v === 'auto' ? 'Automatique' : v}**.`);
    }
    case 'autoriser': return fin(await autoriser(salon, cibles()));
    case 'refuser': return fin(await refuser(salon, e, cibles()));
    case 'inviter': {
      if (!estBooster(interaction.member)) return fin(BOOSTERS);
      const reste = attenteInvitation(derniereInvitation.get(interaction.user.id) ?? 0, reglagesVocaux.conf().attenteInvitations);
      if (reste > 0) return fin(`⏳ Tu pourras réinviter dans ${Math.ceil(reste / 60_000)} min.`);
      derniereInvitation.set(interaction.user.id, Date.now());
      const invite = await salon.createInvite({ maxAge: 3600, maxUses: 0, reason: 'Invitation vocal temporaire' }).catch(() => null);
      const membres = cibles().filter((c) => c.type === OverwriteType.Member);
      await autoriser(salon, membres);
      const envoyes = [];
      const rates = [];
      for (const c of membres) {
        const u = await interaction.client.users.fetch(c.id).catch(() => null);
        if (!u || u.bot) continue;
        const ok = Boolean(invite) && await u.send(`📨 **${nomDe(interaction.member)}** t'invite dans son vocal **${salon.name}** sur **${salon.guild.name}** : ${invite.url}`).then(() => true).catch(() => false);
        (ok ? envoyes : rates).push(`<@${c.id}>`);
      }
      return fin([
        envoyes.length ? `📨 Invitation envoyée à ${envoyes.join(', ')}.` : '',
        rates.length ? `⚠️ MP fermés pour ${rates.join(', ')}${invite ? ` : envoie-leur ce lien ${invite.url}` : ''}` : '',
        'Ils peuvent entrer même si le salon est verrouillé.',
      ].filter(Boolean).join('\n'));
    }
    case 'expulser': {
      const proteges = reglagesVocaux.conf().rolesProteges;
      const ok = [];
      const ignores = [];
      for (const c of cibles()) {
        const m = salon.members.get(c.id);
        if (!m || m.id === e.owner_id) continue;
        if (estProtege(m.roles.cache.keys(), proteges) || (estStaff(m) && !estStaff(interaction.member))) { ignores.push(`<@${m.id}>`); continue; }
        await m.voice.disconnect('Expulsé par le propriétaire du salon').catch(() => {});
        ok.push(`<@${m.id}>`);
      }
      return fin([
        ok.length ? `👢 Déconnecté : ${ok.join(', ')}` : '',
        ignores.length ? `🛡️ Protégé, impossible d'expulser : ${ignores.join(', ')}` : '',
      ].filter(Boolean).join('\n') || 'Personne à déconnecter (il faut qu\'ils soient dans le salon).');
    }
    case 'transferer': {
      const id = cibles()[0]?.id;
      const cible = id ? salon.members.get(id) ?? await salon.guild.members.fetch(id).catch(() => null) : null;
      return fin(await transferer(salon, e, cible, interaction.member));
    }
    default:
      return fin('Option inconnue.');
  }
}

async function surModal(interaction, salon, e, action) {
  const v = interaction.fields.getTextInputValue('v')?.trim() ?? '';
  await interaction.deferReply({ flags: EPH });
  switch (action) {
    case 'nom': return repondre(interaction, await renommer(salon, v, interaction.user.id === e.owner_id ? e.owner_id : null));
    case 'limite': {
      const n = bornerLimite(v);
      if (n === null) return repondre(interaction, '❌ Mets un nombre entre 0 et 99 (0 = illimité).');
      await salon.setUserLimit(n);
      return repondre(interaction, n ? `👥 Limite : **${n}** personnes.` : '👥 Limite retirée.');
    }
    case 'statut':
      try {
        // Pas encore dans discord.js : route de l API pour le statut d un vocal.
        await interaction.client.rest.put(`/channels/${salon.id}/voice-status`, { body: { status: v } });
        return repondre(interaction, v ? `💬 Statut : **${escapeMarkdown(v)}**` : '💬 Statut retiré.');
      } catch (err) {
        return repondre(interaction, `❌ Discord a refusé le statut : ${err.message}`);
      }
    default:
      return repondre(interaction, 'Formulaire inconnu.');
  }
}

/** Tous les composants voicehub:* (menus, sous-menus, formulaires, bouton Charger). */
export async function onVoicehub(interaction) {
  const parts = interaction.customId.split(':');
  try {
    if (interaction.isStringSelectMenu() && (parts[1] === 'reglages' || parts[1] === 'perms') && parts[2]) {
      const valeur = interaction.values[0];
      const { salon, e, erreur } = cibler(interaction, parts[2], { proprio: valeur !== 'acces' });
      if (erreur) return repondre(interaction, erreur);
      try {
        return parts[1] === 'reglages' ? await surReglage(interaction, salon, e, valeur) : await surPermission(interaction, salon, e, valeur);
      } finally {
        // Remet les menus a zero : sinon rechoisir la meme option ne fait rien.
        setTimeout(() => rafraichir(salon).catch(() => {}), 1500);
      }
    }
    if (interaction.isAnySelectMenu() && parts[1] === 's') {
      const { salon, e, erreur } = cibler(interaction, parts[3]);
      if (erreur) return interaction.update({ content: erreur, components: [] });
      await surSousMenu(interaction, salon, e, parts[2]);
      return rafraichir(salon);
    }
    if (interaction.isModalSubmit() && parts[1] === 'm') {
      const { salon, e, erreur } = cibler(interaction, parts[3]);
      if (erreur) return repondre(interaction, erreur);
      await surModal(interaction, salon, e, parts[2]);
      return rafraichir(salon);
    }
    if (interaction.isButton() && parts[1] === 'charger') {
      const { salon, e, erreur } = cibler(interaction, parts[2]);
      if (erreur) return repondre(interaction, erreur);
      await interaction.deferReply({ flags: EPH });
      const p = vocaux.profil(interaction.user.id);
      if (!p) return repondre(interaction, 'Tu n\'as pas encore de réglages sauvegardés : règle ton salon puis choisis **Sauvegarder mes réglages** dans le menu.');
      const r = await appliquerProfil(salon, e, interaction.member, p);
      await rafraichir(salon);
      return repondre(interaction, r);
    }
    // Ancien panneau (avant la refonte) : on le dit.
    return repondre(interaction, '♻️ Ce panneau est périmé : tape `/vocal panneau` dans ton vocal pour en avoir un neuf.');
  } catch (err) {
    console.error('[vocaux]', err);
    const msg = `❌ Erreur : ${err.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg, components: [] }).catch(() => {});
    else await interaction.reply({ content: msg, flags: EPH }).catch(() => {});
  }
}

// ------------------------------------------------------------ /vocal

export async function executerVocal(interaction) {
  const membre = interaction.member;
  const { salon, e, erreur } = cibler(interaction, membre.voice?.channelId, { proprio: false });
  if (erreur) return repondre(interaction, '❌ Tu dois être dans un salon vocal temporaire.');
  const sub = interaction.options.getSubcommand();
  if (sub === 'region') {
    if (!peutChangerRegion(membre)) return repondre(interaction, '🔒 La région des salons est réservée au propriétaire du serveur.');
  } else if (sub !== 'panneau' && !peutGerer(membre, e)) {
    return repondre(interaction, cibler(interaction, salon.id).erreur);
  }
  await interaction.deferReply({ flags: EPH });
  const cible = () => {
    const m = interaction.options.getMentionable('cible', true);
    return [{ id: m.id, type: interaction.guild.roles.cache.has(m.id) ? OverwriteType.Role : OverwriteType.Member }];
  };
  let r = 'Commande inconnue.';
  switch (sub) {
    case 'renommer': r = await renommer(salon, interaction.options.getString('nom', true), membre.id === e.owner_id ? e.owner_id : null); break;
    case 'limite': {
      const n = interaction.options.getInteger('nombre', true);
      await salon.setUserLimit(n);
      r = n ? `👥 Limite : **${n}** personnes.` : '👥 Limite retirée.';
      break;
    }
    case 'verrouiller': r = await verrouiller(salon, true); break;
    case 'deverrouiller': r = await verrouiller(salon, false); break;
    case 'autoriser': r = await autoriser(salon, cible()); break;
    case 'refuser': r = await refuser(salon, e, cible()); break;
    case 'transferer': {
      const u = interaction.options.getUser('membre', true);
      r = await transferer(salon, e, salon.members.get(u.id) ?? await interaction.guild.members.fetch(u.id).catch(() => null), membre);
      break;
    }
    case 'region': {
      const v = interaction.options.getString('region', true);
      await salon.setRTCRegion(v === 'auto' ? null : v);
      r = `🌍 Région : **${v === 'auto' ? 'Automatique' : v}**.`;
      break;
    }
    case 'panneau':
      await posterPanneau(salon);
      r = '✅ Panneau reposté dans le salon.';
      break;
    default:
      break;
  }
  await rafraichir(salon);
  return repondre(interaction, r);
}

export async function autocompleteVocal(interaction) {
  const liste = await interaction.client.fetchVoiceRegions().catch(() => null);
  const qx = interaction.options.getFocused().toLowerCase();
  const options = [{ name: 'Automatique', value: 'auto' }, ...[...(liste?.values() ?? [])].filter((r) => !r.deprecated).map((r) => ({ name: r.name, value: r.id }))];
  return interaction.respond(options.filter((c) => c.name.toLowerCase().includes(qx)).slice(0, 25));
}

// ------------------------------------------------------------ demarrage

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
  // Entres dans le hub pendant que le bot etait arrete : on les sert.
  const hub = guild?.channels.cache.get(reglagesVocaux.hub());
  for (const membre of hub?.members?.values() ?? []) {
    if (membre.user.bot || enCreation.has(membre.id)) continue;
    enCreation.add(membre.id);
    await creerSalon(membre).catch((e) => console.error('[vocaux] creation :', e.message)).finally(() => enCreation.delete(membre.id));
  }
  const pbs = problemesDroits(guild);
  if (pbs.length) {
    journal({
      niveau: 'err',
      titre: 'Vocaux : droits du bot manquants',
      texte: `Il manque au bot ${pbs.join(' ; ')}. Sans **Se connecter**, Discord répond « Missing Access » même avec Gérer les salons.`,
    });
  }
}
