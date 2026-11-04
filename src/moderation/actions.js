// Sanctions : /warn, /kick, /mute, /unmute, /ban, /unban, /warns, et les memes
// en commandes ecrites a prefixe (prefixe.js). Qui peut quoi : /setup general
// > Modération (roles par action), sinon les admins du bot.
//
// Garde-fous, verifies cote serveur a chaque commande :
//   - jamais soi-meme, jamais le proprietaire, jamais un bot ;
//   - jamais un membre staff du bot, sauf par le proprietaire ;
//   - jamais un membre dont le role le plus haut est egal ou au-dessus de
//     celui du moderateur (hierarchie Discord), sauf pour le proprietaire ;
//   - le bot doit lui-meme pouvoir agir (droit et hierarchie).
// Le membre recoit un MP (avant le kick ou le ban, sinon plus de serveur
// commun), et chaque action part dans le journal du bot.
//
// Ban avec duree : le debannissement est programme en base (mod.bansTemp) et
// fait par le bot, meme apres un redemarrage.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import {
  lireDuree, ecrireDuree, lireIdUtilisateur, MUTE_MAX_MS,
} from './outils.js';

const EPH = { flags: MessageFlags.Ephemeral };
export const MUTE_DEFAUT_MS = 3_600_000;

// ------------------------------------------------------------------ base

const json = (cle, defaut) => {
  try { return JSON.parse(store.kvGet(cle) ?? '') ?? defaut; } catch { return defaut; }
};

