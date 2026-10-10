// /setup general : toute la configuration Discord du bot, sans ouvrir un
// fichier. Le proprietaire installe le bot, l invite, tape /setup general :
// un clic sur « Tout créer pour moi » pose roles, salons et panneaux, ou il
// choisit les siens dans les menus.
//
// Trois pages dans le meme message prive : l essentiel (roles, logs),
// les dons, les panneaux. Les setups existants (tickets, vouches, paliers de
// dons) s ouvrent depuis ici.
//
// Tout est enregistre en base (settings) et pris en compte a chaud : le .env
// n est plus qu une valeur par defaut.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, ChannelSelectMenuBuilder,
  ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { verrouiller, peutVerrouiller } from '../lib/salon.js';
import { presence } from '../ingame/presence.js';
import { changerSalonJournal } from '../ops/journal.js';
import { changerSalonHistorique } from '../dons/log.js';
import { publierPanneauDons } from '../dons/panneau.js';
import { assurerRoles } from '../dons/dons.js';
import { rendreSetupDons } from '../dons/setup.js';
import { rendreSetup as rendreSetupTickets, publierPanneau as publierPanneauTickets } from '../tickets/setup.js';
import { reglagesTickets } from '../tickets/reglages.js';
import { rendreSetupVouch } from '../vouch/setup.js';
import { publier as publierClassement, rafraichirSiBesoin, majRoleTop } from '../baltop/panel.js';
import { store } from '../db.js';
import { balances } from '../donut/balances.js';
import { panneauConnexion } from '../commands/panel.js';
import { creerManquants } from '../../scripts/lib/discord-setup.js';
import { compteBot, changementEnCours } from '../ingame/compte.js';
import { lireCodeMsa, demanderRelink } from '../ops/actions.js';
import { journal as noterJournal } from '../ops/journal.js';
import { duree } from '../../ingame/diagnostic.js';

const ok = (v) => (v ? '✅' : '⚠️');
const salon = (id) => (id ? `<#${id}>` : '*à choisir*');
const role = (id) => (id ? `<@&${id}>` : '*à choisir*');

// ------------------------------------------------------------------ pages

