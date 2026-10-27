// /setup general > Tags interdits : la liste des tags (nom + sanction propres
// a chacun), le salon des avertissements publics, les delais, un controle
// immediat. Tout est enregistre en base et pris en compte a chaud.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import {
  SANCTIONS, lireSaisie, ajouterRegle, retirerRegle, modifierRegle, cleRegle, libelle, sanctionDe,
} from './regles.js';
import {
  reglagesTags, balayer, surveillanceActive, etatBalayage,
} from './surveillance.js';

const MAX_REGLES = 25; // un menu Discord ne propose pas plus de 25 choix
const COURT = {
  progressif: 'progressive',
  alerte: 'alerte seule',
  role: 'retrait du rôle Vérifié',
  exclure: 'mute direct',
  expulser: 'expulsion directe',
  bannir: 'ban direct',
};
const sansMarques = (s) => s.replace(/[`*]/g, '');

const retourTags = () => new ButtonBuilder().setCustomId('gsetup:page:tags').setLabel('Retour').setEmoji('↩️')
  .setStyle(ButtonStyle.Secondary);

function lignesEtat() {
  const b = etatBalayage();
  if (!surveillanceActive()) {
    return '🔴 **Surveillance** · à l\'arrêt : cochez **Server Members Intent** dans le portail développeur'
      + ' (Bot > Privileged Gateway Intents), puis redémarrez le bot.';
  }
  return `🟢 **Surveillance** · active${b?.at ? `, dernier contrôle <t:${Math.floor(b.at / 1000)}:R>`
    + (b.erreur ? ` (❌ ${b.erreur})` : ` : ${b.membres} membres`) : ''}`;
}

function escalade() {
  return `1. avertissement en MP${reglagesTags.salonPublic() ? ' et dans le salon public' : ''}\n`
    + `2. après **${reglagesTags.delaiHeures()} h** : mute **${reglagesTags.muteHeures()} h**, 2e avertissement\n`
    + `3. après **${reglagesTags.delaiHeures()} h** : ban de **${reglagesTags.banTempJours()} jours**\n`
    + '4. à son retour, tag toujours là : dernier avertissement\n'
    + `5. après **${reglagesTags.delaiHeures()} h** : ban définitif\n`
    + `Le membre qui retire son tag s'arrête là. S'il le remet dans les **${reglagesTags.oubliJours()} jours**, il passe à l'étape suivante sans délai.`;
}

export function pageTags(note = '') {
  const regles = reglagesTags.regles();
  const salon = reglagesTags.salonPublic();

  const contenu = embed('🏷️・TAGS INTERDITS', {
    couleur: FR.bleu,
    description: 'Un membre qui affiche un de ces **tags de serveur** à côté de son pseudo est signalé dans le journal du bot,'
      + ' puis sanctionné selon le tag. Le staff, le propriétaire et les bots ne sont jamais touchés.\n\n'
      + `${lignesEtat()}\n`
      + `📢 **Avertissements publics** · ${salon ? `<#${salon}>` : '*aucun salon : MP seulement*'}\n`
      + '### Interdits\n'
      + (regles.length ? regles.map((r) => `• ${libelle(r)} · ${COURT[sanctionDe(r)]}`).join('\n') : '*aucun*')
      + '\n### Sanction progressive\n'
      + escalade()
      + (note ? `\n\n${note}` : ''),
  });

  const lignes = [];
  if (regles.length) {
    lignes.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gsetup:tags:fiche')
      .setPlaceholder('✏️ Modifier un interdit : nom, sanction, suppression')
      .addOptions(regles.slice(0, MAX_REGLES).map((r) => ({
        label: sansMarques(libelle(r)).slice(0, 100),
        description: COURT[sanctionDe(r)],
        value: cleRegle(r),
      })))));
  }
  const menuSalon = new ChannelSelectMenuBuilder().setCustomId('gsetup:tags:salon')
    .setPlaceholder('📢 Salon des avertissements publics (ex. #chat-fr)')
    .setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (salon) menuSalon.setDefaultChannels(salon);
  lignes.push(new ActionRowBuilder().addComponents(menuSalon));
  lignes.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gsetup:tags:ajout').setLabel('Interdire un tag').setEmoji('➕')
      .setStyle(ButtonStyle.Success).setDisabled(regles.length >= MAX_REGLES),
    new ButtonBuilder().setCustomId('gsetup:tags:delais').setLabel('Délais').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gsetup:tags:balayer').setLabel('Contrôler maintenant').setEmoji('🔍')
      .setStyle(ButtonStyle.Primary).setDisabled(!surveillanceActive()),
    new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [contenu], components: lignes };
}

/** Fiche d un interdit : son nom, sa sanction, sa suppression. */
export function pageFiche(cle, note = '') {
  const r = reglagesTags.regles().find((x) => cleRegle(x) === cle);
  if (!r) return pageTags('❌ Cet interdit n\'existe plus.');
  const sanction = sanctionDe(r);
  const menu = new StringSelectMenuBuilder().setCustomId(`gsetup:tags:sanction:${cle}`)
    .setPlaceholder('⚖️ Sanction pour ce tag')
    .addOptions(Object.entries(SANCTIONS).map(([valeur, label]) => ({ label, value: valeur, default: valeur === sanction })));
  return {
    embeds: [embed('🏷️・INTERDIT', {
      couleur: FR.bleu,
      description: `${libelle(r)}\n\n⚖️ **Sanction** · ${SANCTIONS[sanction]}`
        + (sanction === 'exclure' ? ` (${reglagesTags.muteHeures()} h)` : '')
        + (sanction === 'progressif' ? `\n\n${escalade()}` : '')
        + (sanction === 'alerte' ? '\n\nLe staff est prévenu dans le journal, le membre ne reçoit rien.' : '')
        + (note ? `\n\n${note}` : ''),
    })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`gsetup:tags:nom:${cle}`).setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`gsetup:tags:suppr:${cle}`).setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
        retourTags(),
      ),
    ],
  };
}

