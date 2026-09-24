// Ce que l installation fait sur Discord a la place de la personne qui installe :
// lien d invitation avec les bons droits, attente que le bot arrive sur le
// serveur, controle de l intent Message Content, creation des roles et salons.
//
// Utilise par scripts/setup.js (installation) et relu par doctor et config
// pour qu il n existe qu UNE liste de permissions.

import { PermissionFlagsBits as P } from 'discord.js';

const API = 'https://discord.com/api/v10';

// Tout ce que le code fait vraiment : envoyer des embeds et des fichiers
// (transcripts), donner le role des verifies, creer les salons de tickets avec
// leurs droits, ouvrir, verrouiller et archiver les fils de vouches, relire
// l historique (import des anciens vouches).
export const DROITS = {
  'Voir les salons': P.ViewChannel,
  'Envoyer des messages': P.SendMessages,
  'Integrer des liens': P.EmbedLinks,
  'Joindre des fichiers': P.AttachFiles,
  'Historique des messages': P.ReadMessageHistory,
  'Emojis externes': P.UseExternalEmojis,
  'Ajouter des reactions': P.AddReactions,
  'Gerer les messages': P.ManageMessages,
  'Gerer les salons': P.ManageChannels,
  'Gerer les roles': P.ManageRoles,
  'Creer des fils publics': P.CreatePublicThreads,
  'Envoyer dans les fils': P.SendMessagesInThreads,
  'Gerer les fils': P.ManageThreads,
};
export const PERMISSIONS = Object.values(DROITS).reduce((a, b) => a | b, 0n);

// Bits de flags de l application : intent Message Content accorde (ou en
// mode « limite », accorde d office aux bots de moins de 100 serveurs).
const MESSAGE_CONTENT = (1 << 18) | (1 << 19);

export const lienInvitation = (clientId, guildId = '') => 'https://discord.com/oauth2/authorize'
  + `?client_id=${clientId}&scope=bot%20applications.commands&permissions=${PERMISSIONS}`
  + (guildId ? `&guild_id=${guildId}&disable_guild_select=true` : '');

export const lienPortailBot = (clientId) => `https://discord.com/developers/applications/${clientId}/bot`;

