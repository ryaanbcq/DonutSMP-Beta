// Surveillance des tags de serveur : un membre qui affiche un tag interdit
// (reglages dans /setup general > Tags interdits) est signale au staff et
// sanctionne selon la regle du tag (escalade progressive ou sanction directe,
// voir regles.js).
//
// Moments de controle :
//   - a l arrivee d un membre (un banni temporaire qui revient compris) ;
//   - quand Discord pousse une mise a jour de son profil (userUpdate) ;
//   - toutes les 5 minutes, les echeances : etapes dont le delai est ecoule,
//     bans temporaires a lever ;
//   - un balayage complet de tous les membres, au demarrage puis toutes les
//     heures : Discord ne garantit pas de prevenir quand quelqu un change de
//     tag, le balayage est le filet.
//
// Il faut l intent privilegie « Server Members » (cocher dans le portail
// developpeur) : sans lui, Discord ne donne ni la liste des membres ni leurs
// arrivees, et la surveillance reste a l arret (signale au journal).
//
// Le casier de chaque membre vit en base (tags.vus) : un balayage ne
// realerte pas et ne resanctionne pas. Le staff (admins du bot, « Gerer le
// serveur »), le proprietaire et les bots ne sont jamais touches.

import { GatewayIntentBits } from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import { tousLesMembres } from '../lib/membres.js';
import {
  SANCTIONS, evaluer, libelle, lireEtat, DERNIERE_ETAPE, muteHeuresRegle,
} from './regles.js';

const BALAYAGE_MS = 60 * 60_000;
const ECHEANCES_MS = 5 * 60_000;
// Au dela, un balayage poste un recapitulatif au lieu d un message par membre
// (une regle ajoutee peut viser des dizaines de membres d un coup).
const DETAIL_MAX = 5;
const H = 3_600_000;
const J = 24 * H;

// ------------------------------------------------------------------ reglages

const json = (cle, defaut) => {
  try { return JSON.parse(store.kvGet(cle) ?? '') ?? defaut; } catch { return defaut; }
};
const nombre = (cle, defaut, max) => {
  const v = Number(store.kvGet(cle));
  return Number.isFinite(v) && v > 0 ? Math.min(v, max) : defaut;
};

export const reglagesTags = {
  regles: () => json('tags.regles', []),
  poserRegles: (liste) => store.kvSet('tags.regles', JSON.stringify(liste)),
  // Delais en heures / jours, comme on les saisit.
  delaiHeures: () => nombre('tags.delaiHeures', 24, 24 * 30),
  muteHeures: () => nombre('tags.exclusionHeures', 24, 24 * 28), // plafond Discord : 28 jours
  banTempJours: () => nombre('tags.banTempJours', 7, 365),
  oubliJours: () => nombre('tags.oubliJours', 30, 3650),
  // « Actifs seulement » : a parle ou ete en vocal dans ces derniers jours.
  activiteJours: () => nombre('tags.activiteJours', 7, 90),
  poserActiviteJours: (j) => store.kvSet('tags.activiteJours', String(j)),
  poserDelais: ({ delai, mute, banTemp, oubli }) => {
    store.kvSet('tags.delaiHeures', String(delai));
    store.kvSet('tags.exclusionHeures', String(mute));
    store.kvSet('tags.banTempJours', String(banTemp));
    store.kvSet('tags.oubliJours', String(oubli));
  },
  // Salon ou les avertissements sont annonces (#chat-fr). Vide = MP seulement.
  salonPublic: () => store.kvGet('tags.salonPublic') || null,
  poserSalonPublic: (id) => store.kvSet('tags.salonPublic', id ? String(id) : ''),
  params: () => ({
    delaiMs: reglagesTags.delaiHeures() * H,
    muteMs: reglagesTags.muteHeures() * H,
    banTempMs: reglagesTags.banTempJours() * J,
    oubliMs: reglagesTags.oubliJours() * J,
  }),
  // userId -> casier (voir evaluer dans regles.js)
  vus: () => json('tags.vus', {}),
  poserVus: (v) => store.kvSet('tags.vus', JSON.stringify(v)),
};

// ------------------------------------------------------------------ activite

