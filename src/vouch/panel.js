import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} from 'discord.js';
import { store } from '../db.js';
import { settings, ouSeLier } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { etoiles, barre, ligneScore } from './trust.js';
import { trustDe, posterAvis, retirerAvis, carteReputation, filDe } from './fils.js';
import { isValidName, bypass } from '../lib/names.js';
import { config } from '../config.js';

// /vouch sans argument : UN message prive qui se remplit en quatre clics.
// Le brouillon vit en memoire par membre ; rien ne part avant « Publier ».

const EPH = { flags: MessageFlags.Ephemeral };
const MIN_ANCIENNETE_MS = 24 * 3_600_000;
const MIN_SCAM = 20;

const brouillons = new Map();
const brouillon = (id) => brouillons.get(String(id)) ?? { cible: null, verdict: null, etoiles: null, message: '' };
const poser = (id, patch) => { brouillons.set(String(id), { ...brouillon(id), ...patch }); return brouillon(id); };

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

export function rendre(b, note = '') {
  const cible = b.cible ? store.getLink(b.cible) : null;
  const t = cible ? trustDe(cible.discord_id) : null;
  const scam = b.verdict === 'neg';
  const complet = cible && b.verdict && (scam ? b.message.length >= MIN_SCAM : b.etoiles);

  let description = '**Notez un membre avec qui vous avez tradé.**\n';
  if (!cible) description += '\n1️⃣ Choisissez le membre ci-dessous.';
  else {
    description += `\n**${cible.mc_name}** · <@${cible.discord_id}>\n`
      + `${t.palier.emoji} ${t.palier.nom} · ${ligneScore(t)} · ${t.n} avis\n\n`
      + `2️⃣ Verdict : ${b.verdict ? (scam ? '⚠️ **Signalement**' : '✅ **Vouch**') : '*à choisir*'}\n`
      + `3️⃣ Note : ${scam ? '*sans objet pour un signalement*' : b.etoiles ? `**${etoiles(b.etoiles)}**` : '*à choisir*'}\n`
      + `4️⃣ Message : ${b.message ? `\n> ${b.message.replace(/\n/g, '\n> ')}` : scam ? `*obligatoire, ${MIN_SCAM} caractères minimum*` : '*facultatif*'}`;
  }
  if (note) description += `\n\n${note}`;

  const contenu = embed('⭐・DONNER UN AVIS', {
    couleur: scam ? FR.rouge : b.verdict ? FR.vert : FR.bleu,
    image: cible?.mc_name ?? 'logo',
    description,
  });

  const choix = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('vouch:cible').setPlaceholder('👤 Le membre à noter'),
  );
  if (!cible) return { embeds: [contenu], components: [choix] };

  const verdict = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vouch:verdict:pos').setLabel('Vouch').setEmoji('✅')
      .setStyle(b.verdict === 'pos' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vouch:verdict:neg').setLabel('Signaler un scam').setEmoji('⚠️')
      .setStyle(scam ? ButtonStyle.Danger : ButtonStyle.Secondary),
  );
  const notes = new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) => new ButtonBuilder().setCustomId(`vouch:etoile:${n}`)
      .setLabel(n <= (b.etoiles ?? 0) ? '★' : '☆')
      .setStyle(n <= (b.etoiles ?? 0) ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(scam || !b.verdict)),
  );
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vouch:message').setLabel(b.message ? 'Modifier le message' : 'Écrire un message')
      .setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(!b.verdict),
    new ButtonBuilder().setCustomId('vouch:publier').setLabel('Publier').setEmoji('📣')
      .setStyle(ButtonStyle.Success).setDisabled(!complet),
    new ButtonBuilder().setCustomId('vouch:annuler').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [contenu], components: [choix, verdict, notes, actions] };
}

// ---------------------------------------------------------------------------
// Panneau public (bouton) et entree /vouch
// ---------------------------------------------------------------------------

export function panneauVouch(forumId) {
  const contenu = embed('⭐・RÉPUTATION', {
    description:
      "**Avant un trade, vérifiez. Après un trade, notez.**\n\n"
      + `Chaque membre vérifié a son post dans <#${forumId}> : cherchez son pseudo pour voir son `
      + 'trust score sur 100, ses étoiles, ses vouches et ses signalements.\n\n'
      + '**Chercher un membre** : choisissez-le dans le menu ci-dessous, ou tapez son pseudo Minecraft '
      + 'avec le bouton 🔍. Sa carte de réputation vous est montrée en privé.\n\n'
      + "Pour noter quelqu'un, cliquez sur **Donner un avis** ou tapez `/vouch`. "
      + 'Un signalement demande une explication, et le staff peut retirer un avis abusif.\n\n'
      + '💎 Légende · 🥇 Trusted · 🥈 De confiance · 🥉 Fiable · 🌱 Nouveau · ☠️ Signalé',
  });
  const recherche = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('vouch:chercher:membre').setPlaceholder('🔍 Chercher un membre Discord'),
  );
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vouch:ouvrir').setLabel('Donner un avis').setEmoji('⭐').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vouch:chercher:mc').setLabel('Chercher un pseudo Minecraft').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [contenu], components: [recherche, boutons] };
}

