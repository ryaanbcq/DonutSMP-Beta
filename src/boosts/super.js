// Super Booster : un membre qui booste le serveur au moins deux fois recoit
// automatiquement le role « Super Booster ».
//
// Discord ne donne pas le nombre de boosts d un membre : le bot compte les
// messages systeme de boost (« X a boosté le serveur ») du salon systeme.
//   - a chaque boost : +1 (ou le nombre indique si plusieurs d un coup) ;
//   - au demarrage : recomptage depuis l historique du salon systeme, en ne
//     gardant que les boosts posterieurs au debut du boost actuel du membre ;
//   - le membre arrete de booster : compteur remis a zero, role retire
//     SEULEMENT si c est le bot qui l avait donne (un role pose a la main reste).
// Limites : il faut que les messages de boost soient actives dans les
// parametres du serveur ; un boost retire sur deux n est pas visible (Discord
// ne previent que quand le membre ne booste plus du tout).
//
//   kv boosts.role       id du role (sinon le role dont le nom contient « super booster »)
//   kv boosts.compteurs  JSON { userId: { n, bot } }
//   kv boosts.salonAvantages  salon des avantages (sinon celui dont le nom contient « nous-soutenir »)

import { store } from '../db.js';
import { config } from '../config.js';
import { journal } from '../ops/journal.js';
import { embed, FR } from '../lib/brand.js';
import { TYPES_BOOST, boostsDuMessage, compterBoosts, decisionRole, texteMerci } from './logique.js';

// GIF de la trend « W » (winner) sous le remerciement ; kv boosts.gif pour en changer, « aucun » pour l enlever.
export const GIF_W = 'https://media.tenor.com/dhnCFJ_FZ8YAAAAC/look-at-the-size-of-this-w-spongebob.gif';

const PAGES_MAX = 30; // 3 000 messages du salon systeme au demarrage

const lire = () => { try { return JSON.parse(store.kvGet('boosts.compteurs') ?? '') ?? {}; } catch { return {}; } };
const ecrire = (c) => store.kvSet('boosts.compteurs', JSON.stringify(c));

export const reglagesBoosts = {
  roleId: () => store.kvGet('boosts.role') || null,
  poserRole: (id) => store.kvSet('boosts.role', id ? String(id) : ''),
  compteurs: lire,
  salonAvantages: (guild) => {
    const id = store.kvGet('boosts.salonAvantages');
    if (id) return guild.channels.cache.has(id) ? id : null;
    return guild.channels.cache.find((c) => /nous-?soutenir/i.test(c.name))?.id ?? null;
  },
  gif: () => { const g = store.kvGet('boosts.gif'); return g === 'aucun' ? null : g || GIF_W; },
};

function roleSuper(guild) {
  const id = reglagesBoosts.roleId();
  if (id) return guild.roles.cache.get(id) ?? null;
  return guild.roles.cache.find((r) => /super\s*-?\s*boost/i.test(r.name)) ?? null;
}

async function appliquer(membre, c) {
  const role = roleSuper(membre.guild);
  if (!role) return null;
  const e = c[membre.id] ?? { n: 0, bot: false };
  const d = decisionRole({ boosts: e.n, booste: Boolean(membre.premiumSinceTimestamp), aLeRole: membre.roles.cache.has(role.id), donneParBot: e.bot });
  if (d === 'donner') {
    await membre.roles.add(role, `A boosté le serveur ${e.n} fois`);
    c[membre.id] = { ...e, bot: true };
    console.log(`[boosts] ${membre.user.tag} : ${e.n} boosts, role ${role.name} donne`);
    journal({ niveau: 'ok', titre: '💎 Super Booster', texte: `**${membre.displayName}** a boosté le serveur ${e.n} fois : rôle **${role.name}** donné.` });
    return 'donne';
  } else if (d === 'retirer') {
    await membre.roles.remove(role, 'Ne booste plus le serveur');
    console.log(`[boosts] ${membre.user.tag} ne booste plus, role ${role.name} retire`);
  }
  return null;
}

