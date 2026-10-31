import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits, LabelBuilder, FileUploadBuilder,
  AttachmentBuilder, EmbedBuilder,
} from 'discord.js';
import { store } from '../db.js';
import { journal } from '../ops/journal.js';
import { settings, ouSeLier } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { etoiles, barre, ligneScore } from './trust.js';
import { trustDe, posterAvis, retirerAvis, carteReputation, filDe, fichiersDe } from './fils.js';
import { isValidName, bypass } from '../lib/names.js';
import { config } from '../config.js';
import { lireLienMedal } from './video.js';
import { reglagesTickets } from '../tickets/reglages.js';

// /vouch sans argument : UN message prive qui se remplit en quatre clics.
// Le brouillon vit en memoire par membre ; rien ne part avant « Publier ».

const EPH = { flags: MessageFlags.Ephemeral };
const MIN_ANCIENNETE_MS = 24 * 3_600_000;
const MIN_SCAM = 20;
const MAX_PREUVES = 5;
const MAX_OCTETS = 8 * 1024 * 1024;
// Anti-farm : au-dela, un membre attend avant de publier un NOUVEL avis
// (modifier un avis existant reste libre).
const MAX_AVIS_JOUR = 10;
// Deux vouches croises en moins de 48 h : signale au staff (farm d alts).
const CROISE_MS = 48 * 3_600_000;

const brouillons = new Map();
const brouillon = (id) => brouillons.get(String(id)) ?? { cible: null, verdict: null, etoiles: null, message: '', preuves: [], video: null };
const poser = (id, patch) => { brouillons.set(String(id), { ...brouillon(id), ...patch, a: Date.now() }); return brouillon(id); };

// Un brouillon abandonne gardait ses preuves (jusqu a 5 x 8 Mo) en memoire
// jusqu au redemarrage. Au bout de 30 min sans geste, il part.
const BROUILLON_MAX_MS = 30 * 60_000;
setInterval(() => {
  const limite = Date.now() - BROUILLON_MAX_MS;
  for (const [id, b] of brouillons) if ((b.a ?? 0) < limite) brouillons.delete(id);
}, 5 * 60_000).unref();

// Une preuve est une capture ou une video du trade : pas un fichier quelconque.
const estPreuve = (a) => /^(image|video)\//.test(a.contentType ?? '')
  || /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i.test(a.name ?? '');

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

const estImageNom = (n) => /\.(png|jpe?g|gif|webp)$/i.test(n ?? '');
function ligneFichiers(preuves) {
  const img = preuves.filter((f) => estImageNom(f.name)).length;
  const vid = preuves.length - img;
  return [img && `${img} image${img > 1 ? 's' : ''} (aperçu ci-dessous)`, vid && `${vid} vidéo${vid > 1 ? 's' : ''}`].filter(Boolean).join(', ');
}

/**
 * Met a jour le panneau. Avec des preuves jointes, le renvoi des fichiers
 * depasse souvent les 3 s de Discord : on accuse reception d abord.
 */
async function maj(interaction, payload) {
  if (!payload.files?.length) return interaction.update(payload);
  await interaction.deferUpdate();
  return interaction.editReply(payload);
}

