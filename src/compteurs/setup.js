// /setup general > Compteurs : les trois salons vocaux, leurs textes, creer
// les salons d un clic, actualiser maintenant.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { TYPES, MINUTES, reglagesCompteurs, chiffres, actualiser, creerSalons } from './compteurs.js';
import { nomSalon } from './logique.js';

const resume = ({ changes = [], attente = [], erreurs = [] } = {}) => [
  changes.length ? `✅ Mis à jour : ${changes.map((t) => TYPES[t].label).join(', ')}.` : '',
  attente.length ? `⏳ Discord limite à 2 changements de nom par 10 min : ${attente.map((t) => TYPES[t].label).join(', ')} au prochain tour.` : '',
  ...erreurs.map((e) => `❌ ${e}`),
].filter(Boolean).join('\n');

export async function pageCompteurs(guild, note = '') {
  const c = reglagesCompteurs.conf();
  const n = await chiffres(guild).catch(() => ({}));
  const lignes = Object.entries(TYPES).map(([t, info]) => (c[t]?.salonId
    ? `${info.emoji} **${info.label}** · <#${c[t].salonId}> → \`${nomSalon(c[t].modele ?? info.defaut, n[t] ?? 0)}\``
    : `${info.emoji} **${info.label}** · *pas de salon* (${n[t] ?? '?'} maintenant)`));
  const description = 'Trois salons vocaux **fermés** (tout le monde les voit, personne ne s\'y connecte) dont le nom affiche un chiffre,'
    + ` mis à jour toutes les **${MINUTES} min** (le plus rapide que Discord autorise).\n\n${lignes.join('\n')}`
    + '\n\n-# Textes : `{nombre}` est remplacé par le chiffre. « En ligne » est le compte de Discord, approximatif.'
    + (note ? `\n\n${note}` : '');

  const menu = (t, info) => {
    const m = new ChannelSelectMenuBuilder().setCustomId(`gsetup:compteurs:salon:${t}`)
      .setPlaceholder(`${info.emoji} Salon vocal « ${info.label} »`).setChannelTypes(ChannelType.GuildVoice).setMinValues(0).setMaxValues(1);
    if (c[t]?.salonId) m.setDefaultChannels(c[t].salonId);
    return new ActionRowBuilder().addComponents(m);
  };
  const actifs = reglagesCompteurs.actifs().length;
  return {
    embeds: [embed('📊・COMPTEURS', { couleur: FR.bleu, description })],
    components: [
      ...Object.entries(TYPES).map(([t, info]) => menu(t, info)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gsetup:compteurs:creer').setLabel('Créer les salons').setEmoji('✨').setStyle(ButtonStyle.Success).setDisabled(actifs === 3),
        new ButtonBuilder().setCustomId('gsetup:compteurs:textes').setLabel('Textes').setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(!actifs),
        new ButtonBuilder().setCustomId('gsetup:compteurs:maj').setLabel('Actualiser').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(!actifs),
        new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function onCompteursSelect(interaction, id) {
  const type = id.split(':')[2];
  if (!TYPES[type]) return;
  const valeur = interaction.values[0] ?? '';
  await interaction.deferUpdate();
  reglagesCompteurs.poserSalon(type, valeur);
  const r = valeur ? await actualiser(interaction.guild).catch((e) => ({ erreurs: [e.message] })) : {};
  return interaction.editReply(await pageCompteurs(interaction.guild, valeur ? `✅ ${TYPES[type].label} → <#${valeur}>.\n${resume(r)}` : `✅ Compteur ${TYPES[type].label} arrêté (le salon n'est pas supprimé).`));
}

export async function onCompteursBouton(interaction, id) {
  const { guild } = interaction;
  if (id === 'compteurs:textes') {
    const c = reglagesCompteurs.conf();
    const modal = new ModalBuilder().setCustomId('gsetup:compteurs:modal').setTitle('Textes des compteurs');
    for (const [t, info] of Object.entries(TYPES)) {
      if (!c[t]?.salonId) continue;
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(t)
        .setLabel(`${info.label} ({nombre} = le chiffre)`).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(90)
        .setValue(c[t].modele ?? info.defaut)));
    }
    return interaction.showModal(modal);
  }
  await interaction.deferUpdate();
  if (id === 'compteurs:creer') {
    const r = await creerSalons(guild).catch((e) => ({ erreurs: [`création impossible : ${e.message}`] }));
    return interaction.editReply(await pageCompteurs(guild, `✨ Catégorie « 📊 STATS » et salons créés.\n${resume(r)}`));
  }
  if (id === 'compteurs:maj') {
    const r = await actualiser(guild).catch((e) => ({ erreurs: [e.message] }));
    return interaction.editReply(await pageCompteurs(guild, resume(r) || '✅ Tout est déjà à jour.'));
  }
}

export async function onCompteursModal(interaction) {
  for (const t of Object.keys(TYPES)) {
    let v = null;
    try { v = interaction.fields.getTextInputValue(t); } catch { continue; }
    reglagesCompteurs.poserModele(t, v.trim() || TYPES[t].defaut);
  }
  await interaction.deferUpdate();
  const r = await actualiser(interaction.guild).catch((e) => ({ erreurs: [e.message] }));
  return interaction.editReply(await pageCompteurs(interaction.guild, `✅ Textes enregistrés.\n${resume(r)}`));
}