// Derniere activite (message ou vocal) de chaque membre. En memoire, et en base
// une fois par minute au plus : un redemarrage ne remet pas tout le monde muet.
const activite = new Map(Object.entries(json('tags.activite', {})));
let activiteSale = false;
function noterActivite(id, at = Date.now()) {
  activite.set(id, at);
  activiteSale = true;
}
function sauverActivite() {
  if (!activiteSale) return;
  const limite = Date.now() - 90 * J;
  for (const [id, at] of activite) if (at < limite) activite.delete(id);
  store.kvSet('tags.activite', JSON.stringify(Object.fromEntries(activite)));
  activiteSale = false;
}
/** Actif = en vocal maintenant, ou message / vocal dans la fenetre reglee. */
export function estActif(membre, now = Date.now()) {
  if (membre?.voice?.channelId) return true;
  const at = activite.get(membre?.id);
  return Boolean(at && now - at <= reglagesTags.activiteJours() * J);
}

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

const heures = (ms) => (ms % J === 0 ? `${ms / J} jour${ms / J > 1 ? 's' : ''}` : `${Math.round(ms / H)} h`);
const quand = (ts) => `<t:${Math.floor(ts / 1000)}:R>`;

// ------------------------------------------------------------------ messages

/**
 * Textes d une etape : MP au membre, annonce publique. `tag` est le tag tel
 * qu il s affiche, `prochaine` l echeance de l etape suivante.
 */
function textes(etape, {
  id, nom, tag, prochaine, p, avert, nb, muteR,
}) {
  const t = `**${tag}**`;
  switch (etape) {
    case 'avertir': {
      const reste = avert < nb
        ? `Au bout de ${nb} avertissements, mute ${heures(muteR)}.`
        : `Prochaine fois ${quand(prochaine)} : mute ${heures(muteR)}.`;
      return {
        mp: `⚠️ Le tag de serveur ${t} n'est pas autorisé sur **${nom}**, retire-le. ${reste} (avertissement ${avert}/${nb})`,
        public: `⚠️ <@${id}>, le tag ${t} n'est pas autorisé ici, retire-le. ${reste} (avertissement ${avert}/${nb})`,
      };
    }
    case 'mute_avertir': return {
      mp: `🔇 Tu es mute ${heures(muteR)} sur **${nom}** : tag ${t} toujours affiché après ${nb} avertissements.`,
      public: `🔇 <@${id}> est mute ${heures(muteR)} : tag ${t} toujours affiché après ${nb} avertissements.`,
    };
    case 'avertissement': return {
      mp: `⚠️ Le tag de serveur ${t} n'est pas autorisé sur **${nom}**. Retire-le ${quand(prochaine)}, sinon tu seras mute ${heures(p.muteMs)}. (avertissement 1/3)`,
      public: `⚠️ <@${id}>, le tag ${t} n'est pas autorisé ici. Retire-le ${quand(prochaine)}, sinon mute ${heures(p.muteMs)}. (avertissement 1/3)`,
    };
    case 'mute': return {
      mp: `🔇 Tu es mute ${heures(p.muteMs)} sur **${nom}** : tag ${t} toujours affiché. Retire-le ${quand(prochaine)}, sinon ban de ${heures(p.banTempMs)}. (avertissement 2/3)`,
      public: `🔇 <@${id}> est mute ${heures(p.muteMs)} : tag ${t} toujours affiché. Prochaine étape ${quand(prochaine)} : ban de ${heures(p.banTempMs)}. (avertissement 2/3)`,
    };
    case 'ban_temp': return {
      mp: `⛔ Tu es banni ${heures(p.banTempMs)} de **${nom}** : tag ${t} toujours affiché. Si tu reviens avec ce tag, tu auras un dernier avertissement avant le ban définitif.`,
      public: `⛔ <@${id}> est banni ${heures(p.banTempMs)} : tag ${t} toujours affiché.`,
    };
    case 'dernier_avertissement': return {
      mp: `⚠️ **Dernier avertissement** : retire le tag ${t} ${quand(prochaine)}, sinon tu seras banni définitivement de **${nom}**. (avertissement 3/3)`,
      public: `⚠️ <@${id}>, **dernier avertissement** : retire le tag ${t} ${quand(prochaine)}, sinon ban définitif. (avertissement 3/3)`,
    };
    case 'ban_def': return {
      mp: `⛔ Tu es banni définitivement de **${nom}** : tag ${t} toujours affiché après trois avertissements.`,
      public: `⛔ <@${id}> est banni définitivement : tag ${t} toujours affiché après trois avertissements.`,
    };
    // Sanctions directes : MP seulement.
    case 'role': return { mp: `⚠️ Le tag ${t} n'est pas autorisé sur **${nom}**. Ton rôle **Vérifié** t'a été retiré, il te sera rendu dès que tu retires ce tag.` };
    case 'exclure': return { mp: `🔇 Tu es mute ${heures(p.muteMs)} sur **${nom}** : le tag ${t} n'y est pas autorisé.` };
    case 'expulser': return { mp: `⛔ Tu as été expulsé de **${nom}** : le tag ${t} n'y est pas autorisé.` };
    case 'bannir': return { mp: `⛔ Tu as été banni de **${nom}** : le tag ${t} n'y est pas autorisé.` };
    default: return {};
  }
}

