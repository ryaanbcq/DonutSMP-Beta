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
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags, escapeMarkdown,
} from 'discord.js';
import { db, store } from '../db.js';
import { config } from '../config.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import {
  nomVocal, nomParDefaut, sansPrefixe, bornerLimite, peutGerer, sortDuVocal, droitsManquants,
  DROITS_HOTE, DROITS_STAFF, droitsAccordables, LIMITE_MAX, NOM_MAX,
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

const q = {
  get: db.prepare('SELECT * FROM vocaux_perso WHERE channel_id = ?'),
  deHote: db.prepare('SELECT * FROM vocaux_perso WHERE owner_id = ?'),
  tous: db.prepare('SELECT * FROM vocaux_perso'),
  creer: db.prepare('INSERT OR REPLACE INTO vocaux_perso (channel_id, owner_id, locked, limite, created_at) VALUES (?, ?, 0, 0, ?)'),
  verrou: db.prepare('UPDATE vocaux_perso SET locked = ? WHERE channel_id = ?'),
  limite: db.prepare('UPDATE vocaux_perso SET limite = ? WHERE channel_id = ?'),
  oublier: db.prepare('DELETE FROM vocaux_perso WHERE channel_id = ?'),
};

export const vocaux = {
  get: (id) => q.get.get(String(id)) ?? null,
  deHote: (id) => q.deHote.all(String(id)),
  tous: () => q.tous.all(),
  creer: (channelId, ownerId) => q.creer.run(String(channelId), String(ownerId), Date.now()),
  poserVerrou: (id, v) => q.verrou.run(v ? 1 : 0, String(id)),
  poserLimite: (id, n) => q.limite.run(n, String(id)),
  oublier: (id) => q.oublier.run(String(id)),
};

export const reglagesVocaux = {
  hub: () => store.kvGet('vocaux.hub') || null,
  categorie: () => store.kvGet('vocaux.categorie') || null,
  poserHub: (id) => store.kvSet('vocaux.hub', id ? String(id) : ''),
  poserCategorie: (id) => store.kvSet('vocaux.categorie', id ? String(id) : ''),
};

const EPH = { flags: MessageFlags.Ephemeral };
const nomDe = (membre) => membre?.displayName ?? membre?.user?.globalName ?? membre?.user?.username ?? 'membre';

// ------------------------------------------------------------ panneau

function panneau(entree, salon, hote) {
  const contenu = embed('🎙️・TON VOCAL', {
    couleur: FR.bleu,
    image: 'aucune',
    description: `### ${escapeMarkdown(salon.name)}\n`
      + 'Gérez votre vocal sans quitter Discord. Seuls l\'hôte et le staff peuvent utiliser ces boutons.',
  }).addFields(
    // Le nom en texte : une mention dans un embed s affiche en ID brut chez
    // qui n a pas charge le membre.
    { name: 'Hôte', value: escapeMarkdown(hote ?? 'inconnu'), inline: true },
    { name: 'Accès', value: entree.locked ? '🔒 Verrouillé' : '🔓 Ouvert', inline: true },
    { name: 'Limite', value: entree.limite > 0 ? `${entree.limite} membre${entree.limite > 1 ? 's' : ''}` : 'Aucune', inline: true },
  ).setFooter({ text: 'Supprimé automatiquement quand tout le monde est parti' });

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('voicehub:lock').setLabel('Verrouiller').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voicehub:unlock').setLabel('Ouvrir').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('voicehub:rename').setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('voicehub:limit').setLabel('Limite').setEmoji('👥').setStyle(ButtonStyle.Primary),
  );
  const expulser = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('voicehub:kick').setPlaceholder('⏏️ Expulser quelqu\'un du vocal')
      .setMinValues(1).setMaxValues(1),
  );
  return { embeds: [contenu], components: [boutons, expulser] };
}

async function hoteDe(guild, entree) {
  const m = guild.members.cache.get(entree.owner_id) ?? await guild.members.fetch(entree.owner_id).catch(() => null);
  return m ? nomDe(m) : null;
}

/** Edite le panneau sur place, jamais supprime puis reposte. */
async function majPanneau(interaction, entree) {
  const salon = interaction.channel;
  try {
    await interaction.update(panneau(entree, salon, await hoteDe(salon.guild, entree)));
  } catch (e) {
    console.warn('[vocaux] panneau :', e.message);
  }
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
    name: nomParDefaut(nomDe(membre)),
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
  await salon.send({
    content: `👋 <@${membre.id}>, bienvenue dans ton vocal !`,
    ...panneau(vocaux.get(salon.id), salon, nomDe(membre)),
    allowedMentions: { users: [membre.id] },
  }).catch((e) => console.warn('[vocaux] panneau :', e.message));
}

async function nettoyer(salon, id) {
  const sort = sortDuVocal(salon);
  if (sort === 'garder') return false;
  if (sort === 'supprimer') await salon.delete('Vocal perso vide').catch((e) => console.warn('[vocaux] suppression :', e.message));
  vocaux.oublier(id);
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
  if (avant.channelId && avant.channelId !== hub && vocaux.get(avant.channelId)) {
    await nettoyer(avant.channel ?? avant.guild.channels.cache.get(avant.channelId), avant.channelId);
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
    if (await nettoyer(salon, e.channel_id)) n += 1;
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
  client.on('channelDelete', (salon) => { if (vocaux.get(salon.id)) vocaux.oublier(salon.id); });
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
  const action = interaction.customId.slice('voicehub:'.length);
  const entree = vocaux.get(interaction.channelId);
  if (!entree) return interaction.reply({ content: '❌ Ce salon n\'est pas un vocal perso.', ...EPH });
  if (!peutGerer(interaction.member, entree, estAdmin)) {
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

  if (action === 'rename') {
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
    if (!ok) return interaction.reply({ content: '❌ Discord refuse le renommage pour l\'instant (2 changements toutes les 10 min au plus). Réessayez plus tard.', ...EPH });
    return majPanneau(interaction, entree);
  }

  if (action === 'limit') {
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
    return interaction.reply({ content: `⏏️ **${escapeMarkdown(nomDe(membre))}** a été expulsé du vocal.`, ...EPH });
  }
  return interaction.reply({ content: '❌ Action inconnue.', ...EPH });
}
