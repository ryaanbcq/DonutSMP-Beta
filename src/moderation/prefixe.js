// Commandes de moderation ecrites dans le chat, plus rapides que les slash :
//
//   +ban @membre [temps] [raison]      +ban 123456789012345678 3j pub
//   +mute @membre [temps] [raison]     (sans temps : 1 h)
//   +kick @membre [raison]
//   +warn @membre [raison]
//   +unmute @membre [raison]
//   +unban <id ou @mention> [raison]
//   +warns @membre
//
// Le prefixe se regle dans /setup general > Modération (« + » par defaut).
// Memes droits, memes garde-fous et meme journal que les slash commands. Le
// message de commande est supprime, la reponse s efface apres 10 s (le journal
// garde la trace). Il faut l intent Message Content.

import { config } from '../config.js';
import {
  registre, peutSanctionner, appliquerSanction, appliquerUnban, MUTE_DEFAUT_MS, PERMISSION,
} from './actions.js';
import { lireDuree, lireIdUtilisateur } from './outils.js';

const REPONSE_MS = 10_000;
const AVEC_DUREE = new Set(['ban', 'mute']);

/**
 * Decoupe « +ban @x 3j pub en vocal » : { nom, cible, duree, raison }, ou
 * null si ce n est pas une commande de moderation. La duree est facultative
 * et se reconnait a sa forme (10m, 2h, 3j, 1sem) juste apres la cible.
 */
export function lireCommande(texte, prefixe = '+') {
  const t = String(texte ?? '').trim();
  if (!prefixe || !t.startsWith(prefixe)) return null;
  const [mot, cible = '', ...reste] = t.slice(prefixe.length).trim().split(/\s+/);
  const nom = mot?.toLowerCase();
  if (!nom || !PERMISSION[nom]) return null;
  let duree = null;
  if (AVEC_DUREE.has(nom) && reste.length) {
    const d = lireDuree(reste[0]);
    if (d && /^\d/.test(reste[0])) { duree = d; reste.shift(); }
  }
  return { nom, cible: lireIdUtilisateur(cible), cibleBrute: cible, duree, raison: reste.join(' ').trim() };
}

async function repondre(message, texte) {
  const r = await message.channel.send({ content: texte, allowedMentions: { parse: [] } }).catch(() => null);
  if (r) setTimeout(() => r.delete().catch(() => {}), REPONSE_MS).unref?.();
}

export async function surMessage(message) {
  if (!message.inGuild() || message.author.bot || message.guildId !== config.discord.guildId) return;
  const c = lireCommande(message.content, registre.prefixe());
  if (!c) return;
  if (!peutSanctionner(message.member, c.nom)) return; // pas de reponse : on ne revele rien
  await message.delete().catch(() => {});
  const p = registre.prefixe();

  if (!c.cible) {
    return repondre(message, `❌ Indique le membre par une mention ou son ID : \`${p}${c.nom} @membre${AVEC_DUREE.has(c.nom) ? ' [temps]' : ''} [raison]\``);
  }
  const { guild, member: moderateur } = message;

  if (c.nom === 'unban') return repondre(message, (await appliquerUnban({ guild, moderateur, id: c.cible, raison: c.raison })).texte);

  if (c.nom === 'warns') {
    const liste = registre.warns(c.cible);
    const lignes = liste.slice(-10).map((w, i) => `\`${liste.length - Math.min(10, liste.length) + i + 1}.\` <t:${Math.floor(w.at / 1000)}:d> : ${w.raison}`);
    return repondre(message, `📋 <@${c.cible}> · ${liste.length} avertissement${liste.length > 1 ? 's' : ''}\n${lignes.join('\n') || '*aucun*'}`);
  }

  const utilisateur = await message.client.users.fetch(c.cible).catch(() => null);
  if (!utilisateur) return repondre(message, `❌ Aucun utilisateur Discord avec l'ID \`${c.cible}\`.`);
  const duree = c.nom === 'mute' ? (c.duree ?? MUTE_DEFAUT_MS) : c.duree;
  const r = await appliquerSanction({ nom: c.nom, guild, moderateur, utilisateur, raison: c.raison, duree });
  return repondre(message, r.texte);
}

export function demarrerPrefixe(client) {
  if (!config.discord.messageContent) {
    console.log('[mod] intent Message Content absent : commandes a prefixe a l arret');
    return;
  }
  client.on('messageCreate', (m) => surMessage(m).catch((e) => console.warn('[mod] prefixe :', e.message)));
  console.log(`[mod] commandes a prefixe actives (« ${registre.prefixe()} »)`);
}
