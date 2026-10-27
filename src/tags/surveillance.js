// Surveillance des tags de serveur : un membre qui affiche un tag interdit
// (reglages dans /setup general > Tags) est signale au staff et sanctionne.
//
// Trois moments de controle :
//   - a l arrivee d un membre ;
//   - quand Discord pousse une mise a jour de son profil (userUpdate) ;
//   - un balayage complet de tous les membres, au demarrage puis toutes les
//     heures : Discord ne garantit pas de prevenir quand quelqu un change de
//     tag, le balayage est le filet.
//
// Il faut l intent privilegie « Server Members » (cocher dans le portail
// developpeur) : sans lui, Discord ne donne ni la liste des membres ni leurs
// arrivees, et la surveillance reste a l arret (signale au journal).
//
// On retient en base qui a deja ete sanctionne, et pour quelle regle : un
// balayage ne realerte pas, ne resanctionne pas. Le staff (admins du bot,
// « Gerer le serveur »), le proprietaire et les bots ne sont jamais touches.

import { GatewayIntentBits } from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import {
  SANCTIONS, SANCTION_DEFAUT, decision, libelle, cleRegle,
} from './regles.js';

const BALAYAGE_MS = 60 * 60_000;
// Au dela, un balayage poste un recapitulatif au lieu d un message par membre
// (une regle ajoutee peut viser des dizaines de membres d un coup).
const DETAIL_MAX = 5;

// ------------------------------------------------------------------ reglages

const json = (cle, defaut) => {
  try { return JSON.parse(store.kvGet(cle) ?? '') ?? defaut; } catch { return defaut; }
};

export const reglagesTags = {
  regles: () => json('tags.regles', []),
  poserRegles: (liste) => store.kvSet('tags.regles', JSON.stringify(liste)),
  sanction: () => (SANCTIONS[store.kvGet('tags.sanction')] ? store.kvGet('tags.sanction') : SANCTION_DEFAUT),
  poserSanction: (s) => store.kvSet('tags.sanction', SANCTIONS[s] ? s : SANCTION_DEFAUT),
  heuresExclusion: () => {
    const h = Number(store.kvGet('tags.exclusionHeures'));
    return Number.isFinite(h) && h > 0 ? Math.min(h, 24 * 28) : 24;
  },
  poserHeuresExclusion: (h) => store.kvSet('tags.exclusionHeures', String(h)),
  // userId -> cle de la regle deja sanctionnee
  vus: () => json('tags.vus', {}),
  poserVus: (v) => store.kvSet('tags.vus', JSON.stringify(v)),
};

// ------------------------------------------------------------------ etat

let client = null;
let dernierBalayage = null;   // { at, membres, signales, erreur }
// Une seule operation a la fois : un balayage et un evenement qui ecrivent
// tags.vus en meme temps perdraient une des deux ecritures.
let file = Promise.resolve();
const enFile = (fn) => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };

export const surveillanceActive = () => Boolean(client?.options.intents.has(GatewayIntentBits.GuildMembers));
export const etatBalayage = () => dernierBalayage;

function exempt(membre) {
  if (!membre || membre.user?.bot) return true;
  if (membre.id === membre.guild?.ownerId) return true;
  // reglages passes explicitement : pas de ligne « [admin] refus » par membre.
  return estAdmin(membre, { ...config.discord, adminRoleId: settings.rolesAdmin() });
}

// ------------------------------------------------------------------ sanctions

async function prevenir(membre, regle, sanction) {
  const tag = membre.user.primaryGuild?.tag ?? regle.valeur.toUpperCase();
  const suite = {
    role: 'Ton rôle **Vérifié** t\'a été retiré. Il te sera rendu dès que tu retires ce tag.',
    exclure: `Tu es réduit au silence pour ${reglagesTags.heuresExclusion()} h.`,
    expulser: 'Tu as été expulsé du serveur.',
    bannir: 'Tu as été banni du serveur.',
  }[sanction];
  if (!suite) return;
  await membre.send(`⚠️ Le tag de serveur **${tag}** n'est pas autorisé sur **${membre.guild.name}**.\n${suite}`)
    .catch(() => {});
}