async function annoncer(guild, texte, id) {
  const salonId = reglagesTags.salonPublic();
  if (!salonId || !texte) return;
  const salon = await guild.channels.fetch(salonId).catch(() => null);
  await salon?.send({ content: texte, allowedMentions: { users: [id] } })
    .catch((e) => console.warn('[tags] annonce publique :', e.message));
}

// ------------------------------------------------------------------ sanctions

/** Applique une sanction (etape ou directe). Rend { resultat, ok, etat? }. */
async function appliquer(membre, {
  sanction, regle, etat, avert, nb,
}) {
  const p = reglagesTags.params();
  const raison = `Tag de serveur interdit : ${libelle(regle).replace(/[`*]/g, '')}`;
  const tag = membre.user.primaryGuild?.tag ?? regle.valeur.toUpperCase();
  const muteR = muteHeuresRegle(regle) * H;
  const msg = textes(sanction, {
    id: membre.id, nom: membre.guild.name, tag, prochaine: etat.prochaine, p, avert, nb, muteR,
  });
  const mp = () => (msg.mp ? membre.send(msg.mp).catch(() => {}) : null);
  const echec = (r) => ({ ok: false, resultat: `❌ ${r}` });

  switch (sanction) {
    case 'avertir':
      await mp();
      await annoncer(membre.guild, msg.public, membre.id);
      return { ok: true, resultat: `averti (${avert}/${nb})` };
    case 'mute_avertir':
      if (!membre.moderatable) return echec('je ne peux pas le mute (droit « Exclure temporairement » ou hiérarchie)');
      await membre.timeout(muteR, raison);
      await mp();
      await annoncer(membre.guild, msg.public, membre.id);
      return { ok: true, resultat: `mute ${heures(muteR)} après ${nb} avertissements` };
    case 'alerte':
      return { ok: true, resultat: 'aucune action, alerte seulement' };
    case 'avertissement':
    case 'dernier_avertissement':
      await mp();
      await annoncer(membre.guild, msg.public, membre.id);
      return { ok: true, resultat: sanction === 'avertissement' ? 'averti (1/3)' : 'dernier avertissement (3/3)' };
    case 'mute':
    case 'exclure':
      if (!membre.moderatable) return echec('je ne peux pas le mute (droit « Exclure temporairement » ou hiérarchie)');
      await membre.timeout(p.muteMs, raison);
      await mp();
      await annoncer(membre.guild, msg.public, membre.id);
      return { ok: true, resultat: `mute ${heures(p.muteMs)}${sanction === 'mute' ? ' (2/3)' : ''}` };
    case 'role': {
      const role = settings.roleVerifie();
      if (!role) return echec('aucun rôle Vérifié configuré');
      if (!membre.roles.cache.has(role)) return { ok: true, resultat: 'pas de rôle Vérifié à retirer' };
      if (!membre.manageable) return echec('son rôle est au-dessus du mien');
      await mp();
      await membre.roles.remove(role, raison);
      return { ok: true, resultat: 'rôle Vérifié retiré' };
    }
    case 'expulser':
      if (!membre.kickable) return echec('je ne peux pas l\'expulser (droit « Expulser » ou hiérarchie)');
      await mp(); // avant : apres le depart, plus de serveur commun pour le MP
      await membre.kick(raison);
      return { ok: true, resultat: 'expulsé' };
    case 'ban_temp':
    case 'ban_def':
    case 'bannir': {
      if (!membre.bannable) return echec('je ne peux pas le bannir (droit « Bannir » ou hiérarchie)');
      await mp();
      await membre.ban({ reason: sanction === 'ban_temp' ? `${raison} (${heures(p.banTempMs)})` : raison });
      await annoncer(membre.guild, msg.public, membre.id);
      if (sanction === 'ban_temp') {
        return { ok: true, resultat: `banni ${heures(p.banTempMs)}`, etat: { ...etat, banJusqua: Date.now() + p.banTempMs } };
      }
      return { ok: true, resultat: sanction === 'ban_def' ? 'banni définitivement' : 'banni' };
    }
    default:
      return echec(`sanction inconnue : ${sanction}`);
  }
}

/** Le tag n est plus porte : on rend le role Verifie s il lui revient. */
async function rendreRole(membre, casier) {
  const role = settings.roleVerifie();
  if (casier?.mode !== 'role' || !role || !store.getLink(membre.id)) return null;
  if (membre.roles.cache.has(role) || !membre.manageable) return null;
  await membre.roles.add(role, 'Tag de serveur interdit retiré').catch(() => {});
  return 'rôle Vérifié rendu';
}

const TITRES = {
  avertir: 'Tag interdit : avertissement',
  mute_avertir: 'Tag interdit : mute après avertissements',
  avertissement: 'Tag interdit : avertissement 1/3',
  mute: 'Tag interdit : mute (avertissement 2/3)',
  ban_temp: 'Tag interdit : ban temporaire',
  dernier_avertissement: 'Tag interdit : dernier avertissement',
  ban_def: 'Tag interdit : ban définitif',
};

/**
 * Controle un membre. Rend un compte rendu si une sanction a ete appliquee,
 * sinon null. `muet` : le balayage regroupe lui meme les messages.
 */
async function controler(membre, { muet = false } = {}) {
  const vus = reglagesTags.vus();
  const avant = lireEtat(vus[membre.id]);
  const d = evaluer({
    primaryGuild: membre.user?.primaryGuild,
    regles: reglagesTags.regles(),
    etat: avant,
    exempt: exempt(membre),
    actif: estActif(membre),
    params: reglagesTags.params(),
  });

  const enregistrer = (etat) => {
    const v = reglagesTags.vus();
    if (etat) v[membre.id] = etat; else delete v[membre.id];
    reglagesTags.poserVus(v);
  };

  if (d.action === 'oublier') { enregistrer(null); return null; }

  if (d.action === 'rien') {
    // Sanction « role » deja appliquee mais le role est revenu (relink, staff) :
    // on le retire de nouveau, sans realerter.
    const role = settings.roleVerifie();
    if (d.regle && avant?.mode === 'role' && role && membre.roles.cache.has(role) && membre.manageable) {
      await membre.roles.remove(role, 'Tag de serveur interdit toujours affiché').catch(() => {});
    }
    return null;
  }

  if (d.action === 'leve') {
    // Sanction directe : rien a retenir. Progressif : le casier reste le temps de l oubli.
    enregistrer(avant.mode === 'progressif' ? d.etat : null);
    const rendu = await rendreRole(membre, avant).catch(() => null);
    console.log(`[tags] ${membre.user.tag} ne porte plus de tag interdit${rendu ? ` (${rendu})` : ''}`);
    if (!muet) {
      journal({
        niveau: 'info',
        titre: 'Tag interdit retiré',
        texte: `<@${membre.id}> n'affiche plus de tag interdit.`
          + (rendu ? ` Rôle Vérifié rendu.` : '')
          + (avant.mode === 'progressif'
            ? ` Son casier (étape ${avant.etape}/${DERNIERE_ETAPE}) est gardé ${reglagesTags.oubliJours()} jours : s'il remet le tag, il passe à l'étape suivante sans délai.`
            : ''),
      });
    }
    return null;
  }

  // appliquer
  const r = await appliquer(membre, d).catch((e) => ({ ok: false, resultat: `❌ ${e.message}` }));
  // Un echec n est pas retenu : la prochaine echeance reessaie (droit ajoute entre temps).
  if (r.ok) enregistrer(r.etat ?? d.etat);
  const tag = membre.user.primaryGuild?.tag ?? '?';
  console.log(`[tags] ${membre.user.tag} affiche ${tag} (${libelle(d.regle)}) : ${d.sanction} -> ${r.resultat}`);
  const rapport = {
    id: membre.id,
    nom: membre.user.tag,
    tag,
    serveur: membre.user.primaryGuild?.identityGuildId ?? null,
    regle: d.regle,
    sanction: d.sanction,
    prochaine: r.ok ? (r.etat ?? d.etat).prochaine : null,
    resultat: r.resultat,
  };
  if (!muet) noterSanction(rapport);
  return rapport;
}