export async function rendreSetupGeneral(guild, note = '') {
  const etat = await presence();
  const moi = guild.members.me;
  const manque = [];
  if (moi && !moi.permissions.has(PermissionFlagsBits.ManageRoles)) manque.push('Gérer les rôles');
  if (moi && !moi.permissions.has(PermissionFlagsBits.ManageChannels)) manque.push('Gérer les salons');

  const contenu = embed('⚙️・CONFIGURATION GÉNÉRALE', {
    couleur: FR.bleu,
    description:
      'Tout se règle ici, rien à modifier sur la machine du bot. **✨ Tout créer pour moi** pose ce qui manque'
      + ' (rôle, salons, panneaux) ; ou choisissez les vôtres dans les menus.\n\n'
      + `${etat.enLigne ? '🟢' : '🔴'} **Bot en jeu** · ${etat.enLigne ? `connecté (${etat.username})` : 'hors ligne : les `/link` et les dons sont suspendus'}\n\n`
      + '### Essentiel\n'
      + `${ok(settings.roleVerifie())} **Rôle des vérifiés** · ${role(settings.roleVerifie())}\n`
      + `${settings.rolesAdmin().length ? '✅' : '➖'} **Rôles admin du bot** (/setup, /panel, /embed, tickets) · ${settings.rolesAdmin().length ? settings.rolesAdmin().map(role).join(' ') : '*« Gérer le serveur » suffit*'}\n`
      + '### Logs\n'
      + `${ok(settings.salonLogs())} **Liaisons (/link)** · ${salon(settings.salonLogs())}\n`
      + `${ok(settings.salonHistoriqueDons())} **Donations** · ${salon(settings.salonHistoriqueDons())}\n`
      + `${ok(reglagesTickets.salonLogs())} **Tickets** · ${salon(reglagesTickets.salonLogs())}\n`
      + `${ok(settings.salonJournal())} **Journal du bot** · ${salon(settings.salonJournal())}\n`
      + '### Panneaux\n'
      + `${ok(settings.salonLink())} **Connexion** · ${salon(settings.salonLink())}\n`
      + `${ok(settings.salonBaltop())} **Classement** · ${salon(settings.salonBaltop())}\n`
      + `${ok(settings.salonDonations())} **Donations** · ${salon(settings.salonDonations())}\n`
      + `${ok(reglagesTickets.salonPanneau())} **Tickets** · ${salon(reglagesTickets.salonPanneau())}\n`
      + `${ok(settings.salonVouch())} **Vouches** · ${salon(settings.salonVouch())}\n`
      + '### Dons\n'
      + `${ok(settings.beneficiaire())} **Reversés chaque nuit à** · ${settings.beneficiaire() ? `\`${settings.beneficiaire()}\`` : '*personne : le bot garde les dons*'}`
      + (manque.length ? `\n\n⚠️ Il me manque **${manque.join('** et **')}** : réinvitez-moi avec ces droits.` : '')
      + (note ? `\n\n${note}` : ''),
  });

  const verifie = new RoleSelectMenuBuilder().setCustomId('gsetup:verifie')
    .setPlaceholder('✅ Rôle donné aux comptes vérifiés').setMinValues(1).setMaxValues(1);
  if (settings.roleVerifie()) verifie.setDefaultRoles(settings.roleVerifie());
  const admin = new RoleSelectMenuBuilder().setCustomId('gsetup:admin')
    .setPlaceholder('🛠️ Rôles admin du bot : /setup, /panel, /embed, tickets').setMinValues(0).setMaxValues(10);
  if (settings.rolesAdmin().length) admin.setDefaultRoles(...settings.rolesAdmin());

  return {
    embeds: [contenu],
    components: [
      ...[verifie, admin].map((m) => new ActionRowBuilder().addComponents(m)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:tout').setLabel('Tout créer pour moi').setEmoji('✨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('gsetup:page:panneaux').setLabel('Panneaux').setEmoji('📌').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:page:dons').setLabel('Dons').setEmoji('💝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:page:logs').setLabel('Logs').setEmoji('📋').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:page:bot').setLabel('Bot en jeu').setEmoji('🤖').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function pageLogs(note = '') {
  return {
    embeds: [embed('📋・LOGS', {
      couleur: FR.bleu,
      description: 'Un salon staff par type d\'événement. Les salons choisis ici deviennent visibles par les rôles staff.\n\n'
        + `🔗 **Liaisons** · ${salon(settings.salonLogs())} : chaque compte vérifié\n`
        + `💝 **Donations** · ${salon(settings.salonHistoriqueDons())} : chaque don et chaque reversement`
        + `${settings.salonHistoriqueDons() ? '' : ' (sinon dans le journal)'}\n`
        + `🎫 **Tickets** · ${salon(reglagesTickets.salonLogs())} : ouverture, fermeture, logs sauvegardés\n`
        + `🩺 **Journal du bot** · ${salon(settings.salonJournal())} : pannes, connexion, erreurs`
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(texte('gsetup:logs', '🔗 Logs des liaisons (/link)', settings.salonLogs())),
      new ActionRowBuilder().addComponents(texte('gsetup:historique:l', '💝 Logs des donations', settings.salonHistoriqueDons())),
      new ActionRowBuilder().addComponents(texte('gsetup:ticketlogs', '🎫 Logs des tickets', reglagesTickets.salonLogs())),
      new ActionRowBuilder().addComponents(texte('gsetup:journal', '🩺 Journal du bot (pannes, erreurs)', settings.salonJournal())),
      new ActionRowBuilder().addComponents(retour()),
    ],
  };
}

/** Un salon de logs choisi : les roles staff le voient. */
async function ouvrirAuStaff(guild, salonId) {
  const s = salonId ? await guild.channels.fetch(salonId).catch(() => null) : null;
  if (!s?.permissionOverwrites) return;
  for (const r of settings.rolesAdmin()) {
    await s.permissionOverwrites.edit(r, { ViewChannel: true, ReadMessageHistory: true }, { reason: 'Rôle staff du bot' }).catch(() => {});
  }
}

async function pageBot(note = '') {
  const etat = await presence();
  const code = await lireCodeMsa();
  const changement = changementEnCours();
  const lignes = [
    `${etat.enLigne ? '🟢' : '🔴'} **État** · ${etat.enLigne ? 'connecté à DonutSMP' : `hors ligne${etat.age != null ? ` (dernier signe il y a ${duree(etat.age)})` : ''}`}`,
    `👤 **Compte receveur** · \`${compteBot() || '?'}\`${etat.username && etat.username !== compteBot() ? ` (connecté en \`${etat.username}\`)` : ''}`,
    `🌐 **Serveur** · \`${process.env.MC_HOST ?? 'donutsmp.net'}\``,
    `🔑 **Connexion Microsoft** · ${code
      ? `un code attend d'être validé, expire <t:${Math.floor(code.expireA / 1000)}:R>`
      : (etat.enLigne ? 'jeton valide' : 'pas de code en attente')}`,
  ];
  if (changement) lignes.push('🔀 **Changement de compte en cours** : le prochain compte connecté deviendra le compte du bot.');

  return {
    embeds: [embed('🤖・BOT EN JEU', {
      couleur: FR.bleu,
      description: `${lignes.join('\n')}\n\n`
        + '**Reconnecter** : même compte, nouveau jeton (compte bloqué, jeton expiré).\n'
        + '**Changer de compte** : le bot se déconnecte, et le compte Microsoft avec lequel vous validez le code'
        + ' devient le compte qui encaisse les `/link` et les dons. Il doit posséder Minecraft Java.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ops:msa').setLabel('Afficher le code').setEmoji('🔑')
        .setStyle(ButtonStyle.Primary).setDisabled(!code),
      new ButtonBuilder().setCustomId('ops:relink').setLabel('Reconnecter').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('gsetup:changer').setLabel('Changer de compte').setEmoji('🔀').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('gsetup:page:bot').setLabel('Actualiser').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
      retour(),
    )],
  };
}

function texte(id, placeholder, actuel) {
  const m = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (actuel) m.setDefaultChannels(actuel);
  return m;
}

const retour = () => new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️')
  .setStyle(ButtonStyle.Secondary);

function pagePanneaux(note = '') {
  const top = settings.roleTop();
  return {
    embeds: [embed('📌・PANNEAUX', {
      couleur: FR.bleu,
      description: 'Choisissez un salon : le panneau y est publié (ou mis à jour) aussitôt, et le salon passe en lecture seule.\n\n'
        + `🔗 **Connexion** · ${salon(settings.salonLink())}\n`
        + `🏆 **Classement** · ${salon(settings.salonBaltop())} · rôle du 1er : ${top ? role(top) : '*aucun*'}\n`
        + `💝 **Donations** · ${salon(settings.salonDonations())}\n`
        + `🎫 **Tickets** · ${salon(reglagesTickets.salonPanneau())}\n`
        + `⭐ **Vouches** · ${salon(store.kvGet('vouch.salonPanneau'))} · forum ${salon(settings.salonVouch())}\n\n`
        + 'Vouches (forum, rôle Trusted) et tickets (catégories, rôles staff, logs) ont leurs réglages : boutons ci-dessous.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(texte('gsetup:link', '🔗 Panneau de connexion', settings.salonLink())),
      new ActionRowBuilder().addComponents(texte('gsetup:baltop', '🏆 Classement des fortunes', settings.salonBaltop())),
      new ActionRowBuilder().addComponents(texte('gsetup:donations:p', '💝 Panneau des donations', settings.salonDonations())),
      new ActionRowBuilder().addComponents(texte('gsetup:tickets', '🎫 Panneau des tickets', reglagesTickets.salonPanneau())),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:page:top').setLabel('Rôle du 1er').setEmoji('🥇').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:ouvrir:vouches').setLabel('Vouches').setEmoji('⭐').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gsetup:ouvrir:tickets').setLabel('Réglages tickets').setEmoji('🎫').setStyle(ButtonStyle.Primary),
        retour(),
      ),
    ],
  };
}

function pageTop(note = '') {
  const top = settings.roleTop();
  const menu = new RoleSelectMenuBuilder().setCustomId('gsetup:roletop')
    .setPlaceholder('🥇 Rôle donné au premier du classement').setMinValues(0).setMaxValues(1);
  if (top) menu.setDefaultRoles(top);
  return {
    embeds: [embed('🥇・RÔLE DU PREMIER', {
      couleur: FR.bleu,
      description: `Le membre en tête du classement des fortunes reçoit ce rôle, et le perd quand il est dépassé.\n\n**Actuel** · ${top ? role(top) : '*aucun*'}`
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:page:panneaux').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function pageDons(note = '') {
  return {
    embeds: [embed('💝・DONS', {
      couleur: FR.bleu,
      description: `**Reversés chaque nuit à** · ${settings.beneficiaire() ? `\`${settings.beneficiaire()}\`` : '*personne*'}\n`
        + `**Don minimum** · ${config.dons.min.toLocaleString('fr-FR')} $\n\n`
        + 'Le salon **donations** reçoit le panneau public (classement des donateurs, rangs, bouton de don).'
        + ' L\'**historique** reçoit un message par don et par reversement, pour le staff.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(texte('gsetup:donations', '💝 Salon public des donations', settings.salonDonations())),
      new ActionRowBuilder().addComponents(texte('gsetup:historique', '📜 Historique des dons (staff)', settings.salonHistoriqueDons())),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:beneficiaire').setLabel('Bénéficiaire').setEmoji('🎁').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gsetup:ouvrir:paliers').setLabel('Paliers et rôles').setEmoji('🎖️').setStyle(ButtonStyle.Secondary),
        retour(),
      ),
    ],
  };
}

// -------------------------------------------------------------- publication

async function publierConnexion(guild, salonId) {
  const cible = await guild.channels.fetch(salonId).catch(() => null);
  if (!cible?.isTextBased?.()) throw new Error('salon introuvable');
  const recents = await cible.messages.fetch({ limit: 50 }).catch(() => null);
  const mien = recents?.find((m) => m.author.id === guild.client.user.id
    && m.components?.some((r) => r.components.some((c) => c.customId === 'link:start')));
  if (mien) await mien.edit(panneauConnexion());
  else await cible.send(panneauConnexion());
  settings.poserSalonLink(cible.id);
  const moi = guild.members.me;
  if (peutVerrouiller(cible, moi)) await verrouiller(cible, moi).catch(() => {});
  return mien ? 'panneau de connexion mis à jour' : 'panneau de connexion publié';
}

async function publierBaltop(guild, salonId) {
  settings.poserSalonBaltop(salonId);
  const message = await publierClassement(guild.client, salonId);
  if (!message) throw new Error('publication refusée');
  const moi = guild.members.me;
  if (peutVerrouiller(message.channel, moi)) await verrouiller(message.channel, moi).catch(() => {});
  return 'classement publié';
}

/** Les roles que le bot ne peut pas poser, avec la raison. */
function refusRole(guild, r) {
  if (!r) return 'rôle introuvable';
  if (r.id === guild.id) return '@everyone ne peut pas servir ici';
  if (r.managed) return `${r.name} est géré par une intégration`;
  const moi = guild.members.me;
  if (moi && r.position >= moi.roles.highest.position) {
    return `${r.name} est au-dessus de mon rôle : je ne pourrai pas le donner. Montez mon rôle au-dessus dans les paramètres du serveur`;
  }
  return null;
}

// Cle du .env (vocabulaire de l installateur) -> reglage en base.
const CLES = {
  VERIFIED_ROLE_ID: ['general.roleVerifie', () => settings.roleVerifie()],
  LINK_CHANNEL_ID: ['link.salon', () => settings.salonLink()],
  BALTOP_CHANNEL_ID: ['baltop.salon', () => settings.salonBaltop()],
  DONATION_CHANNEL_ID: ['dons.salonPanneau', () => settings.salonDonations()],
  LOG_CHANNEL_ID: ['general.salonLogs', () => settings.salonLogs()],
  OPS_CHANNEL_ID: ['general.salonJournal', () => settings.salonJournal()],
  DONATION_LOG_CHANNEL_ID: ['dons.salonHistorique', () => settings.salonHistoriqueDons()],
};

async function toutCreer(guild) {
  const client = guild.client;
  const api = {
    get: (chemin) => client.rest.get(chemin),
    post: (chemin, corps) => client.rest.post(chemin, { body: corps }),
  };
  const env = Object.fromEntries(Object.entries(CLES).map(([k, [, lire]]) => [k, lire()]));
  const faits = [];
  const poses = await creerManquants(api, {
    guildId: guild.id, botId: client.user.id, env, adminRoleId: settings.rolesAdmin().join(','), journal: (t) => faits.push(t),
  });
  for (const [k, id] of Object.entries(poses)) settings.poser(CLES[k][0], id);
  // Le cache discord.js ne connait pas encore ce qui vient d etre cree.
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});

  const notes = [];
  const essayer = async (quoi, fn) => { try { notes.push(await fn()); } catch (e) { notes.push(`❌ ${quoi} : ${e.message}`); } };
  if (settings.salonLink()) await essayer('connexion', () => publierConnexion(guild, settings.salonLink()));
  if (settings.salonBaltop()) await essayer('classement', () => publierBaltop(guild, settings.salonBaltop()));
  await essayer('rôles de donateur', async () => { await assurerRoles(guild); return 'rôles de donateur prêts'; });
  if (settings.salonDonations()) await essayer('donations', async () => (await publierPanneauDons(client, guild)) ?? 'panneau des donations');
  await changerSalonJournal(client, settings.salonJournal());
  await changerSalonHistorique(client);
  return `✨ ${faits.length ? `Créé : ${faits.join(', ')}.` : 'Rien à créer, tout existait.'}\n${notes.map((n) => `• ${n}`).join('\n')}`;
}

/**
 * Les roles staff voient les salons staff du bot (logs, journal, historique) ;
 * un role retire de la liste perd cet acces. Rend une note, vide si rien.
 */
async function ouvrirSalonsStaff(guild, avant, apres) {
  const salons = [settings.salonLogs(), settings.salonJournal(), settings.salonHistoriqueDons()].filter(Boolean);
  const retires = avant.filter((r) => !apres.includes(r));
  let faits = 0;
  for (const id of salons) {
    const s = await guild.channels.fetch(id).catch(() => null);
    if (!s?.permissionOverwrites) continue;
    for (const r of apres) {
      await s.permissionOverwrites.edit(r, { ViewChannel: true, ReadMessageHistory: true }, { reason: 'Rôle staff du bot' })
        .then(() => { faits += 1; }).catch(() => {});
    }
    for (const r of retires) await s.permissionOverwrites.delete(r, 'Plus rôle staff du bot').catch(() => {});
  }
  return faits ? ', et voient les salons staff du bot' : '';
}

// ------------------------------------------------------------ interactions

export async function onGsetupSelect(interaction) {
  const { guild, client } = interaction;
  const id = interaction.customId.slice('gsetup:'.length);
  const valeur = interaction.values[0] ?? '';

  if (id === 'admin') {
    const avant = settings.rolesAdmin();
    settings.poser('general.roleAdmin', interaction.values.join(','));
    await interaction.deferUpdate();
    const note = await ouvrirSalonsStaff(guild, avant, interaction.values);
    return interaction.editReply(await rendreSetupGeneral(guild, interaction.values.length
      ? `✅ ${interaction.values.map(role).join(' ')} ont accès à /setup, /panel, /embed et aux tickets${note}.`
      : '✅ Plus de rôle admin du bot : « Gérer le serveur » suffit.'));
  }
  if (id === 'verifie') {
    if (valeur) {
      const refus = refusRole(guild, guild.roles.cache.get(valeur));
      if (refus) return interaction.update(await rendreSetupGeneral(guild, `❌ ${refus}.`));
    }
    settings.poser('general.roleVerifie', valeur);
    return interaction.update(await rendreSetupGeneral(guild, '✅ Rôle des vérifiés enregistré. Il est donné aux prochains comptes liés.'));
  }
  if (['logs', 'journal', 'ticketlogs', 'historique:l'].includes(id)) {
    await interaction.deferUpdate();
    if (id === 'logs') settings.poser('general.salonLogs', valeur);
    if (id === 'journal') {
      settings.poser('general.salonJournal', valeur);
      await changerSalonJournal(client, valeur);
    }
    if (id === 'ticketlogs') reglagesTickets.poserSalonLogs(valeur);
    if (id === 'historique:l') {
      settings.poser('dons.salonHistorique', valeur);
      await changerSalonHistorique(client);
    }
    await ouvrirAuStaff(guild, valeur);
    return interaction.editReply(pageLogs(valeur ? `✅ <#${valeur}> enregistré.` : '✅ Salon retiré.'));
  }

  await interaction.deferUpdate();
  if (id === 'link' || id === 'baltop') {
    if (!valeur) return interaction.editReply(pagePanneaux());
    const note = await (id === 'link' ? publierConnexion(guild, valeur) : publierBaltop(guild, valeur))
      .then((n) => `✅ <#${valeur}> : ${n}.`).catch((e) => `❌ ${e.message}`);
    return interaction.editReply(pagePanneaux(note));
  }
  if (id === 'tickets') {
    if (!valeur) return interaction.editReply(pagePanneaux());
    const note = await publierPanneauTickets(guild, valeur)
      .then(({ note: n }) => { reglagesTickets.poserSalonPanneau(valeur); return `✅ <#${valeur}> : ${n}.`; })
      .catch((e) => `❌ ${e.message}`);
    return interaction.editReply(pagePanneaux(note));
  }
  if (id === 'roletop') {
    if (valeur) {
      const refus = refusRole(guild, guild.roles.cache.get(valeur));
      if (refus) return interaction.editReply(pageTop(`❌ ${refus}.`));
    }
    // Retire l ancien role au premier actuel, puis laisse majRoleTop reposer le nouveau.
    const ancien = settings.roleTop();
    const premier = store.kvGet('baltop.top1');
    if (ancien && premier && ancien !== valeur) {
      const m = await guild.members.fetch(premier).catch(() => null);
      await m?.roles.remove(ancien).catch(() => {});
    }
    if (valeur) settings.poserRoleTop(valeur); else settings.retirerRoleTop();
    store.kvSet('baltop.top1', '');
    if (valeur) await majRoleTop(client).catch(() => {});
    const tete = balances.classement('money', 1)[0];
    return interaction.editReply(pageTop(valeur
      ? `✅ ${role(valeur)} enregistré${tete ? `, donné à <@${tete.discordId}>` : ''}.`
      : '✅ Plus de rôle pour le premier.'));
  }
  if (id === 'donations' || id === 'donations:p') {
    const depuisPanneaux = id === 'donations:p';
    settings.poser('dons.salonPanneau', valeur);
    const n = valeur ? await publierPanneauDons(client, guild).catch((e) => `❌ ${e.message}`) : null;
    const note = valeur ? `✅ <#${valeur}> : ${n ?? 'panneau publié'}.` : '✅ Plus de panneau des donations.';
    return interaction.editReply(depuisPanneaux ? pagePanneaux(note) : pageDons(note));
  }
  if (id === 'historique') {
    settings.poser('dons.salonHistorique', valeur);
    await changerSalonHistorique(client);
    return interaction.editReply(pageDons(valeur ? `✅ Historique dans <#${valeur}>.` : '✅ Les dons repassent dans le journal du bot.'));
  }
}

