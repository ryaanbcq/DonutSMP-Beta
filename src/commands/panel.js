import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, MessageFlags, ChannelType,
} from 'discord.js';
import { config } from '../config.js';
import { embed, TITRES } from '../lib/brand.js';
import { verrouiller, deverrouiller, peutVerrouiller } from '../lib/salon.js';
import { publier as publierClassement, majRoleTop } from '../baltop/panel.js';
import { settings } from '../settings.js';
import { panneauTicket } from '../tickets/panel.js';
import { reglagesTickets } from '../tickets/reglages.js';
import { permissionsManquantes } from '../tickets/manager.js';

export const requiresLink = false;

// ---------------------------------------------------------------------------
// Panneaux disponibles. Pour en ajouter un : une entree ici, rien d autre.
// ---------------------------------------------------------------------------

export function panneauConnexion() {
  const delai = Math.round(config.refundDelayMaxS / 60);

  const contenu = embed(TITRES.connexion, {
    description:
      "Associez votre compte Minecraft à votre profil Discord pour débloquer "
      + "l'ensemble des fonctionnalités interactives de DonutSMP FR.\n\n"
      + "**1.** Cliquez sur **Se connecter** ci-dessous.\n"
      + "**2.** Indiquez votre pseudo Minecraft.\n"
      + "**3.** Envoyez en jeu la somme exacte demandée.\n\n"
      + "Cette somme n'est **pas un frais** : elle vous est rendue automatiquement "
      + `sous ${delai} minutes. Elle sert uniquement à prouver que le compte est bien le vôtre.\n\n`
      + "Vos informations servent uniquement à la synchronisation sur DonutSMP FR et ne "
      + "seront jamais partagées. Pour toute question ou demande de suppression, "
      + "contactez le staff via un ticket.",
  });

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('link:start')
      .setLabel('Se connecter')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [contenu], components: [boutons] };
}

const PANNEAUX = {
  link: {
    nom: 'Connexion',
    async poser(interaction, salon) {
      await salon.send(panneauConnexion());
      // Le classement renvoie vers ce salon : on retient lequel c'est.
      settings.poserSalonLink(salon.id);
      return 'Le classement renverra désormais vers ce salon.';
    },
  },
  baltop: {
    nom: 'Classement',
    async poser(interaction, salon) {
      // Retenu AVANT la publication : c'est ce salon que le bot réécrira.
      settings.poserSalonBaltop(salon.id);

      const role = interaction.options.getRole('role');
      if (role) settings.poserRoleTop(role.id);

      const emojis = interaction.options.getString('emojis');
      if (emojis) {
        const liste = emojis.trim().split(/\s+/).slice(0, 3);
        if (liste.length === 3) settings.poserEmojis(liste);
      }

      const message = await publierClassement(interaction.client, salon.id);
      if (!message) throw new Error('publication refusée, regarde les logs');
      await majRoleTop(interaction.client);

      const notes = ['Il se réécrira ici tout seul dès qu\'une position bouge.'];
      if (emojis && emojis.trim().split(/\s+/).length !== 3)
        notes.push('⚠️ Il faut exactement trois emojis, les anciens sont conservés.');
      if (role) notes.push(`Le premier du classement recevra ${role}.`);
      else if (!settings.roleTop()) notes.push('Ajoute l\'option `role` pour récompenser le premier.');
      return notes.join(' ');
    },
  },
  ticket: {
    nom: 'Tickets',
    async poser(interaction, salon) {
      await salon.send(panneauTicket());
      reglagesTickets.poserSalonPanneau(salon.id);
      const notes = [];
      const manque = permissionsManquantes(interaction.guild);
      if (manque.length) notes.push(`⚠️ Il me manque ${manque.join(' et ')} pour créer les salons de ticket.`);
      if (!reglagesTickets.roles().length) notes.push('Aucun rôle staff : `/panel ticket roles` pour en ajouter.');
      if (!reglagesTickets.salonLogs()) notes.push('Aucun salon de logs : `/panel ticket config`.');
      return notes.join(' ');
    },
  },
};

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Publie un panneau du bot dans un salon')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => sousCommande(s, 'link', 'Panneau de connexion avec le bouton de liaison'))
  .addSubcommand((s) =>
    sousCommande(s, 'baltop', 'Classement des fortunes de la commu, réécrit tout seul')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Rôle donné automatiquement au premier du classement'))
      .addStringOption((o) =>
        o.setName('emojis')
          .setDescription('Les trois emojis du podium, séparés par un espace')
          .setMaxLength(200)))
  .addSubcommand((s) =>
    s.setName('deverrouiller')
      .setDescription('Rouvre un salon de panneau à tout le monde')
      .addChannelOption((o) => o.setName('salon').setDescription('Le salon à rouvrir')))
  .addSubcommandGroup((g) =>
    g.setName('ticket')
      .setDescription('Système de tickets : panneau, rôles, catégories, logs')
      .addSubcommand((s) => sousCommande(s, 'publier', 'Publie le panneau de tickets pour les membres'))
      .addSubcommand((s) =>
        s.setName('roles')
          .setDescription('Rôles staff qui voient et gèrent les tickets')
          .addStringOption((o) =>
            o.setName('action').setDescription('Que faire').setRequired(true)
              .addChoices({ name: 'ajouter', value: 'ajouter' }, { name: 'retirer', value: 'retirer' }))
          .addRoleOption((o) => o.setName('role').setDescription('Le rôle concerné').setRequired(true)))
      .addSubcommand((s) =>
        s.setName('categorie')
          .setDescription('Catégories proposées aux membres quand ils ouvrent un ticket')
          .addStringOption((o) =>
            o.setName('action').setDescription('Que faire').setRequired(true)
              .addChoices({ name: 'ajouter', value: 'ajouter' }, { name: 'retirer', value: 'retirer' }))
          .addStringOption((o) =>
            o.setName('nom').setDescription('Nom de la catégorie (le même pour la retirer)').setRequired(true).setMaxLength(60))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji affiché devant').setMaxLength(32))
          .addStringOption((o) =>
            o.setName('description').setDescription('Une ligne pour expliquer').setMaxLength(200)))
      .addSubcommand((s) =>
        s.setName('config')
          .setDescription('Où créer les tickets et où envoyer les logs')
          .addChannelOption((o) =>
            o.setName('dossier').setDescription('Catégorie Discord où naissent les salons de ticket')
              .addChannelTypes(ChannelType.GuildCategory))
          .addChannelOption((o) =>
            o.setName('logs').setDescription('Salon staff qui reçoit les logs et transcripts')
              .addChannelTypes(ChannelType.GuildText)))
      .addSubcommand((s) => s.setName('etat').setDescription('Résumé de la configuration des tickets')));