export function rendre(b, note = '') {
  const cible = b.cible ? store.getLink(b.cible) : null;
  const t = cible ? trustDe(cible.discord_id) : null;
  const scam = b.verdict === 'neg';
  // Un signalement sans preuve suffisait a faire passer n importe qui en ☠️
  // (deux alts, vingt caracteres chacun) : la capture est obligatoire.
  const complet = cible && b.verdict
    && (scam ? b.message.length >= MIN_SCAM && ((b.preuves?.length ?? 0) > 0 || Boolean(b.video)) : b.etoiles);

  let description = '**Notez un membre avec qui vous avez tradé.**\n';
  if (!cible) description += '\n1️⃣ Choisissez le membre ci-dessous.';
  else {
    description += `\n**${cible.mc_name}** · <@${cible.discord_id}>\n`
      + `${t.palier.emoji} ${t.palier.nom} · ${ligneScore(t)} · ${t.n} avis\n\n`
      + `2️⃣ Verdict : ${b.verdict ? (scam ? '⚠️ **Signalement**' : '✅ **Vouch**') : '*à choisir*'}\n`
      + `3️⃣ Note : ${scam ? '*sans objet pour un signalement*' : b.etoiles ? `**${etoiles(b.etoiles)}**` : '*à choisir*'}\n`
      + `4️⃣ Message : ${b.message ? `\n> ${b.message.replace(/\n/g, '\n> ')}` : scam ? `*obligatoire, ${MIN_SCAM} caractères minimum*` : '*facultatif*'}`
      + `\n📎 Preuves : ${b.preuves?.length ? ligneFichiers(b.preuves) : b.video ? '*aucun fichier*' : scam ? '*obligatoire : au moins une capture, une vidéo ou un clip Medal*' : '*aucune*'}`
      + (b.video ? `\n🎬 Clip Medal : ${b.video}` : '');
  }
  if (note) description += `\n\n${note}`;

  const contenu = embed('⭐・DONNER UN AVIS', {
    couleur: scam ? FR.rouge : b.verdict ? FR.vert : FR.bleu,
    image: cible?.mc_name ?? 'logo',
    description,
  });

  // Les preuves s'affichent en vrai (aperçus) au lieu d'une liste de noms de fichiers.
  const embeds = [contenu];
  const images = (b.preuves ?? []).filter((f) => estImageNom(f.name));
  if (images.length) {
    contenu.setImage(`attachment://${images[0].name}`);
    for (const f of images.slice(1)) embeds.push(new EmbedBuilder().setColor(contenu.data.color).setImage(`attachment://${f.name}`));
  }
  const pj = { files: [...(b.preuves ?? [])], attachments: [] };

  const choix = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('vouch:cible').setPlaceholder('👤 Le membre à noter'),
  );
  if (!cible) return { embeds, components: [choix], ...pj };

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
      .setDisabled(scam)),
  );
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vouch:message').setLabel(b.message ? 'Modifier le message' : 'Écrire un message')
      .setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(!b.verdict),
    // La cible voyage dans le bouton : un vieux panneau ouvert sur un autre
    // membre ne peut plus publier le brouillon courant a sa place.
    new ButtonBuilder().setCustomId(`vouch:publier:${b.cible}`).setLabel('Publier').setEmoji('📣')
      .setStyle(ButtonStyle.Success).setDisabled(!complet),
    new ButtonBuilder().setCustomId('vouch:annuler').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );
  return { embeds, components: [choix, verdict, notes, actions], ...pj };
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
      + 'Un signalement demande une explication **et une capture du trade**, et le staff peut retirer un avis abusif.\n\n'
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
  // Creer le post peut enchainer plusieurs appels API : on prend le delai de
  // 15 min de Discord au lieu des 3 s d une reponse directe.
  await interaction.deferReply(EPH);
  return montrerCarte(interaction, link, { differe: true });
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


export async function ouvrir(interaction, cibleId = null) {
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

  // Depuis le bouton d un post : le joueur est deja choisi, memes garde-fous
  // que par le menu.
  if (cibleId) {
    if (cibleId === interaction.user.id) return interaction.reply({ content: '❌ On ne se note pas soi-même.', ...EPH });
    const cible = store.getLink(cibleId);
    if (!cible) {
      return interaction.reply({
        content: `❌ <@${cibleId}> n'a pas lié son compte Minecraft : seuls les membres vérifiés (\`/link\`) ont une réputation et peuvent être notés.`,
        ...EPH,
      });
    }
    const existant = store.getVouch(interaction.user.id, cibleId);
    poser(interaction.user.id, { cible: cibleId });
    return interaction.reply({ ...(existant ? vueExistant(existant, cible) : rendre(brouillon(interaction.user.id))), ...EPH });
  }
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
  if (id === interaction.user.id) return maj(interaction, rendre(b, '❌ On ne se note pas soi-même.'));
  const cible = store.getLink(id);
  if (!cible) return maj(interaction, rendre(b, `❌ <@${id}> n'a pas de compte vérifié : seuls les membres link peuvent être notés.`));
  const existant = store.getVouch(interaction.user.id, id);
  if (existant) {
    // Garde-fou : un avis existe deja, on ne le remplace pas sans le dire.
    poser(interaction.user.id, { cible: id, verdict: null, etoiles: null, message: '', preuves: [], video: null });
    return interaction.update(vueExistant(existant, cible));
  }
  return maj(interaction, rendre(poser(interaction.user.id, { cible: id })));
}

