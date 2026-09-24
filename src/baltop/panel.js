import {
  escapeMarkdown, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from 'discord.js';
import { balances } from '../donut/balances.js';
import { config } from '../config.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { shortMoney } from '../lib/format.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { normName } from '../lib/names.js';
import { classementDons, palierPour, paliers, roleDuPalier, nomRole } from '../dons/dons.js';

const RANGS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const MEDAILLES = ['🥇', '🥈', '🥉'];
const CLE_MESSAGE = 'baltop.message';

function rang(i) {
  if (i < 3) return settings.emojis()[i] || MEDAILLES[i];
  return RANGS[i] ?? `\`${i + 1}\``;
}

/** Cadence en clair, generee depuis la config pour ne pas mentir. */
export function texteCadence() {
  const cycle = Math.round(config.baltop.cycleMs / 60_000);
  return `en continu : chaque compte vérifié est relevé toutes les ${cycle} minutes environ, `
    + 'et ce classement se met à jour dès qu\'une position change';
}

export function rendre() {
  const top = balances.classement('money', 10);

  const intro = '**Découvrez les plus grandes fortunes de DonutSMP FR ! '
    + 'Le classement ci-dessous regroupe les 10 joueurs ayant le solde en jeu le plus élevé.**'
    + (settings.roleTop()
      ? ` De plus, le joueur occupant la 1ère place reçoit automatiquement le rôle exclusif <@&${settings.roleTop()}> !`
      : '');

  const lignes = top.length
    ? top.map((r, i) => `${rang(i)} <@${r.discordId}> · **${escapeMarkdown(r.name)}** — \`\`${shortMoney(r.value)}\`\``).join('\n')
    : '*Aucun solde relevé pour le moment.*';

  const salonLink = settings.salonLink();
  const pied = salonLink
    ? '\n\n*Pour que votre argent soit pris en compte, vous devez obligatoirement lier votre compte '
      + `Minecraft dans le salon <#${salonLink}>.*`
    : '\n\n*Pour que votre argent soit pris en compte, vous devez obligatoirement lier votre compte '
      + 'Minecraft depuis le panneau de connexion du serveur.*';

  return embed(TITRES.classement, {
    couleur: FR.or,
    image: 'aucune',
    description: `${intro}\n\n${lignes}\n\n`
      + `> **Le classement est actualisé ${texteCadence()}.**`
      + pied,
  });
}

/** Publie ou reecrit le panneau. Rend le message, ou null. */
export async function publier(client, salonForce = null) {
  const salonId = salonForce ?? settings.salonBaltop();
  if (!salonId) return null;

  const salon = await client.channels.fetch(salonId).catch(() => null);
  if (!salon?.isTextBased?.()) {
    console.warn('[baltop] salon du panneau introuvable');
    return null;
  }

  const contenu = { embeds: [rendre()], components: [basculer('dons')] };
  const connu = store.kvGet(CLE_MESSAGE);

  if (connu) {
    const [, messageId] = connu.split(':');
    const message = await salon.messages.fetch(messageId).catch(() => null);
    if (message) {
      await message.edit(contenu);
      return message;
    }
    // Message supprime a la main : on en repose un.
  }

  const message = await salon.send(contenu);
  store.kvSet(CLE_MESSAGE, `${salon.id}:${message.id}`);
  return message;
}

/** Donne le role au premier et le retire a l ancien. */
export async function majRoleTop(client) {
  const roleId = settings.roleTop();
  if (!roleId || !config.discord.guildId) return;

  const top = balances.classement('money', 1);
  if (top.length === 0) return;

  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) return;

  const gagnant = top[0].discordId;
  const ancien = store.kvGet('baltop.top1');
  if (ancien === gagnant) return;

  if (ancien) {
    const membre = await guild.members.fetch(ancien).catch(() => null);
    await membre?.roles.remove(roleId).catch((e) => console.warn('[baltop] retrait du role :', e.message));
  }

  const membre = await guild.members.fetch(gagnant).catch(() => null);
  if (membre) {
    await membre.roles.add(roleId).catch((e) => console.warn('[baltop] attribution du role :', e.message));
    store.kvSet('baltop.top1', gagnant);
    console.log(`[baltop] role du premier donne a ${top[0].name}`);
  }
}

// Reecriture continue : on ne touche au message que si le classement affiche
// a REELLEMENT change, et jamais plus souvent que `minEditMs`. Editer un
// message a chaque relevé ferait tourner le bot dans les limites de Discord
// pour un resultat identique a l ecran.

