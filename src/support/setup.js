// /setup general > Support IA : allumer, delais, categories ou l assistant
// repond sur le fond, salon de la revue quotidienne, FAQ.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { settings } from '../settings.js';
import { reglagesTickets, cleDe } from '../tickets/reglages.js';
import { reglagesSupport } from './reglages.js';
import { iaDisponible, MODELE } from './ia.js';
import { lancerRevue } from './revue.js';
import { replanifier } from './agent.js';

const court = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function pageSupport(note = '') {
  const actif = reglagesSupport.actif();
  const r = reglagesSupport.reglages();
  const fond = reglagesSupport.categoriesFond();
  const cats = reglagesTickets.categories();
  const faq = reglagesSupport.faq();
  const revue = reglagesSupport.salonRevue() || settings.salonJournal();

  const etat = !iaDisponible() ? '🔴 **Pas de clé API** (ANTHROPIC_API_KEY dans le .env)'
    : actif ? '🟢 **Actif**' : '🔴 **Éteint**';
  const description = 'Quand le staff ne répond pas, l\'assistant (Claude Haiku) prend le **début** du ticket : il accueille, fait préciser'
    + ' ce qui manque, et répond seul aux questions simples de support technique (connaissances du bot + FAQ validée ici).'
    + ' Il se tait dès que le staff écrit ou prend le ticket. Pour l\'argent, les scams et les sanctions, il transmet toujours.\n\n'
    + `${etat} · modèle \`${MODELE}\`\n`
    + `⏱️ **Délai** · ${r.delaiJourMin} min le jour, **${r.delaiNuitMin} min la nuit** (${r.nuitDebut} h à ${r.nuitFin} h)\n`
    + `🎯 **Répond sur le fond dans** · ${cats.filter((c) => fond.includes(c.cle)).map((c) => `${c.emoji} ${c.nom}`).join(', ') || '*aucune catégorie : accueil seulement*'}\n`
    + `📚 **FAQ** · ${faq.length} entrée(s)\n`
    + `🌙 **Revue chaque jour à 5 h** · ${revue ? `<#${revue}>` : '*pas de salon*'} (bilan + propositions de FAQ à valider)\n`
    + `-# Au plus ${r.maxIaParTicket} réponses par ticket et ${r.maxParJour} par jour. Les tickets ouverts avant l'allumage ne sont pas repris.`
    + (note ? `\n\n${note}` : '');

  const menuRevue = new ChannelSelectMenuBuilder().setCustomId('gsetup:support:revue')
    .setPlaceholder('🌙 Salon de la revue quotidienne (staff)').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
  if (reglagesSupport.salonRevue()) menuRevue.setDefaultChannels(reglagesSupport.salonRevue());

  const menuCats = new StringSelectMenuBuilder().setCustomId('gsetup:support:cats')
    .setPlaceholder('🎯 Catégories où il répond sur le fond').setMinValues(0).setMaxValues(Math.max(1, Math.min(25, cats.length)))
    .addOptions((cats.length ? cats : [{ cle: 'aucune', nom: 'Aucune catégorie', emoji: '➖' }]).slice(0, 25).map((c) => ({
      label: court(c.nom, 100), value: c.cle ?? cleDe(c.nom), emoji: { name: c.emoji || '🎫' }, default: fond.includes(c.cle),
    })));

  const rangs = [new ActionRowBuilder().addComponents(menuRevue), new ActionRowBuilder().addComponents(menuCats)];
  if (faq.length) {
    rangs.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('gsetup:support:faqrm')
      .setPlaceholder(`🗑️ Retirer une entrée de la FAQ (${faq.length})`).setMinValues(1).setMaxValues(1)
      .addOptions(faq.slice(-25).map((e) => ({ label: court(e.question, 100), value: e.id, description: court(e.reponse, 100) })))));
  }
  rangs.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gsetup:support:basculer').setLabel(actif ? 'Éteindre' : 'Allumer')
      .setEmoji(actif ? '⏹️' : '▶️').setStyle(actif ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(!iaDisponible() && !actif),
    new ButtonBuilder().setCustomId('gsetup:support:delais').setLabel('Délais').setEmoji('⏱️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gsetup:support:faqadd').setLabel('Ajouter à la FAQ').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('gsetup:support:revuego').setLabel('Revue maintenant').setEmoji('🌙').setStyle(ButtonStyle.Secondary)
      .setDisabled(!iaDisponible()),
    new ButtonBuilder().setCustomId('gsetup:page:accueil').setLabel('Retour').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed('🤖・SUPPORT IA', { couleur: FR.bleu, description })], components: rangs };
}