function vueExistant(existant, cible) {
  const positif = existant.value > 0;
  const contenu = embed(positif ? '✅・VOUS AVEZ DÉJÀ VOUCH CE JOUEUR' : '⚠️・VOUS AVEZ DÉJÀ SIGNALÉ CE JOUEUR', {
    couleur: positif ? FR.vert : FR.rouge,
    image: cible.mc_name,
    description:
      `Votre avis sur **${cible.mc_name}** existe déjà, publié <t:${Math.floor(existant.created_at / 1000)}:R> :\n`
      + `${positif ? etoiles(existant.stars ?? 5) : '⚠️ Signalement'}`
      + (existant.comment ? `\n> ${existant.comment.replace(/\n/g, '\n> ')}` : '')
      + '\n\nUn seul avis par joueur. Vous pouvez le **modifier** (il sera remplacé) ou le **supprimer**.',
  });
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vouch:existant:modifier').setLabel('Modifier').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('vouch:existant:supprimer').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('vouch:annuler').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [contenu], components: [boutons] };
}

export async function onBouton(interaction) {
  const id = interaction.customId;
  if (id.startsWith('vouch:suppr:')) return supprimer(interaction);
  if (id === 'vouch:ouvrir') return ouvrir(interaction);
  if (id.startsWith('vouch:noter:')) return ouvrir(interaction, id.slice('vouch:noter:'.length));
  if (id === 'vouch:chercher:mc') return interaction.showModal(modalRecherche());

  const b = brouillon(interaction.user.id);
  if (id === 'vouch:annuler') {
    brouillons.delete(String(interaction.user.id));
    return interaction.update({ embeds: [embed('⭐・DONNER UN AVIS', { description: 'Avis annulé, rien n\'a été publié.' })], components: [], attachments: [] });
  }
  if (id === 'vouch:existant:modifier') {
    const existant = b.cible ? store.getVouch(interaction.user.id, b.cible) : null;
    if (!existant) return maj(interaction, rendre(b));
    return maj(interaction, rendre(poser(interaction.user.id, {
      verdict: existant.value > 0 ? 'pos' : 'neg',
      etoiles: existant.stars ?? null,
      message: existant.comment ?? '',
    }), 'ℹ️ Publier remplacera votre avis précédent.'));
  }
  if (id === 'vouch:existant:supprimer') {
    await interaction.deferUpdate();
    const ok = b.cible ? await retirerAvis(interaction.client, interaction.user.id, b.cible) : false;
    const cible = b.cible ? store.getLink(b.cible) : null;
    brouillons.delete(String(interaction.user.id));
    console.log(`[vouch] ${interaction.user.tag} retire son avis sur ${cible?.mc_name ?? b.cible}`);
    return interaction.editReply({
      embeds: [embed('🗑️・AVIS SUPPRIMÉ', {
        couleur: FR.jaune, image: cible?.mc_name ?? 'aucune',
        description: ok ? `Votre avis sur **${cible?.mc_name}** est retiré, son score est recalculé.` : 'Cet avis n\'existait plus.',
      })],
      components: [],
    });
  }
  if (id.startsWith('vouch:verdict:')) {
    const verdict = id.slice('vouch:verdict:'.length);
    return maj(interaction, rendre(poser(interaction.user.id, { verdict, etoiles: verdict === 'neg' ? null : b.etoiles })));
  }
  if (id.startsWith('vouch:etoile:')) {
    // Une etoile vaut un vouch : pas besoin de cliquer « Vouch » avant.
    return maj(interaction, rendre(poser(interaction.user.id, { verdict: 'pos', etoiles: Number(id.slice('vouch:etoile:'.length)) })));
  }
  if (id === 'vouch:message') {
    const scam = b.verdict === 'neg';
    const champ = new TextInputBuilder().setCustomId('message')
      .setStyle(TextInputStyle.Paragraph).setRequired(scam).setMaxLength(280);
    if (scam) champ.setMinLength(MIN_SCAM);
    // Une valeur vide sur un champ a minimum est refusee par Discord (vecu) :
    // on ne pre-remplit que s il y a deja un message.
    if (b.message) champ.setValue(b.message);
    const modal = new ModalBuilder().setCustomId('vouch:modal').setTitle(scam ? 'Que s\'est-il passé ?' : 'Votre message')
      .addLabelComponents(
        new LabelBuilder().setLabel(scam ? 'Décrivez le scam, avec des faits' : 'Un mot sur le trade').setTextInputComponent(champ),
        new LabelBuilder().setLabel('Clip Medal (facultatif)')
          .setDescription('Lien medal.tv du clip, pour une vidéo trop lourde pour Discord.')
          .setTextInputComponent(new TextInputBuilder().setCustomId('video').setStyle(TextInputStyle.Short).setRequired(false)
            .setMaxLength(300).setPlaceholder('https://medal.tv/games/minecraft/clips/...')
            .setValue(b.video ?? '')),
        // Discord refuse un libelle de plus de 45 caracteres (vecu le 31/10).
        new LabelBuilder().setLabel(scam ? 'Preuves (obligatoires, ou un clip Medal)' : 'Preuves (captures, vidéos)')
          .setDescription(`Images ou vidéos, jusqu'à ${MAX_PREUVES} fichiers de 8 Mo. ${b.preuves?.length ? 'Un nouvel envoi remplace les précédentes.' : ''}`.trim())
          .setFileUploadComponent(new FileUploadBuilder().setCustomId('preuves').setMinValues(0).setMaxValues(MAX_PREUVES).setRequired(false)),
      );
    return interaction.showModal(modal);
  }
  if (id.startsWith('vouch:publier')) {
    const vise = id.slice('vouch:publier:'.length);
    if (vise && vise !== String(b.cible)) {
      return maj(interaction, rendre(b, '⚠️ Ce panneau était ouvert sur un autre membre : voici votre avis en cours. Vérifiez-le avant de publier.'));
    }
    return publier(interaction, b);
  }
}