function sousCommande(s, nom, description) {
  return s.setName(nom)
    .setDescription(description)
    .addChannelOption((o) => o.setName('salon').setDescription('Où publier (ici par défaut)'))
    .addBooleanOption((o) =>
      o.setName('verrouiller')
        .setDescription('Empêcher les membres d\'écrire dans ce salon (oui par défaut)'));
}

export async function execute(interaction) {
  const type = interaction.options.getSubcommand();
  if (interaction.options.getSubcommandGroup(false) === 'ticket' && type !== 'publier') {
    return reglerTickets(interaction, type);
  }
  const salon = interaction.options.getChannel('salon') ?? interaction.channel;
  const moi = interaction.guild?.members?.me;

  if (!salon?.isTextBased?.() || salon.isDMBased?.()) {
    return interaction.reply({
      content: "❌ Ce salon n'accepte pas de messages.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (type === 'deverrouiller') {
    if (!peutVerrouiller(salon, moi)) {
      return interaction.editReply("❌ Il me manque la permission « Gérer les rôles » sur ce salon.");
    }
    await deverrouiller(salon);
    return interaction.editReply(`🔓 ${salon} est rouvert à tout le monde.`);
  }

  const panneau = PANNEAUX[type === 'publier' ? 'ticket' : type];
  if (!panneau) return interaction.editReply('❌ Panneau inconnu.');

  let note;
  try {
    note = await panneau.poser(interaction, salon);
  } catch (err) {
    return interaction.editReply(`❌ Publication impossible : ${err.message}`);
  }

  // Le verrouillage vient APRES la publication : si Discord le refuse, le
  // panneau est quand meme en place et on le dit au lieu d echouer en entier.
  const veutVerrou = interaction.options.getBoolean('verrouiller') ?? true;
  let verrou = '';
  if (veutVerrou) {
    if (!peutVerrouiller(salon, moi)) {
      verrou = "\n⚠️ Salon non verrouillé : il me manque la permission « Gérer les rôles » ici.";
    } else {
      try {
        await verrouiller(salon, moi);
        verrou = '\n🔒 Salon verrouillé, seuls le staff et moi pouvons y écrire.';
      } catch (err) {
        verrou = `\n⚠️ Salon non verrouillé : ${err.message}`;
      }
    }
  }

  return interaction.editReply(
    `✅ Panneau **${panneau.nom}** publié dans ${salon}.${verrou}${note ? `\nℹ️ ${note}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// /panel ticket roles | categorie | config | etat
// ---------------------------------------------------------------------------

async function reglerTickets(interaction, type) {
  const o = interaction.options;
  let texte;

  if (type === 'roles') {
    const role = o.getRole('role');
    if (o.getString('action') === 'ajouter') {
      texte = reglagesTickets.ajouterRole(role.id)
        ? `✅ ${role} voit désormais les tickets. Les tickets déjà ouverts ne changent pas.`
        : `ℹ️ ${role} avait déjà accès.`;
    } else {
      texte = reglagesTickets.retirerRole(role.id)
        ? `✅ ${role} ne verra plus les nouveaux tickets.`
        : `ℹ️ ${role} n'avait pas accès.`;
    }
  } else if (type === 'categorie') {
    const nom = o.getString('nom');
    if (o.getString('action') === 'ajouter') {
      try {
        reglagesTickets.poserCategorie({ nom, emoji: o.getString('emoji'), description: o.getString('description') });
        texte = `✅ Catégorie **${nom}** enregistrée.`;
      } catch (err) {
        texte = `❌ ${err.message}`;
      }
    } else {
      texte = reglagesTickets.retirerCategorie(nom)
        ? `✅ Catégorie **${nom}** retirée.`
        : `ℹ️ Aucune catégorie nommée **${nom}**.`;
    }
    texte += await republierPanneau(interaction.client);
  } else if (type === 'config') {
    const dossier = o.getChannel('dossier');
    const logs = o.getChannel('logs');
    const faits = [];
    if (dossier) { reglagesTickets.poserDossier(dossier.id); faits.push(`les tickets naîtront dans **${dossier.name}**`); }
    if (logs) { reglagesTickets.poserSalonLogs(logs.id); faits.push(`les logs iront dans ${logs}`); }
    texte = faits.length ? `✅ Désormais ${faits.join(' et ')}.` : etatTickets(interaction.guild);
  } else {
    texte = etatTickets(interaction.guild);
  }

  return interaction.reply({ content: texte, flags: MessageFlags.Ephemeral });
}

function etatTickets(guild) {
  const r = reglagesTickets;
  const roles = r.roles().map((id) => `<@&${id}>`).join(', ') || 'aucun (seuls les « Gérer le serveur » ont accès)';
  const dossier = r.dossier() ? `<#${r.dossier()}>` : 'aucun (à la racine du serveur)';
  const cats = r.categories().map((c) => `${c.emoji} ${c.nom}`).join('\n') || 'aucune';
  const manque = permissionsManquantes(guild);
  return [
    '**Configuration des tickets**',
    `Panneau : ${r.salonPanneau() ? `<#${r.salonPanneau()}>` : 'pas encore publié'}`,
    `Dossier des tickets : ${dossier}`,
    `Logs : ${r.salonLogs() ? `<#${r.salonLogs()}>` : 'aucun, les suppressions perdront la conversation'}`,
    `Rôles staff : ${roles}`,
    `Catégories :\n${cats}`,
    manque.length ? `⚠️ Il me manque ${manque.join(' et ')}.` : '',
  ].filter(Boolean).join('\n');
}

/** Le panneau publie liste les categories : on le reecrit quand elles changent. */
async function republierPanneau(client) {
  const id = reglagesTickets.salonPanneau();
  if (!id) return '';
  const salon = await client.channels.fetch(id).catch(() => null);
  if (!salon?.isTextBased?.()) return '';
  const recents = await salon.messages.fetch({ limit: 50 }).catch(() => null);
  const mien = recents?.find((m) => m.author.id === client.user.id
    && m.components?.[0]?.components?.[0]?.customId === 'ticket:cat');
  if (!mien) return ' Le panneau n\'a pas été retrouvé, republie-le avec `/panel ticket publier`.';
  await mien.edit(panneauTicket()).catch(() => {});
  return ' Le panneau a été mis à jour.';
}
