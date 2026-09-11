import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { embed, TITRES } from '../lib/brand.js';
import { verrouiller, deverrouiller, peutVerrouiller } from '../lib/salon.js';
import { publier as publierClassement, majRoleTop } from '../baltop/panel.js';
import { settings } from '../settings.js';

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

      const message = await publierClassement(interaction.client, salon.id);
      if (!message) throw new Error('publication refusée, regarde les logs');
      await majRoleTop(interaction.client);

      const notes = ['Il se réécrira ici tout seul dès qu\'une position bouge.'];
      if (role) notes.push(`Le premier du classement recevra ${role}.`);
      else if (!settings.roleTop()) notes.push('Ajoute l\'option `role` pour récompenser le premier.');
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
        o.setName('role').setDescription('Rôle donné automatiquement au premier du classement')))
  .addSubcommand((s) =>
    s.setName('deverrouiller')
      .setDescription('Rouvre un salon de panneau à tout le monde')
      .addChannelOption((o) => o.setName('salon').setDescription('Le salon à rouvrir')));

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

  const panneau = PANNEAUX[type];
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
