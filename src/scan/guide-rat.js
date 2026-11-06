// Guide anti-rat dans les tickets : quand un membre dit s etre fait « rat »
// (faux mod, faux client, grabber), le bot poste ce guide sous la reponse du
// support. Etapes a boutons, le message se met a jour sur place :
//   1. As-tu encore le fichier ?   2. L as-tu lance avec Minecraft ?
//   3. Conseils adaptes + liens directs (Microsoft) + scan DonutScan + denonciation.
// Seuls le membre du ticket et le staff peuvent cliquer.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder,
  TextInputBuilder, TextInputStyle, escapeMarkdown,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { store } from '../db.js';
import { estStaff } from '../tickets/manager.js';
import { memoire } from '../support/reglages.js';

const SITE = 'https://donutscan.org/fr/';
const MS_MDP = 'https://account.live.com/password/Change';
const MS_SECU = 'https://account.microsoft.com/security';
const titre = '🛡️・GUIDE ANTI-RAT';
const bouton = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const lien = (url, label, emoji) => {
  const b = new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link);
  return emoji ? b.setEmoji(emoji) : b;
};
const rang = (...b) => new ActionRowBuilder().addComponents(...b);

/** Etape 1 : poste sous la reponse du support. */
export function guideRat() {
  const e = embed(titre, {
    couleur: FR.jaune,
    image: 'aucune',
    description: 'On va voir ensemble ce qu’il faut faire, en 2 questions.\n\n**1. As-tu encore le fichier (le `.jar` ou le programme) ?**',
  });
  return { embeds: [e], components: [rang(bouton('rat:f:1', 'Oui, je l’ai encore', ButtonStyle.Primary, '📁'), bouton('rat:f:0', 'Non, je ne l’ai plus', ButtonStyle.Secondary, '🗑️'))] };
}

function etape2(fichier) {
  const e = embed(titre, {
    couleur: FR.jaune,
    image: 'aucune',
    description: `${fichier ? '✅ Tu as le fichier : garde-le, **sans l’ouvrir**, on pourra l’analyser.' : '👌 Pas de fichier, pas grave.'}\n\n**2. L’as-tu lancé (mis dans ton dossier mods et démarré Minecraft, ou ouvert le programme) ?**`,
  });
  return { embeds: [e], components: [rang(
    bouton(`rat:l:${fichier ? 1 : 0}:1`, 'Oui, je l’ai lancé', ButtonStyle.Danger, '⚠️'),
    bouton(`rat:l:${fichier ? 1 : 0}:0`, 'Non, jamais lancé', ButtonStyle.Success, '🙂'),
  )] };
}

function etape3(fichier, lance) {
  const lignes = [];
  if (lance) {
    lignes.push(
      '**⚠️ Fais tout ça depuis un AUTRE appareil (téléphone, autre PC), pas depuis le PC touché :**',
      '**1.** Change le mot de passe de ton **compte Microsoft** (c’est lui qui protège Minecraft), puis dans *Sécurité* → *Options de sécurité avancées*, clique sur **Se déconnecter partout**.',
      '**2.** Change ton mot de passe **Discord** (Paramètres → Mon compte) : ça déconnecte aussi le voleur. Active la **double authentification**.',
      '**3.** Change le mot de passe de ta **boîte mail**, puis de tout compte dont le mot de passe était enregistré dans ton navigateur.',
      '**4.** Sur le PC touché : supprime le fichier, fais une analyse complète avec ton antivirus. Le plus sûr reste de **réinitialiser Windows** (sauvegarde tes fichiers avant).',
      '**5.** Vérifie tes biens sur DonutSMP et préviens le staff ici si quelque chose a disparu.',
    );
  } else {
    lignes.push(
      '**Bonne nouvelle : un mod jamais lancé ne peut rien faire.**',
      `**1.** ${fichier ? 'Ne l’ouvre pas. Scanne-le pour savoir ce qu’il contenait, puis supprime-le.' : 'S’il traîne encore dans ton dossier mods ou tes téléchargements, supprime-le.'}`,
      '**2.** Si on te renvoie un mod ou un client, scanne-le avant de le lancer.',
    );
  }
  lignes.push('', '**Dernière étape : dis-nous qui te l’a envoyé** avec le bouton 🚨 et joins tes **preuves** (captures des messages, clip Medal) : le staff les vérifie avant de sanctionner.');
  const e = embed(titre, { couleur: lance ? FR.rouge : FR.vert, image: 'aucune', description: lignes.join('\n') });
  const rangs = [];
  if (lance) rangs.push(rang(lien(MS_MDP, 'Changer mon mot de passe Microsoft', '🔑'), lien(MS_SECU, 'Sécurité Microsoft', '🛡️')));
  rangs.push(rang(
    ...(fichier ? [bouton(`scan:start:${lance ? 1 : 0}`, 'Scanner le fichier', ButtonStyle.Primary, '🔍')] : []),
    bouton('rat:denoncer', 'Dénoncer l’envoyeur', ButtonStyle.Danger, '🚨'),
    lien(SITE, fichier ? 'Plus de 25 Mo ? donutscan.org' : 'donutscan.org'),
  ));
  return { embeds: [e], components: rangs };
}

function autorise(interaction) {
  const t = store.getTicket(interaction.channelId);
  return !t || t.discord_id === interaction.user.id || estStaff(interaction.member);
}

