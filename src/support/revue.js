// Revue quotidienne du support (5 h, heure de Paris) : l IA relit les tickets
// des dernieres 24 h ou le staff a repondu et propose des entrees de FAQ.
// Rien n entre dans la FAQ sans un clic du staff (✅ Ajouter, ✏️ Modifier,
// ❌ Ignorer). Le bilan de la nuit part avec.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, escapeMarkdown,
} from 'discord.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { estAdmin } from '../lib/admin.js';
import { heureParis, jourParis } from './logique.js';
import { memoire, reglagesSupport, faqTexte } from './reglages.js';
import { connaissancesServeur } from './connaissances.js';
import { proposerFaq, iaDisponible } from './ia.js';

const H = 3_600_000;
const J = 24 * H;
const EPH = { flags: MessageFlags.Ephemeral };

async function salonRevue(client) {
  const id = reglagesSupport.salonRevue() || settings.salonJournal();
  const s = id ? await client.channels.fetch(id).catch(() => null) : null;
  return s?.isTextBased?.() ? s : null;
}

/** Les tickets des dernieres 24 h ou le staff a parle, en texte. */
export function ticketsRecents(now = Date.now()) {
  const parSalon = new Map();
  for (const m of memoire.depuis(now - J)) {
    if (!parSalon.has(m.channel_id)) parSalon.set(m.channel_id, []);
    parSalon.get(m.channel_id).push(m);
  }
  const blocs = [];
  for (const [id, msgs] of parSalon) {
    if (!msgs.some((m) => m.role === 'staff')) continue;
    const t = store.getTicket(id);
    const lignes = msgs.slice(-30).map((m) => `[${m.role === 'staff' ? 'Staff' : m.role === 'ia' ? 'Assistant IA' : 'Membre'}] ${String(m.content ?? '').slice(0, 800)}`);
    blocs.push(`### Ticket (${t?.categorie ?? 'sans catégorie'})\nDemande : ${String(t?.sujet ?? '').slice(0, 500)}\n${lignes.join('\n')}`);
  }
  return blocs;
}

function carteProposition(id, p) {
  return {
    embeds: [embed('💡・PROPOSITION DE FAQ', {
      couleur: FR.jaune,
      image: 'aucune',
      description: `**Q :** ${escapeMarkdown(p.question)}\n**R :** ${escapeMarkdown(p.reponse)}\n\n-# Tirée des réponses du staff dans les tickets. Ajoutée, l'assistant IA pourra s'en servir.`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`support:faq:ok:${id}`).setLabel('Ajouter').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`support:faq:edit:${id}`).setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`support:faq:non:${id}`).setLabel('Ignorer').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    )],
  };
}

/** Lance la revue. Rend une phrase de bilan. */
export async function lancerRevue(client, now = Date.now()) {
  if (!iaDisponible()) return 'pas de clé API';
  const s = await salonRevue(client);
  if (!s) return 'aucun salon de revue';

  const etats = memoire.etatsDepuis(now - J);
  const pris = etats.filter((e) => e.ia_count > 0);
  const transmis = pris.filter((e) => e.transmis).length;
  const blocs = ticketsRecents(now);
  let propositions = [];
  if (blocs.length) {
    const r = await proposerFaq({ connaissances: connaissancesServeur(), faq: faqTexte(), tickets: blocs.join('\n\n').slice(0, 150_000) });
    propositions = (r.propositions ?? []).filter((p) => p.question?.trim() && p.reponse?.trim()).slice(0, 6);
  }
  await s.send({
    embeds: [embed('🌙・BILAN DU SUPPORT IA', {
      couleur: FR.bleu,
      image: 'aucune',
      description: `Sur les dernières 24 h : **${pris.length}** ticket(s) pris en charge par l'assistant, dont **${transmis}** transmis au staff.\n`
        + `**${blocs.length}** ticket(s) avec des réponses du staff relus, **${propositions.length}** proposition(s) de FAQ ci-dessous.\n`
        + `-# FAQ actuelle : ${reglagesSupport.faq().length} entrée(s). Réglages : /setup general > Support IA.`,
    })],
    allowedMentions: { parse: [] },
  });
  for (const p of propositions) {
    const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    reglagesSupport.poserProposition(id, { question: p.question.trim(), reponse: p.reponse.trim(), at: now });
    await s.send({ ...carteProposition(id, reglagesSupport.propositions()[id]), allowedMentions: { parse: [] } });
  }
  memoire.purger(now - 14 * J);
  return `${pris.length} ticket(s) pris, ${propositions.length} proposition(s)`;
}

export function demarrerRevue(client) {
  const verifier = () => {
    const now = Date.now();
    if (!reglagesSupport.actif() || heureParis(now) !== 5) return;
    const jour = jourParis(now);
    if (store.kvGet('support.revue.jour') === jour) return;
    store.kvSet('support.revue.jour', jour);
    lancerRevue(client, now).then((n) => console.log(`[support] revue : ${n}`)).catch((e) => console.warn('[support] revue :', e.message));
  };
  setInterval(verifier, 10 * 60_000).unref();
}

// ------------------------------------------------------------------ boutons

export async function onBoutonSupport(interaction) {
  if (!estAdmin(interaction.member)) return interaction.reply({ content: '🔒 Réservé aux admins du bot.', ...EPH });
  const [, , action, id] = interaction.customId.split(':');
  const p = reglagesSupport.propositions()[id];
  if (!p) return interaction.update({ components: [] }).catch(() => {});
  if (action === 'ok') {
    reglagesSupport.ajouterFaq(p.question, p.reponse, interaction.user.id);
    reglagesSupport.poserProposition(id, null);
    return interaction.update({ content: `✅ Ajoutée à la FAQ par **${escapeMarkdown(interaction.member.displayName)}**.`, components: [] });
  }
  if (action === 'non') {
    reglagesSupport.poserProposition(id, null);
    return interaction.update({ content: `❌ Ignorée par **${escapeMarkdown(interaction.member.displayName)}**.`, components: [] });
  }
  if (action === 'edit') {
    return interaction.showModal(new ModalBuilder().setCustomId(`support:faqform:${id}`).setTitle('Modifier puis ajouter à la FAQ')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q').setLabel('Question').setStyle(TextInputStyle.Short)
          .setRequired(true).setMaxLength(300).setValue(p.question.slice(0, 300))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('r').setLabel('Réponse').setStyle(TextInputStyle.Paragraph)
          .setRequired(true).setMaxLength(1500).setValue(p.reponse.slice(0, 1500))),
      ));
  }
  return interaction.reply({ content: '❌ Action inconnue.', ...EPH });
}

export async function onModalSupport(interaction) {
  if (!estAdmin(interaction.member)) return interaction.reply({ content: '🔒 Réservé aux admins du bot.', ...EPH });
  const id = interaction.customId.split(':')[2];
  const q = interaction.fields.getTextInputValue('q').trim();
  const r = interaction.fields.getTextInputValue('r').trim();
  reglagesSupport.ajouterFaq(q, r, interaction.user.id);
  reglagesSupport.poserProposition(id, null);
  return interaction.update({
    ...carteProposition(id, { question: q, reponse: r }),
    content: `✏️ Modifiée et ajoutée à la FAQ par **${escapeMarkdown(interaction.member.displayName)}**.`,
    components: [],
  });
}