/** Applique la sanction. Rend le resultat lisible pour le journal. */
async function sanctionner(membre, regle, sanction) {
  const raison = `Tag de serveur interdit (${libelle(regle).replace(/`/g, '')})`;
  if (sanction === 'alerte') return 'aucune action, alerte seulement';
  if (sanction === 'role') {
    const role = settings.roleVerifie();
    if (!role) return '❌ aucun rôle Vérifié configuré';
    if (!membre.roles.cache.has(role)) return 'pas de rôle Vérifié à retirer';
    if (!membre.manageable) return '❌ son rôle est au-dessus du mien';
    await prevenir(membre, regle, sanction);
    await membre.roles.remove(role, raison);
    return 'rôle Vérifié retiré';
  }
  if (sanction === 'exclure') {
    if (!membre.moderatable) return '❌ je ne peux pas l\'exclure (droit « Exclure temporairement » ou hiérarchie)';
    const h = reglagesTags.heuresExclusion();
    await prevenir(membre, regle, sanction);
    await membre.timeout(h * 3_600_000, raison);
    return `exclu ${h} h`;
  }
  if (sanction === 'expulser') {
    if (!membre.kickable) return '❌ je ne peux pas l\'expulser (droit « Expulser » ou hiérarchie)';
    await prevenir(membre, regle, sanction);
    await membre.kick(raison);
    return 'expulsé';
  }
  if (sanction === 'bannir') {
    if (!membre.bannable) return '❌ je ne peux pas le bannir (droit « Bannir » ou hiérarchie)';
    await prevenir(membre, regle, sanction);
    await membre.ban({ reason: raison });
    return 'banni';
  }
  return 'sanction inconnue';
}

/** Le tag n est plus porte : on rend le role Verifie s il lui revient. */
async function lever(membre) {
  const role = settings.roleVerifie();
  if (reglagesTags.sanction() !== 'role' || !role || !store.getLink(membre.id)) return null;
  if (membre.roles.cache.has(role) || !membre.manageable) return null;
  await membre.roles.add(role, 'Tag de serveur interdit retiré').catch(() => {});
  return 'rôle Vérifié rendu';
}

/**
 * Controle un membre. Rend un compte rendu si quelque chose a ete fait, sinon
 * null. `muet` : le balayage regroupe lui meme les messages.
 */
async function controler(membre, { muet = false } = {}) {
  const vus = reglagesTags.vus();
  const d = decision({
    primaryGuild: membre.user?.primaryGuild,
    regles: reglagesTags.regles(),
    deja: vus[membre.id],
    exempt: exempt(membre),
  });
  if (d.action === 'rien') {
    // Deja sanctionne mais le role Verifie est revenu (relink, staff) : on le
    // retire de nouveau, sans realerter.
    const role = settings.roleVerifie();
    if (d.regle && reglagesTags.sanction() === 'role' && role && membre.roles.cache.has(role) && membre.manageable) {
      await membre.roles.remove(role, 'Tag de serveur interdit toujours affiché').catch(() => {});
    }
    return null;
  }

  if (d.action === 'leve') {
    delete vus[membre.id];
    reglagesTags.poserVus(vus);
    const rendu = await lever(membre).catch(() => null);
    console.log(`[tags] ${membre.user.tag} ne porte plus de tag interdit${rendu ? ` (${rendu})` : ''}`);
    if (!muet) {
      journal({
        niveau: 'info',
        titre: 'Tag interdit retiré',
        texte: `<@${membre.id}> n'affiche plus de tag interdit.${rendu ? ` ${rendu[0].toUpperCase()}${rendu.slice(1)}.` : ''}`,
      });
    }
    return null;
  }

  const sanction = reglagesTags.sanction();
  const resultat = await sanctionner(membre, d.regle, sanction).catch((e) => `❌ ${e.message}`);
  // Un echec n est pas retenu : le prochain balayage reessaie (droit ajoute entre temps).
  if (!resultat.startsWith('❌')) {
    vus[membre.id] = cleRegle(d.regle);
    reglagesTags.poserVus(vus);
  }
  const tag = membre.user.primaryGuild?.tag ?? '?';
  console.log(`[tags] ${membre.user.tag} affiche ${tag} (${libelle(d.regle)}) : ${resultat}`);
  const serveur = membre.user.primaryGuild?.identityGuildId ?? null;
  const rapport = { id: membre.id, nom: membre.user.tag, tag, serveur, regle: d.regle, resultat };
  if (!muet) noterSanction(rapport, sanction);
  return rapport;
}