export function client(token) {
  const appel = async (methode, chemin, corps) => {
    const res = await fetch(`${API}${chemin}`, {
      method: methode,
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'donutsmp-fr-bot setup',
        ...(corps ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const e = new Error(`Discord ${res.status} sur ${chemin}`);
      e.status = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  };
  return {
    get: (c) => appel('GET', c),
    post: (c, corps) => appel('POST', c, corps),
  };
}

export const aMessageContent = (app) => Boolean(app.flags & MESSAGE_CONTENT);

/** Droits effectifs du bot sur le serveur (roles cumules). */
export async function droitsDuBot(api, guildId, botId) {
  const roles = await api.get(`/guilds/${guildId}/roles`);
  const membre = await api.get(`/guilds/${guildId}/members/${botId}`);
  const siens = roles.filter((r) => membre.roles.includes(r.id) || r.id === guildId);
  return siens.reduce((acc, r) => acc | BigInt(r.permissions), 0n);
}

export function droitsManquants(perms) {
  if (perms & P.Administrator) return [];
  return Object.entries(DROITS).filter(([, bit]) => !(perms & bit)).map(([nom]) => nom);
}

/**
 * Relance `verifier` toutes les 3 s jusqu a ce qu il rende autre chose que
 * null/false, ou jusqu au delai. Pour attendre une action faite dans le
 * navigateur (inviter le bot, cocher un intent) sans demander de relancer.
 */
export async function attendre(verifier, { delaiMs = 15 * 60_000, pasMs = 3000 } = {}) {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const r = await verifier().catch(() => null);
    if (r) return r;
    if (Date.now() > fin) return null;
    await new Promise((ok) => setTimeout(ok, pasMs));
  }
}

// Ce que l installation cree quand la cle est vide. Deux categories : le public
// (salon ou l on se verifie, classement) et le staff (logs, journal des pannes).
export const A_CREER = [
  { cle: 'VERIFIED_ROLE_ID', type: 'role', nom: 'Vérifié' },
  { cle: 'LINK_CHANNEL_ID', type: 'salon', nom: 'connexion', categorie: 'public', lectureSeule: true },
  { cle: 'BALTOP_CHANNEL_ID', type: 'salon', nom: 'classement', categorie: 'public', lectureSeule: true },
  { cle: 'LOG_CHANNEL_ID', type: 'salon', nom: 'logs-verifications', categorie: 'staff' },
  { cle: 'OPS_CHANNEL_ID', type: 'salon', nom: 'journal-bot', categorie: 'staff' },
];

const CATEGORIES = { public: 'DONUTSMP FR', staff: 'DONUTSMP FR · STAFF' };
const TEXTE = 0;
const CATEGORIE = 4;

// Ce que le bot doit pouvoir faire dans ses propres salons, meme prives.
const DROITS_BOT_SALON = P.ViewChannel | P.SendMessages | P.EmbedLinks | P.AttachFiles
  | P.ReadMessageHistory | P.ManageMessages;

/**
 * Cree ce qui manque et rend { CLE: id } a ecrire dans le .env. Reutilise un
 * role ou un salon du meme nom deja present : relancer l installation apres
 * une coupure ne fabrique pas de doublons.
 */
export async function creerManquants(api, { guildId, botId, env, adminRoleId = '', journal = () => {} }) {
  const manquants = A_CREER.filter((x) => !env[x.cle]);
  if (!manquants.length) return {};

  const roles = await api.get(`/guilds/${guildId}/roles`);
  const salons = await api.get(`/guilds/${guildId}/channels`);
  const poses = {};

  const categorieId = async (genre) => {
    const nom = CATEGORIES[genre];
    const deja = salons.find((c) => c.type === CATEGORIE && c.name.toLowerCase() === nom.toLowerCase());
    if (deja) return deja.id;
    const prive = genre === 'staff';
    const overwrites = [
      { id: botId, type: 1, allow: String(DROITS_BOT_SALON), deny: '0' },
    ];
    if (prive) {
      overwrites.push({ id: guildId, type: 0, allow: '0', deny: String(P.ViewChannel) });
      if (adminRoleId) overwrites.push({ id: adminRoleId, type: 0, allow: String(P.ViewChannel | P.ReadMessageHistory), deny: '0' });
    }
    const c = await api.post(`/guilds/${guildId}/channels`, { name: nom, type: CATEGORIE, permission_overwrites: overwrites });
    salons.push(c);
    journal(`categorie ${nom} creee${prive ? ' (privee)' : ''}`);
    return c.id;
  };

  for (const x of manquants) {
    if (x.type === 'role') {
      const deja = roles.find((r) => r.name.toLowerCase() === x.nom.toLowerCase() && !r.managed);
      if (deja) { poses[x.cle] = deja.id; journal(`role ${x.nom} repris`); continue; }
      // Un role neuf nait tout en bas : sous celui du bot, donc donnable.
      const r = await api.post(`/guilds/${guildId}/roles`, { name: x.nom, permissions: '0', mentionable: false });
      roles.push(r);
      poses[x.cle] = r.id;
      journal(`role ${x.nom} cree`);
      continue;
    }
    const parent = await categorieId(x.categorie);
    const deja = salons.find((c) => c.type === TEXTE && c.parent_id === parent && c.name === x.nom);
    if (deja) { poses[x.cle] = deja.id; journal(`#${x.nom} repris`); continue; }
    const overwrites = [{ id: botId, type: 1, allow: String(DROITS_BOT_SALON), deny: '0' }];
    if (x.categorie === 'staff') {
      overwrites.push({ id: guildId, type: 0, allow: '0', deny: String(P.ViewChannel) });
      if (adminRoleId) overwrites.push({ id: adminRoleId, type: 0, allow: String(P.ViewChannel | P.ReadMessageHistory), deny: '0' });
    } else if (x.lectureSeule) {
      // Les slash commands restent utilisables : c est un autre droit.
      overwrites.push({ id: guildId, type: 0, allow: '0', deny: String(P.SendMessages | P.CreatePublicThreads) });
    }
    const c = await api.post(`/guilds/${guildId}/channels`, {
      name: x.nom, type: TEXTE, parent_id: parent, permission_overwrites: overwrites,
    });
    salons.push(c);
    poses[x.cle] = c.id;
    journal(`#${x.nom} cree`);
  }
  return poses;
}