function noterSanction(r) {
  const etapeSuivante = r.prochaine && r.sanction !== 'ban_temp' ? quand(r.prochaine) : null;
  journal({
    niveau: r.resultat.startsWith('❌') ? 'err' : 'warn',
    titre: TITRES[r.sanction] ?? 'Tag de serveur interdit',
    texte: `<@${r.id}> (**${r.nom}**) affiche le tag **${r.tag}**.`,
    champs: {
      Règle: libelle(r.regle),
      'Serveur du tag': r.serveur ? `\`${r.serveur}\`` : null,
      Sanction: SANCTIONS[r.sanction] ?? r.sanction,
      Résultat: r.resultat,
      'Étape suivante': etapeSuivante,
    },
  });
}

// ------------------------------------------------------------------ balayage

async function serveur() {
  if (!client || !config.discord.guildId) return null;
  return client.guilds.fetch(config.discord.guildId).catch(() => null);
}

/** Controle tous les membres. Rend { membres, signales } ou { erreur }. */
export function balayer() {
  return enFile(async () => {
    if (!client || !surveillanceActive()) return { erreur: 'intent « Server Members » absent' };
    if (!reglagesTags.regles().length && !Object.keys(reglagesTags.vus()).length) {
      dernierBalayage = { at: Date.now(), membres: 0, signales: 0 };
      return dernierBalayage;
    }
    const guild = await serveur();
    if (!guild) return { erreur: 'serveur introuvable' };
    let membres;
    try {
      // Liste partagee avec le reste du bot : pas de nouvelle demande a Discord.
      membres = await tousLesMembres(guild);
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
    // Membre parti depuis plus longtemps que l oubli (et pas en ban temporaire) : casier efface.
    const vus = reglagesTags.vus();
    const oubli = reglagesTags.params().oubliMs;
    let menage = false;
    for (const [id, v] of Object.entries(vus)) {
      const c = lireEtat(v);
      if (!membres.has(id) && !c.banJusqua && Date.now() - (c.maj ?? 0) > oubli) { delete vus[id]; menage = true; }
    }
    if (menage) reglagesTags.poserVus(vus);

    if (rapports.length <= DETAIL_MAX) rapports.forEach(noterSanction);
    else {
      const lignes = rapports.map((r) => `${r.resultat.startsWith('❌') ? '❌' : '•'} <@${r.id}> **${r.tag}** : ${r.resultat}`);
      let texte = lignes.join('\n');
      if (texte.length > 3800) texte = `${texte.slice(0, 3800)}\n… et d'autres (voir \`donut logs discord\`)`;
      journal({ niveau: 'warn', titre: `Tags interdits : ${rapports.length} membres`, texte });
    }
    dernierBalayage = { at: Date.now(), membres: membres.size, signales: rapports.length };
    console.log(`[tags] balayage : ${membres.size} membres, ${rapports.length} sanction(s)`);
    return dernierBalayage;
  });
}

/** Etapes dont le delai est ecoule, bans temporaires arrives a terme. */
export function echeances() {
  return enFile(async () => {
    const guild = await serveur();
    if (!guild) return;
    const now = Date.now();
    for (const [id, v] of Object.entries(reglagesTags.vus())) {
      const c = lireEtat(v);
      if (c.banJusqua && now >= c.banJusqua) {
        const ok = await guild.bans.remove(id, 'Fin du ban temporaire (tag interdit)').then(() => true)
          .catch((e) => (e.code === 10026 ? true : (console.warn(`[tags] deban ${id} :`, e.message), false))); // 10026 : deja debanni
        if (!ok) continue;
        const vus = reglagesTags.vus();
        if (vus[id]) { delete vus[id].banJusqua; reglagesTags.poserVus(vus); }
        journal({
          niveau: 'info',
          titre: 'Tag interdit : fin du ban temporaire',
          texte: `<@${id}> est débanni. S'il revient avec le tag, il reçoit son dernier avertissement.`,
        });
        continue;
      }
      if (c.prochaine != null && now >= c.prochaine && !c.banJusqua) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m) await controler(m).catch((e) => console.warn(`[tags] ${id} :`, e.message));
      }
    }
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
  // Activite : un message ou une entree en vocal compte, et le membre est
  // controle tout de suite (regles « actifs seulement » : l avertissement
  // tombe au moment ou il parle).
  const actifMaintenant = (m) => {
    if (!m || m.user?.bot || !garder(m)) return;
    const etaitActif = estActif(m);
    noterActivite(m.id);
    if (!etaitActif || reglagesTags.regles().some((r) => r.actifs)) enFile(() => controler(m)).catch(() => {});
  };
  c.on('messageCreate', (msg) => { if (msg.inGuild()) actifMaintenant(msg.member); });
  c.on('voiceStateUpdate', (avant, apres) => { if (apres.channelId && !avant.channelId) actifMaintenant(apres.member); });
  setInterval(sauverActivite, 60_000).unref();
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
  setInterval(() => echeances().catch((e) => console.warn('[tags] echeances :', e.message)), ECHEANCES_MS).unref();
  console.log(`[tags] surveillance active, ${reglagesTags.regles().length} regle(s)`);
}

