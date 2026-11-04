// Guide du staff : un salon (choisi dans /setup general > Guide staff) ou le
// bot tient a jour une serie d embeds qui expliquent tout le bot. Le texte
// est ecrit ici, mais les VALEURS sont lues dans les reglages au moment du
// rendu : prefixe des commandes, roles autorises par sanction, regles des
// tags, etat de l anti-pub, des tickets et des vocaux. Changer un reglage
// met le guide a jour en moins de 10 minutes (seuls les messages dont le
// contenu a change sont edites).
//
// Une grosse fonctionnalite = une section a ajouter ou a reecrire ici.

import { createHash } from 'node:crypto';
import { escapeMarkdown } from 'discord.js';
import { store } from '../db.js';
import { config } from '../config.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { registre } from '../moderation/actions.js';
import { reglagesAntipub } from '../moderation/antipub.js';
import { reglagesTags } from '../tags/surveillance.js';
import { libelle, resumeSanction } from '../tags/regles.js';
import { reglagesTickets } from '../tickets/reglages.js';
import { reglagesVocaux } from '../vocaux/hub.js';
import { reglagesSuggestions } from '../suggestions/salon.js';
import { reglagesSupport } from '../support/reglages.js';
import { iaDisponible } from '../support/ia.js';

export const reglagesGuide = {
  salon: () => store.kvGet('guide.salon') || null,
  poserSalon: (id) => store.kvSet('guide.salon', id ? String(id) : ''),
  messages: () => { try { return JSON.parse(store.kvGet('guide.messages') ?? '[]'); } catch { return []; } },
  poserMessages: (l) => store.kvSet('guide.messages', JSON.stringify(l)),
};

const role = (id) => `<@&${id}>`;
const roles = (ids, vide = '*personne*') => (ids?.length ? ids.map(role).join(' ') : vide);
const salon = (id, vide = '*pas réglé*') => (id ? `<#${id}>` : vide);
// Les membres en texte : une mention dans un embed s affiche en ID brut.
function membres(guild, ids) {
  return ids.map((id) => {
    const m = guild?.members.cache.get(id);
    return m ? `**${escapeMarkdown(m.displayName)}**` : '*membre parti*';
  }).join(', ');
}

// ------------------------------------------------------------------ sections

function sommaire() {
  const admins = settings.rolesAdmin();
  return embed('📘・GUIDE DU STAFF', {
    couleur: FR.bleu,
    description:
      'Tout ce que fait le bot DonutSMP FR et comment s\'en servir. **Ce guide se met à jour tout seul** :'
      + ' les préfixes, rôles et règles affichés ici sont ceux réglés en ce moment.\n\n'
      + '**Sommaire**\n'
      + '1. 🔨 Sanctions et commandes rapides\n'
      + '2. 🏷️ Tags de serveur interdits\n'
      + '3. 🚫 Anti-pub\n'
      + '4. 🎫 Tickets et support IA\n'
      + '5. ⭐ Vouches, réputation et import\n'
      + '6. 🔗 Liaison, classement et dons\n'
      + '7. 🔊 Vocaux temporaires\n'
      + '8. ⚙️ Configuration\n\n'
      + `👑 **Admins du bot** · ${roles(admins, '*aucun rôle : « Gérer le serveur » suffit*')}\n`
      + '-# Ils ont /setup, /panel, /embed, les tickets et l\'import des vouches. « Gérer le serveur » donne toujours ces droits.',
  });
}

