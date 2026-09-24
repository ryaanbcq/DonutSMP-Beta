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
import { rendreSetup as rendreSetupTickets } from '../tickets/setup.js';
import { reglagesTickets } from '../tickets/reglages.js';
import { rendreSetupVouch } from '../vouch/setup.js';
import { publier as publierClassement, rafraichirSiBesoin } from '../baltop/panel.js';
import { panneauConnexion } from '../commands/panel.js';
import { creerManquants } from '../../scripts/lib/discord-setup.js';

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
      + `${settings.rolesAdmin().length ? '✅' : '➖'} **Rôles staff** · ${settings.rolesAdmin().length ? settings.rolesAdmin().map(role).join(' ') : '*« Gérer le serveur » suffit*'}\n`
      + `${ok(settings.salonLogs())} **Logs des vérifications** · ${salon(settings.salonLogs())}\n`
      + `${ok(settings.salonJournal())} **Journal du bot** · ${salon(settings.salonJournal())}\n`
      + '### Panneaux\n'
      + `${ok(settings.salonLink())} **Connexion** · ${salon(settings.salonLink())}\n`
      + `${ok(settings.salonBaltop())} **Classement** · ${salon(settings.salonBaltop())}\n`
      + `${ok(settings.salonDonations())} **Donations** · ${salon(settings.salonDonations())}\n`
      + `${ok(reglagesTickets.salonPanneau())} **Tickets** · ${salon(reglagesTickets.salonPanneau())}\n`
      + `${ok(settings.salonVouch())} **Vouches** · ${salon(settings.salonVouch())}\n`
      + '### Dons\n'
      + `${ok(settings.beneficiaire())} **Reversés chaque nuit à** · ${settings.beneficiaire() ? `\`${settings.beneficiaire()}\`` : '*personne : le bot garde les dons*'}\n`
      + `${ok(settings.salonHistoriqueDons())} **Historique** · ${salon(settings.salonHistoriqueDons())}`
      + (manque.length ? `\n\n⚠️ Il me manque **${manque.join('** et **')}** : réinvitez-moi avec ces droits.` : '')
      + (note ? `\n\n${note}` : ''),
  });

  const verifie = new RoleSelectMenuBuilder().setCustomId('gsetup:verifie')
    .setPlaceholder('✅ Rôle donné aux comptes vérifiés').setMinValues(1).setMaxValues(1);
  if (settings.roleVerifie()) verifie.setDefaultRoles(settings.roleVerifie());
  const admin = new RoleSelectMenuBuilder().setCustomId('gsetup:admin')
    .setPlaceholder('🛠️ Rôles staff (commandes admin du bot)').setMinValues(0).setMaxValues(10);
  if (settings.rolesAdmin().length) admin.setDefaultRoles(...settings.rolesAdmin());
  const logs = texte('gsetup:logs', '📋 Salon des logs de vérification', settings.salonLogs());
  const journal = texte('gsetup:journal', '🩺 Journal du bot (pannes, erreurs)', settings.salonJournal());

  return {
    embeds: [contenu],
    components: [
      ...[verifie, admin, logs, journal].map((m) => new ActionRowBuilder().addComponents(m)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:tout').setLabel('Tout créer pour moi').setEmoji('✨').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('gsetup:page:panneaux').setLabel('Panneaux').setEmoji('📌').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gsetup:page:dons').setLabel('Dons').setEmoji('💝').setStyle(ButtonStyle.Secondary),
      ),
    ],
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
  return {
    embeds: [embed('📌・PANNEAUX', {
      couleur: FR.bleu,
      description: 'Choisissez un salon : le panneau y est publié (ou mis à jour) aussitôt, et le salon passe en lecture seule.'
        + '\n\nTickets et vouches ont leurs propres réglages (rôles staff, catégories, forum) : boutons ci-dessous.'
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(texte('gsetup:link', '🔗 Salon du panneau de connexion', settings.salonLink())),
      new ActionRowBuilder().addComponents(texte('gsetup:baltop', '🏆 Salon du classement des fortunes', settings.salonBaltop())),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:ouvrir:tickets').setLabel('Tickets').setEmoji('🎫').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gsetup:ouvrir:vouches').setLabel('Vouches').setEmoji('⭐').setStyle(ButtonStyle.Primary),
        retour(),
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
      ? `✅ ${interaction.values.map(role).join(' ')} ont accès aux commandes staff${note}.`
      : '✅ Plus de rôle staff : « Gérer le serveur » suffit.'));
  }
  if (id === 'verifie') {
    if (valeur) {
      const refus = refusRole(guild, guild.roles.cache.get(valeur));
      if (refus) return interaction.update(await rendreSetupGeneral(guild, `❌ ${refus}.`));
    }
    settings.poser('general.roleVerifie', valeur);
    return interaction.update(await rendreSetupGeneral(guild, '✅ Rôle des vérifiés enregistré. Il est donné aux prochains comptes liés.'));
  }
  if (id === 'logs' || id === 'journal') {
    settings.poser(id === 'logs' ? 'general.salonLogs' : 'general.salonJournal', valeur);
    if (id === 'journal') await changerSalonJournal(client, valeur);
    return interaction.update(await rendreSetupGeneral(guild, valeur ? `✅ <#${valeur}> enregistré.` : '✅ Salon retiré.'));
  }

  await interaction.deferUpdate();
  if (id === 'link' || id === 'baltop') {
    if (!valeur) return interaction.editReply(pagePanneaux());
    const note = await (id === 'link' ? publierConnexion(guild, valeur) : publierBaltop(guild, valeur))
      .then((n) => `✅ <#${valeur}> : ${n}.`).catch((e) => `❌ ${e.message}`);
    return interaction.editReply(pagePanneaux(note));
  }
  if (id === 'donations') {
    settings.poser('dons.salonPanneau', valeur);
    const n = valeur ? await publierPanneauDons(client, guild).catch((e) => `❌ ${e.message}`) : null;
    return interaction.editReply(pageDons(valeur ? `✅ <#${valeur}> : ${n ?? 'panneau publié'}.` : '✅ Plus de panneau des donations.'));
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
  if (id === 'page:dons') return interaction.update(pageDons());
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
