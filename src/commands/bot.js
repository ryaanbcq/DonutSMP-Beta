// /bot auth : les comptes Minecraft du bot en jeu, en UN panneau a boutons
// (meme facture que /setup general).
//
//   /bot auth status   ouvre le panneau : etat, compte actif, secours, et
//                      les boutons Ajouter / Basculer / Retirer / Message
//   /bot auth add      raccourci du bouton Ajouter
//   /bot auth switch   raccourci du menu Basculer
//   /bot auth remove   raccourci du bouton Retirer
//
// Reserve a l acces TOTAL (voir aAccesTotal). Le code Microsoft ne sort jamais d un message ephemere :
// qui le valide prend le compte.

import {
  SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  PermissionFlagsBits, PermissionsBitField,
} from 'discord.js';
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import prismarineAuth from 'prismarine-auth';
import { registre } from '../moderation/actions.js';

/**
 * Acces TOTAL, le meme que la hierarchie de /setup general > Modération :
 * le proprietaire du serveur, les developpeurs (DEV_USER_IDS) et les membres
 * ou roles « 👑 Peut tout faire ». Le role admin du bot ne suffit PAS : ces
 * comptes encaissent l argent des /link et des dons. Tant que personne n est
 * regle dans « Peut tout faire », seule la permission Administrateur passe.
 */
export function aAccesTotal(membre, reglages = null) {
  if (!membre) return false;
  const id = membre.id ?? membre.user?.id;
  if (id && membre.guild?.ownerId === id) return true;
  if (id && (config.discord.devUserIds ?? []).includes(id)) return true;
  const { membres, roles } = reglages ?? registre.autorises();
  if (id && membres.includes(id)) return true;
  const r = membre.roles;
  const aRole = (x) => (typeof r?.cache?.has === 'function' ? r.cache.has(x) : Array.isArray(r) && r.includes(x));
  if (roles.some(aRole)) return true;
  if (membres.length || roles.length) return false;
  const p = membre.permissions;
  if (typeof p?.has === 'function') return p.has(PermissionFlagsBits.Administrator);
  try { return new PermissionsBitField(BigInt(p)).has(PermissionFlagsBits.Administrator); } catch { return false; }
}
import { embed, FR } from '../lib/brand.js';
import { config } from '../config.js';
import { presence, PERIME } from '../ingame/presence.js';
import {
  lireRegistre, compteActif, trouverCompte, ajouterCompte, retirerCompte, activerCompte,
  dossierPour, idDe, DOSSIER_COMPTES,
} from '../ingame/comptes.js';
import { journal } from '../ops/journal.js';

const { Authflow, Titles } = prismarineAuth;

