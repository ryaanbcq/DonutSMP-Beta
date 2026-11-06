// Quand un membre parle d un rat (mod piege, faux client, grabber), le bot
// lui demande s il a encore le fichier et propose de le scanner avec
// DonutScan (bouton scan:start = meme formulaire que le panneau).
//
// Garde-fous anti-spam : une proposition par membre toutes les 6 h, une par
// salon toutes les 10 min. Il faut l intent Message Content et la cle API.
// Interrupteur : kv scan.alerte = « off » pour couper.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { embed, FR } from '../lib/brand.js';

const PAR_MEMBRE_MS = 6 * 3_600_000;
const PAR_SALON_MS = 10 * 60_000;
const vusMembre = new Map();
const vusSalon = new Map();

const sansAccents = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Mots qui suffisent seuls : le jargon du vol de compte.
const FORT = /\b(rats?|ratz|ratt(?:er|e|es|ee|ees|ing|ed|eur|eurs)|ratting|grabb?er|grabb?e|silent ?net|malwares?|stealers?|token ?logg?ers?|keyloggers?|infostealer)\b/;
// « rate », « rater », « rate » (sans accent) : souvent « j ai rate mon coup ». Il faut du contexte.
const AMBIGU = /\b(rate|rater|rates)\b/;
const CONTEXTE = /\b(mods?|clients?|cheats?|cheate?s?|jar|fichiers?|pc|ordi|compte|comptes|hack(?:e|er|é)?|virus|telecharg\w*|install\w*|lien|dm|mp|scamm?\w*|gens|perso?ns?\w*|petits?)\b/;

/** Ce message parle-t-il d un rat ? (fonction pure, testee) */
export function parleDeRat(texte) {
  const t = sansAccents(texte);
  if (t.length < 3 || t.length > 2000) return false;
  if (FORT.test(t)) return true;
  return AMBIGU.test(t) && CONTEXTE.test(t);
}

export const reglagesAlerteScan = {
  active: () => store.kvGet('scan.alerte') !== 'off',
  poser: (v) => store.kvSet('scan.alerte', v ? 'on' : 'off'),
};

export function messageAlerte(membreId) {
  const carte = embed('🔍・TU AS LE MOD ?', {
    couleur: FR.jaune,
    image: 'aucune',
    description:
      'Si quelqu’un t’a envoyé un mod, un client ou un « cheat », **ne le lance pas**.\n'
      + 'Tu as encore le fichier `.jar` ? Scanne-le : **DonutScan** l’analyse sans l’ouvrir et te dit en privé s’il est piégé.\n'
      + '-# Déjà lancé ? Change tes mots de passe depuis un autre appareil et ouvre un ticket.',
  });
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('scan:start').setLabel('Oui, scanner le mod').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('scan:non').setLabel('Je ne l’ai pas').setStyle(ButtonStyle.Secondary),
  );
  return { content: `<@${membreId}>`, embeds: [carte], components: [boutons], allowedMentions: { users: [membreId], repliedUser: false } };
}

export async function surMessage(message, now = Date.now()) {
  if (!message.inGuild() || message.author.bot || message.guildId !== config.discord.guildId) return;
  if (!config.donutscan.apiKey || !reglagesAlerteScan.active()) return;
  if (!parleDeRat(message.content)) return;
  if (now - (vusMembre.get(message.author.id) ?? 0) < PAR_MEMBRE_MS) return;
  if (now - (vusSalon.get(message.channelId) ?? 0) < PAR_SALON_MS) return;
  vusMembre.set(message.author.id, now);
  vusSalon.set(message.channelId, now);
  await message.reply(messageAlerte(message.author.id));
  console.log(`[scan] alerte rat proposee a ${message.author.tag} dans #${message.channel?.name ?? message.channelId}`);
}

/** Bouton « Je ne l ai pas » : conseils en prive. */
export function onBoutonScanNon(interaction) {
  return interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: 'D’accord. Si tu l’as lancé :\n'
      + '• change le mot de passe de ton compte Microsoft et de Discord **depuis un autre appareil** ;\n'
      + '• sauvegarde tes fichiers puis réinitialise ton PC, c’est le plus sûr ;\n'
      + '• ouvre un ticket avec le nom de la personne et des captures : le staff peut la bannir.\n'
      + 'Si on t’en renvoie un, scanne-le avant : https://donutscan.org/fr/',
  });
}

export function demarrerAlerteScan(client) {
  if (!config.discord.messageContent) return console.log('[scan] intent Message Content absent : alerte rat a l arret');
  client.on('messageCreate', (m) => surMessage(m).catch((e) => console.warn('[scan] alerte :', e.message)));
  console.log(`[scan] alerte rat ${config.donutscan.apiKey ? (reglagesAlerteScan.active() ? 'active' : 'coupee (kv scan.alerte)') : 'inactive (pas de cle DonutScan)'}`);
}