/** Remerciement en reponse au message systeme de boost, dans le meme salon. */
async function remercier(m, membre, boosts, devientSuper) {
  const role = roleSuper(m.guild);
  const carte = embed('🚀・MERCI POUR TON BOOST', {
    couleur: 0xf47fff, // rose Nitro
    image: membre.displayAvatarURL({ size: 256 }),
    description: texteMerci({ boosts, total: m.guild.premiumSubscriptionCount, devientSuper, roleSuper: role ? `${role}` : null, salonAvantages: reglagesBoosts.salonAvantages(m.guild) }),
  });
  const gif = reglagesBoosts.gif();
  if (gif) carte.setImage(gif);
  await m.reply({ content: `${membre}`, embeds: [carte], allowedMentions: { users: [membre.id], repliedUser: false } });
}

async function surMessage(m) {
  if (!m.guild || m.guild.id !== config.discord.guildId || !TYPES_BOOST.has(m.type)) return;
  const c = lire();
  const e = c[m.author.id] ?? { n: 0, bot: false };
  c[m.author.id] = { ...e, n: e.n + boostsDuMessage(m.content) };
  const membre = m.member ?? await m.guild.members.fetch(m.author.id).catch(() => null);
  const r = membre ? await appliquer(membre, c).catch((err) => { console.warn('[boosts] role :', err.message); return null; }) : null;
  ecrire(c);
  if (membre) await remercier(m, membre, c[m.author.id].n, r === 'donne').catch((err) => console.warn('[boosts] merci :', err.message));
}

async function surMembre(ancien, membre) {
  if (membre.guild.id !== config.discord.guildId) return;
  const avant = ancien?.premiumSinceTimestamp ?? null;
  const apres = membre.premiumSinceTimestamp ?? null;
  if (avant === apres) return;
  const c = lire();
  if (!apres) c[membre.id] = { n: 0, bot: c[membre.id]?.bot ?? false };
  await appliquer(membre, c).catch((err) => console.warn('[boosts] role :', err.message));
  if (!apres && c[membre.id]) c[membre.id].bot = false;
  ecrire(c);
}

/** Recompte depuis l historique du salon systeme, puis met les roles a jour. */
export async function recompter(guild) {
  const salon = guild.systemChannel;
  if (!salon) return { erreur: 'aucun salon système' };
  const messages = [];
  let avant;
  for (let i = 0; i < PAGES_MAX; i += 1) {
    const page = await salon.messages.fetch({ limit: 100, ...(avant ? { before: avant } : {}) }).catch(() => null);
    if (!page?.size) break;
    for (const m of page.values()) if (TYPES_BOOST.has(m.type)) messages.push({ auteur: m.author.id, at: m.createdTimestamp, n: boostsDuMessage(m.content) });
    avant = page.last().id;
    if (page.size < 100) break;
  }
  const membres = await guild.members.fetch().catch(() => guild.members.cache);
  const debuts = new Map([...membres.values()].map((m) => [m.id, m.premiumSinceTimestamp ?? null]));
  const comptes = compterBoosts(messages, debuts);
  const c = lire();
  for (const [id, n] of comptes) c[id] = { n: Math.max(n, c[id]?.n ?? 0), bot: c[id]?.bot ?? false };
  for (const m of membres.values()) {
    if (!m.premiumSinceTimestamp && !c[m.id]?.bot) continue;
    await appliquer(m, c).catch((err) => console.warn('[boosts] role :', err.message));
  }
  ecrire(c);
  return { messages: messages.length, boosteurs: [...membres.values()].filter((m) => m.premiumSinceTimestamp).length, superBoosters: [...comptes.values()].filter((n) => n >= 2).length };
}

export function demarrerBoosts(client) {
  client.on('messageCreate', (m) => surMessage(m).catch((e) => console.warn('[boosts] :', e.message)));
  client.on('guildMemberUpdate', (a, b) => surMembre(a, b).catch((e) => console.warn('[boosts] :', e.message)));
  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) return;
  const role = roleSuper(guild);
  if (!role) { console.log('[boosts] aucun role Super Booster : inactif'); return; }
  recompter(guild)
    .then((r) => console.log(`[boosts] role ${role.name} : ${r.erreur ?? `${r.messages} message(s) de boost lus, ${r.boosteurs} boosteur(s), ${r.superBoosters} a 2 boosts ou plus`}`))
    .catch((e) => console.warn('[boosts] recomptage :', e.message));
}