export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Staff : le bot en jeu')
  .addSubcommandGroup((g) => g.setName('auth').setDescription('Comptes Minecraft du bot en jeu')
    .addSubcommand((s) => s.setName('status').setDescription('Panneau des comptes du bot : état, secours, bascule'))
    .addSubcommand((s) => s.setName('add').setDescription('Ajouter un compte de secours (sans couper le compte actuel)'))
    .addSubcommand((s) => s.setName('switch').setDescription('Basculer le bot en jeu sur un autre compte')
      .addStringOption((o) => o.setName('compte').setDescription('Compte enregistré').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Oublier un compte et son jeton')
      .addStringOption((o) => o.setName('compte').setDescription('Compte enregistré').setRequired(true).setAutocomplete(true))));

const prive = (p) => ({ ...p, flags: MessageFlags.Ephemeral });
const qui = (i) => i.user.tag ?? i.user.username ?? i.user.id;
const t = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const nomDe = (c) => c?.nom ?? c?.id ?? '?';
const bouton = (id, label, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder()
  .setCustomId(`botauth:${id}`).setLabel(label).setEmoji(emoji).setStyle(style);
const ligne = (...b) => new ActionRowBuilder().addComponents(...b);

const refus = () => prive({
  embeds: [embed('🔒・ACCÈS RÉSERVÉ', { couleur: FR.rouge, image: 'aucune', description: 'Réservé à l\'**accès total** : les membres et rôles « 👑 Peut tout faire » de `/setup general` > Modération, et le propriétaire du serveur. Ces comptes encaissent l\'argent des `/link` et des dons.' })],
});

export async function autocomplete(interaction) {
  if (!aAccesTotal(interaction.member)) return interaction.respond([]);
  const saisi = idDe(interaction.options.getFocused());
  const reg = lireRegistre();
  const sub = interaction.options.getSubcommand(false);
  const choix = reg.comptes
    .filter((c) => !((sub === 'remove' || sub === 'switch') && c.id === reg.actif))
    .filter((c) => !saisi || c.id.includes(saisi))
    .slice(0, 25)
    .map((c) => ({ name: nomDe(c), value: c.id }));
  return interaction.respond(choix);
}

export async function execute(interaction) {
  if (!aAccesTotal(interaction.member)) return interaction.reply(refus());
  const sub = interaction.options.getSubcommand();
  if (sub === 'status') return interaction.reply(prive(await panneau()));
  if (sub === 'add') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return ajouter(interaction);
  }
  if (sub === 'switch') {
    const c = trouverCompte(interaction.options.getString('compte'));
    if (!c) return interaction.reply(prive(await panneau('⛔ Ce compte n\'est pas enregistré.')));
    return interaction.reply(prive(confirmationBascule(c)));
  }
  if (sub === 'remove') {
    const c = trouverCompte(interaction.options.getString('compte'));
    if (!c) return interaction.reply(prive(await panneau('⛔ Ce compte n\'est pas enregistré.')));
    return interaction.reply(prive(confirmationRetrait(c)));
  }
  return null;
}

// --------------------------------------------------------------- panneau ---

/** Une ligne d etat courte, partagee avec /link et le setup. */
function etatEnClair(etat) {
  if (etat.enLigne) return { emoji: '🟢', texte: 'en jeu, les paiements de vérification sont vus', couleur: FR.vert };
  if (etat.bloquant) {
    return {
      emoji: '⛔',
      texte: `**bloqué par DonutSMP**${etat.kickA ? ` ${t(etat.kickA)}` : ''}${etat.banId ? ` (Ban ID \`${etat.banId}\`)` : ''}`,
      couleur: FR.rouge,
    };
  }
  if (etat.raison === 'muet' || etat.raison === 'jamais_demarre') return { emoji: '🔴', texte: 'arrêté sur la machine', couleur: FR.rouge };
  const pourquoi = etat.raison && etat.raison !== 'deconnecte' ? ` (${etat.raison})` : '';
  return { emoji: '🟠', texte: `déconnecté${pourquoi}, il se reconnecte seul`, couleur: FR.jaune };
}

// Ce qu il faut faire, en une phrase, selon la situation.
function conseil(etat, secours) {
  if (etat.enLigne) {
    return secours.length
      ? 'Tout va bien. Si DonutSMP bloque ce compte, choisis un secours dans le menu : le bot bascule en quelques secondes.'
      : 'Tout va bien. Ajoute un **compte de secours** maintenant : le jour où ce compte est bloqué, tu bascules en un clic.';
  }
  if (etat.bloquant) {
    return secours.length
      ? '**Bascule sur un compte de secours** avec le menu ci-dessous pour rouvrir les `/link` tout de suite, puis fais appel chez DonutSMP.'
      : 'Fais appel chez DonutSMP (ticket sur discord.gg/donutsmp) avec le Ban ID. Pour rouvrir les `/link` sans attendre : **Ajouter un compte**, puis bascule dessus.';
  }
  if (etat.raison === 'muet' || etat.raison === 'jamais_demarre') {
    return 'Le process `fr-ingame` est arrêté. Choisir un compte dans le menu le relance, ou sur la machine : `pm2 start fr-ingame`.';
  }
  return 'Rien à faire pour l\'instant : il revient tout seul. Si ça dure, **Actualiser** pour suivre.';
}

export async function panneau(note = null) {
  const reg = lireRegistre();
  const actif = compteActif(reg);
  const secours = reg.comptes.filter((c) => c.id !== reg.actif);
  const etat = await presence();
  const e = etatEnClair(etat);
  const mauvais = etat.username && actif?.nom && etat.username.toLowerCase() !== actif.nom.toLowerCase();

  const lignes = [
    `${e.emoji} **État** · ${e.texte}`,
    `👤 **Compte qui encaisse** · \`${nomDe(actif)}\``,
    `🛟 **Comptes de secours** · ${secours.length ? secours.map((c) => `\`${nomDe(c)}\``).join(' ') : '*aucun*'}`,
  ];
  if (mauvais) lignes.push(`⚠️ **Connecté en** \`${etat.username}\` : les paiements vers \`${nomDe(actif)}\` ne seraient pas vus.`);

  const description = 'Le compte Minecraft qui reçoit les `/pay` des `/link` et des dons. Garde un secours prêt :'
    + ' si DonutSMP bloque le compte, tu bascules en un clic.\n\n'
    + `${lignes.join('\n')}\n\n`
    + (etat.rapport?.resume && !etat.enLigne ? `### 🧠 Ce qui se passe\n${etat.rapport.resume}\n` : '')
    + `### 👉 Que faire\n${conseil(etat, secours)}`
    + (note ? `\n\n${note}` : '');

  const composants = [];
  if (secours.length) {
    composants.push(ligne(new StringSelectMenuBuilder().setCustomId('botauth:choisir')
      .setPlaceholder('🔀 Basculer le bot sur…')
      .addOptions(secours.slice(0, 25).map((c) => ({
        label: nomDe(c),
        value: c.id,
        emoji: '🛟',
        description: c.vuEnJeuA ? 'Déjà entré en jeu' : 'Jamais encore entré en jeu',
      })))));
  }
  composants.push(ligne(
    bouton('ajouter', 'Ajouter un compte', '➕', ButtonStyle.Success),
    bouton('message', 'Message de DonutSMP', '📨').setDisabled(!etat.motif),
    bouton('retirer', 'Retirer un compte', '🗑️', ButtonStyle.Danger).setDisabled(!secours.length),
    bouton('panneau', 'Actualiser', '♻️'),
  ));

  return {
    embeds: [embed('🤖・COMPTES DU BOT', { couleur: e.couleur, image: nomDe(actif), description })],
    components: composants,
  };
}