export async function onGsetupBouton(interaction) {
  const { guild } = interaction;
  const id = interaction.customId.slice('gsetup:'.length);

  if (id === 'beneficiaire') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:beneficiaire').setTitle('Bénéficiaire des dons')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('pseudo').setLabel('Pseudo Minecraft (Bedrock : avec le point)')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(25)
          .setPlaceholder('vide = le bot garde les dons').setValue(settings.beneficiaire() ?? ''),
      )));
  }
  if (id === 'page:accueil') return interaction.update(await rendreSetupGeneral(guild));
  if (id === 'page:panneaux') return interaction.update(pagePanneaux());
  if (id === 'page:top') return interaction.update(pageTop());
  if (id === 'page:logs') return interaction.update(pageLogs());
  if (id === 'page:dons') return interaction.update(pageDons());
  if (id === 'page:bot') return interaction.update(await pageBot());
  if (id === 'changer') {
    return interaction.update({
      embeds: [embed('🔀・CHANGER DE COMPTE', {
        couleur: FR.jaune,
        description: `Le bot en jeu (\`${compteBot()}\`) va être **déconnecté**. Un code Microsoft arrive ensuite :`
          + ' validez-le avec le **nouveau** compte (il doit posséder Minecraft Java).\n\n'
          + 'Dès sa connexion, ce compte encaisse les `/link` et les dons, et les panneaux affichent son pseudo.'
          + ' Pendant l\'opération, les `/link` et les dons sont suspendus.\n\n'
          + '⚠️ Les dons pas encore reversés restent sur l\'**ancien** compte : faites le reversement avant, ou récupérez-les à la main.',
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:changer:ok').setLabel('Confirmer le changement').setEmoji('🔀').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('gsetup:page:bot').setLabel('Annuler').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      )],
    });
  }
  if (id === 'changer:ok') {
    const par = interaction.user.tag ?? interaction.user.id;
    await demanderRelink(par, undefined, { changer: true });
    noterJournal({
      niveau: 'warn',
      titre: 'Changement de compte demandé',
      texte: `<@${interaction.user.id}> change le compte du bot en jeu (ancien : **${compteBot()}**).`,
      champs: { Par: par },
    });
    // Laisse au bot en jeu le temps de lire l ordre (2 s) avant d afficher l etat.
    await interaction.deferUpdate();
    await new Promise((r) => setTimeout(r, 4000));
    return interaction.editReply(await pageBot('🔀 Ordre transmis. Le code arrive dans quelques secondes : **Afficher le code** puis validez avec le nouveau compte, et **Actualiser** pour suivre.'));
  }
  if (id === 'ouvrir:tickets') return interaction.update(rendreSetupTickets(guild));
  if (id === 'ouvrir:vouches') return interaction.update(rendreSetupVouch(guild));
  if (id === 'ouvrir:paliers') return interaction.update(rendreSetupDons(guild));
  if (id === 'tout') {
    await interaction.deferUpdate();
    const note = await toutCreer(guild).catch((e) => `❌ Création interrompue : ${e.message}. Recliquez, rien ne sera créé en double.`);
    return interaction.editReply(await rendreSetupGeneral(guild, note));
  }
}

export async function onGsetupModal(interaction) {
  const { guild, client } = interaction;
  const pseudo = interaction.fields.getTextInputValue('pseudo').trim();
  if (pseudo && !/^\.?[A-Za-z0-9_]{1,24}$/.test(pseudo)) {
    return interaction.update(pageDons(`❌ « ${pseudo} » n'est pas un pseudo Minecraft.`));
  }
  settings.poser('dons.beneficiaire', pseudo);
  await interaction.deferUpdate();
  // Le beneficiaire sort des classements : on les reecrit.
  await publierPanneauDons(client, guild).catch(() => {});
  await rafraichirSiBesoin(client, { force: true }).catch(() => {});
  return interaction.editReply(pageDons(pseudo
    ? `✅ Les dons seront reversés chaque nuit à \`${pseudo}\` (pris en compte par le bot en jeu sous une minute).`
    : '✅ Plus de reversement : le bot garde les dons.'));
}
