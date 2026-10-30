// Anti-pub : un message qui contient une invitation vers un AUTRE serveur
// Discord est supprime, et son auteur recoit un avertissement (compte dans
// /warns). Au bout de N avertissements de pub en 24 h, mute automatique.
//
// Detection : liens d invitation Discord (discord.gg, discord.com/invite,
// dsc.gg, .gg/...), y compris les variantes espacees pour passer les filtres
// (« discord . gg / abc »). Les invitations vers CE serveur restent permises
// (le code est resolu aupres de Discord, en cache). Un message modifie pour
// ajouter un lien est controle aussi.
//
// Jamais touches : les bots, le staff (admins du bot et membres autorises a
// sanctionner), les roles et salons exemptes dans /setup general > Anti-pub.
// Il faut l intent Message Content (DISCORD_MESSAGE_CONTENT=true) : sans lui
// le texte des messages est vide et rien n est detecte.

import { config } from '../config.js';
import { store } from '../db.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import { registre, peutSanctionner } from './actions.js';
import { ecrireDuree } from './outils.js';

const RAISON = 'Publicité : invitation vers un autre serveur Discord';
const AVIS_SALON_MS = 8_000;
const H = 3_600_000;

// ------------------------------------------------------------------ detection

// Caracteres invisibles glisses dans un lien pour tromper les filtres.
const INVISIBLES = /[​-‏⁠﻿­]/g;
const MOTIF = /(?:discord(?:app)?\s*\.\s*(?:com|gg)\s*\/\s*(?:invite\s*\/\s*)?|dsc\s*\.\s*gg\s*\/\s*|(?:^|[\s(<])\.gg\s*\/\s*)([a-z0-9-]{2,32})/gi;

/** Codes d invitation trouves dans un texte (sans doublon). */
export function codesInvitation(texte) {
  const t = String(texte ?? '').normalize('NFKC').replace(INVISIBLES, '');
  return [...new Set([...t.matchAll(MOTIF)].map((m) => m[1]))];
}

// ------------------------------------------------------------------ reglages

const liste = (cle) => String(store.kvGet(cle) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const nombre = (cle, defaut, min, max) => {
  const brut = store.kvGet(cle);
  if (brut == null || brut === '') return defaut; // Number(null) vaut 0, pas « absent »
  const v = Number(brut);
  return Number.isFinite(v) && v >= min && v <= max ? v : defaut;
};

export const reglagesAntipub = {
  actif: () => store.kvGet('antipub.actif') === '1',
  poserActif: (v) => store.kvSet('antipub.actif', v ? '1' : '0'),
  salonsExemptes: () => liste('antipub.salons'),
  poserSalonsExemptes: (ids) => store.kvSet('antipub.salons', ids.join(',')),
  rolesExemptes: () => liste('antipub.roles'),
  poserRolesExemptes: (ids) => store.kvSet('antipub.roles', ids.join(',')),
  // 0 = jamais de mute automatique.
  avantMute: () => nombre('antipub.avantMute', 3, 0, 10),
  muteHeures: () => nombre('antipub.muteHeures', 24, 1, 672),
  poserSanction: (avantMute, muteHeures) => {
    store.kvSet('antipub.avantMute', String(avantMute));
    store.kvSet('antipub.muteHeures', String(muteHeures));
  },
};

// ------------------------------------------------------------------ invitations

// code -> { serveur, at } : un meme code n est pas redemande a Discord.
const cache = new Map();
const CACHE_MS = 6 * H;

/** Vrai si toutes les invitations visent ce serveur. Une invitation illisible compte comme pub. */
async function versCeServeur(client, codes) {
  for (const code of codes) {
    const connu = cache.get(code);
    let serveur = connu && Date.now() - connu.at < CACHE_MS ? connu.serveur : undefined;
    if (serveur === undefined) {
      const inv = await client.fetchInvite(code).catch(() => null);
      serveur = inv?.guild?.id ?? null;
      cache.set(code, { serveur, at: Date.now() });
    }
    if (serveur !== config.discord.guildId) return false;
  }
  return true;
}

// ------------------------------------------------------------------ controle

function exempte(message) {
  const m = message.member;
  if (!m || message.author.bot) return true;
  if (estAdmin(m, { ...config.discord, adminRoleId: [] }) || peutSanctionner(m)) return true;
  const salon = message.channel;
  const salons = reglagesAntipub.salonsExemptes();
  if (salons.includes(salon.id) || (salon.parentId && salons.includes(salon.parentId))) return true;
  return reglagesAntipub.rolesExemptes().some((r) => m.roles.cache.has(r));
}

/** Avertissements de pub de ce membre dans les dernieres 24 h. */
const pubsRecentes = (id, now = Date.now()) => registre.warns(id)
  .filter((w) => w.raison === RAISON && now - w.at < 24 * H).length;

export async function controlerMessage(message) {
  if (!reglagesAntipub.actif() || !message.inGuild() || message.guildId !== config.discord.guildId) return;
  const codes = codesInvitation(message.content);
  if (!codes.length || exempte(message)) return;
  if (await versCeServeur(message.client, codes)) return;

  const auteur = message.author;
  const contenu = message.content.slice(0, 300);
  const supprime = await message.delete().then(() => true, () => false);
  const n = registre.ajouterWarn(auteur.id, { at: Date.now(), par: message.client.user.id, raison: RAISON });
  const recentes = pubsRecentes(auteur.id);
  const seuil = reglagesAntipub.avantMute();

  let mute = null;
  if (seuil && recentes >= seuil && message.member.moderatable) {
    const ms = reglagesAntipub.muteHeures() * H;
    mute = await message.member.timeout(ms, `${RAISON} (${recentes} en 24 h)`).then(() => ms, () => null);
  }

  const suite = mute
    ? `Tu es mute ${ecrireDuree(mute)} après ${recentes} avertissements pour pub en 24 h.`
    : (seuil ? `Avertissement ${recentes}/${seuil} : au bout de ${seuil} en 24 h, mute ${ecrireDuree(reglagesAntipub.muteHeures() * H)}.` : '');
  const recu = await auteur.send(`⚠️ Ton message dans <#${message.channelId}> a été supprimé : la pub pour d'autres serveurs Discord est interdite sur **${message.guild.name}**. ${suite}`)
    .then(() => true, () => false);
  // MP fermes : un mot dans le salon, efface aussitot.
  if (!recu) {
    const avis = await message.channel.send({
      content: `⚠️ <@${auteur.id}>, la pub pour d'autres serveurs est interdite ici. ${suite}`,
      allowedMentions: { users: [auteur.id] },
    }).catch(() => null);
    if (avis) setTimeout(() => avis.delete().catch(() => {}), AVIS_SALON_MS).unref?.();
  }

  console.log(`[antipub] ${auteur.tag} dans #${message.channel.name} : ${codes.join(', ')} (${recentes}/24 h)${mute ? ', mute' : ''}`);
  journal({
    niveau: mute ? 'err' : 'warn',
    titre: mute ? 'Anti-pub : mute automatique' : 'Anti-pub : message supprimé',
    texte: `<@${auteur.id}> (**${auteur.tag}**) dans <#${message.channelId}>.\n\`\`\`\n${contenu.replace(/`/g, "'")}\n\`\`\``,
    champs: {
      Invitations: codes.map((c) => `\`${c}\``).join(' '),
      'En 24 h': `${recentes}${seuil ? `/${seuil}` : ''}`,
      'Total avertissements': String(n),
      Supprimé: supprime ? 'oui' : '❌ non (droit « Gérer les messages » ?)',
      ...(mute ? { Mute: ecrireDuree(mute) } : {}),
    },
  });
}

export function demarrerAntipub(client) {
  if (!config.discord.messageContent) {
    console.log('[antipub] intent Message Content absent : anti-pub a l arret');
    return;
  }
  const verifier = (m) => controlerMessage(m).catch((e) => console.warn('[antipub] :', e.message));
  client.on('messageCreate', verifier);
  client.on('messageUpdate', (avant, apres) => {
    if (apres.partial || avant.content === apres.content) return;
    verifier(apres);
  });
  console.log(`[antipub] ${reglagesAntipub.actif() ? 'actif' : 'inactif (a activer dans /setup general)'}`);
}