export async function onBoutonRat(interaction) {
  if (!autorise(interaction)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Ce guide est réservé à la personne qui a ouvert le ticket.' });
  }
  const p = interaction.customId.split(':');
  if (p[1] === 'f') return interaction.update(etape2(p[2] === '1'));
  if (p[1] === 'l') {
    const fichier = p[2] === '1'; const lance = p[3] === '1';
    memoire.noter({ id: `${interaction.id}`, channelId: interaction.channelId, role: 'membre', at: Date.now(),
      content: `[Guide anti-rat : le membre ${fichier ? 'a encore' : 'n’a plus'} le fichier et ${lance ? 'l’a LANCÉ' : 'ne l’a jamais lancé'}.]` });
    return interaction.update(etape3(fichier, lance));
  }
  if (p[1] === 'denoncer') {
    const champ = (id, label, desc, style, requis, max) => new LabelBuilder().setLabel(label).setDescription(desc)
      .setTextInputComponent(new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(requis).setMaxLength(max));
    const modal = new ModalBuilder().setCustomId('rat:modal').setTitle('Dénoncer l’envoyeur').addLabelComponents(
      champ('discord', 'Son Discord', 'Pseudo, mention ou ID Discord', TextInputStyle.Short, false, 100),
      champ('mc', 'Son pseudo Minecraft', 'Si tu le connais', TextInputStyle.Short, false, 40),
      champ('comment', 'Comment tu l’as reçu, et quand', 'MP, salon, lien, vocal… et la date', TextInputStyle.Paragraph, true, 600),
      // Preuves obligatoires : sans elles le staff ne peut pas sanctionner.
      new LabelBuilder().setLabel('Tes preuves (captures, vidéo)').setDescription('Captures des messages où il t’envoie le fichier. Jamais le fichier lui-même.')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('preuves').setMinValues(1).setMaxValues(10).setRequired(true)),
      champ('clips', 'Liens de clips (Medal, YouTube…)', 'Facultatif, un lien par ligne', TextInputStyle.Paragraph, false, 500),
    );
    return interaction.showModal(modal);
  }
}

export async function onModalRat(interaction) {
  const v = (id) => { try { return String(interaction.fields.getTextInputValue(id) ?? '').trim(); } catch { return ''; } };
  const discord = v('discord'); const mc = v('mc'); const comment = v('comment');
  const clips = v('clips').split(/\s+/).filter((u) => /^https:\/\/\S+$/i.test(u)).slice(0, 5);
  const preuves = [...(interaction.fields.getUploadedFiles('preuves')?.values() ?? [])];
  if (!discord && !mc) return interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Il faut au moins son Discord ou son pseudo Minecraft.' });
  // Pas de jar ni d executable parmi les preuves : on ne fait jamais circuler le fichier piege.
  const interdits = preuves.filter((f) => /\.(jar|exe|dll|bat|cmd|ps1|scr|msi|zip|rar|7z)$/i.test(f.name));
  if (interdits.length) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Envoie seulement des captures ou des vidéos, jamais le fichier lui-même. Pour l’analyser, utilise le bouton « Scanner le fichier ».' });
  await interaction.deferReply();
  const e = embed('🚨・ENVOYEUR DÉNONCÉ', { couleur: FR.rouge, image: 'aucune' }).addFields(
    { name: 'Discord', value: discord ? escapeMarkdown(discord).slice(0, 200) : '?', inline: true },
    { name: 'Minecraft', value: mc ? escapeMarkdown(mc).slice(0, 60) : '?', inline: true },
    { name: 'Comment / quand', value: escapeMarkdown(comment).slice(0, 1000) },
    { name: 'Preuves', value: `${preuves.length} fichier(s) joint(s)${clips.length ? `\n${clips.map((u) => `<${u}>`).join('\n')}` : ''}`.slice(0, 1000) },
  ).setFooter({ text: 'Preuves à valider par le staff avant toute sanction.' });
  // Les preuves sont repostees dans le ticket (les liens d upload d un formulaire expirent) ;
  // trop lourdes pour le bot : on garde au moins le lien.
  let jointes = preuves.map((f) => ({ attachment: f.url, name: f.name }));
  try {
    await interaction.editReply({ embeds: [e], files: jointes, allowedMentions: { parse: [] } });
  } catch {
    jointes = [];
    e.spliceFields(3, 1, { name: 'Preuves', value: preuves.map((f) => `[${escapeMarkdown(f.name)}](${f.url})`).concat(clips.map((u) => `<${u}>`)).join('\n').slice(0, 1000) || '?' });
    await interaction.editReply({ embeds: [e], allowedMentions: { parse: [] } });
  }
  memoire.noter({ id: `${interaction.id}`, channelId: interaction.channelId, role: 'membre', at: Date.now(), pieces: preuves.length,
    content: `[Formulaire « dénoncer l’envoyeur » : Discord = ${discord || '?'} ; Minecraft = ${mc || '?'} ; reçu : ${comment} ; preuves : ${preuves.length} fichier(s)${clips.length ? ` + ${clips.length} lien(s) de clip` : ''}. Les preuves sont fournies, ne les redemande pas.]` });
  console.log(`[scan] guide rat : envoyeur denonce dans #${interaction.channel?.name ?? interaction.channelId} (${preuves.length} preuve(s))`);
  const { replanifier } = await import('../support/agent.js');
  replanifier?.(interaction.channelId);
}
