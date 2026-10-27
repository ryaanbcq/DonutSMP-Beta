// Qui, parmi les comptes lies, a quitte le serveur Discord ? Et la liste des
// membres pour tout le bot (classements, tags interdits).
//
// Discord limite durement les demandes de membres par la passerelle (opcode 8,
// vecu le 28/10 : « Request with opcode 8 was rate limited » des que le suivi
// des departs, les noms du classement et le balayage des tags tombaient
// ensemble). Donc :
//   - avec l intent « Server Members » : UNE demande de la liste complete au
//     demarrage puis toutes les 6 h, et entre deux le cache de discord.js,
//     tenu a jour par les arrivees, departs et mises a jour ; tout le monde lit
//     ce cache, plus aucune demande en rafale ;
//   - sans l intent : demandes par paquets de 100 ids, une a la fois.
// Une limite atteinte attend le delai indique par Discord puis reessaie. Si
// Discord ne repond pas, on garde la liste precedente : une panne ne doit
// jamais vider ni gonfler le classement.

import { GatewayIntentBits } from 'discord.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { brancherDeparts } from '../donut/balances.js';

const CONTROLE_MS = 15 * 60_000;
const LISTE_COMPLETE_MS = 6 * 3_600_000;
const PAQUET = 100; // maximum de user_ids par requete Discord
const attendre = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

// Une demande de membres a la fois, pour tout le bot.
let file = Promise.resolve();
const enFile = (fn) => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };

/** Rejoue une demande refusee pour limite de debit, apres le delai indique. */
async function avecReessai(fn, essais = 3) {
  for (let i = 1; ; i += 1) {
    try { return await fn(); } catch (e) {
      const apres = /retry after ([\d.]+)/i.exec(e.message ?? '');
      if (!apres || i >= essais) throw e;
      console.warn(`[membres] limite Discord, nouvel essai dans ${Math.ceil(Number(apres[1]))} s`);
      await attendre((Number(apres[1]) + 1) * 1000);
    }
  }
}

const aIntent = (guild) => guild.client.options.intents.has(GatewayIntentBits.GuildMembers);
let listeChargeeA = 0;

/**
 * Tous les membres du serveur (intent requis). Une seule vraie demande par
 * `ageMax`, le cache sinon : il est tenu a jour par les evenements.
 */
export function tousLesMembres(guild, { ageMax = LISTE_COMPLETE_MS } = {}) {
  if (listeChargeeA && Date.now() - listeChargeeA < ageMax) return Promise.resolve(guild.members.cache);
  return enFile(async () => {
    if (listeChargeeA && Date.now() - listeChargeeA < ageMax) return guild.members.cache;
    const membres = await avecReessai(() => guild.members.fetch({ time: 120_000 }));
    listeChargeeA = Date.now();
    console.log(`[membres] liste complete chargee : ${membres.size} membres`);
    return membres;
  });
}

/** Les membres parmi `ids` : cache complet si on l a, sinon paquets de 100. */
async function membresParmi(guild, ids) {
  if (aIntent(guild)) {
    const tous = await tousLesMembres(guild);
    return new Map(ids.filter((id) => tous.has(id)).map((id) => [id, tous.get(id)]));
  }
  return enFile(async () => {
    const trouves = new Map();
    for (let i = 0; i < ids.length; i += PAQUET) {
      const paquet = ids.slice(i, i + PAQUET);
      const m = await avecReessai(() => guild.members.fetch({ user: paquet, time: 30_000 }));
      for (const [id, membre] of m) trouves.set(id, membre);
    }
    return trouves;
  });
}

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
  const presents = await membresParmi(guild, lies);
  const p = calculerPartis(lies, new Set(presents.keys()));
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
    const membres = await membresParmi(guild, voulus);
    return new Map([...membres].map(([id, m]) => [id, m.displayName]));
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
