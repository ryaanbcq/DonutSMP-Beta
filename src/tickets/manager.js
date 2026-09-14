import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder, GatewayIntentBits,
} from 'discord.js';
import { store } from '../db.js';
import { FR } from '../lib/brand.js';
import { reglagesTickets } from './reglages.js';
import { enteteTicket, boutonsTicket, embedLog, TITRE_TICKET } from './panel.js';
import { rendreTranscript, collecterMessages } from './transcript.js';

// Cycle de vie d un ticket : menu du panneau → formulaire → salon prive.
// Les boutons de l en tete ferment, rouvrent, prennent en charge, sauvegardent
// les logs ou suppriment. Toute suppression passe d abord par un transcript
// si un salon de logs est configure : on ne perd jamais une conversation.

const EPH = { flags: MessageFlags.Ephemeral };

const PERMS_MEMBRE = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
const PERMS_STAFF = [...PERMS_MEMBRE, PermissionFlagsBits.ManageMessages];
const PERMS_BOT = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
];

export function estStaff(membre) {
  if (!membre) return false;
  if (membre.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const roles = reglagesTickets.roles();
  return roles.some((id) => membre.roles?.cache?.has(id));
}

/** Ce qui manque au bot pour ouvrir des tickets dans cette guilde. Vide = tout va bien. */
export function permissionsManquantes(guild) {
  const moi = guild.members.me;
  if (!moi) return ['le bot est introuvable dans la guilde'];
  const manque = [];
  if (!moi.permissions.has(PermissionFlagsBits.ManageChannels)) manque.push('Gérer les salons');
  if (!moi.permissions.has(PermissionFlagsBits.ManageRoles)) manque.push('Gérer les rôles');
  return manque;
}

function nomSalon(prefixe, id, pseudo) {
  const propre = String(pseudo ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  return `${prefixe}-${String(id).padStart(4, '0')}${propre ? `-${propre}` : ''}`;
}

// ---------------------------------------------------------------------------
// Ouverture
// ---------------------------------------------------------------------------

export async function onSelectionCategorie(interaction) {
  const cle = interaction.values?.[0];
  const categorie = reglagesTickets.categorie(cle);
  if (!categorie) {
    return interaction.reply({ content: "❌ Cette catégorie n'existe plus, le panneau doit être republié.", ...EPH });
  }

  const existant = store.ticketEnCours(interaction.user.id);
  if (existant && interaction.guild.channels.cache.has(existant.channel_id)) {
    return interaction.reply({
      content: `📩 Vous avez déjà un ticket : <#${existant.channel_id}>. Continuez la discussion là-bas, ou attendez sa suppression pour en ouvrir un autre.`,
      ...EPH,
    });
  }
  if (existant) store.setTicketEtat(existant.channel_id, 'supprime');

  const manque = permissionsManquantes(interaction.guild);
  if (manque.length) {
    return interaction.reply({
      content: `❌ Le bot ne peut pas créer de ticket : il lui manque ${manque.join(' et ')}. Prévenez le staff.`,
      ...EPH,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket:modal:${cle}`)
    .setTitle(`${categorie.nom}`.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('sujet')
        .setLabel('Décrivez votre demande')
        .setPlaceholder('Le plus précisément possible : le staff gagne du temps, vous aussi.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(1000),
    ));
  return interaction.showModal(modal);
}

export async function onFormulaireOuverture(interaction) {
  const cle = interaction.customId.slice('ticket:modal:'.length);
  const categorie = reglagesTickets.categorie(cle);
  const sujet = interaction.fields.getTextInputValue('sujet').trim();
  await interaction.deferReply(EPH);

  const guild = interaction.guild;
  const moi = guild.members.me;
  const roles = reglagesTickets.roles().filter((id) => guild.roles.cache.has(id));

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: PERMS_MEMBRE },
    { id: moi.id, allow: PERMS_BOT },
    ...roles.map((id) => ({ id, allow: PERMS_STAFF })),
  ];

  const dossier = reglagesTickets.dossier();
  const parent = dossier && guild.channels.cache.get(dossier)?.type === ChannelType.GuildCategory ? dossier : null;

  // Le numero vient de la base : on reserve la ligne avec un identifiant
  // provisoire, puis on la fait pointer sur le vrai salon une fois cree.
  const provisoire = `en-creation-${interaction.user.id}-${Date.now()}`;
  const id = store.createTicket(provisoire, interaction.user.id, categorie?.nom ?? null, sujet);

  let salon;
  try {
    salon = await guild.channels.create({
      name: nomSalon('ticket', id, interaction.user.username),
      type: ChannelType.GuildText,
      parent,
      permissionOverwrites: overwrites,
      topic: `Ticket #${id} de ${interaction.user.tag}${categorie ? ` · ${categorie.nom}` : ''}`,
      reason: `Ticket #${id} ouvert par ${interaction.user.tag}`,
    });
  } catch (err) {
    store.setTicketEtat(provisoire, 'supprime');
    console.error('[ticket] creation du salon :', err.message);
    return interaction.editReply(`❌ Impossible de créer le salon : ${err.message}`);
  }
  store.renommerTicket(provisoire, salon.id);
  const ticket = store.getTicket(salon.id);

  const entete = enteteTicket({ ticket, categorie, membreId: interaction.user.id, prisPar: null });
  const mentions = [`<@${interaction.user.id}>`, ...roles.map((r) => `<@&${r}>`)].join(' ');
  await salon.send({ content: mentions, ...entete, allowedMentions: { users: [interaction.user.id], roles } });

  console.log(`[ticket] #${id} ouvert par ${interaction.user.tag} (${categorie?.nom ?? 'sans categorie'})`);
  await majJournal(guild, ticket);

  // Le membre est mentionne dans son ticket, qui apparait chez lui : la
  // confirmation en prive ne sert a rien, on retire la reponse differee.
  return interaction.deleteReply().catch(() => {});
}

// ---------------------------------------------------------------------------
// Boutons de l en tete
// ---------------------------------------------------------------------------

export async function onBoutonTicket(interaction) {
  const action = interaction.customId.slice('ticket:'.length);
  const ticket = store.getTicket(interaction.channelId);
  if (!ticket || ticket.etat === 'supprime') {
    return interaction.reply({ content: "❌ Ce salon n'est pas un ticket suivi par le bot.", ...EPH });
  }
  const staff = estStaff(interaction.member);
  const auteur = interaction.user.id === ticket.discord_id;

  switch (action) {
    case 'close': return fermer(interaction, ticket, { staff, auteur });
    case 'reopen': return rouvrir(interaction, ticket, { staff });
    case 'claim': return prendre(interaction, ticket, { staff });
    case 'transcript': return sauvegarder(interaction, ticket, { staff });
    case 'delete': return demanderSuppression(interaction, { staff });
    case 'delete:ok': return supprimer(interaction, ticket, { staff });
    default: return interaction.reply({ content: '❌ Action inconnue.', ...EPH });
  }
}

const refus = (interaction, texte = '❌ Réservé au staff.') => interaction.reply({ content: texte, ...EPH });

async function majEntete(interaction, ticket, { prisPar }) {
  // Les boutons vivent sur le message d en tete : quand on clique dessus,
  // interaction.message est ce message et on le met a jour sur place.
  const categorie = reglagesTickets.categories().find((c) => c.nom === ticket.categorie) ?? null;
  const entete = enteteTicket({ ticket, categorie, membreId: ticket.discord_id, prisPar });
  await interaction.message.edit(entete).catch(() => {});
}

async function fermer(interaction, ticket, { staff, auteur }) {
  if (!staff && !auteur) return refus(interaction, '❌ Seuls l\'auteur du ticket et le staff peuvent le fermer.');
  if (ticket.etat !== 'ouvert') return refus(interaction, 'ℹ️ Ce ticket est déjà fermé.');
  await interaction.deferReply();

  store.setTicketEtat(ticket.channel_id, 'ferme', interaction.user.id);
  const salon = interaction.channel;
  await salon.permissionOverwrites.edit(ticket.discord_id, { SendMessages: false }, { reason: 'Ticket fermé' }).catch(() => {});
  await salon.setName(nomSalon('ferme', ticket.id, salon.name.split('-').slice(2).join('-'))).catch(() => {});
  await majEntete(interaction, { ...ticket, etat: 'ferme' }, { prisPar: ticket.pris_par });

  console.log(`[ticket] #${ticket.id} ferme par ${interaction.user.tag}`);
  await majJournal(interaction.guild, store.getTicket(ticket.channel_id));
  return interaction.editReply({
    embeds: [embedLog('🔒・TICKET FERMÉ',
      `Fermé par <@${interaction.user.id}>. L'auteur ne peut plus y écrire.\n`
      + 'Le staff peut le **rouvrir**, **sauvegarder les logs** ou le **supprimer** depuis les boutons ci-dessus.', FR.jaune)],
  });
}

async function rouvrir(interaction, ticket, { staff }) {
  if (!staff) return refus(interaction);
  if (ticket.etat === 'ouvert') return refus(interaction, 'ℹ️ Ce ticket est déjà ouvert.');
  await interaction.deferReply();

  store.setTicketEtat(ticket.channel_id, 'ouvert', interaction.user.id);
  const salon = interaction.channel;
  await salon.permissionOverwrites.edit(ticket.discord_id, { SendMessages: true }, { reason: 'Ticket rouvert' }).catch(() => {});
  await salon.setName(nomSalon('ticket', ticket.id, salon.name.split('-').slice(2).join('-'))).catch(() => {});
  await majEntete(interaction, { ...ticket, etat: 'ouvert' }, { prisPar: ticket.pris_par });

  console.log(`[ticket] #${ticket.id} rouvert par ${interaction.user.tag}`);
  await majJournal(interaction.guild, store.getTicket(ticket.channel_id));
  return interaction.editReply({
    content: `<@${ticket.discord_id}>`,
    embeds: [embedLog('🔓・TICKET ROUVERT', `Rouvert par <@${interaction.user.id}>.`, FR.vert)],
    allowedMentions: { users: [ticket.discord_id] },
  });
}

async function prendre(interaction, ticket, { staff }) {
  if (!staff) return refus(interaction);
  if (ticket.pris_par && ticket.pris_par !== interaction.user.id) {
    return refus(interaction, `ℹ️ Ce ticket est déjà pris en charge par <@${ticket.pris_par}>.`);
  }
  // Un second clic du meme membre rend le ticket.
  const nouveau = ticket.pris_par === interaction.user.id ? null : interaction.user.id;
  store.setTicketPris(ticket.channel_id, nouveau);
  await interaction.deferUpdate();
  await majEntete(interaction, ticket, { prisPar: nouveau });
  await majJournal(interaction.guild, store.getTicket(ticket.channel_id));
  await interaction.channel.send({
    embeds: [embedLog(TITRE_TICKET, nouveau
      ? `<@${nouveau}> prend ce ticket en charge.`
      : `<@${interaction.user.id}> ne suit plus ce ticket.`, FR.bleu)],
  }).catch(() => {});
}

async function sauvegarder(interaction, ticket, { staff }) {
  if (!staff) return refus(interaction);
  await interaction.deferReply(EPH);
  const fichier = await transcript(interaction.client, interaction.channel, ticket);
  const logs = await salonLogs(interaction.guild);
  if (logs) {
    await majJournal(interaction.guild, ticket, { fichier });
    return interaction.editReply(`📄 Logs joints au suivi du ticket dans ${logs}.`);
  }
  return interaction.editReply({
    content: '📄 Aucun salon de logs configuré (`/panel ticket config logs`), voici le fichier :',
    files: [fichier],
  });
}

async function demanderSuppression(interaction, { staff }) {
  if (!staff) return refus(interaction);
  return interaction.reply({
    content: '🗑️ Supprimer ce ticket ? La conversation sera perdue, sauf si vous avez cliqué **Sauvegarder les logs** avant.',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:delete:ok').setLabel('Oui, supprimer').setStyle(ButtonStyle.Danger),
    )],
    ...EPH,
  });
}

