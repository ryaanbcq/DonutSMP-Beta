// /embed create : le staff compose un embed dans un formulaire, le bot le
// poste lui-meme dans le salon. Rien ne trahit la commande : pas de « X a
// utilise /embed » (ce bandeau n existe que sur une REPONSE a la commande,
// or ici la commande ne repond que par le formulaire, et le message est un
// envoi normal du bot).

import {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import { estAdmin } from '../lib/admin.js';
import { FR } from '../lib/brand.js';

export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Embeds du serveur')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((s) => s.setName('create').setDescription('Composer un embed, posté par le bot dans ce salon'));

const EPH = { flags: MessageFlags.Ephemeral };

const COULEURS = {
  bleu: FR.bleu, 'bleu clair': FR.bleu, or: FR.or, jaune: FR.jaune, vert: FR.vert, rouge: FR.rouge,
  violet: 0x9b59b6, rose: 0xff73c6, orange: 0xf39c12, blanc: 0xffffff, noir: 0x111111, gris: 0x95a5a6,
  blurple: 0x5865f2,
};

/** « #ff0000 », « ff0000 », « rouge » -> entier. Vide = bleu FR. null si illisible. */
export function lireCouleur(texte) {
  const t = String(texte ?? '').trim().toLowerCase();
  if (!t) return FR.bleu;
  if (COULEURS[t] !== undefined) return COULEURS[t];
  const m = t.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return parseInt(hex, 16);
}

const estUrlImage = (u) => /^https?:\/\/\S+$/i.test(u);

export async function execute(interaction) {
  if (!estAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Réservé au staff.', ...EPH });
  }
  const salon = interaction.channel;
  const moi = interaction.guild?.members?.me;
  const droits = salon?.permissionsFor?.(moi);
  if (!salon?.isTextBased?.() || (droits && !droits.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]))) {
    return interaction.reply({ content: '❌ Je ne peux pas poster d\'embed dans ce salon (Envoyer des messages + Intégrer des liens).', ...EPH });
  }

  const champ = (id, label, style, { requis = false, max, placeholder } = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(requis);
    if (max) t.setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };

  return interaction.showModal(new ModalBuilder()
    .setCustomId(`embed:create:${salon.id}`)
    .setTitle('Créer un embed')
    .addComponents(
      champ('titre', 'Titre', TextInputStyle.Short, { max: 256, placeholder: 'Facultatif' }),
      champ('contenu', 'Contenu', TextInputStyle.Paragraph, { requis: true, max: 4000, placeholder: 'Markdown accepté : **gras**, listes, liens, mentions…' }),
      champ('couleur', 'Couleur', TextInputStyle.Short, { max: 20, placeholder: '#AEEFFF, rouge, or, violet… (vide = bleu)' }),
      champ('image', 'Image (lien)', TextInputStyle.Short, { max: 500, placeholder: 'https://… (facultatif)' }),
    ));
}

export async function onModalEmbed(interaction) {
  if (!interaction.customId.startsWith('embed:create:')) return;
  if (!estAdmin(interaction.member)) return interaction.reply({ content: '❌ Réservé au staff.', ...EPH });

  const titre = interaction.fields.getTextInputValue('titre').trim();
  const contenu = interaction.fields.getTextInputValue('contenu').trim();
  const couleur = lireCouleur(interaction.fields.getTextInputValue('couleur'));
  const image = interaction.fields.getTextInputValue('image').trim();

  if (couleur === null) {
    return interaction.reply({ content: '❌ Couleur illisible : un code comme `#AEEFFF`, ou un nom (bleu, rouge, vert, jaune, or, violet, rose, orange, blanc, noir, gris).', ...EPH });
  }
  if (image && !estUrlImage(image)) {
    return interaction.reply({ content: '❌ L\'image doit être un lien qui commence par `https://`.', ...EPH });
  }

  const e = new EmbedBuilder().setColor(couleur).setDescription(contenu);
  if (titre) e.setTitle(titre);
  if (image) e.setImage(image);

  const salon = await interaction.client.channels.fetch(interaction.customId.split(':')[2]).catch(() => null);
  if (!salon?.isTextBased?.()) return interaction.reply({ content: '❌ Salon introuvable.', ...EPH });

  await interaction.deferReply(EPH);
  try {
    // Envoi normal du bot, sans lien avec la commande. Les mentions du texte
    // s affichent mais ne notifient personne.
    await salon.send({ embeds: [e], allowedMentions: { parse: [] } });
  } catch (err) {
    return interaction.editReply(`❌ Envoi refusé par Discord : ${err.message}`);
  }
  console.log(`[embed] ${interaction.user.tag} a poste un embed dans #${salon.name}`);
  // Rien ne doit rester, meme en prive.
  return interaction.deleteReply().catch(() => {});
}