function moderation(guild) {
  const p = registre.prefixe();
  const perms = registre.perms();
  const { membres: tous, roles: rolesTout } = registre.autorises();
  const regle = tous.length || rolesTout.length || Object.values(perms).some((l) => l?.length);
  const qui = (a) => `-# 👮 ${roles(perms[a], regle ? 'seulement ceux qui peuvent tout faire' : 'admins du bot')}`;
  const peutTout = [membres(guild, tous), roles(rolesTout, '')].filter(Boolean).join(' ');
  return embed('🔨・SANCTIONS', {
    couleur: FR.rouge,
    description:
      `Préfixe : **\`${p}\`** · dans n'importe quel salon · le membre par **@mention ou ID**\n`
      + '-# Ton message est effacé, la réponse aussi après 10 s, tout reste dans le journal.\n\n'
      + '### ⚠️ Avertir\n'
      + `\`${p}warn @membre raison\`\n`
      + `\`${p}unwarn @membre [numéro|tout]\` · le dernier par défaut\n`
      + `\`${p}warns @membre\` · son historique\n`
      + `${qui('warn')}\n`
      + '### 🔇 Mute\n'
      + `\`${p}mute @membre [durée] [raison]\` · sans durée : mute d'1 h (28 jours au plus)\n`
      + `\`${p}unmute @membre\`\n`
      + `\`${p}habs @membre\` / \`${p}unhabs @membre\` · met en prison (rôle Prison) ou en sort (aussi \`/habs\`)\n`
      + `${qui('mute')}\n`
      + '### 👢 Expulser\n'
      + `\`${p}kick @membre [raison]\`\n`
      + `${qui('kick')}\n`
      + '### ⛔ Bannir\n'
      + `\`${p}ban @membre [durée] [raison]\` · sans durée : ban définitif\n`
      + `\`${p}unban <ID>\`\n`
      + `${qui('ban')}\n\n`
      + `⏱️ **Durée** : \`10m\` \`2h\` \`3j\` \`1sem\` · ex. \`${p}ban 123456789012345678 3j pub en MP\`\n`
      + (peutTout ? `👑 **Peut tout faire** : ${peutTout}\n` : '')
      + '-# Préfixe et rôles : /setup general > Modération.',
  });
}

function tags() {
  const regles = reglagesTags.regles();
  const lignes = regles.length
    ? regles.map((r) => `• ${libelle(r)} · ${resumeSanction(r)}`).join('\n')
    : '*Aucune règle pour le moment.*';
  return embed('🏷️・TAGS INTERDITS', {
    couleur: FR.or,
    description:
      'Le bot surveille le **tag de serveur** affiché à côté du pseudo des membres (ex. le tag d\'un serveur concurrent)'
      + ' et applique la sanction de la règle. Une règle vise un **texte de tag** ou, plus fiable, l\'**ID du serveur** du tag.\n\n'
      + `**Règles actives**\n${lignes}\n\n`
      + '**Les sanctions possibles**\n'
      + `• **Progressive** : avertissement, puis après ${reglagesTags.delaiHeures()} h un mute de ${reglagesTags.muteHeures()} h,`
      + ` puis un ban de ${reglagesTags.banTempJours()} jours, un dernier avertissement à son retour, et enfin le ban définitif\n`
      + `• **Avertissements puis mute** : N avertissements espacés de ${reglagesTags.delaiHeures()} h, puis un mute\n`
      + '• **Directe** : alerte au staff, retrait du rôle Vérifié, mute, expulsion ou ban\n\n'
      + '**Bon à savoir**\n'
      + '• Les avertissements partent **en MP** ; le salon public ne reçoit que ceux dont les MP sont fermés (effacés après 2 min).\n'
      + `• « Actifs seulement » : on ne vise que les membres qui ont parlé ou été en vocal dans les ${reglagesTags.activiteJours()} derniers jours.\n`
      + '• Retirer le tag arrête tout ; le remettre reprend là où il en était.'
      + ` Le casier est oublié après ${reglagesTags.oubliJours()} jours sans tag.\n`
      + '• Le staff du bot n\'est jamais sanctionné.\n'
      + '-# Règles et délais : /setup general > Tags interdits.',
  });
}

function antipub() {
  const actif = reglagesAntipub.actif();
  const phrases = { off: 'éteint', alerte: 'alerte au staff seulement', supprimer: 'message supprimé' }[reglagesAntipub.phrases()];
  const avantMute = reglagesAntipub.avantMute();
  return embed('🚫・ANTI-PUB', {
    couleur: FR.rouge,
    description:
      `État : ${actif ? '🟢 **actif**' : '🔴 **éteint**'}\n\n`
      + '• **Liens d\'invitation** vers un autre serveur (discord.gg, .gg/…, même déguisés avec des espaces) : message supprimé'
      + ` et avertissement pour l'auteur${avantMute ? `, mute de ${reglagesAntipub.muteHeures()} h au bout de ${avantMute} en 24 h` : ''}.`
      + ' Les invitations vers notre serveur restent permises.\n'
      + `• **Pub sans lien** (« rejoignez mon serveur… ») : un détecteur qui apprend juge les phrases, réglé sur : **${phrases}**`
      + ` (seuil ${Math.round(reglagesAntipub.seuil() * 100)} %). Chaque alerte a deux boutons, **C'est de la pub** et **Pas de la pub** :`
      + ' chaque clic l\'entraîne.\n'
      + '• Clic droit sur un message > Applications > **Signaler comme pub** : apprend aussi au détecteur.\n'
      + '• Jamais touchés : les bots, le staff, les rôles et salons exemptés.\n'
      + '-# Réglages : /setup general > Anti-pub.',
  });
}

