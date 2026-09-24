// Panneau public des dons : comment donner, et les rangs avec leurs vrais
// roles et montants. Les paliers et les roles ne sont jamais ecrits en dur :
// ils viennent de /setup dons (sinon DONATION_TIERS), et le panneau se
// reecrit des qu ils changent. Salon : DONATION_CHANNEL_ID.

import { config } from '../config.js';
import { store } from '../db.js';
import { embed, FR } from '../lib/brand.js';
import { shortMoney } from '../lib/format.js';
import { ouSeLier } from '../settings.js';
import { verrouiller, peutVerrouiller } from '../lib/salon.js';
import { paliers, roleDuPalier, nomRole } from './dons.js';

const CLE = 'dons.panneau';
const PUCES = ['🥉', '🥈', '🥇', '💎'];

export function rendrePanneauDons(guild) {
  const liste = paliers();
  const rangs = liste.map((p, i) => {
    const id = roleDuPalier(p);
    const role = id && guild?.roles.cache.has(id) ? `<@&${id}>` : `**${nomRole(p)}**`;
    return `> ${PUCES[i] ?? '💎'} ${role}\n└ à partir de **${shortMoney(p)}** donnés au total`;
  });

  return embed('💝・DONATIONS', {
    couleur: FR.or,
    description:
      '**Vous aimez le bot et la communauté DonutSMP FR ? Soutenez-nous par un don en jeu !**\n\n'
      + '### Comment donner\n'
      + `En jeu, envoyez le montant de votre choix au bot :\n\`\`\`/pay ${config.mc.linkAccount} <montant>\`\`\``
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
  if (!config.dons.salonPanneauId) return null;
  const salon = await client.channels.fetch(config.dons.salonPanneauId).catch(() => null);
  if (!salon?.isTextBased?.()) {
    console.warn('[don] DONATION_CHANNEL_ID introuvable, pas de panneau des dons');
    return null;
  }
  const contenu = { embeds: [rendrePanneauDons(guild ?? salon.guild)], allowedMentions: { parse: [] } };

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