// ------------------------------------------------------------ interactions ---

export async function onBotAuth(interaction) {
  if (!aAccesTotal(interaction.member)) return interaction.reply(refus());
  const [, action, arg] = interaction.customId.split(':');

  if (action === 'panneau') return interaction.update(await panneau());

  if (action === 'message') {
    const etat = await presence();
    return interaction.reply(prive({
      embeds: [embed('📨・MESSAGE DE DONUTSMP', {
        couleur: FR.rouge,
        image: 'aucune',
        description: etat.motif
          ? `Ce que DonutSMP a répondu au bot ${etat.kickA ? t(etat.kickA) : ''} :\n\n${citation(etat.motif)}`
            + (etat.rapport?.queFaire ? `\n\n### 🛠️ À faire\n${etat.rapport.queFaire}` : '')
          : 'Aucun refus enregistré.',
      })],
    }));
  }

  if (action === 'ajouter') {
    await interaction.deferUpdate();
    return ajouter(interaction);
  }

  if (action === 'choisir') {
    const c = trouverCompte(interaction.values[0]);
    if (!c) return interaction.update(await panneau('⛔ Ce compte n\'existe plus.'));
    return interaction.update(confirmationBascule(c));
  }
  if (action === 'basculer') {
    await interaction.deferUpdate();
    const note = await basculer(interaction, arg);
    // Laisse au bot en jeu le temps de lire l ordre avant d afficher l etat.
    await new Promise((r) => setTimeout(r, 3000));
    return interaction.editReply(await panneau(note));
  }

  if (action === 'retirer') {
    const reg = lireRegistre();
    const secours = reg.comptes.filter((c) => c.id !== reg.actif);
    if (!secours.length) return interaction.update(await panneau());
    return interaction.update({
      embeds: [embed('🗑️・RETIRER UN COMPTE', {
        couleur: FR.jaune,
        image: 'aucune',
        description: 'Choisis le compte à oublier. Son jeton Microsoft est **effacé** de la machine :'
          + ' pour le réutiliser, il faudra le rajouter avec **Ajouter un compte**.\n\n'
          + `Le compte qui encaisse (\`${nomDe(compteActif(reg))}\`) ne peut pas être retiré.`,
      })],
      components: [
        ligne(new StringSelectMenuBuilder().setCustomId('botauth:aretirer').setPlaceholder('🗑️ Compte à retirer…')
          .addOptions(secours.slice(0, 25).map((c) => ({ label: nomDe(c), value: c.id, emoji: '🛟' })))),
        ligne(bouton('panneau', 'Annuler', '↩️')),
      ],
    });
  }
  if (action === 'aretirer') {
    const c = trouverCompte(interaction.values[0]);
    if (!c) return interaction.update(await panneau('⛔ Ce compte n\'existe plus.'));
    return interaction.update(confirmationRetrait(c));
  }
  if (action === 'retirerok') return interaction.update(await panneau(await retirer(interaction, arg)));

  return null;
}

// ---------------------------------------------------------------- bascule ---