function tickets() {
  const cats = reglagesTickets.categories();
  return embed('🎫・TICKETS', {
    couleur: FR.bleu,
    description:
      `Les membres ouvrent un ticket depuis le panneau de ${salon(reglagesTickets.salonPanneau())} : ils choisissent une catégorie,`
      + ' décrivent leur demande, et un salon privé est créé (un seul ticket ouvert par membre).\n\n'
      + `**Catégories** (${cats.length}) : ${cats.map((c) => `${c.emoji} ${c.nom}`).join(' · ')}\n`
      + `**Rôles qui voient les tickets** : ${roles(reglagesTickets.roles(), '*admins du bot*')}\n`
      + `**Logs** : ${salon(reglagesTickets.salonLogs())}\n\n`
      + '**Les boutons du ticket**\n'
      + '🙋 **Prendre en charge** · ton nom s\'affiche, les autres savent que c\'est géré\n'
      + '➕ **Ajouter un membre** · l\'autre partie d\'un trade, un témoin…\n'
      + '🔒 **Fermer** (ou `/close`) / 🔓 **Rouvrir** · le membre n\'écrit plus, le salon reste\n'
      + '📄 **Sauvegarder les logs** · transcript dans le salon des logs\n'
      + '🗑️ **Supprimer** · pas de transcript automatique : clique **Sauvegarder les logs** avant si la conversation compte\n\n'
      + '**Fin automatique**\n'
      + '⏳ Le membre ne répond plus depuis **24 h** à une réponse du staff ou du support : le bot le prévient, et **24 h** plus tard sans un mot de personne le ticket est supprimé. Un message de n\'importe qui annule. Un ticket où le membre attend le staff n\'est jamais supprimé pour ça. Les logs sont sauvegardés automatiquement avant.\n'
      + '✅ Quand le support a réglé la demande, il demande au membre si c\'est résolu : **Oui** = ticket supprimé 1 minute plus tard, **Non** = on continue.\n'
      + '-# Catégories, dossiers et rôles : /setup tickets.',
  });
}

function supportIA() {
  const r = reglagesSupport.reglages();
  const actif = reglagesSupport.actif() && iaDisponible();
  return embed('🤖・SUPPORT IA DES TICKETS', {
    couleur: FR.bleu,
    description:
      `État : ${actif ? '🟢 **actif**' : '🔴 **éteint**'}\n\n`
      + `Quand personne du staff n'a répondu depuis **${r.delaiJourMin} min** (**${r.delaiNuitMin} min la nuit**, de ${r.nuitDebut} h à ${r.nuitFin} h),`
      + ' l\'assistant prend le **début** du ticket : il accueille, fait préciser ce qui manque (pseudo, captures, dates) et répond seul'
      + ' aux questions simples de support technique. Ses messages arrivent dans un encadré « 💬 Support DonutSMP FR ».\n\n'
      + '• **Il se tait** dès qu\'un membre du staff écrit ou clique **Prendre en charge**. Il ne revient que si une demande du membre reste **30 min** sans réponse, et seulement s\'il juge qu\'elle est restée en plan (un merci ou un ok ne le réveille pas).\n'
      + '• Argent, scam, sanctions, middleman, partenariat : il ne promet rien, rassemble les faits et **transmet** (alerte dans le journal).\n'
      + '• **Chaque jour à 5 h**, il relit les tickets où le staff a répondu et propose des entrées de FAQ :'
      + ' ✅ Ajouter, ✏️ Modifier ou ❌ Ignorer. Rien n\'entre dans la FAQ sans votre clic.\n'
      + `• FAQ actuelle : **${reglagesSupport.faq().length}** entrée(s).\n`
      + '-# Réglages, FAQ et revue : /setup general > Support IA.',
  });
}

