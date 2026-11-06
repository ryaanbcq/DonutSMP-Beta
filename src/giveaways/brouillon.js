// /gcreate = panneau de creation, dans le style des panneaux de config du bot
// (Ryan, 06/11) : un embed recapitulatif prive, des menus (roles requis, roles
// bonus +1 et +2 cumulables, salon) et des boutons qui ouvrent les formulaires
// (lot, duree, gagnants ; description, image). « Lancer » publie.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, MessageFlags,
  ModalBuilder, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, FileUploadBuilder,
} from 'discord.js';
import { storeAttachment } from './commands.js';
import { embed, FR } from '../lib/brand.js';
import { startGiveaway } from './service.js';
import { parseDuration } from './outils/format.js';
import { MAX_GIVEAWAY_MS, MAX_WINNERS } from './rules.js';

const brouillons = new Map(); // userId -> brouillon
const VIE_MS = 60 * 60_000;
const EPH = { flags: MessageFlags.Ephemeral };

function nettoyer() {
  const t = Date.now();
  for (const [k, b] of brouillons) if (t - b.at > VIE_MS) brouillons.delete(k);
}

/** Roles bonus par defaut : ceux de /gsettings (au-dela de +2, ranges en +2). */
function bonusDefaut(ctx, guildId) {
  const b = { 1: [], 2: [] };
  for (const e of ctx.settings.get(guildId).giveaways.bonusEntries ?? []) b[(e.entries ?? 2) >= 3 ? 2 : 1].push(e.roleId);
  return b;
}

const roles = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : '*personne*');

