// Compteurs vocaux : trois salons vocaux fermes (visibles, personne ne s y
// connecte) dont le nom affiche le nombre de membres, de membres en ligne et
// de membres en vocal, mis a jour toutes les 5 min.
//
//   kv compteurs.conf  JSON { membres|en_ligne|en_vocal: { salonId, modele, renommages: [ts] } }
//
// « En ligne » = compte approximatif de Discord (pas d intent de presence).

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { store } from '../db.js';
import { config } from '../config.js';
import { TYPES, MINUTES, nomSalon, nomAvecNombre, peutRenommer } from './logique.js';

export { TYPES, MINUTES };

const lire = () => { try { return JSON.parse(store.kvGet('compteurs.conf') ?? '') ?? {}; } catch { return {}; } };
const ecrire = (c) => store.kvSet('compteurs.conf', JSON.stringify(c));

export const reglagesCompteurs = {
  conf: lire,
  poserSalon(type, salonId) {
    const c = lire();
    for (const t of Object.keys(TYPES)) if (t !== type && salonId && c[t]?.salonId === salonId) delete c[t];
    if (salonId) c[type] = { ...c[type], salonId, renommages: c[type]?.salonId === salonId ? (c[type].renommages ?? []) : [] };
    else delete c[type];
    ecrire(c);
  },
  poserModele(type, modele) {
    const c = lire();
    if (!c[type]) return;
    c[type].modele = modele ? (modele.includes('{nombre}') ? modele : `${modele} {nombre}`) : undefined;
    c[type].appliquerModele = true; // un modele choisi au setup s applique une fois, puis seul le nombre change
    ecrire(c);
  },
  actifs: () => Object.keys(TYPES).filter((t) => lire()[t]?.salonId),
};

export async function chiffres(guild) {
  const frais = await guild.client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => null);
  let vocal = 0;
  for (const e of guild.voiceStates.cache.values()) if (e.channelId && !e.member?.user.bot) vocal += 1;
  return {
    membres: frais?.approximateMemberCount ?? guild.memberCount ?? 0,
    en_ligne: frais?.approximatePresenceCount ?? 0,
    en_vocal: vocal,
  };
}

/** Salon visible de tous, ou personne ne peut se connecter (le bot si). */
async function fermer(salon) {
  const everyone = salon.guild.roles.everyone;
  if (!salon.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.Connect)) {
    await salon.permissionOverwrites.edit(everyone, { Connect: false }, { reason: 'Salon compteur' });
  }
  const moi = salon.guild.members.me;
  if (moi && !salon.permissionOverwrites.cache.get(moi.id)?.allow.has(PermissionFlagsBits.ManageChannels)) {
    await salon.permissionOverwrites.edit(moi, { ViewChannel: true, Connect: true, ManageChannels: true }, { reason: 'Le bot renomme ce compteur' });
  }
}

/** Renomme les salons dont le chiffre a change. Rend { changes, attente, erreurs }. */
export async function actualiser(guild) {
  const c = lire();
  const res = { changes: [], attente: [], erreurs: [] };
  const types = Object.keys(TYPES).filter((t) => c[t]?.salonId);
  if (!types.length) return res;
  const n = await chiffres(guild);
  for (const t of types) {
    const salon = guild.channels.cache.get(c[t].salonId);
    if (!salon) { res.erreurs.push(`${TYPES[t].label} : salon supprimé`); continue; }
    try { await fermer(salon); } catch (e) { res.erreurs.push(`${TYPES[t].label} : impossible de fermer le salon (${e.message})`); }
    const modele = c[t].modele ?? TYPES[t].defaut;
    // Le nom du salon est garde tel quel (renomme a la main par le staff ?) : seul le nombre change.
    const nom = c[t].appliquerModele ? nomSalon(modele, n[t]) : nomAvecNombre(salon.name, n[t], modele);
    if (salon.name === nom) { delete c[t].appliquerModele; continue; }
    const { ok, recents } = peutRenommer(c[t].renommages);
    if (!ok) { res.attente.push(t); continue; }
    try {
      await salon.setName(nom, 'Compteur');
      c[t].renommages = [...recents, Date.now()];
      delete c[t].appliquerModele;
      res.changes.push(t);
    } catch (e) {
      res.erreurs.push(`${TYPES[t].label} : ${e.message}`);
    }
  }
  ecrire(c);
  return res;
}

/** Cree une categorie « 📊 STATS » et les trois salons, en haut du serveur. */
export async function creerSalons(guild) {
  const cat = await guild.channels.create({ name: '📊 STATS', type: ChannelType.GuildCategory, position: 0, reason: 'Compteurs' });
  for (const t of Object.keys(TYPES)) {
    const s = await guild.channels.create({
      name: nomSalon(TYPES[t].defaut, 0), type: ChannelType.GuildVoice, parent: cat.id, reason: 'Compteur',
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
        { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
      ],
    });
    reglagesCompteurs.poserSalon(t, s.id);
  }
  return actualiser(guild);
}

export function demarrerCompteurs(client) {
  const tour = async () => {
    const guild = client.guilds.cache.get(config.discord.guildId);
    if (!guild || !reglagesCompteurs.actifs().length) return;
    const { erreurs } = await actualiser(guild);
    for (const e of erreurs) console.warn('[compteurs]', e);
  };
  setTimeout(() => tour().catch(() => {}), 30_000).unref?.();
  setInterval(() => tour().catch((e) => console.warn('[compteurs]', e.message)), MINUTES * 60_000).unref?.();
}