export async function onModal(interaction) {
  if (interaction.customId === 'vouch:chercher:modal') return chercherParTexte(interaction);
  if (interaction.customId !== 'vouch:modal') return;
  const message = interaction.fields.getTextInputValue('message').trim();
  // Champ absent d un formulaire ouvert avant la mise a jour : pas d erreur.
  let videoSaisie = '';
  try { videoSaisie = interaction.fields.getTextInputValue('video')?.trim() ?? ''; } catch { /* ancien formulaire */ }
  const video = lireLienMedal(videoSaisie);
  const noteVideo = videoSaisie && !video ? '\n⚠️ Le lien vidéo doit être un clip Medal (medal.tv/.../clips/...), ignoré.' : '';

  // Les fichiers du formulaire ont une URL a duree de vie courte : on les
  // telecharge tout de suite, la carte publiee en sera la copie durable.
  const envoyes = [...(interaction.fields.getUploadedFiles('preuves', false)?.values() ?? [])];
  let note = '';
  let preuves = brouillon(interaction.user.id).preuves ?? [];
  if (envoyes.length) {
    if (interaction.isFromMessage()) await interaction.deferUpdate(); else await interaction.deferReply(EPH);
    preuves = [];
    for (const a of envoyes.slice(0, MAX_PREUVES)) {
      if ((a.size ?? 0) > MAX_OCTETS) { note += `\n⚠️ \`${a.name}\` dépasse 8 Mo, ignoré.`; continue; }
      if (!estPreuve(a)) { note += `\n⚠️ \`${a.name}\` n'est ni une image ni une vidéo, ignoré.`; continue; }
      const res = await fetch(a.url).catch(() => null);
      if (!res?.ok) { note += `\n⚠️ \`${a.name}\` n'a pas pu être récupéré.`; continue; }
      // Nom propre : les noms iPhone (« image_… », espaces, accents) cassent attachment://.
      const ext = (a.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? (a.contentType ?? '').split('/')[1] ?? 'png').toLowerCase();
      preuves.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name: `preuve-${preuves.length + 1}.${ext}` }));
    }
    const b = poser(interaction.user.id, { message, preuves, video });
    return interaction.editReply(rendre(b, (note + noteVideo).trim()));
  }
  // Les preuves deja jointes sont renvoyees avec le panneau (jusqu a 5 x 8 Mo) :
  // l envoi depasse souvent les 3 s que Discord laisse pour repondre
  // (« Unknown interaction », vecu le 31/10). On accuse reception d abord.
  if (interaction.isFromMessage()) await interaction.deferUpdate(); else await interaction.deferReply(EPH);
  const b = poser(interaction.user.id, { message, preuves, video });
  return interaction.editReply(rendre(b, noteVideo.trim()));
}