async function supprimer(interaction, ticket, { staff }) {
  if (!staff) return refus(interaction);
  await interaction.update({ content: '⏳ Suppression...', components: [] });

  // Pas de transcript automatique : les logs ne partent que sur un clic
  // explicite de « Sauvegarder les logs », decision de Ryan.
  store.setTicketEtat(ticket.channel_id, 'supprime', interaction.user.id);
  await majJournal(interaction.guild, store.getTicket(ticket.channel_id));
  console.log(`[ticket] #${ticket.id} supprime par ${interaction.user.tag}`);
  await interaction.channel.delete(`Ticket #${ticket.id} supprimé par ${interaction.user.tag}`);
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

async function transcript(client, salon, ticket) {
  const messages = await collecterMessages(salon);
  const auteur = await client.users.fetch(ticket.discord_id).then((u) => u.tag).catch(() => null);
  const contenuDisponible = client.options.intents.has(GatewayIntentBits.MessageContent);
  const texte = rendreTranscript({ ticket: { ...ticket, auteur }, messages, contenuDisponible });
  return new AttachmentBuilder(Buffer.from(texte, 'utf8'), { name: `ticket-${String(ticket.id).padStart(4, '0')}.txt` });
}

async function salonLogs(guild) {
  const id = reglagesTickets.salonLogs();
  if (!id) return null;
  const salon = await guild.channels.fetch(id).catch(() => null);
  return salon?.isTextBased?.() ? salon : null;
}

const ETATS = {
  ouvert: { texte: '🟢 Ouvert', couleur: FR.vert },
  ferme: { texte: '🔒 Fermé', couleur: FR.jaune },
  supprime: { texte: '🗑️ Supprimé', couleur: FR.rouge },
};

/**
 * UN message de log par ticket, cree a l ouverture et edite ensuite : l etat,
 * la prise en charge et le transcript s y ajoutent au lieu d empiler des
 * messages. Sans salon de logs configure, rien ne part.
 */
async function majJournal(guild, ticket, { fichier } = {}) {
  const logs = await salonLogs(guild);
  if (!logs) return;

  const etat = ETATS[ticket.etat] ?? ETATS.ouvert;
  const par = ticket.etat !== 'ouvert' && ticket.etat_par ? ` par <@${ticket.etat_par}>` : '';
  const contenu = embedLog(TITRE_TICKET,
    `Ticket **#${ticket.id}** de <@${ticket.discord_id}>`
    + (ticket.categorie ? ` · ${ticket.categorie}` : '')
    + (ticket.etat !== 'supprime' ? ` · <#${ticket.channel_id}>` : ''),
    etat.couleur)
    .addFields(
      { name: 'État', value: etat.texte + par, inline: true },
      { name: 'Pris en charge', value: ticket.pris_par ? `<@${ticket.pris_par}>` : 'Personne', inline: true },
    );
  if (ticket.sujet) contenu.addFields({ name: 'Demande', value: ticket.sujet.slice(0, 1024) });

  const charge = { embeds: [contenu], ...(fichier ? { files: [fichier] } : {}) };
  const existant = ticket.log_message_id
    ? await logs.messages.fetch(ticket.log_message_id).catch(() => null)
    : null;
  try {
    if (existant) {
      await existant.edit(charge);
    } else {
      const envoye = await logs.send(charge);
      store.setTicketLog(ticket.channel_id, envoye.id);
    }
  } catch (e) {
    console.error('[ticket] logs :', e.message);
  }
}