function vouches() {
  return embed('⭐・VOUCHES ET RÉPUTATION', {
    couleur: FR.or,
    description:
      `Chaque membre a un **post de réputation** dans ${salon(settings.salonVouch())}, en lecture seule : seul le bot y écrit. Un membre non lié en a un dès son premier avis, à son nom Discord ; le jour où il lie son compte, le même post passe à son pseudo Minecraft et garde ses avis.`
      + ' On y donne un avis avec le bouton du post ou `/vouch`.\n\n'
      + '• **Vouch** : 1 à 5 étoiles et un message facultatif.\n'
      + '• **Signalement de scam** : message de 20 caractères minimum ET une preuve (capture, vidéo ou clip Medal) obligatoires.\n'
      + '• Il faut être lié depuis 24 h pour noter, 10 nouveaux avis au plus par 24 h, un seul avis par personne notée (modifiable).\n'
      + '• **Trust score** affiché à partir de 5 avis. 2 signalements = profil **☠️ Signalé**, sans score et hors du top.'
      + `${settings.roleTrusted() ? ` Le rôle ${role(settings.roleTrusted())} est donné aux profils de confiance.` : ''}\n`
      + '• Chaque avis a un bouton **Retirer (staff)** : à utiliser pour un faux avis ou un avis entre alts.\n\n'
      + '**Importer les anciens vouches** (admins du bot)\n'
      + '`/importer-vouches fil:<lien du post de l\'ancien forum> [membre]`\n'
      + 'Le bot lit le fil, garde une réponse par membre et prépare une fiche : tu **exclus** ce qui ne va pas, puis tu **importes**.'
      + ' Les vouches gardent leur auteur et leur date d\'origine (« [Ancien vouch] »). Un message n\'est jamais importé deux fois,'
      + ' et un avis récent de la même personne passe avant l\'ancien.\n'
      + '-# Forum, panneau et rôle Trusted : /setup vouches.',
  });
}

function liaison() {
  return embed('🔗・LIAISON, CLASSEMENT ET DONS', {
    couleur: FR.vert,
    description:
      `**Liaison** : dans ${salon(settings.salonLink())}, le membre clique sur **Se connecter**, donne son pseudo et envoie`
      + ' en jeu le petit `/pay` demandé au compte du bot. Le bot le voit, lie le compte, donne le rôle'
      + `${settings.roleVerifie() ? ` ${role(settings.roleVerifie())}` : ' Vérifié'} et rembourse le paiement.`
      + ' Si le bot en jeu est hors ligne, les liaisons attendent.\n\n'
      + `**Classement** : ${salon(settings.salonBaltop())} montre les 10 plus grosses fortunes des membres liés,`
      + ' mis à jour tout seul. `/baltop` et `/bal` pour le reste. Les membres partis sont retirés.\n\n'
      + `**Dons** : \`/pay\` au compte du bot en jeu ; le panneau de ${salon(settings.salonDonations())} affiche les plus gros donateurs`
      + ' et les rôles par palier sont donnés automatiquement.'
      + `${settings.beneficiaire() ? ` Les dons sont reversés chaque nuit à \`${settings.beneficiaire()}\`.` : ''}\n`
      + '-# L\'argent en jeu ne bouge jamais sans l\'accord de Ryan.',
  });
}

function vocaux() {
  const hub = reglagesVocaux.hub();
  return embed('🔊・VOCAUX TEMPORAIRES', {
    couleur: FR.bleu,
    description:
      `État : ${hub ? `🟢 **actif**, hub ${salon(hub)}` : '🔴 **éteint**'}\n\n`
      + 'Rejoindre le hub crée un vocal perso et y déplace le membre, qui en devient propriétaire. Dans le chat du vocal, un panneau (et `/vocal`) :\n'
      + '• **Réglages** : nom (gardé pour ses prochains vocaux), limite, statut, caméra et soundboard 💎, région (propriétaire du serveur), réinitialiser, sauvegarder ses réglages\n'
      + '• **Permissions** : verrouiller, déverrouiller, autoriser, refuser, inviter en MP 💎, expulser, transférer, voir les accès\n'
      + '💎 = boosters seulement. Si le propriétaire part, le vocal passe à quelqu\'un qui est dedans. Les rôles protégés ne peuvent être ni expulsés ni refusés.\n'
      + 'Le staff peut tout faire sur n\'importe quel vocal. Le vocal est supprimé quand il se vide.'
      + `${reglagesVocaux.salonLogs() ? ` Ouvertures et fermetures (durée, participants) dans ${salon(reglagesVocaux.salonLogs())}.` : ''}\n`
      + '💎 **Super Booster** : le rôle n\'existe qu\'avec 2 boosts actifs : le bot le donne tout seul (il compte les messages de boost du salon système) et le retire à quiconque ne les a pas, même s\'il a été donné à la main.\n'
      + '-# Hub, catégorie, logs, rôles protégés, nom et limite par défaut : /setup general > Vocaux.',
  });
}

function configuration() {
  return embed('⚙️・CONFIGURATION', {
    couleur: FR.bleu,
    description:
      '`/setup general` · tout : rôles, salons, panneaux, logs, dons, bot en jeu, tags, modération, anti-pub, vocaux, compteurs, support IA, ce guide\n'
      + '`/setup tickets` · `/setup vouches` · `/setup dons` · réglages de chaque système\n'
      + '`/panel` · republier un panneau dans un salon · `/embed create` · poster un embed\n'
      + '`/statut` · statut du bot · `/sauvegarde` · télécharger toutes les données du bot\n\n'
      + `**Journal du bot** : ${salon(settings.salonJournal())} (pannes, erreurs, sanctions automatiques)\n`
      + `**Logs des liaisons** : ${salon(settings.salonLogs())}\n`
      + `**Idées et bugs du bot** : ${salon(reglagesSuggestions.salon())} (un ✅ = un vote)\n`
      + `-# Un souci avec le bot : prévenir **NotRyzn**${reglagesSuggestions.salon() ? ` ou le poster dans ${salon(reglagesSuggestions.salon())}` : ''}.`,
  });
}