// ---------------------------------------------------------------------------
// Recherche : par membre Discord (menu) ou par pseudo Minecraft / nom Discord (formulaire)
// ---------------------------------------------------------------------------

async function montrerCarte(interaction, link, { differe = false } = {}) {
  const fil = await filDe(interaction.client, link).catch(() => null);
  const charge = { ...carteReputation(link), content: fil ? `Tous ses avis : ${fil}` : undefined, ...EPH };
  return differe ? interaction.editReply(charge) : interaction.reply(charge);
}

async function chercherParMembre(interaction) {
  const id = interaction.values[0];
  const link = store.getLink(id);
  if (!link) return interaction.reply({ content: `<@${id}> n'a pas de compte vérifié : pas de réputation à afficher.`, ...EPH });
  return montrerCarte(interaction, link);
}

function modalRecherche() {
  return new ModalBuilder().setCustomId('vouch:chercher:modal').setTitle('Chercher un joueur')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('q').setLabel('Pseudo Minecraft ou nom Discord')
        .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(32),
    ));
}

async function chercherParTexte(interaction) {
  const q = interaction.fields.getTextInputValue('q').trim();
  await interaction.deferReply(EPH);

  // 1. pseudo Minecraft exact (la casse ne compte pas)
  if (isValidName(q)) {
    const link = store.getLinkByName(q);
    if (link) return montrerCarte(interaction, link, { differe: true });
  }

  // 2. nom Discord : Discord cherche par prefixe de pseudo ou de surnom
  const membres = await interaction.guild.members.search({ query: q, limit: 10 }).catch(() => null);
  const lies = [...(membres?.values() ?? [])].map((m) => store.getLink(m.id)).filter(Boolean);
  if (lies.length === 1) return montrerCarte(interaction, lies[0], { differe: true });
  if (lies.length > 1) {
    return interaction.editReply(
      `Plusieurs membres vérifiés correspondent à **${q}** :\n`
      + lies.map((l) => `• **${l.mc_name}** <@${l.discord_id}>`).join('\n')
      + '\n\nPrécisez le pseudo Minecraft, ou choisissez-le dans le menu du panneau.',
    );
  }

  // 3. pseudo Minecraft approchant, parmi les comptes lies
  const bas = q.toLowerCase();
  const proches = store.allLinks().filter((l) => l.mc_name.toLowerCase().includes(bas)).slice(0, 5);
  if (proches.length === 1) return montrerCarte(interaction, proches[0], { differe: true });
  if (proches.length > 1) {
    return interaction.editReply(
      `Aucun **${q}** exact, mais ces pseudos s'en approchent :\n`
      + proches.map((l) => `• **${l.mc_name}** <@${l.discord_id}>`).join('\n'),
    );
  }
  return interaction.editReply(`Aucun membre vérifié ne correspond à **${q}**. Seuls les comptes link ont une réputation.`);
}


export async function ouvrir(interaction) {
  const moi = store.getLink(interaction.user.id);
  const libre = bypass(interaction.member, config);
  if (!moi && !libre) return interaction.reply({ content: `❌ Pour noter, ${ouSeLier()}.`, ...EPH });
  if (moi && !libre && Date.now() - moi.linked_at < MIN_ANCIENNETE_MS) {
    const dans = Math.ceil((moi.linked_at + MIN_ANCIENNETE_MS - Date.now()) / 3_600_000);
    return interaction.reply({
      content: `⏳ Votre compte est vérifié depuis moins de 24 h : vous pourrez noter dans ${dans} h. Ça évite les comptes jetables.`,
      ...EPH,
    });
  }
  if (!settings.salonVouch()) {
    return interaction.reply({ content: "❌ Le forum des vouches n'est pas encore configuré (staff : `/panel vouches`).", ...EPH });
  }
  brouillons.delete(String(interaction.user.id));
  return interaction.reply({ ...rendre(brouillon(interaction.user.id)), ...EPH });
}

// ---------------------------------------------------------------------------
// Interactions (customId prefixe vouch:)
// ---------------------------------------------------------------------------

export async function onSelect(interaction) {
  if (interaction.customId === 'vouch:chercher:membre') return chercherParMembre(interaction);
  if (interaction.customId !== 'vouch:cible') return;
  const id = interaction.values[0];
  const b = brouillon(interaction.user.id);
  if (id === interaction.user.id) return interaction.update(rendre(b, '❌ On ne se note pas soi-même.'));
  const cible = store.getLink(id);
  if (!cible) return interaction.update(rendre(b, `❌ <@${id}> n'a pas de compte vérifié : seuls les membres link peuvent être notés.`));
  const existant = store.getVouch(interaction.user.id, id);
  const note = existant ? 'ℹ️ Vous aviez déjà noté ce membre : publier remplacera votre avis.' : '';
  return interaction.update(rendre(poser(interaction.user.id, {
    cible: id,
    verdict: existant ? (existant.value > 0 ? 'pos' : 'neg') : null,
    etoiles: existant?.stars ?? null,
    message: existant?.comment ?? '',
  }), note));
}

