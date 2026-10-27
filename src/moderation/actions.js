// /warn, /kick, /mute, /unmute, /ban, /unban : moderation reservee aux admins
// du bot (role choisi dans /setup general, ou « Gerer le serveur »).
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
  mute: { desc: 'Rendre un membre muet (timeout, 28 jours max)', duree: 'obligatoire' },
  unmute: { desc: 'Rendre la parole à un membre', duree: false },
  ban: { desc: 'Bannir un membre, pour une durée ou définitivement', duree: 'facultative' },
  unban: { desc: 'Débannir un utilisateur (ID ou @mention)', duree: false },
};

function construire(nom) {
  const d = DEF[nom];
  const b = new SlashCommandBuilder().setName(nom).setDescription(d.desc);
  if (nom === 'unban') {
    b.addStringOption((o) => o.setName('joueur').setDescription('ID Discord ou @mention de l\'utilisateur banni').setRequired(true));
  } else {
    b.addUserOption((o) => o.setName('joueur').setDescription('Le membre').setRequired(true));
  }
  if (d.duree === 'obligatoire') {
    b.addStringOption((o) => o.setName('temps').setDescription('Ex. 10m, 2h, 3j, 1sem').setRequired(true));
  }
  b.addStringOption((o) => o.setName('raison').setDescription('Raison, envoyée au membre et au journal').setRequired(true).setMaxLength(400));
  if (d.duree === 'facultative') {
    b.addStringOption((o) => o.setName('temps').setDescription('Ex. 3j, 1sem. Vide = définitif').setRequired(false));
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

async function executer(nom, interaction) {
  if (!estAdmin(interaction.member)) {
    return interaction.reply({ content: '🔒 Réservé aux admins du bot (rôle choisi dans /setup general).', ...EPH });
  }
  const { guild } = interaction;
  const raison = interaction.options.getString('raison', true).trim();
  const tempsTexte = interaction.options.getString('temps');
  const moderateur = interaction.member;
  const par = `${interaction.user.tag} (${interaction.user.id})`;
  const raisonAudit = `${raison} · par ${interaction.user.tag}`.slice(0, 500);

  if (nom === 'unban') return unban(interaction, { raison, raisonAudit });

  const utilisateur = interaction.options.getUser('joueur', true);
  const cible = await guild.members.fetch(utilisateur.id).catch(() => null);
  // Ban d un utilisateur deja parti : possible, sans controle de role.
  if (!cible && nom !== 'ban') return interaction.reply({ content: `❌ <@${utilisateur.id}> n'est pas sur le serveur.`, ...EPH });
  if (cible) {
    const refus = refusHierarchie({ moderateur, cible, guild });
    if (refus) return interaction.reply({ content: `❌ Impossible : ${refus}.`, ...EPH });
  }

  let duree = null;
  if (tempsTexte) {
    duree = lireDuree(tempsTexte);
    if (!duree) return interaction.reply({ content: `❌ Durée illisible : « ${tempsTexte} ». Exemples : 10m, 2h, 3j, 1sem, 1j12h.`, ...EPH });
  }
  if (nom === 'mute' && duree > MUTE_MAX_MS) {
    return interaction.reply({ content: '❌ Discord limite un mute à 28 jours. Pour plus long, utilise /ban avec une durée.', ...EPH });
  }

  await interaction.deferReply(EPH);
  const mp = (texte) => utilisateur.send(texte).then(() => true, () => false);
  const nomServeur = guild.name;
  const qui = `<@${utilisateur.id}> (**${utilisateur.tag}**)`;
  let resultat;
  let titre;
  const champs = { Raison: raison, Par: `<@${interaction.user.id}>` };

  try {
    switch (nom) {
      case 'warn': {
        const n = registre.ajouterWarn(utilisateur.id, { at: Date.now(), par: interaction.user.id, raison });
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
        if (!cible.isCommunicationDisabled()) {
          return interaction.editReply(`➖ ${qui} n'est pas mute.`);
        }
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
        if (duree) registre.poserBanTemp(utilisateur.id, { jusqua: Date.now() + duree, raison, par: interaction.user.id });
        else registre.poserBanTemp(utilisateur.id, null);
        titre = duree ? 'Modération : ban temporaire' : 'Modération : ban définitif';
        champs.Durée = duree ? ecrireDuree(duree) : 'définitif';
        if (duree) champs.Fin = `<t:${Math.floor((Date.now() + duree) / 1000)}:f>`;
        resultat = `⛔ ${qui} banni ${duree ? ecrireDuree(duree) : 'définitivement'}.`;
        break;
      }
      default:
        return interaction.editReply('Commande inconnue.');
    }
  } catch (e) {
    console.warn(`[mod] /${nom} ${utilisateur.tag} par ${par} : ${e.message}`);
    return interaction.editReply(`❌ ${e.message}.`);
  }

  console.log(`[mod] /${nom} ${utilisateur.tag} par ${par}${duree ? ` (${ecrireDuree(duree)})` : ''} : ${raison}`);
  journal({ niveau: 'warn', titre, texte: resultat, champs });
  return interaction.editReply(resultat);
}

async function unban(interaction, { raison, raisonAudit }) {
  const saisie = interaction.options.getString('joueur', true);
  const id = lireIdUtilisateur(saisie);
  if (!id) return interaction.reply({ content: `❌ « ${saisie} » n'est ni un ID Discord ni une @mention.`, ...EPH });
  await interaction.deferReply(EPH);
  const ban = await interaction.guild.bans.fetch(id).catch(() => null);
  if (!ban) return interaction.editReply(`➖ <@${id}> n'est pas banni.`);
  try {
    await interaction.guild.bans.remove(id, raisonAudit);
  } catch (e) {
    return interaction.editReply(`❌ ${e.message}.`);
  }
  registre.poserBanTemp(id, null);
  const qui = `<@${id}> (**${ban.user.tag}**)`;
  console.log(`[mod] /unban ${ban.user.tag} par ${interaction.user.tag} : ${raison}`);
  journal({
    niveau: 'info',
    titre: 'Modération : débannissement',
    texte: `✅ ${qui} débanni.`,
    champs: { Raison: raison, Par: `<@${interaction.user.id}>`, 'Raison du ban': ban.reason ?? '—' },
  });
  return interaction.editReply(`✅ ${qui} débanni. Il peut revenir avec une invitation.`);
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