async function publier(interaction, b) {
  const cible = b.cible ? store.getLink(b.cible) : null;
  if (!cible) return maj(interaction, rendre(b, '❌ Le membre visé n\'est plus vérifié.'));
  const scam = b.verdict === 'neg';
  if (scam && b.message.length < MIN_SCAM) return maj(interaction, rendre(b, `❌ Un signalement demande ${MIN_SCAM} caractères d'explication.`));
  if (scam && !(b.preuves?.length) && !b.video) return maj(interaction, rendre(b, '❌ Un signalement demande au moins une capture, une vidéo ou un clip Medal du trade.'));
  if (!scam && !b.etoiles) return maj(interaction, rendre(b, '❌ Choisissez une note.'));

  const nouveau = !store.getVouch(interaction.user.id, cible.discord_id);
  if (nouveau && !bypass(interaction.member, config) && store.vouchCountFromSince(interaction.user.id, Date.now() - 86_400_000) >= MAX_AVIS_JOUR) {
    return maj(interaction, rendre(b, `⏳ ${MAX_AVIS_JOUR} avis en 24 h, c'est le maximum. Réessayez demain, votre brouillon reste ici 30 min.`));
  }

  await interaction.deferUpdate();
  store.setVouch(interaction.user.id, cible.discord_id, scam ? -1 : 1, b.message || null, scam ? null : b.etoiles);
  store.setVouchVideo(interaction.user.id, cible.discord_id, b.video);
  const fil = await posterAvis(interaction.client, interaction.user.id, cible.discord_id, { fichiers: b.preuves ?? [] })
    .catch((e) => { console.error('[vouch] publication :', e.message); return null; });
  brouillons.delete(String(interaction.user.id));

  const t = trustDe(cible.discord_id);
  const auteur = store.getLink(interaction.user.id)?.mc_name ?? interaction.user.tag;
  if (scam) prevenirSignale(interaction, cible, auteur, b.message, fil).catch((e) => console.warn('[vouch] MP :', e.message));
  else if (nouveau) prevenirVouch(interaction.client, cible, auteur, b.etoiles, t, fil).catch(() => {});
  const retour = !scam && store.getVouch(cible.discord_id, interaction.user.id);
  if (retour && retour.value > 0 && Date.now() - retour.created_at < CROISE_MS) {
    journal({
      niveau: 'warn',
      titre: 'Vouches croisés',
      texte: `**${auteur}** et **${cible.mc_name}** se sont vouch mutuellement en moins de 48 h : vérifier que ce ne sont pas des alts.`,
      champs: { A: auteur, B: cible.mc_name },
      joueur: cible.mc_name,
    });
  }
  console.log(`[vouch] ${auteur} ${scam ? 'signale' : `vouch ${b.etoiles}★`} ${cible.mc_name} (score ${t.score})`);
  journal(scam
    ? {
      niveau: 'warn',
      titre: 'Signalement',
      texte: `**${auteur}** signale **${cible.mc_name}**.`,
      champs: { Auteur: auteur, Cible: cible.mc_name, Score: `${t.score}/100` },
      joueur: cible.mc_name,
    }
    : {
      niveau: 'info',
      titre: 'Nouvel avis',
      texte: `**${auteur}** note **${cible.mc_name}** ${etoiles(b.etoiles)}`,
      champs: { Auteur: auteur, Cible: cible.mc_name, Score: `${t.score}/100` },
      joueur: cible.mc_name,
    });
  return interaction.editReply({
    embeds: [embed(scam ? '⚠️・SIGNALEMENT PUBLIÉ' : '✅・VOUCH PUBLIÉ', {
      couleur: scam ? FR.rouge : FR.vert,
      image: cible.mc_name,
      description: `Votre avis sur **${cible.mc_name}** est publié${fil ? ` dans ${fil}` : ''}.\n`
        + `${t.palier.emoji} ${t.palier.nom} · ${ligneScore(t)}`,
    })],
    components: fil ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Voir le profil de ${cible.mc_name}`).setEmoji('👀').setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${fil.guildId}/${fil.id}`),
    )] : [],
    attachments: [], // les apercus du brouillon disparaissent avec lui
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

