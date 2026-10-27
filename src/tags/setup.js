// /setup general > Tags interdits : la liste des tags, la sanction, un
// controle immediat. Tout est enregistre en base et pris en compte a chaud.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import {
  SANCTIONS, lireSaisie, ajouterRegle, retirerRegle, cleRegle, libelle,
} from './regles.js';
import {
  reglagesTags, balayer, surveillanceActive, etatBalayage,
} from './surveillance.js';

const MAX_REGLES = 25; // un menu Discord ne propose pas plus de 25 choix

export function pageTags(note = '') {
  const regles = reglagesTags.regles();
  const sanction = reglagesTags.sanction();
  const b = etatBalayage();
  const etat = surveillanceActive()
    ? `🟢 **Surveillance** · active${b?.at ? `, dernier contrôle <t:${Math.floor(b.at / 1000)}:R>${b.erreur ? ` (❌ ${b.erreur})` : ` : ${b.membres} membres, ${b.signales} signalé(s)`}` : ''}`
    : '🔴 **Surveillance** · à l\'arrêt : cochez **Server Members Intent** dans le portail développeur (Bot > Privileged Gateway Intents), puis redémarrez le bot.';

  const contenu = embed('🏷️・TAGS INTERDITS', {
    couleur: FR.bleu,
    description: 'Un membre qui affiche un de ces **tags de serveur** à côté de son pseudo est signalé dans le journal du bot,'
      + ' puis sanctionné. Le staff, le propriétaire et les bots ne sont jamais touchés.\n\n'
      + `${etat}\n`
      + `⚖️ **Sanction** · ${SANCTIONS[sanction]}${sanction === 'exclure' ? ` (${reglagesTags.heuresExclusion()} h)` : ''}\n\n`
      + '### Interdits\n'
      + (regles.length ? regles.map((r) => `• ${libelle(r)}`).join('\n') : '*aucun*')
      + '\n\n💡 Un tag peut être repris par n\'importe quel serveur. L\'**ID du serveur** qui le distribue est infaillible :'
      + ' il est donné dans le journal à chaque signalement.'
      + (note ? `\n\n${note}` : ''),
  });

  const menuSanction = new StringSelectMenuBuilder().setCustomId('gsetup:tags:sanction')
    .setPlaceholder('⚖️ Sanction')
    .addOptions(Object.entries(SANCTIONS).map(([valeur, label]) => ({ label, value: valeur, default: valeur === sanction })));

  const lignes = [new ActionRowBuilder().addComponents(menuSanction)];
  if (regles.length) {
    lignes.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gsetup:tags:retirer')
      .setPlaceholder('🗑️ Retirer un interdit')
      .addOptions(regles.slice(0, MAX_REGLES).map((r) => ({
        label: libelle(r).replace(/`/g, '').slice(0, 100), value: cleRegle(r),
      })))));
  }
  lignes.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gsetup:tags:ajout').setLabel('Interdire un tag').setEmoji('➕')
      .setStyle(ButtonStyle.Success).setDisabled(regles.length >= MAX_REGLES),
    new ButtonBuilder().setCustomId('gsetup:tags:duree').setLabel('Durée d\'exclusion').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gsetup:tags:balayer').setLabel('Contrôler maintenant').setEmoji('🔍')
      .setStyle(ButtonStyle.Primary).setDisabled(!surveillanceActive()),
    new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [contenu], components: lignes };
}

/** Controle relance apres un changement de regles, sans bloquer la reponse. */
function recontroler() {
  if (surveillanceActive()) balayer().catch((e) => console.warn('[tags] balayage :', e.message));
}

export async function onTagsSelect(interaction, id) {
  if (id === 'tags:sanction') {
    reglagesTags.poserSanction(interaction.values[0]);
    return interaction.update(pageTags(`✅ Sanction : **${SANCTIONS[reglagesTags.sanction()]}**. Elle s'applique aux prochains signalements.`));
  }
  if (id === 'tags:retirer') {
    const cle = interaction.values[0];
    reglagesTags.poserRegles(retirerRegle(reglagesTags.regles(), cle));
    recontroler();
    return interaction.update(pageTags('✅ Interdit retiré. Les membres qui ne portaient que lui ne sont plus visés.'));
  }
  return null;
}

export async function onTagsBouton(interaction, id) {
  if (id === 'tags:ajout') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:tags:ajout').setTitle('Interdire un tag')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('saisie').setLabel('Tag (ex. SCAM) ou ID du serveur')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20),
      )));
  }
  if (id === 'tags:duree') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:tags:duree').setTitle('Durée d\'exclusion')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('heures').setLabel('En heures (1 à 672, soit 28 jours)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)
          .setValue(String(reglagesTags.heuresExclusion())),
      )));
  }
  if (id === 'tags:balayer') {
    await interaction.deferUpdate();
    const r = await balayer();
    return interaction.editReply(pageTags(r.erreur
      ? `❌ Contrôle impossible : ${r.erreur}.`
      : `✅ ${r.membres} membres contrôlés, ${r.signales} nouveau(x) signalement(s).`));
  }
  return null;
}

export async function onTagsModal(interaction, id) {
  if (id === 'tags:ajout') {
    const lu = lireSaisie(interaction.fields.getTextInputValue('saisie'));
    if (lu.erreur) return interaction.update(pageTags(`❌ ${lu.erreur}.`));
    const avant = reglagesTags.regles();
    const apres = ajouterRegle(avant, lu);
    if (apres.length === avant.length) return interaction.update(pageTags(`➖ ${libelle(lu)} est déjà interdit.`));
    reglagesTags.poserRegles(apres);
    recontroler();
    return interaction.update(pageTags(`✅ ${libelle(lu)} interdit.${surveillanceActive() ? ' Contrôle de tous les membres lancé, résultats dans le journal du bot.' : ''}`));
  }
  if (id === 'tags:duree') {
    const h = Math.round(Number(interaction.fields.getTextInputValue('heures').trim()));
    if (!Number.isFinite(h) || h < 1 || h > 672) return interaction.update(pageTags('❌ Entre 1 et 672 heures.'));
    reglagesTags.poserHeuresExclusion(h);
    return interaction.update(pageTags(`✅ Exclusion de ${h} h.`));
  }
  return null;
}
