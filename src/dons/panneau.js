// Panneau public des dons : comment donner, et les rangs avec leurs vrais
// roles et montants. Les paliers et les roles ne sont jamais ecrits en dur :
// ils viennent de /setup dons (sinon DONATION_TIERS), et le panneau se
// reecrit des qu ils changent. Salon : DONATION_CHANNEL_ID.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { embed, FR } from '../lib/brand.js';
import { shortMoney } from '../lib/format.js';
import { ouSeLier, settings } from '../settings.js';
import { verrouiller, peutVerrouiller } from '../lib/salon.js';
import { presence } from '../ingame/presence.js';
import { escapeMarkdown } from 'discord.js';
import { rang } from '../baltop/panel.js';
import { paliers, roleDuPalier, nomRole, lireMontant, totalDe, palierPour, classementDons } from './dons.js';

const CLE = 'dons.panneau';
const PUCES = ['🥉', '🥈', '🥇', '💎'];

// Etat affiche du bot en jeu. Il ne passe hors ligne qu apres 90 s de coupure,
// comme le reste du bot : les micro-coupures (8 s) ne font pas clignoter le
// panneau. Hors ligne, un /pay n est vu par personne : le don serait perdu.
const HORS_LIGNE_APRES_MS = 90_000;
let enLigneAffiche = true;
let horsLigneDepuis = null;

function boutons(enLigne) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dons:creer').setLabel('Créer ma donation').setEmoji('💝')
      .setStyle(ButtonStyle.Success).setDisabled(!enLigne),
  )];
}

/** Top 10 des donateurs, par compte Minecraft (lies ou non). */
export function rendreDonateurs() {
  const liste = paliers();
  const top = classementDons(10);
  const lignes = top.length
    ? top.map((r, i) => {
      const p = palierPour(r.total, liste);
      const id = p >= 0 ? roleDuPalier(liste[p]) : null;
      const role = p >= 0 ? ` · ${id ? `<@&${id}>` : nomRole(liste[p])}` : '';
      const qui = r.discordId ? `<@${r.discordId}> · **${escapeMarkdown(r.name)}**` : `**${escapeMarkdown(r.name)}**`;
      return `${rang(i)} ${qui} : \`\`${shortMoney(r.total)}\`\`${role}`;
    }).join('\n')
    : '*Aucun don pour le moment : soyez le premier !*';
  return embed('🏆・PLUS GROS DONATEURS', {
    couleur: FR.bleu,
    image: 'aucune',
    description: `**Merci à ceux qui font vivre la communauté ! Total des dons de chacun, depuis le début.**\n\n${lignes}`,
  });
}

export function rendrePanneauDons(guild, enLigne = enLigneAffiche) {
  const liste = paliers();
  const rangs = liste.map((p, i) => {
    const id = roleDuPalier(p);
    const role = id && guild?.roles.cache.has(id) ? `<@&${id}>` : `**${nomRole(p)}**`;
    return `> ${PUCES[i] ?? '💎'} ${role}\n└ à partir de **${shortMoney(p)}** donnés au total`;
  });

  return embed('💝・DONATIONS', {
    couleur: FR.bleu,
    description:
      '**Vous aimez le bot et la communauté DonutSMP FR ? Soutenez-nous par un don en jeu !**\n\n'
      + (enLigne
        ? '> 🟢 **Bot en ligne** · vos dons sont comptés en direct.\n'
        : '> 🔴 **Bot hors ligne** · n\'envoyez rien pour l\'instant : le bot ne verrait pas votre paiement'
          + ' et le don ne serait pas compté. Le bouton revient dès son retour.\n')
      + '### Comment donner\n'
      + 'Cliquez sur **Créer ma donation**, choisissez le montant, puis copiez la commande en jeu. Ou tapez-la vous-même :\n'
      + `\`\`\`/pay ${config.mc.linkAccount} <montant>\`\`\``
      + `Minimum **${shortMoney(config.dons.min)}** par don. Chaque don s'additionne à votre total.\n\n`
      + '### Les rangs\n'
      + `${rangs.join('\n\n')}\n\n`
      + 'Le rang est donné automatiquement, en quelques secondes, au membre dont le compte Minecraft est lié.'
      + ` Pas encore lié ? ${ouSeLier().replace(/^./, (c) => c.toUpperCase())} : vos dons déjà faits comptent dès la liaison.\n\n`
      + '*Un don est définitif et n\'est jamais remboursé.*',
  });
}