// ---------------------------------------------------------------------------
// Un signalement n est jamais silencieux : la personne visee le recoit en MP
// avec de quoi le contester, un bouton vers le salon des tickets.
// ---------------------------------------------------------------------------

async function prevenirSignale(interaction, cible, auteur, message, fil) {
  const vouch = store.getVouch(interaction.user.id, cible.discord_id);
  return envoyerMpSignale(interaction.client, { guildId: interaction.guildId, cible, vouch, auteur, fil });
}

/** MP discret a la personne vouch : elle sait que son profil monte. */
async function prevenirVouch(client, cible, auteur, nb, t, fil) {
  const user = await client.users.fetch(cible.discord_id);
  const lien = fil ? `\n[Voir mon profil](https://discord.com/channels/${fil.guildId}/${fil.id})` : '';
  await user.send({ embeds: [embed('⭐・NOUVEAU VOUCH', {
    couleur: FR.vert,
    image: cible.mc_name,
    description: `**${auteur}** vous a laissé ${etoiles(nb)} sur **${cible.mc_name}**.\n`
      + `${t.palier.emoji} ${t.palier.nom} · ${ligneScore(t)} · ${t.n} avis${lien}`,
  })] });
}

/** Le MP de signalement, reutilisable par les scripts admin. */
export async function envoyerMpSignale(client, { guildId, cible, vouch, auteur, fil = null }) {
  const message = vouch.comment ?? '';
  if (!fil) {
    const connu = store.getThread(cible.discord_id);
    fil = connu ? await client.channels.fetch(connu.thread_id).catch(() => null) : null;
  }
  const lienCarte = fil && vouch?.message_id ? `https://discord.com/channels/${guildId}/${fil.id}/${vouch.message_id}` : null;
  const salonTickets = reglagesTickets.salonPanneau();
  // Les preuves voyagent avec le MP, en pieces jointes telechargeables :
  // reprises sur la carte publiee, dont les liens sont frais au fetch.
  const carte = fil && vouch?.message_id ? await fil.messages.fetch(vouch.message_id).catch(() => null) : null;
  const files = carte ? await fichiersDe(carte) : [];

  const contenu = embed('⚠️・VOUS AVEZ ÉTÉ SIGNALÉ', {
    couleur: FR.rouge,
    image: cible.mc_name,
    description:
      `**${auteur}** <@${vouch.from_id}> a publié un signalement de scam sur votre profil **${cible.mc_name}**.\n`
      + `> ${message.replace(/\n/g, '\n> ')}\n`
      + (files.length ? `📎 ${files.length} preuve(s) jointe(s), ci-dessous\n` : '')
      + '\nSi vous estimez ce signalement injustifié, **ouvrez un ticket** : le staff examinera les preuves des deux côtés '
      + 'et pourra retirer l\'avis. Un signalement pèse lourd dans votre trust score, ne le laissez pas sans réponse.',
  });
  const boutons = new ActionRowBuilder();
  if (salonTickets) {
    boutons.addComponents(new ButtonBuilder().setLabel('Contester dans #tickets').setEmoji('📩').setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${salonTickets}`));
  }
  if (lienCarte) {
    boutons.addComponents(new ButtonBuilder().setLabel('Voir le signalement').setEmoji('👀').setStyle(ButtonStyle.Link).setURL(lienCarte));
  }
  // Les preuves voyagent avec le MP, en pieces jointes telechargeables :
  // reprises sur la carte publiee, dont les liens sont frais au fetch.
  const user = await client.users.fetch(cible.discord_id);
  await user.send({ embeds: [contenu], components: boutons.components.length ? [boutons] : [], files });
  console.log(`[vouch] ${cible.mc_name} prevenu en MP du signalement`);
}