function noterSanction(r, sanction) {
  journal({
    niveau: r.resultat.startsWith('❌') ? 'err' : 'warn',
    titre: 'Tag de serveur interdit',
    texte: `<@${r.id}> (**${r.nom}**) affiche le tag **${r.tag}**.`,
    champs: {
      Règle: libelle(r.regle),
      'Serveur du tag': r.serveur ? `\`${r.serveur}\`` : null,
      Sanction: SANCTIONS[sanction],
      Résultat: r.resultat,
    },
  });
}

// ------------------------------------------------------------------ balayage

/** Controle tous les membres. Rend { membres, signales } ou { erreur }. */
export function balayer() {
  return enFile(async () => {
    if (!client || !surveillanceActive()) return { erreur: 'intent « Server Members » absent' };
    if (!reglagesTags.regles().length && !Object.keys(reglagesTags.vus()).length) {
      dernierBalayage = { at: Date.now(), membres: 0, signales: 0 };
      return dernierBalayage;
    }
    const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
    if (!guild) return { erreur: 'serveur introuvable' };
    let membres;
    try {
      membres = await guild.members.fetch();
    } catch (e) {
      dernierBalayage = { at: Date.now(), erreur: e.message };
      return dernierBalayage;
    }
    const rapports = [];
    for (const m of membres.values()) {
      const r = await controler(m, { muet: true }).catch((e) => {
        console.warn(`[tags] ${m.user?.tag} :`, e.message);
        return null;
      });
      if (r) rapports.push(r);
    }
    // Un membre parti du serveur n est plus a suivre.
    const vus = reglagesTags.vus();
    let menage = false;
    for (const id of Object.keys(vus)) if (!membres.has(id)) { delete vus[id]; menage = true; }
    if (menage) reglagesTags.poserVus(vus);

    const sanction = reglagesTags.sanction();
    if (rapports.length <= DETAIL_MAX) rapports.forEach((r) => noterSanction(r, sanction));
    else {
      const lignes = rapports.map((r) => `${r.resultat.startsWith('❌') ? '❌' : '•'} <@${r.id}> **${r.tag}** : ${r.resultat}`);
      let texte = lignes.join('\n');
      if (texte.length > 3800) texte = `${texte.slice(0, 3800)}\n… et d'autres (voir \`donut logs discord\`)`;
      journal({
        niveau: 'warn',
        titre: `Tags interdits : ${rapports.length} membres`,
        texte,
        champs: { Sanction: SANCTIONS[sanction] },
      });
    }
    dernierBalayage = { at: Date.now(), membres: membres.size, signales: rapports.length };
    console.log(`[tags] balayage : ${membres.size} membres, ${rapports.length} signale(s)`);
    return dernierBalayage;
  });
}

// ------------------------------------------------------------------ branchement

export function demarrerSurveillanceTags(c) {
  client = c;
  if (!surveillanceActive()) {
    console.log('[tags] intent « Server Members » absent : surveillance des tags a l arret');
    if (reglagesTags.regles().length) {
      journal({
        niveau: 'warn',
        titre: 'Tags interdits : surveillance à l\'arrêt',
        texte: 'Des tags sont interdits mais l\'intent **Server Members** n\'est pas actif : personne n\'est contrôlé.'
          + ' Cochez-le dans le portail développeur (Bot > Privileged Gateway Intents), puis redémarrez le bot.',
      });
    }
    return;
  }
  const garder = (m) => m.guild?.id === config.discord.guildId;
  c.on('guildMemberAdd', (m) => { if (garder(m)) enFile(() => controler(m)).catch(() => {}); });
  c.on('guildMemberUpdate', (_, m) => { if (garder(m)) enFile(() => controler(m)).catch(() => {}); });
  // Discord pousse les changements de profil (dont le tag) par userUpdate.
  c.on('userUpdate', (avant, apres) => {
    const a = avant.primaryGuild; const b = apres.primaryGuild;
    if (a?.tag === b?.tag && a?.identityGuildId === b?.identityGuildId && a?.identityEnabled === b?.identityEnabled) return;
    enFile(async () => {
      const g = c.guilds.cache.get(config.discord.guildId);
      const m = await g?.members.fetch(apres.id).catch(() => null);
      if (m) await controler(m);
    }).catch(() => {});
  });
  balayer().catch((e) => console.warn('[tags] balayage :', e.message));
  setInterval(() => balayer().catch((e) => console.warn('[tags] balayage :', e.message)), BALAYAGE_MS).unref();
  console.log(`[tags] surveillance active, ${reglagesTags.regles().length} regle(s), sanction ${reglagesTags.sanction()}`);
}