export const registre = {
  warns: (id) => json('mod.warns', {})[id] ?? [],
  ajouterWarn: (id, w) => {
    const tous = json('mod.warns', {});
    tous[id] = [...(tous[id] ?? []), w];
    store.kvSet('mod.warns', JSON.stringify(tous));
    return tous[id].length;
  },
  /** Retire l avertissement n (1 = le plus ancien), ou tous si n est null. Rend combien sont retires. */
  retirerWarns: (id, n = null) => {
    const tous = json('mod.warns', {});
    const liste = tous[id] ?? [];
    let retires;
    if (n == null) { retires = liste.length; delete tous[id]; } else {
      if (n < 1 || n > liste.length) return 0;
      liste.splice(n - 1, 1); retires = 1;
      if (liste.length) tous[id] = liste; else delete tous[id];
    }
    store.kvSet('mod.warns', JSON.stringify(tous));
    return retires;
  },
  // Qui peut sanctionner : membres et roles choisis dans /setup general.
  autorises: () => ({
    membres: String(store.kvGet('mod.autorises') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    roles: String(store.kvGet('mod.rolesAutorises') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  }),
  poserAutorises: ({ membres, roles }) => {
    if (membres) store.kvSet('mod.autorises', membres.join(','));
    if (roles) store.kvSet('mod.rolesAutorises', roles.join(','));
  },
  // Roles autorises par action : { warn, mute, kick, ban } -> [ids].
  perms: () => json('mod.perms', {}),
  poserPerms: (action, roles) => {
    const p = json('mod.perms', {});
    if (roles.length) p[action] = roles; else delete p[action];
    store.kvSet('mod.perms', JSON.stringify(p));
  },
  // Prefixe des commandes ecrites (+ban @x raison).
  prefixe: () => store.kvGet('mod.prefixe') || '+',
  poserPrefixe: (p) => store.kvSet('mod.prefixe', p),
  bansTemp: () => json('mod.bansTemp', {}),
  poserBanTemp: (id, ban) => {
    const tous = json('mod.bansTemp', {});
    if (ban) tous[id] = ban; else delete tous[id];
    store.kvSet('mod.bansTemp', JSON.stringify(tous));
  },
};

// ------------------------------------------------------------------ commandes

const DEF = {
  warn: { desc: 'Avertir un membre', duree: false },
  kick: { desc: 'Expulser un membre du serveur', duree: false },
  mute: { desc: 'Rendre un membre muet (timeout, 28 jours max)', duree: 'facultative' },
  unmute: { desc: 'Rendre la parole à un membre', duree: false },
  ban: { desc: 'Bannir un membre, pour une durée ou définitivement', duree: 'facultative' },
  unban: { desc: 'Débannir un utilisateur (ID ou @mention)', duree: false },
};

function construire(nom) {
  const d = DEF[nom];
  const b = new SlashCommandBuilder().setName(nom).setDescription(d.desc);
  if (nom === 'unban') {
    b.addStringOption((o) => o.setName('joueur').setDescription('ID Discord ou @mention de l\'utilisateur banni').setRequired(true));
  }
  // L ordre Discord impose les options obligatoires d abord.
  b.addStringOption((o) => o.setName('raison').setDescription('Raison, envoyée au membre et au journal').setRequired(false).setMaxLength(400));
  if (nom !== 'unban') {
    // Deux facons de designer le membre : la liste de Discord, ou son ID colle.
    b.addUserOption((o) => o.setName('joueur').setDescription('Le membre (ou utilise l\'option id)').setRequired(false));
    b.addStringOption((o) => o.setName('id').setDescription('ID Discord du membre, à la place de joueur').setRequired(false));
  }
  if (d.duree) {
    b.addStringOption((o) => o.setName('temps').setDescription(nom === 'mute' ? 'Ex. 10m, 2h, 3j. Vide = 1 h' : 'Ex. 3j, 1sem. Vide = définitif').setRequired(false));
  }
  return b;
}

/** Ce qu un fichier de src/commands exporte pour une commande de moderation. */
export function commande(nom) {
  return { data: construire(nom), execute: (i) => executer(nom, i), requiresLink: false };
}

// ------------------------------------------------------------------ controles

const estStaff = (membre) => estAdmin(membre, { ...config.discord, adminRoleId: settings.rolesAdmin() });

/** Raison du refus, ou null si le moderateur peut agir sur la cible. */
export function refusHierarchie({ moderateur, cible, guild }) {
  if (cible.id === moderateur.id) return 'tu ne peux pas te viser toi-même';
  if (cible.id === guild.ownerId) return 'c\'est le propriétaire du serveur';
  if (cible.user?.bot) return 'c\'est un bot';
  if (moderateur.id === guild.ownerId) return null;
  if (estStaff(cible)) return 'c\'est un membre du staff du bot';
  if (cible.roles.highest.position >= moderateur.roles.highest.position) {
    return 'son rôle le plus haut est au même niveau ou au-dessus du tien';
  }
  return null;
}

// ------------------------------------------------------------------ execution

// Chaque commande releve d une permission : unmute va avec mute, unban avec
// ban, warns avec warn.
export const PERMISSION = {
  warn: 'warn', warns: 'warn', mute: 'mute', unmute: 'mute', kick: 'kick', ban: 'ban', unban: 'ban',
};

/**
 * Qui peut lancer cette commande. Le proprietaire toujours. Ensuite, si rien
 * n est regle dans /setup general > Modération, les admins du bot. Sinon :
 * les membres autorises a tout, les roles autorises a tout, et les roles de
 * cette action. `reglages` : { membres, roles, perms } (tests).
 */
export function peutSanctionner(membre, action = null, reglages = null) {
  const r = reglages ?? { ...registre.autorises(), perms: registre.perms() };
  if (typeof r === 'string') return peutSanctionner(membre, action, { membres: r.split(',').map((x) => x.trim()).filter(Boolean), roles: [], perms: {} });
  const id = membre?.id ?? membre?.user?.id;
  if (id && membre?.guild?.ownerId === id) return true;
  const perms = r.perms ?? {};
  const regle = r.membres.length || r.roles.length || Object.values(perms).some((x) => x?.length);
  if (!regle) return estAdmin(membre);
  if (r.membres.includes(id)) return true;
  const roles = membre?.roles;
  const aRole = (x) => (typeof roles?.cache?.has === 'function' ? roles.cache.has(x) : Array.isArray(roles) && roles.includes(x));
  if (r.roles.some(aRole)) return true;
  const cle = action ? PERMISSION[action] ?? action : null;
  if (cle) return (perms[cle] ?? []).some(aRole);
  return Object.values(perms).flat().some(aRole);
}

/**
 * Applique une sanction. Utilise par les slash commands et par les commandes
 * a prefixe. Rend { ok, texte } (texte = reponse au moderateur).
 */
export async function appliquerSanction({ nom, guild, moderateur, utilisateur, raison, duree }) {
  raison = (raison || 'Aucune raison donnée').slice(0, 400);
  const raisonAudit = `${raison} · par ${moderateur.user.tag}`.slice(0, 500);
  const par = `${moderateur.user.tag} (${moderateur.id})`;
  const cible = await guild.members.fetch(utilisateur.id).catch(() => null);
  // Ban d un utilisateur deja parti : possible, sans controle de role.
  if (!cible && nom !== 'ban') return { ok: false, texte: `❌ <@${utilisateur.id}> n'est pas sur le serveur.` };
  if (cible) {
    const refus = refusHierarchie({ moderateur, cible, guild });
    if (refus) return { ok: false, texte: `❌ Impossible : ${refus}.` };
  }
  if (nom === 'mute' && duree > MUTE_MAX_MS) {
    return { ok: false, texte: '❌ Discord limite un mute à 28 jours. Pour plus long, utilise un ban avec une durée.' };
  }

  const mp = (texte) => utilisateur.send(texte).then(() => true, () => false);
  const nomServeur = guild.name;
  const qui = `<@${utilisateur.id}> (**${utilisateur.tag}**)`;
  let resultat;
  let titre;
  const champs = { Raison: raison, Par: `<@${moderateur.id}>` };

  try {
    switch (nom) {
      case 'warn': {
        const n = registre.ajouterWarn(utilisateur.id, { at: Date.now(), par: moderateur.id, raison });
        const recu = await mp(`⚠️ Tu as reçu un avertissement sur **${nomServeur}** : ${raison}\n(avertissement n°${n})`);
        titre = 'Modération : avertissement';
        champs.Total = `${n} avertissement${n > 1 ? 's' : ''}`;
        resultat = `⚠️ ${qui} averti (n°${n}).${recu ? '' : ' Ses MP sont fermés : il n\'a pas reçu le message.'}`;
        break;
      }
      case 'kick': {
        if (!cible.kickable) throw new Error('je ne peux pas l\'expulser (droit ou rôle au-dessus du mien)');
        await mp(`⛔ Tu as été expulsé de **${nomServeur}** : ${raison}`);
        await cible.kick(raisonAudit);
        titre = 'Modération : expulsion';
        resultat = `👢 ${qui} expulsé.`;
        break;
      }
      case 'mute': {
        if (!cible.moderatable) throw new Error('je ne peux pas le mute (droit ou rôle au-dessus du mien)');
        await cible.timeout(duree, raisonAudit);
        await mp(`🔇 Tu es mute ${ecrireDuree(duree)} sur **${nomServeur}** : ${raison}`);
        titre = 'Modération : mute';
        champs.Durée = ecrireDuree(duree);
        champs.Fin = `<t:${Math.floor((Date.now() + duree) / 1000)}:f>`;
        resultat = `🔇 ${qui} mute ${ecrireDuree(duree)}.`;
        break;
      }
      case 'unmute': {
        if (!cible.isCommunicationDisabled()) return { ok: false, texte: `➖ ${qui} n'est pas mute.` };
        if (!cible.moderatable) throw new Error('je ne peux pas lui rendre la parole (rôle au-dessus du mien)');
        await cible.timeout(null, raisonAudit);
        await mp(`🔊 Tu peux de nouveau parler sur **${nomServeur}**.`);
        titre = 'Modération : fin du mute';
        resultat = `🔊 ${qui} n'est plus mute.`;
        break;
      }
      case 'ban': {
        if (cible && !cible.bannable) throw new Error('je ne peux pas le bannir (droit ou rôle au-dessus du mien)');
        await mp(duree
          ? `⛔ Tu es banni ${ecrireDuree(duree)} de **${nomServeur}** : ${raison}`
          : `⛔ Tu es banni définitivement de **${nomServeur}** : ${raison}`);
        await guild.bans.create(utilisateur.id, { reason: duree ? `${raisonAudit} (${ecrireDuree(duree)})` : raisonAudit });
        if (duree) registre.poserBanTemp(utilisateur.id, { jusqua: Date.now() + duree, raison, par: moderateur.id });
        else registre.poserBanTemp(utilisateur.id, null);
        titre = duree ? 'Modération : ban temporaire' : 'Modération : ban définitif';
        champs.Durée = duree ? ecrireDuree(duree) : 'définitif';
        if (duree) champs.Fin = `<t:${Math.floor((Date.now() + duree) / 1000)}:f>`;
        resultat = `⛔ ${qui} banni ${duree ? ecrireDuree(duree) : 'définitivement'}.`;
        break;
      }
      default:
        return { ok: false, texte: 'Commande inconnue.' };
    }
  } catch (e) {
    console.warn(`[mod] ${nom} ${utilisateur.tag} par ${par} : ${e.message}`);
    return { ok: false, texte: `❌ ${e.message}.` };
  }
  console.log(`[mod] ${nom} ${utilisateur.tag} par ${par}${duree ? ` (${ecrireDuree(duree)})` : ''} : ${raison}`);
  journal({ niveau: 'warn', titre, texte: resultat, champs });
  return { ok: true, texte: resultat };
}

/** Debannit. Rend { ok, texte }. */
export async function appliquerUnban({ guild, moderateur, id, raison }) {
  raison = (raison || 'Aucune raison donnée').slice(0, 400);
  const ban = await guild.bans.fetch(id).catch(() => null);
  if (!ban) return { ok: false, texte: `➖ <@${id}> n'est pas banni.` };
  try {
    await guild.bans.remove(id, `${raison} · par ${moderateur.user.tag}`.slice(0, 500));
  } catch (e) {
    return { ok: false, texte: `❌ ${e.message}.` };
  }
  registre.poserBanTemp(id, null);
  const qui = `<@${id}> (**${ban.user.tag}**)`;
  console.log(`[mod] unban ${ban.user.tag} par ${moderateur.user.tag} : ${raison}`);
  journal({
    niveau: 'info',
    titre: 'Modération : débannissement',
    texte: `✅ ${qui} débanni.`,
    champs: { Raison: raison, Par: `<@${moderateur.id}>`, 'Raison du ban': ban.reason ?? '—' },
  });
  return { ok: true, texte: `✅ ${qui} débanni. Il peut revenir avec une invitation.` };
}

async function executer(nom, interaction) {
  if (!peutSanctionner(interaction.member, nom)) {
    return interaction.reply({ content: '🔒 Tu n\'as pas la permission pour cette sanction.', ...EPH });
  }
  const { guild } = interaction;
  const raison = interaction.options.getString('raison')?.trim() ?? '';
  const tempsTexte = interaction.options.getString('temps');

  if (nom === 'unban') {
    const saisie = interaction.options.getString('joueur', true);
    const id = lireIdUtilisateur(saisie);
    if (!id) return interaction.reply({ content: `❌ « ${saisie} » n'est ni un ID Discord ni une @mention.`, ...EPH });
    await interaction.deferReply(EPH);
    return interaction.editReply((await appliquerUnban({ guild, moderateur: interaction.member, id, raison })).texte);
  }

  const idSaisi = interaction.options.getString('id');
  let utilisateur = interaction.options.getUser('joueur');
  if (!utilisateur && idSaisi) {
    const id = lireIdUtilisateur(idSaisi);
    if (!id) return interaction.reply({ content: `❌ « ${idSaisi} » n'est pas un ID Discord.`, ...EPH });
    utilisateur = await interaction.client.users.fetch(id).catch(() => null);
    if (!utilisateur) return interaction.reply({ content: `❌ Aucun utilisateur Discord avec l'ID \`${id}\`.`, ...EPH });
  }
  if (!utilisateur) return interaction.reply({ content: '❌ Indique le membre : option **joueur**, ou son ID dans l\'option **id**.', ...EPH });

  let duree = null;
  if (tempsTexte) {
    duree = lireDuree(tempsTexte);
    if (!duree) return interaction.reply({ content: `❌ Durée illisible : « ${tempsTexte} ». Exemples : 10m, 2h, 3j, 1sem, 1j12h.`, ...EPH });
  }
  if (nom === 'mute' && !duree) duree = MUTE_DEFAUT_MS;

  await interaction.deferReply(EPH);
  const r = await appliquerSanction({ nom, guild, moderateur: interaction.member, utilisateur, raison, duree });
  return interaction.editReply(r.texte);
}

// ------------------------------------------------------------------ bans temporaires

/** Debannit ceux dont le ban temporaire est arrive a terme. */
export async function leverBansEchus(client, now = Date.now()) {
  const echus = Object.entries(registre.bansTemp()).filter(([, b]) => b.jusqua <= now);
  if (!echus.length) return;
  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) return;
  for (const [id, b] of echus) {
    try {
      await guild.bans.remove(id, `Fin du ban temporaire : ${b.raison}`.slice(0, 500));
    } catch (e) {
      if (e.code !== 10026) { console.warn(`[mod] deban ${id} :`, e.message); continue; } // 10026 : deja debanni
    }
    registre.poserBanTemp(id, null);
    console.log(`[mod] fin du ban temporaire de ${id}`);
    journal({
      niveau: 'info',
      titre: 'Modération : fin du ban temporaire',
      texte: `<@${id}> est débanni. Il peut revenir avec une invitation.`,
      champs: { 'Raison du ban': b.raison },
    });
  }
}

export function demarrerModeration(client) {
  leverBansEchus(client).catch((e) => console.warn('[mod] bans temporaires :', e.message));
  setInterval(() => leverBansEchus(client).catch((e) => console.warn('[mod] bans temporaires :', e.message)), 60_000).unref();
}

// ------------------------------------------------------------------ /warns

export const commandeWarns = {
  data: new SlashCommandBuilder().setName('warns').setDescription('Avertissements d\'un membre : les voir, en retirer')
    .addUserOption((o) => o.setName('joueur').setDescription('Le membre').setRequired(false))
    .addStringOption((o) => o.setName('id').setDescription('ID Discord, à la place de joueur').setRequired(false))
    .addStringOption((o) => o.setName('retirer').setDescription('Numéro de l\'avertissement à retirer, ou « tout »').setRequired(false)),
  requiresLink: false,
  async execute(interaction) {
    if (!peutSanctionner(interaction.member, 'warns')) {
      return interaction.reply({ content: '🔒 Tu n\'as pas la permission pour cette sanction.', ...EPH });
    }
    const id = interaction.options.getUser('joueur')?.id ?? lireIdUtilisateur(interaction.options.getString('id') ?? '');
    if (!id) return interaction.reply({ content: '❌ Indique le membre : option **joueur**, ou son ID dans l\'option **id**.', ...EPH });
    const retirer = interaction.options.getString('retirer')?.trim().toLowerCase();
    if (retirer) {
      const n = retirer === 'tout' ? null : Number(retirer);
      if (n !== null && !Number.isInteger(n)) return interaction.reply({ content: '❌ **retirer** : un numéro ou « tout ».', ...EPH });
      const retires = registre.retirerWarns(id, n);
      if (!retires) return interaction.reply({ content: `➖ Rien à retirer pour <@${id}>.`, ...EPH });
      journal({
        niveau: 'info',
        titre: 'Modération : avertissement retiré',
        texte: `${retires} avertissement${retires > 1 ? 's' : ''} retiré${retires > 1 ? 's' : ''} à <@${id}>.`,
        champs: { Par: `<@${interaction.user.id}>`, Restants: String(registre.warns(id).length) },
      });
      return interaction.reply({ content: `✅ ${retires} avertissement${retires > 1 ? 's' : ''} retiré${retires > 1 ? 's' : ''} à <@${id}> (reste ${registre.warns(id).length}).`, ...EPH });
    }
    const liste = registre.warns(id);
    const lignes = liste.map((w, i) => `\`${i + 1}.\` <t:${Math.floor(w.at / 1000)}:d> par <@${w.par}> : ${w.raison}`);
    let texte = liste.length ? lignes.join('\n') : '*Aucun avertissement.*';
    if (texte.length > 3800) texte = `${texte.slice(0, 3800)}\n…`;
    return interaction.reply({
      content: `📋 **Avertissements de <@${id}>** · ${liste.length}\n${texte}`,
      allowedMentions: { parse: [] },
      ...EPH,
    });
  },
};
