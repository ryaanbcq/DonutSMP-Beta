// Qui, parmi les comptes lies, a quitte le serveur Discord ?
//
// Sert au classement des fortunes : un membre parti n y figure plus (son
// compte reste lie, il retrouve sa place s il revient).
//
// Toutes les 15 minutes on demande a Discord lesquels des comptes lies sont
// encore membres (par paquets de 100 ids, ce qui marche avec ou sans l intent
// « Server Members »). Avec l intent, les departs et les retours sont en plus
// suivis en direct. Si Discord ne repond pas, on garde la liste precedente :
// une panne ne doit jamais vider ni gonfler le classement.

import { GatewayIntentBits } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { brancherDeparts } from '../donut/balances.js';

const CONTROLE_MS = 15 * 60_000;
const PAQUET = 100; // maximum de user_ids par requete Discord

let partis = new Set();
let pret = false;
let auChangement = () => {};

export const estParti = (id) => partis.has(String(id));
export const nombrePartis = () => partis.size;
brancherDeparts(estParti);

/** Ids absents parmi `lies`, d apres les membres rendus par Discord. */
export function calculerPartis(lies, presents) {
  return new Set(lies.filter((id) => !presents.has(id)));
}

function poser(nouveaux) {
  const avant = [...partis].sort().join(',');
  partis = nouveaux;
  if (pret && [...partis].sort().join(',') !== avant) auChangement();
  pret = true;
}

async function controler(guild) {
  const lies = [...new Set(db.prepare('SELECT discord_id FROM links').all().map((r) => String(r.discord_id)))];
  const presents = new Set();
  for (let i = 0; i < lies.length; i += PAQUET) {
    const paquet = lies.slice(i, i + PAQUET);
    const membres = await guild.members.fetch({ user: paquet, time: 30_000 });
    for (const id of membres.keys()) presents.add(id);
  }
  const p = calculerPartis(lies, presents);
  poser(p);
  return { lies: lies.length, partis: p.size };
}

/**
 * Demarre le suivi. `onChange` est appele quand la liste des partis bouge
 * (le classement se reecrit alors).
 */
export function suivreMembres(client, onChange = () => {}) {
  auChangement = onChange;
  const tour = async () => {
    const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
    if (!guild) return;
    try {
      const r = await controler(guild);
      console.log(`[membres] ${r.lies} comptes lies, ${r.partis} parti(s) du serveur, exclus du classement`);
    } catch (e) {
      console.warn('[membres] controle impossible, liste precedente gardee :', e.message);
    }
  };
  tour();
  setInterval(tour, CONTROLE_MS).unref();

  if (client.options.intents.has(GatewayIntentBits.GuildMembers)) {
    const garder = (m) => m.guild?.id === config.discord.guildId;
    client.on('guildMemberRemove', (m) => {
      if (!garder(m) || partis.has(m.id)) return;
      poser(new Set([...partis, m.id]));
    });
    client.on('guildMemberAdd', (m) => {
      if (!garder(m) || !partis.has(m.id)) return;
      const n = new Set(partis); n.delete(m.id); poser(n);
    });
  }
}

// ------------------------------------------------------------ noms affiches

/**
 * Nom affiche (pseudo du serveur, sinon nom global, sinon nom d utilisateur)
 * des ids donnes, encore membres. Rend une Map id -> nom, ou null si Discord
 * ne repond pas.
 *
 * Pourquoi pas une mention <@id> : dans un embed, Discord n affiche le nom
 * que si le client de CELUI QUI LIT a deja charge ce membre. Sinon il voit
 * l id brut (<@1126956881559179446>), et dans un classement c est le cas de
 * presque toutes les lignes.
 */
export async function nomsAffiches(guild, ids) {
  const voulus = [...new Set(ids.filter(Boolean).map(String))];
  if (!guild || !voulus.length) return voulus.length ? null : new Map();
  try {
    const noms = new Map();
    for (let i = 0; i < voulus.length; i += PAQUET) {
      const membres = await guild.members.fetch({ user: voulus.slice(i, i + PAQUET), time: 30_000 });
      for (const [id, m] of membres) noms.set(id, m.displayName);
    }
    return noms;
  } catch (e) {
    console.warn('[membres] noms affiches :', e.message);
    return null;
  }
}

/**
 * « Nom Discord · **Pseudo** », ou le pseudo seul quand le nom Discord est
 * inconnu ou identique. `echapper` = escapeMarkdown de discord.js.
 */
export function qui(pseudo, nomDiscord, echapper = (s) => s) {
  const p = `**${echapper(pseudo)}**`;
  if (!nomDiscord) return p;
  const pareil = nomDiscord.trim().toLowerCase().replace(/^\./, '') === String(pseudo).trim().toLowerCase().replace(/^\./, '');
  return pareil ? p : `${echapper(nomDiscord)} · ${p}`;
}