export async function onBouton(interaction) {
  const id = interaction.customId;
  if (id.startsWith('vouch:suppr:')) return supprimer(interaction);
  if (id === 'vouch:ouvrir') return ouvrir(interaction);
  if (id === 'vouch:chercher:mc') return interaction.showModal(modalRecherche());

  const b = brouillon(interaction.user.id);
  if (id === 'vouch:annuler') {
    brouillons.delete(String(interaction.user.id));
    return interaction.update({ embeds: [embed('⭐・DONNER UN AVIS', { description: 'Avis annulé, rien n\'a été publié.' })], components: [] });
  }
  if (id.startsWith('vouch:verdict:')) {
    const verdict = id.slice('vouch:verdict:'.length);
    return interaction.update(rendre(poser(interaction.user.id, { verdict, etoiles: verdict === 'neg' ? null : b.etoiles })));
  }
  if (id.startsWith('vouch:etoile:')) {
    return interaction.update(rendre(poser(interaction.user.id, { etoiles: Number(id.slice('vouch:etoile:'.length)) })));
  }
  if (id === 'vouch:message') {
    const scam = b.verdict === 'neg';
    const modal = new ModalBuilder().setCustomId('vouch:modal').setTitle(scam ? 'Que s\'est-il passé ?' : 'Votre message')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('message').setLabel(scam ? 'Décrivez le scam, avec des faits' : 'Un mot sur le trade')
          .setStyle(TextInputStyle.Paragraph).setRequired(scam).setMinLength(scam ? MIN_SCAM : 0).setMaxLength(280)
          .setValue(b.message ?? ''),
      ));
    return interaction.showModal(modal);
  }
  if (id === 'vouch:publier') return publier(interaction, b);
}

export async function onModal(interaction) {
  if (interaction.customId === 'vouch:chercher:modal') return chercherParTexte(interaction);
  if (interaction.customId !== 'vouch:modal') return;
  const message = interaction.fields.getTextInputValue('message').trim();
  const b = poser(interaction.user.id, { message });
  if (interaction.isFromMessage()) return interaction.update(rendre(b));
  return interaction.reply({ ...rendre(b), ...EPH });
}

async function publier(interaction, b) {
  const cible = b.cible ? store.getLink(b.cible) : null;
  if (!cible) return interaction.update(rendre(b, '❌ Le membre visé n\'est plus vérifié.'));
  const scam = b.verdict === 'neg';
  if (scam && b.message.length < MIN_SCAM) return interaction.update(rendre(b, `❌ Un signalement demande ${MIN_SCAM} caractères d'explication.`));
  if (!scam && !b.etoiles) return interaction.update(rendre(b, '❌ Choisissez une note.'));

  await interaction.deferUpdate();
  store.setVouch(interaction.user.id, cible.discord_id, scam ? -1 : 1, b.message || null, scam ? null : b.etoiles);
  const fil = await posterAvis(interaction.client, interaction.user.id, cible.discord_id)
    .catch((e) => { console.error('[vouch] publication :', e.message); return null; });
  brouillons.delete(String(interaction.user.id));

  const t = trustDe(cible.discord_id);
  const auteur = store.getLink(interaction.user.id)?.mc_name ?? interaction.user.tag;
  console.log(`[vouch] ${auteur} ${scam ? 'signale' : `vouch ${b.etoiles}★`} ${cible.mc_name} (score ${t.score})`);
  return interaction.editReply({
    embeds: [embed(scam ? '⚠️・SIGNALEMENT PUBLIÉ' : '✅・VOUCH PUBLIÉ', {
      couleur: scam ? FR.rouge : FR.vert,
      image: cible.mc_name,
      description: `Votre avis sur **${cible.mc_name}** est publié${fil ? ` dans ${fil}` : ''}.\n`
        + `${t.palier.emoji} ${t.palier.nom} · ${ligneScore(t)}`,
    })],
    components: [],
  });
}

async function supprimer(interaction) {
  const [, , fromId, toId] = interaction.customId.split(':');
  const staff = interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages);
  if (!staff && interaction.user.id !== fromId) return interaction.reply({ content: '❌ Réservé au staff.', ...EPH });
  await interaction.deferReply(EPH);
  const ok = await retirerAvis(interaction.client, fromId, toId);
  console.log(`[vouch] avis de ${fromId} sur ${toId} retire par ${interaction.user.tag}`);
  return interaction.editReply(ok ? '🗑️ Avis retiré, le score est recalculé.' : 'Cet avis n\'existe plus.');
}