/** Controle relance apres un changement de regles, sans bloquer la reponse. */
function recontroler() {
  if (surveillanceActive()) balayer().catch((e) => console.warn('[tags] balayage :', e.message));
}

const champ = (id, label, valeur, max = 4) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
    .setRequired(true).setMaxLength(max).setValue(String(valeur)),
);

export async function onTagsSelect(interaction, id) {
  if (id === 'tags:fiche') return interaction.update(pageFiche(interaction.values[0]));
  if (id === 'tags:salon') {
    const salon = interaction.values[0] ?? '';
    reglagesTags.poserSalonPublic(salon);
    return interaction.update(pageTags(salon
      ? `✅ Les avertissements seront annoncés dans <#${salon}>.`
      : '✅ Plus d\'annonce publique : MP seulement.'));
  }
  if (id.startsWith('tags:sanction:')) {
    const cle = id.slice('tags:sanction:'.length);
    reglagesTags.poserRegles(modifierRegle(reglagesTags.regles(), cle, { sanction: interaction.values[0] }));
    recontroler();
    return interaction.update(pageFiche(cle, '✅ Sanction enregistrée. Elle s\'applique aux prochains signalements.'));
  }
  return null;
}

export async function onTagsBouton(interaction, id) {
  if (id === 'tags:ajout') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:tags:ajout').setTitle('Interdire un tag')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('saisie').setLabel('Tag (ex. SCAM) ou ID du serveur')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nom').setLabel('Nom (facultatif, ex. Serveur d\'arnaque X)')
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(40),
        ),
      ));
  }
  if (id.startsWith('tags:nom:')) {
    const cle = id.slice('tags:nom:'.length);
    const r = reglagesTags.regles().find((x) => cleRegle(x) === cle);
    return interaction.showModal(new ModalBuilder().setCustomId(`gsetup:tags:nom:${cle}`).setTitle('Renommer')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('nom').setLabel('Nom (vide = aucun)')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(40).setValue(r?.nom ?? ''),
      )));
  }
  if (id.startsWith('tags:suppr:')) {
    const cle = id.slice('tags:suppr:'.length);
    const r = reglagesTags.regles().find((x) => cleRegle(x) === cle);
    reglagesTags.poserRegles(retirerRegle(reglagesTags.regles(), cle));
    recontroler();
    return interaction.update(pageTags(r ? `✅ ${libelle(r)} n'est plus interdit.` : '✅ Interdit retiré.'));
  }
  if (id === 'tags:delais') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:tags:delais').setTitle('Délais')
      .addComponents(
        champ('delai', 'Délai entre deux étapes (heures)', reglagesTags.delaiHeures()),
        champ('mute', 'Durée du mute (heures, 672 max)', reglagesTags.muteHeures()),
        champ('banTemp', 'Durée du ban temporaire (jours)', reglagesTags.banTempJours()),
        champ('oubli', 'Casier effacé après (jours sans le tag)', reglagesTags.oubliJours()),
      ));
  }
  if (id === 'tags:balayer') {
    await interaction.deferUpdate();
    const r = await balayer();
    return interaction.editReply(pageTags(r.erreur
      ? `❌ Contrôle impossible : ${r.erreur}.`
      : `✅ ${r.membres} membres contrôlés, ${r.signales} nouvelle(s) sanction(s), détail dans le journal du bot.`));
  }
  return null;
}

export async function onTagsModal(interaction, id) {
  if (id === 'tags:ajout') {
    const lu = lireSaisie(interaction.fields.getTextInputValue('saisie'), interaction.fields.getTextInputValue('nom'));
    if (lu.erreur) return interaction.update(pageTags(`❌ ${lu.erreur}.`));
    const avant = reglagesTags.regles();
    const apres = ajouterRegle(avant, lu);
    if (apres.length === avant.length) return interaction.update(pageTags(`➖ ${libelle(lu)} est déjà interdit.`));
    reglagesTags.poserRegles(apres);
    // Pas de controle tout de suite : l admin choisit d abord la sanction sur la fiche.
    return interaction.update(pageFiche(cleRegle(lu), `✅ ${libelle(lu)} interdit, avec la sanction progressive par défaut.`
      + ' Changez-la ci-dessous si besoin, puis **Retour** > **Contrôler maintenant** (sinon au balayage de chaque heure).'));
  }
  if (id.startsWith('tags:nom:')) {
    const cle = id.slice('tags:nom:'.length);
    reglagesTags.poserRegles(modifierRegle(reglagesTags.regles(), cle, { nom: interaction.fields.getTextInputValue('nom') }));
    return interaction.update(pageFiche(cle, '✅ Nom enregistré.'));
  }
  if (id === 'tags:delais') {
    const lire = (k, min, max) => {
      const v = Math.round(Number(interaction.fields.getTextInputValue(k).trim()));
      return Number.isFinite(v) && v >= min && v <= max ? v : null;
    };
    const d = {
      delai: lire('delai', 1, 720), mute: lire('mute', 1, 672), banTemp: lire('banTemp', 1, 365), oubli: lire('oubli', 1, 3650),
    };
    if (Object.values(d).includes(null)) {
      return interaction.update(pageTags('❌ Valeurs hors limites : délai 1 à 720 h, mute 1 à 672 h, ban 1 à 365 jours, oubli 1 à 3650 jours.'));
    }
    reglagesTags.poserDelais(d);
    return interaction.update(pageTags('✅ Délais enregistrés. Les étapes déjà programmées gardent leur échéance.'));
  }
  return null;
}