export async function onSupportSelect(interaction, id) {
  if (id === 'support:revue') {
    reglagesSupport.poserSalonRevue(interaction.values[0] ?? '');
    return interaction.update(pageSupport('✅ Salon de la revue enregistré.'));
  }
  if (id === 'support:cats') {
    reglagesSupport.poserCategoriesFond(interaction.values.filter((v) => v !== 'aucune'));
    return interaction.update(pageSupport('✅ Catégories enregistrées.'));
  }
  if (id === 'support:faqrm') {
    reglagesSupport.retirerFaq(interaction.values[0]);
    return interaction.update(pageSupport('✅ Entrée retirée de la FAQ.'));
  }
}

export async function onSupportBouton(interaction, id) {
  if (id === 'support:basculer') {
    const v = !reglagesSupport.actif();
    reglagesSupport.poserActif(v);
    replanifier();
    return interaction.update(pageSupport(v ? '✅ Assistant allumé : il prendra les nouveaux tickets.' : '✅ Assistant éteint.'));
  }
  if (id === 'support:delais') {
    const r = reglagesSupport.reglages();
    const champ = (cle, label, v) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(cle).setLabel(label)
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setValue(String(v)));
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:support:delaisform').setTitle('Délais de l\'assistant')
      .addComponents(
        champ('jour', 'Minutes sans réponse, le jour (1 à 240)', r.delaiJourMin),
        champ('nuit', 'Minutes sans réponse, la nuit (1 à 240)', r.delaiNuitMin),
        champ('debut', 'Début de la nuit, heure de Paris (0 à 23)', r.nuitDebut),
        champ('fin', 'Fin de la nuit, heure de Paris (0 à 23)', r.nuitFin),
      ));
  }
  if (id === 'support:faqadd') {
    return interaction.showModal(new ModalBuilder().setCustomId('gsetup:support:faqform').setTitle('Ajouter à la FAQ')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q').setLabel('Question (comme un membre la pose)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(300)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('r').setLabel('Réponse')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)),
      ));
  }
  if (id === 'support:revuego') {
    await interaction.deferUpdate();
    const n = await lancerRevue(interaction.client).catch((e) => `❌ ${e.message}`);
    return interaction.editReply(pageSupport(`🌙 Revue : ${n}.`));
  }
}

export async function onSupportModal(interaction, id) {
  if (id === 'support:faqform') {
    reglagesSupport.ajouterFaq(interaction.fields.getTextInputValue('q').trim(), interaction.fields.getTextInputValue('r').trim(), interaction.user.id);
    return interaction.update(pageSupport('✅ Entrée ajoutée à la FAQ.'));
  }
  if (id === 'support:delaisform') {
    const n = (cle, min, max) => {
      const v = Number(interaction.fields.getTextInputValue(cle).trim());
      return Number.isInteger(v) && v >= min && v <= max ? v : null;
    };
    const r = { delaiJourMin: n('jour', 1, 240), delaiNuitMin: n('nuit', 1, 240), nuitDebut: n('debut', 0, 23), nuitFin: n('fin', 0, 23) };
    if (Object.values(r).some((v) => v === null)) return interaction.update(pageSupport('❌ Valeurs invalides : minutes de 1 à 240, heures de 0 à 23.'));
    reglagesSupport.poserReglages(r);
    replanifier();
    return interaction.update(pageSupport('✅ Délais enregistrés.'));
  }
}