export function panneau(b, note = '') {
  const pret = Boolean(b.prize && b.dureeMs);
  const lignes = [
    `🎁 **Lot** · ${b.prize ? `**${b.prize}**` : '*à définir*'}`,
    `🏆 **Gagnants** · ${b.winners}`,
    `⏱️ **Durée** · ${b.dureeTexte ?? '*à définir*'}`,
    `📍 **Salon** · <#${b.channelId}>`,
    `📝 **Description** · ${b.description ? b.description.slice(0, 200) : '*aucune*'}`,
    `🖼️ **Image** · ${b.image ? '✅ envoyée' : '*aucune*'} · **Miniature** · ${b.thumbnail ? '✅ envoyée' : '*aucune*'}`,
    '',
    `🔒 **Rôle requis** · ${roles(b.requis)}`,
    `➕ **+1 entrée** · ${roles(b.bonus[1])}`,
    `➕ **+2 entrées** · ${roles(b.bonus[2])}`,
    '',
    '-# Les bonus s\'additionnent : un membre qui a deux rôles bonus cumule les deux.',
  ];
  const e = embed('🎉・NOUVEAU GIVEAWAY', {
    couleur: pret ? FR.vert : FR.bleu,
    description: `${lignes.join('\n')}${note ? `\n\n${note}` : ''}`,
  });

  const menuRoles = (id, placeholder, defauts, max) => {
    const m = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(0).setMaxValues(max);
    if (defauts.length) m.setDefaultRoles(...defauts.slice(0, max));
    return new ActionRowBuilder().addComponents(m);
  };
  const salon = new ChannelSelectMenuBuilder().setCustomId('gdraft:salon').setPlaceholder('📍 Salon du giveaway')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)
    .setDefaultChannels(b.channelId);
  return {
    embeds: [e],
    components: [
      menuRoles('gdraft:requis', '🔒 Rôle(s) requis pour participer', b.requis, 5),
      menuRoles('gdraft:b1', '➕ Rôles bonus : +1 entrée', b.bonus[1], 10),
      menuRoles('gdraft:b2', '➕ Rôles bonus : +2 entrées', b.bonus[2], 10),
      new ActionRowBuilder().addComponents(salon),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gdraft:infos').setLabel('Lot et durée').setEmoji('🎁').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('gdraft:texte').setLabel('Description et images').setEmoji('📝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('gdraft:go').setLabel('Lancer').setEmoji('🎉').setStyle(ButtonStyle.Success).setDisabled(!pret),
        new ButtonBuilder().setCustomId('gdraft:cancel').setLabel('Annuler').setStyle(ButtonStyle.Danger),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** /gcreate : ouvre le panneau, deja rempli avec les reglages par defaut. */
export function ouvrirPanneau(interaction, ctx) {
  nettoyer();
  const b = {
    prize: '', winners: 1, dureeMs: 86_400_000, dureeTexte: '1d', description: '', image: '', thumbnail: '',
    channelId: interaction.channelId, requis: [], bonus: bonusDefaut(ctx, interaction.guildId), at: Date.now(),
  };
  brouillons.set(interaction.user.id, b);
  return interaction.reply({ ...panneau(b, 'Commence par **🎁 Lot et durée**.'), ...EPH });
}

const champ = (id, label, style, requis, valeur, max, placeholder) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(requis).setMaxLength(max);
  if (placeholder) t.setPlaceholder(placeholder);
  if (valeur) t.setValue(String(valeur));
  return new ActionRowBuilder().addComponents(t);
};

/** Menus, boutons et formulaires gdraft:* */
export async function surBrouillon(interaction, ctx) {
  const b = brouillons.get(interaction.user.id);
  const expire = () => interaction.isModalSubmit() || interaction.isMessageComponent()
    ? interaction.update({ embeds: [], content: '⌛ Panneau expiré : relance `/gcreate`.', components: [] })
    : null;
  if (!b) return expire();
  b.at = Date.now();
  const quoi = interaction.customId.slice('gdraft:'.length);

  if (quoi === 'infos') {
    return interaction.showModal(new ModalBuilder().setCustomId('gdraft:m:infos').setTitle('Lot et durée').addComponents(
      champ('prize', 'Lot à gagner', TextInputStyle.Short, true, b.prize, 256, 'Elytra, 500M, Nitro…'),
      champ('duration', 'Durée', TextInputStyle.Short, true, b.dureeTexte, 20, '30m, 2h, 3d, 1w'),
      champ('winners', 'Nombre de gagnants', TextInputStyle.Short, true, b.winners, 3, '1'),
    ));
  }
  if (quoi === 'texte') {
    // Images envoyees en fichier depuis l ordinateur ou le telephone (Ryan, 06/11), gardees par le bot.
    const upload = (id) => new FileUploadBuilder().setCustomId(id).setMinValues(0).setMaxValues(1).setRequired(false);
    const desc = new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
      .setPlaceholder('Conditions, détails…');
    if (b.description) desc.setValue(b.description);
    return interaction.showModal(new ModalBuilder().setCustomId('gdraft:m:texte').setTitle('Description et images').addLabelComponents(
      new LabelBuilder().setLabel('Description (facultatif)').setTextInputComponent(desc),
      new LabelBuilder().setLabel('Grande image (facultatif)').setDescription('PNG, JPG, GIF ou WEBP, 8 Mo max. Vide = on garde l\'actuelle.').setFileUploadComponent(upload('image')),
      new LabelBuilder().setLabel('Miniature en haut à droite (facultatif)').setDescription('Vide = on garde l\'actuelle.').setFileUploadComponent(upload('thumbnail')),
    ));
  }
  if (quoi === 'm:infos') {
    const v = (id) => interaction.fields.getTextInputValue(id).trim();
    const ms = parseDuration(v('duration'));
    const n = Number(v('winners'));
    const erreurs = [];
    if (!ms || ms > MAX_GIVEAWAY_MS) erreurs.push('Durée invalide (exemples : 30m, 2h, 3d ; 60 jours au plus).');
    if (!Number.isInteger(n) || n < 1 || n > MAX_WINNERS) erreurs.push(`Gagnants : entre 1 et ${MAX_WINNERS}.`);
    b.prize = v('prize');
    if (!erreurs.length) { b.dureeMs = ms; b.dureeTexte = v('duration'); b.winners = n; }
    return interaction.update(panneau(b, erreurs.length ? `❌ ${erreurs.join(' ')}` : '✅ Lot et durée enregistrés.'));
  }
  if (quoi === 'm:texte') {
    await interaction.deferUpdate();
    b.description = interaction.fields.getTextInputValue('description').trim();
    const erreurs = [];
    for (const id of ['image', 'thumbnail']) {
      const fichier = interaction.fields.getUploadedFiles(id)?.first();
      if (!fichier) continue;
      const r = await storeAttachment(ctx, fichier);
      if (r.error) erreurs.push(`${id === 'image' ? 'Image' : 'Miniature'} : ${r.error}`);
      else b[id] = r.ref;
    }
    return interaction.editReply(panneau(b, erreurs.length ? `❌ ${erreurs.join(' ')}` : '✅ Description et images enregistrées.'));
  }
  if (quoi === 'requis') { b.requis = [...interaction.values]; return interaction.update(panneau(b)); }
  if (quoi === 'salon') { b.channelId = interaction.values[0] ?? b.channelId; return interaction.update(panneau(b)); }
  if (quoi === 'b1' || quoi === 'b2') {
    const n = Number(quoi[1]);
    const autre = n === 1 ? 2 : 1;
    // Un role n a qu un palier : le choisir ici le retire de l autre.
    b.bonus[autre] = b.bonus[autre].filter((id) => !interaction.values.includes(id));
    b.bonus[n] = [...interaction.values];
    return interaction.update(panneau(b));
  }
  if (quoi === 'cancel') {
    brouillons.delete(interaction.user.id);
    return interaction.update({ embeds: [], content: 'Giveaway annulé.', components: [] });
  }
  if (quoi !== 'go') return undefined;

  await interaction.update({ ...panneau(b, '⏳ Publication…'), components: [] });
  const bonusEntries = [1, 2].flatMap((k) => b.bonus[k].map((roleId) => ({ roleId, entries: k + 1 })));
  try {
    const g = await startGiveaway(ctx, interaction.guild, {
      channelId: b.channelId, hostId: interaction.user.id, prize: b.prize, description: b.description,
      durationMs: b.dureeMs, winners: b.winners,
      options: { ...(b.image ? { image: b.image } : {}), ...(b.thumbnail ? { thumbnail: b.thumbnail } : {}), requiredRoleIds: b.requis, bonusEntries },
    });
    brouillons.delete(interaction.user.id);
    return interaction.editReply({ ...panneau(b, `🎉 Giveaway #${g.id} lancé dans <#${g.channel_id}> !`), components: [] });
  } catch (e) {
    return interaction.editReply(panneau(b, `❌ Impossible de publier : ${e.message}`));
  }
}