/** Publie ou reecrit le panneau. Rend une note lisible, ou null sans salon. */
export async function publierPanneauDons(client, guild) {
  if (!settings.salonDonations()) return null;
  const salon = await client.channels.fetch(settings.salonDonations()).catch(() => null);
  if (!salon?.isTextBased?.()) {
    console.warn('[don] salon donations introuvable, pas de panneau des dons');
    return null;
  }
  const contenu = {
    // Le classement d abord, l explication et le bouton ensuite.
    embeds: [rendreDonateurs(), rendrePanneauDons(guild ?? salon.guild)],
    components: boutons(enLigneAffiche),
    allowedMentions: { parse: [] },
  };

  const [salonId, messageId] = (store.kvGet(CLE) ?? '').split(':');
  if (salonId === salon.id && messageId) {
    const message = await salon.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.edit(contenu);
      return 'panneau mis à jour';
    }
  }
  const message = await salon.send(contenu);
  store.kvSet(CLE, `${salon.id}:${message.id}`);
  // Lecture seule pour les membres : le panneau reste en haut, sans discussion.
  const moi = salon.guild.members.me;
  if (peutVerrouiller(salon, moi)) await verrouiller(salon, moi).catch(() => {});
  console.log(`[don] panneau publie dans #${salon.name}`);
  return 'panneau publié';
}

/** Relit l etat du bot en jeu et reecrit le panneau quand l affichage change. */
export function surveillerPanneauDons(client, { intervalMs = 30_000 } = {}) {
  const verifier = async () => {
    const { enLigne } = await presence();
    if (enLigne) horsLigneDepuis = null;
    else horsLigneDepuis ??= Date.now();
    const affiche = enLigne || Date.now() - horsLigneDepuis < HORS_LIGNE_APRES_MS;
    if (affiche === enLigneAffiche) return;
    enLigneAffiche = affiche;
    await publierPanneauDons(client).catch((e) => console.error('[don] panneau :', e.message));
    console.log(`[don] panneau : bot ${affiche ? 'en ligne' : 'hors ligne'}`);
  };
  const t = setInterval(() => { verifier().catch(() => {}); }, intervalMs);
  t.unref?.();
  return verifier;
}

// ------------------------------------------------------ Creer ma donation

const EPH = { flags: MessageFlags.Ephemeral };

export async function onBoutonDons(interaction) {
  if (interaction.customId !== 'dons:creer') return;
  return interaction.showModal(new ModalBuilder().setCustomId('dons:montant').setTitle('Créer ma donation')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('montant').setLabel(`Montant (minimum ${shortMoney(config.dons.min).replace('$', '')})`)
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setPlaceholder('ex. 500M, 1B, 2.5B'),
    )));
}

export async function onModalDons(interaction) {
  if (interaction.customId !== 'dons:montant') return;
  const montant = lireMontant(interaction.fields.getTextInputValue('montant'));
  if (!montant) {
    return interaction.reply({ content: '❌ Montant illisible. Exemples : `500M`, `1B`, `2.5B`, `750000`.', ...EPH });
  }
  if (montant < config.dons.min) {
    return interaction.reply({ content: `❌ Le minimum est de **${shortMoney(config.dons.min)}** par don.`, ...EPH });
  }
  const { enLigne } = await presence();
  if (!enLigne) {
    return interaction.reply({
      content: '🔴 Le bot est hors ligne en ce moment : un paiement ne serait pas vu. Réessayez dans quelques minutes.',
      ...EPH,
    });
  }

  const lien = store.getLink(interaction.user.id);
  const liste = paliers();
  let suite;
  if (lien) {
    const apres = totalDe(lien.mc_name) + montant;
    const p = palierPour(apres, liste);
    const prochain = liste[p + 1];
    suite = `Envoyez-le depuis **${lien.mc_name}**, votre compte lié.\n`
      + `Total après ce don : **${shortMoney(apres)}**`
      + (p >= 0 ? ` · rang **${nomRole(liste[p])}**` : '')
      + (prochain ? ` · prochain rang à ${shortMoney(prochain)}` : '');
  } else {
    suite = 'Votre compte Minecraft n\'est pas lié : le don sera compté, et votre rang arrivera quand vous lierez'
      + ` ce même compte (${ouSeLier()}).`;
  }

  return interaction.reply({
    embeds: [embed('💝・MA DONATION', {
      couleur: FR.or,
      image: lien?.mc_name ?? 'aucune',
      description: `Copiez cette commande et collez-la **en jeu** :\n\`\`\`/pay ${config.mc.linkAccount} ${montant}\`\`\``
        + `Soit **${shortMoney(montant)}**.\n\n${suite}\n\n*Un don est définitif et n\'est jamais remboursé.*`,
    })],
    ...EPH,
  });
}