let derniereSignature = null;
let derniereEdition = 0;
let enCours = false;
let depuisQuand = 0;

export function signature() {
  return balances.classement('money', 10)
    .map((r) => `${r.discordId}:${r.value}`)
    .join('|');
}

export async function rafraichirSiBesoin(client, { force = false } = {}) {
  if (!settings.salonBaltop()) return false;

  // Filet : une publication qui ne rend jamais la main bloquerait le panneau
  // pour toujours. Au dela de deux minutes on considere le verrou perdu.
  if (enCours) {
    if (Date.now() - depuisQuand < 120_000) return false;
    console.warn('[baltop] verrou de publication bloque, on le force');
    enCours = false;
  }

  const sig = signature();
  if (!force) {
    if (sig === derniereSignature) return false;
    if (Date.now() - derniereEdition < config.baltop.minEditMs) return false;
  }

  enCours = true;
  depuisQuand = Date.now();
  try {
    await publier(client);
    await majRoleTop(client);
    derniereSignature = sig;
    derniereEdition = Date.now();
    return true;
  } catch (err) {
    console.error('[baltop] reecriture impossible :', err.message);
    return false;
  } finally {
    enCours = false;
  }
}

/**
 * A appeler apres chaque releve de solde, ET en balayage regulier.
 *
 * Ne jamais faire dependre un affichage public d un seul evenement : si un
 * onUpdate est manque, le classement resterait faux indefiniment sans que
 * personne ne le sache. Le balayage rattrape, la limite d edition empeche
 * qu il fasse du bruit.
 */
// Comptes qui viennent d etre lies : leur premier solde passe devant la
// limite d edition. Un membre qui se link doit se voir au classement dans la
// foulee, pas deux minutes plus tard parce qu un autre releve venait de passer.
const urgents = new Set();

export function actualiserAuProchainSolde(nom) {
  urgents.add(normName(nom));
}

export function surveiller(client, { balayageMs = 60_000 } = {}) {
  derniereSignature = signature();

  const declencher = (lien) => {
    const force = Boolean(lien?.mc_name && urgents.delete(normName(lien.mc_name)));
    rafraichirSiBesoin(client, { force }).catch((e) => console.error('[baltop] ', e.message));
  };

  const timer = setInterval(declencher, balayageMs);
  timer.unref?.();
  return declencher;
}

// ------------------------------------------------ Bascule fortunes / donateurs
// Le panneau public est le meme pour tous : le bouton ouvre une vue PRIVEE,
// ou l on passe d un classement a l autre sans toucher au message public.

function basculer(vers) {
  return new ActionRowBuilder().addComponents(vers === 'dons'
    ? new ButtonBuilder().setCustomId('baltop:dons').setLabel('Plus gros donateurs').setEmoji('💝').setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder().setCustomId('baltop:fortunes').setLabel('Plus grosses fortunes').setEmoji('🏆').setStyle(ButtonStyle.Secondary));
}

export function rendreDonateurs() {
  const top = classementDons(10);
  const liste = paliers();
  const lignes = top.length
    ? top.map((r, i) => {
      const p = palierPour(r.total, liste);
      const role = p >= 0 ? (roleDuPalier(liste[p]) ? ` · <@&${roleDuPalier(liste[p])}>` : ` · ${nomRole(liste[p])}`) : '';
      const qui = r.discordId ? `<@${r.discordId}> · **${escapeMarkdown(r.name)}**` : `**${escapeMarkdown(r.name)}**`;
      return `${rang(i)} ${qui} — \`\`${shortMoney(r.total)}\`\`${role}`;
    }).join('\n')
    : '*Aucun don pour le moment.*';
  const salon = config.dons.salonPanneauId;
  return embed('💝・PLUS GROS DONATEURS', {
    couleur: FR.or,
    image: 'aucune',
    description: `**Merci à ceux qui font vivre le bot ! Total des dons de chacun, depuis le début.**\n\n${lignes}`
      + (salon ? `\n\n*Pour donner et voir les rangs : <#${salon}>.*` : ''),
  });
}

export async function onBoutonBaltop(interaction) {
  const vue = interaction.customId === 'baltop:dons'
    ? { embeds: [rendreDonateurs()], components: [basculer('fortunes')] }
    : { embeds: [rendre()], components: [basculer('dons')] };
  // Depuis le panneau public : nouvelle vue privee. Depuis la vue privee : on la remplace.
  if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) return interaction.update(vue);
  return interaction.reply({ ...vue, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
