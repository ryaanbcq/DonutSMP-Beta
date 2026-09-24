import {
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { reglagesTickets } from './reglages.js';

// Design fourni par Ryan : auteur « 📩・TICKET », violet 0x5e5efd, une ligne
// par categorie en citation, un pied de page qui rappelle la regle.

export const COULEUR_TICKET = 0x5e5efd;
export const TITRE_TICKET = '📩・TICKET';

const PIED = 'Merci de ne pas ouvrir de ticket sans motif valable ou pour spammer le staff, sous peine de sanction.';

export function panneauTicket() {
  const categories = reglagesTickets.categories();

  const lignes = categories.map((c, i) =>
    `> ${c.emoji} **${i + 1}. ${c.nom}**\n└ ${c.description || 'Aucune description.'}`);

  const contenu = new EmbedBuilder()
    .setColor(COULEUR_TICKET)
    .setAuthor({ name: TITRE_TICKET })
    .setDescription(
      "**Une question, un problème ou une demande spécifique ? L'équipe de DonutSMP FR est là pour vous aider !**\n\n"
      + (categories.length
        ? 'Veuillez sélectionner la catégorie correspondant à votre demande dans le menu déroulant ci-dessous :\n\n'
          + lignes.join('\n\n')
        : 'Aucune catégorie de ticket n\'est configurée pour le moment.'),
    )
    .setFooter({ text: PIED });

  if (!categories.length) return { embeds: [contenu], components: [] };

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:cat')
    .setPlaceholder('Choisissez la catégorie de votre demande')
    .addOptions(categories.map((c) => ({
      label: c.nom.slice(0, 100),
      value: c.cle,
      description: (c.description || '').slice(0, 100) || undefined,
      emoji: c.emoji || undefined,
    })));

  return { embeds: [contenu], components: [new ActionRowBuilder().addComponents(menu)] };
}

/** En tete d un ticket fraichement ouvert, avec ses boutons de gestion. */
export function enteteTicket({ ticket, categorie, membreId, prisPar }) {
  const contenu = embed(TITRE_TICKET, {
    couleur: COULEUR_TICKET,
    description:
      `Bonjour <@${membreId}>, merci d'avoir ouvert un ticket. Un membre du staff va vous répondre dès que possible.\n\n`
      + 'En attendant, décrivez votre demande le plus précisément possible.',
  }).addFields(
    { name: 'Catégorie', value: categorie ? `${categorie.emoji} ${categorie.nom}` : 'Non précisée', inline: true },
    { name: 'Ticket', value: `#${ticket.id}`, inline: true },
    { name: 'Pris en charge par', value: prisPar ? `<@${prisPar}>` : 'Personne pour le moment', inline: true },
  );
  if (ticket.sujet) contenu.addFields({ name: 'Demande', value: ticket.sujet.slice(0, 1024) });
  return { embeds: [contenu], components: boutonsTicket(ticket.etat) };
}

export function boutonsTicket(etat) {
  const ouvert = etat === 'ouvert';
  const rangee = new ActionRowBuilder().addComponents(
    ouvert
      ? new ButtonBuilder().setCustomId('ticket:close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId('ticket:reopen').setLabel('Rouvrir').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Prendre en charge').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:add').setLabel('Ajouter un membre').setEmoji('➕').setStyle(ButtonStyle.Secondary)
      .setDisabled(!ouvert),
    new ButtonBuilder().setCustomId('ticket:transcript').setLabel('Sauvegarder les logs').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:delete').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return [rangee];
}

export function embedLog(titre, description, couleur = FR.bleu) {
  return embed(titre, { couleur, description }).setTimestamp();
}