export function rendreGuide(guild) {
  return [sommaire(), moderation(guild), tags(), antipub(), tickets(), supportIA(), vouches(), liaison(), vocaux(), configuration()];
}

// ------------------------------------------------------------------ publication

const empreinte = (e) => createHash('sha1').update(JSON.stringify(e.toJSON())).digest('hex');
let dernieres = [];

/**
 * Publie le guide dans son salon : edite les messages existants dont le
 * contenu a change, en poste s il en manque. Si les messages ne se suivent
 * plus (supprimes), tout est republie dans l ordre.
 */
export async function publierGuide(client, { force = false } = {}) {
  const id = reglagesGuide.salon();
  if (!id) return { note: 'aucun salon' };
  const guild = client.guilds.cache.get(config.discord.guildId);
  const s = await client.channels.fetch(id).catch(() => null);
  if (!guild || !s?.isTextBased?.()) return { note: 'salon introuvable' };

  // Au demarrage la liste des membres n est pas encore chargee : on va
  // chercher ceux que le guide nomme (une requete par membre, pas la passerelle).
  for (const mid of registre.autorises().membres) {
    if (!guild.members.cache.has(mid)) await guild.members.fetch(mid).catch(() => null);
  }
  const embeds = rendreGuide(guild);
  const empreintes = embeds.map(empreinte);
  if (!force && empreintes.join() === dernieres.join()) return { note: 'à jour' };

  const ids = reglagesGuide.messages();
  const existants = [];
  for (const mid of ids) existants.push(await s.messages.fetch(mid).catch(() => null));
  const complet = ids.length === embeds.length && existants.every(Boolean);

  if (!complet) {
    for (const m of existants) await m?.delete().catch(() => {});
    const nouveaux = [];
    for (const e of embeds) {
      const m = await s.send({ embeds: [e], allowedMentions: { parse: [] } });
      nouveaux.push(m.id);
    }
    reglagesGuide.poserMessages(nouveaux);
    dernieres = empreintes;
    return { note: 'guide publié' };
  }
  let n = 0;
  for (let i = 0; i < embeds.length; i += 1) {
    if (!force && dernieres[i] === empreintes[i]) continue;
    await existants[i].edit({ embeds: [embeds[i]], allowedMentions: { parse: [] } }).catch((e) => console.warn('[guide] :', e.message));
    n += 1;
  }
  dernieres = empreintes;
  return { note: n ? `${n} section(s) mise(s) à jour` : 'à jour' };
}

export function demarrerGuide(client) {
  const tourner = () => publierGuide(client).then((r) => { if (r.note !== 'à jour' && r.note !== 'aucun salon') console.log(`[guide] ${r.note}`); })
    .catch((e) => console.warn('[guide] :', e.message));
  // Au demarrage on reedite tout (le texte a pu changer avec une mise a jour).
  publierGuide(client, { force: true }).then((r) => console.log(`[guide] ${r.note}`)).catch((e) => console.warn('[guide] :', e.message));
  setInterval(tourner, 10 * 60_000).unref();
}