function confirmationBascule(c) {
  const actif = compteActif();
  return {
    embeds: [embed('🔀・BASCULER LE BOT', {
      couleur: FR.jaune,
      image: nomDe(c),
      description: `Le bot quitte \`${nomDe(actif)}\` et entre en jeu avec **\`${nomDe(c)}\`**.\n\n`
        + `- Les nouveaux \`/link\` demanderont de payer **${nomDe(c)}**, les panneaux se mettent à jour seuls.\n`
        + `- Les dons pas encore reversés restent sur \`${nomDe(actif)}\`.\n`
        + '- Ça prend quelques secondes, le temps de la reconnexion.',
    })],
    components: [ligne(
      bouton(`basculer:${c.id}`, `Basculer sur ${nomDe(c)}`.slice(0, 80), '🔀', ButtonStyle.Danger),
      bouton('panneau', 'Annuler', '↩️'),
    )],
  };
}

function demarrerBotJeu() {
  return new Promise((resolve) => {
    execFile('pm2', ['start', 'ecosystem.config.cjs', '--only', 'fr-ingame'], { cwd: process.cwd(), timeout: 30_000 },
      (err) => resolve(err ? err.message : null));
  });
}

/** Bascule et rend la note a afficher dans le panneau. */
async function basculer(interaction, id) {
  const reg = lireRegistre();
  const c = trouverCompte(id, reg);
  if (!c) return '⛔ Ce compte n\'existe plus.';
  const avant = compteActif(reg);
  if (c.id === reg.actif) return `ℹ️ \`${nomDe(c)}\` encaisse déjà.`;
  activerCompte(c.id);

  const etat = await presence();
  let note;
  if (etat.age != null && etat.age < PERIME) {
    await mkdir(dirname(config.ingame.controlFile), { recursive: true });
    await writeFile(config.ingame.controlFile, JSON.stringify({ action: 'switch', id: c.id, par: qui(interaction), at: Date.now() }), { mode: 0o600 });
    note = `✅ Bascule lancée : le bot se reconnecte avec \`${nomDe(c)}\`. **Actualiser** dans quelques secondes pour le voir en jeu.`;
  } else {
    // Bot en jeu arrete (ex. apres un ban) : on le relance, il lit le registre au demarrage.
    const err = await demarrerBotJeu();
    note = err
      ? `⚠️ \`${nomDe(c)}\` est le nouveau compte, mais le bot en jeu n'a pas pu être relancé. Sur la machine : \`pm2 start fr-ingame\`.`
      : `✅ Le bot en jeu était arrêté : il redémarre avec \`${nomDe(c)}\`. **Actualiser** dans quelques secondes.`;
  }
  journal({
    niveau: 'info', titre: 'Bascule de compte',
    texte: `<@${interaction.user.id}> bascule le bot en jeu de **${nomDe(avant)}** vers **${nomDe(c)}**.`,
    champs: { Par: qui(interaction) },
  });
  return note;
}

// ----------------------------------------------------------------- retrait ---

function confirmationRetrait(c) {
  if (c.id === lireRegistre().actif) {
    return {
      embeds: [embed('⛔・IMPOSSIBLE', { couleur: FR.rouge, image: 'aucune', description: `\`${nomDe(c)}\` encaisse en ce moment : bascule d'abord sur un autre compte.` })],
      components: [ligne(bouton('panneau', 'Retour', '↩️'))],
    };
  }
  return {
    embeds: [embed('🗑️・RETIRER UN COMPTE', {
      couleur: FR.rouge,
      image: nomDe(c),
      description: `Oublier **\`${nomDe(c)}\`** et effacer son jeton Microsoft de la machine ?`,
    })],
    components: [ligne(
      bouton(`retirerok:${c.id}`, `Retirer ${nomDe(c)}`.slice(0, 80), '🗑️', ButtonStyle.Danger),
      bouton('panneau', 'Annuler', '↩️'),
    )],
  };
}

async function retirer(interaction, id) {
  let c;
  try {
    c = retirerCompte(id);
  } catch (e) {
    return e.message === 'compte actif' ? '⛔ Ce compte encaisse : bascule d\'abord.' : '⛔ Ce compte n\'existe plus.';
  }
  // Jamais le dossier du .env (il peut etre partage avec `donut auth`).
  const dossierEnv = process.env.MC_PROFILES_FOLDER ?? './data/msa-cache';
  if (c.dossier && c.dossier !== dossierEnv) await rm(c.dossier, { recursive: true, force: true }).catch(() => {});
  journal({ niveau: 'info', titre: 'Compte retiré', texte: `<@${interaction.user.id}> a retiré **${nomDe(c)}** des comptes du bot.`, champs: { Par: qui(interaction) } });
  return `🗑️ \`${nomDe(c)}\` est oublié, son jeton effacé.`;
}

// ------------------------------------------------------------------ ajout ---

let ajoutEnCours = null;

/** L interaction est deja differee : tout passe par editReply (panneau ou reponse). */
async function ajouter(interaction) {
  if (ajoutEnCours) return interaction.editReply(await panneau(`⏳ Un ajout est déjà en cours (lancé par ${ajoutEnCours}).`));
  ajoutEnCours = qui(interaction);
  // Dossier provisoire : on ne connait le pseudo qu apres la connexion.
  const provisoire = `${DOSSIER_COMPTES()}/.ajout-${Date.now()}`;
  const cle = `donutfr-${Date.now()}`;
  try {
    await mkdir(provisoire, { recursive: true, mode: 0o700 });
    await interaction.editReply({
      embeds: [embed('➕・AJOUTER UN COMPTE', { couleur: FR.bleu, image: 'aucune', description: '⏳ Je demande un code à Microsoft…' })],
      components: [],
    });
    const flow = new Authflow(cle, provisoire, {
      // Memes reglages que mineflayer, sinon le bot en jeu ne reutiliserait pas le jeton.
      flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo',
    }, (res) => {
      const lien = `https://www.microsoft.com/link?otc=${encodeURIComponent(res.user_code)}`;
      const expire = Date.now() + (Number(res.expires_in) || 900) * 1000;
      interaction.editReply({
        embeds: [embed('➕・AJOUTER UN COMPTE', {
          couleur: FR.jaune,
          image: 'aucune',
          description: `# \`${res.user_code}\`\n`
            + '1. **Ouvrir la page Microsoft** (le code est déjà rempli).\n'
            + '2. Connecte-toi avec le compte Microsoft **du nouveau bot**, pas le tien.\n'
            + '3. Accepte. Ce panneau se met à jour tout seul.\n\n'
            + `Le compte actuel continue de jouer pendant ce temps. Code valable jusqu'à <t:${Math.floor(expire / 1000)}:t>,`
            + ' **ne le partage avec personne** : qui le valide prend le compte.',
        })],
        components: [ligne(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ouvrir la page Microsoft').setEmoji('🌐').setURL(lien),
        )],
      }).catch(() => {});
    });
    journal({ niveau: 'info', titre: 'Ajout de compte lancé', texte: `<@${interaction.user.id}> connecte un nouveau compte Minecraft pour le bot.`, champs: { Par: qui(interaction) } });
    const { profile } = await flow.getMinecraftJavaToken({ fetchProfile: true });
    if (!profile?.name) throw new Error('ce compte Microsoft ne possède pas Minecraft Java');

    const id = idDe(profile.name);
    const reg = lireRegistre();
    const existant = trouverCompte(id, reg);
    if (existant?.id === reg.actif) {
      // Le compte actif lui-meme : on ne touche pas au jeton qui tourne.
      await rm(provisoire, { recursive: true, force: true });
      return interaction.editReply(await panneau(`ℹ️ \`${profile.name}\` est déjà le compte qui encaisse.`));
    }
    const dossier = dossierPour(id);
    await rm(dossier, { recursive: true, force: true });
    await rename(provisoire, dossier);
    ajouterCompte({ nom: profile.name, uuid: profile.id ?? null, cle, dossier, par: qui(interaction) });
    journal({
      niveau: 'ok', titre: 'Compte de secours ajouté', texte: `**${profile.name}** est prêt à prendre le relais.`,
      champs: { Compte: profile.name, Par: qui(interaction) }, joueur: profile.name,
    });
    return interaction.editReply(await panneau(`✅ \`${profile.name}\` est ajouté en secours${existant ? ' (jeton renouvelé)' : ''}. Pour l'utiliser : menu **Basculer le bot sur…**`));
  } catch (e) {
    await rm(provisoire, { recursive: true, force: true }).catch(() => {});
    console.error('[bot auth] ajout echoue :', e.message);
    const pourquoi = /own|profile|Not Found/i.test(e.message)
      ? 'ce compte Microsoft ne possède pas Minecraft Java'
      : 'la connexion Microsoft a échoué ou le code a expiré';
    return interaction.editReply(await panneau(`⛔ Ajout impossible : ${pourquoi}.`)).catch(() => {});
  } finally {
    ajoutEnCours = null;
  }
}

// Le message brut de DonutSMP, sans le bruit de proxy, en citation courte.
function citation(motif) {
  const propre = String(motif)
    .replace(/Connect reason:.*?(already online)?\s*/i, '')
    .replace(/You are connected to proxy:\s*\S+\s*/i, '')
    .trim();
  const court = propre.length > 900 ? `${propre.slice(0, 899)}…` : propre;
  return court.split(/(?<=[.!?])\s+/).map((l) => `> ${l}`).join('\n');
}
