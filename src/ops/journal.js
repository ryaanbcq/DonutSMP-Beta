// Journal technique du bot, poste en embeds dans un salon staff.
//
// Un seul endroit pour comprendre ce qui se passe : liens crees, avis postes,
// deconnexions du bot en jeu, remboursements en echec, erreurs de commande.
// Les evenements du bot en jeu arrivent par fichier (il n a pas de client
// Discord), le reste appelle `journal()` directement.
//
// Deux regles de survie :
//   - jamais de secret dans un embed (le code Microsoft n est pas poste) ;
//   - un evenement identique qui se repete est compte, pas reposte : une
//     boucle de reconnexion ne doit pas noyer le salon.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { config } from '../config.js';
import { Tailer } from '../lib/tail.js';
import { FR, skin } from '../lib/brand.js';

const COULEURS = { ok: FR.vert, info: FR.bleu, warn: FR.jaune, err: FR.rouge };
const PUCES = { ok: '🟢', info: '🔵', warn: '🟡', err: '🔴' };
// Ligne d auteur a la charte : on sait d un coup d oeil quel process parle.
const SOURCES = { jeu: '🎮・BOT EN JEU', discord: '💬・BOT DISCORD' };

// Limites de l API Discord : un embed trop long est refuse en entier (50035).
const MAX = { titre: 256, texte: 4096, nom: 256, valeur: 1024 };
const couper = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Boutons qu un evenement peut demander. Le traitement vit dans src/ops/actions.js.
const BOUTONS = {
  msa: () => new ButtonBuilder()
    .setCustomId('ops:msa').setLabel('Afficher le code').setEmoji('🔑').setStyle(ButtonStyle.Primary),
  relink: () => new ButtonBuilder()
    .setCustomId('ops:relink').setLabel('Relink le compte').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
};

function composants(actions) {
  const boutons = (actions ?? []).map((a) => BOUTONS[a]?.()).filter(Boolean);
  return boutons.length ? [new ActionRowBuilder().addComponents(boutons.slice(0, 5))] : [];
}

const FENETRE_DOUBLON_MS = 60_000;
const derniers = new Map();   // titre+texte -> { at, message }

let salon = null;
let file = Promise.resolve();

export function salonConfigure() { return Boolean(salon); }

// Salons thematiques (dons...) : recoivent en plus les evenements marques
// de leur canal, sans passer par le dedoublonnage du journal.
const canaux = new Map();
export function surCanal(nom, fn) { canaux.set(nom, fn); }

/** Pose un salon a la main. Utilise par les tests, jamais par le bot. */
export function poserSalon(s) {
  salon = s;
  derniers.clear();
  file = Promise.resolve();
}

/** Attend que la file d envoi soit videe (tests). */
export function attendreJournal() { return file; }

function construire({ niveau = 'info', titre, texte, champs, joueur, source = 'discord', at }) {
  const e = new EmbedBuilder()
    .setColor(COULEURS[niveau] ?? COULEURS.info)
    .setAuthor({ name: SOURCES[source] ?? SOURCES.discord })
    .setTitle(couper(`${PUCES[niveau] ?? PUCES.info} ${titre}`, MAX.titre))
    .setTimestamp(at ? new Date(at) : new Date());
  if (texte) e.setDescription(couper(String(texte), MAX.texte));
  // L evenement parle d un joueur : sa tete en vignette, comme les embeds publics.
  const tete = joueur ? skin(joueur) : null;
  if (tete) e.setThumbnail(tete);
  const paires = Object.entries(champs ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (paires.length) {
    e.addFields(paires.slice(0, 6).map(([name, value]) => ({
      name: couper(String(name), MAX.nom),
      value: couper(String(value), MAX.valeur),
      inline: true,
    })));
  }
  return e;
}

/**
 * Poste un evenement. Ne rejette jamais : un journal casse ne doit pas casser
 * ce qu il journalise.
 */
export function journal(evenement) {
  if (!salon) return;
  // Serialise : les embeds arrivent dans l ordre ou les choses se sont passees.
  file = file.then(() => envoyer(evenement)).catch(() => {});
}

async function envoyer(evenement) {
  // Les champs (delai, essai...) ne comptent pas : une boucle de reconnexion
  // dont le delai grandit reste un seul message.
  const cle = `${evenement.source ?? 'discord'}|${evenement.niveau}|${evenement.titre}|${evenement.texte ?? ''}`;
  const vu = derniers.get(cle);
  const maintenant = Date.now();

  if (vu && maintenant - vu.at < FENETRE_DOUBLON_MS) {
    // Meme evenement dans la foulee : on incremente le message deja poste.
    vu.fois += 1;
    vu.at = maintenant;
    const embed = construire(evenement).setFooter({ text: `🔁 Répété ${vu.fois} fois en moins d'une minute` });
    await vu.message?.edit({ embeds: [embed], components: composants(evenement.actions) }).catch(() => {});
    return;
  }

  const message = await salon.send({
    embeds: [construire(evenement)],
    components: composants(evenement.actions),
  }).catch((e) => {
    console.error('[journal] envoi impossible :', e.message);
    return null;
  });
  derniers.set(cle, { at: maintenant, fois: 1, message });
  if (derniers.size > 50) derniers.delete(derniers.keys().next().value);
}

/**
 * Branche le journal : resout le salon, puis lit le flux du bot en jeu.
 * Sans OPS_CHANNEL_ID, tout devient silencieux et rien ne casse.
 */
/** Change le salon du journal a chaud (/setup general). Vide = silencieux. */
export async function changerSalonJournal(client, salonId) {
  salon = salonId ? await client.channels.fetch(salonId).catch(() => null) : null;
  derniers.clear();
  return salon;
}

export async function demarrerJournal(client, salonId = config.discord.opsChannelId) {
  // Le flux est lu meme sans journal : les salons thematiques (dons) en vivent aussi.
  if (!salonId) {
    console.log('[journal] aucun salon de journal, journal Discord desactive');
  } else {
    salon = await client.channels.fetch(salonId).catch((e) => {
      console.error('[journal] salon introuvable :', e.message);
      return null;
    });
    if (salon) console.log(`[journal] evenements postes dans #${salon.name}`);
  }

  const tailer = new Tailer({
    file: config.ingame.eventsFile,
    key: 'events.offset',
    pollMs: 2000,
    onLine: (entree) => {
      if (!entree || typeof entree !== 'object' || !entree.titre) return;
      // Un evenement de canal (dons) va dans SON salon ; le journal ne le
      // reprend que si ce salon n est pas configure, pour ne rien perdre.
      const relais = entree.canal && canaux.get(entree.canal);
      if (relais) {
        Promise.resolve(relais(entree)).catch(() => {});
        return;
      }
      journal({
        niveau: entree.niveau,
        titre: entree.titre,
        texte: entree.texte,
        champs: entree.champs,
        joueur: entree.joueur,
        actions: entree.actions,
        source: entree.source ?? 'jeu',
        at: entree.at,
      });
    },
  });
  await tailer.start();
}

/**
 * Derniers mots du bot Discord : il ne peut plus poster, alors il ecrit dans
 * le flux d evenements, et c est lui-meme, relance par pm2, qui les postera.
 */
export function noterSync(evenement) {
  try {
    const fichier = config.ingame.eventsFile;
    mkdirSync(dirname(fichier), { recursive: true });
    appendFileSync(fichier, `${JSON.stringify({ at: Date.now(), source: 'discord', ...evenement })}\n`);
  } catch (e) {
    console.error('[journal] ecriture impossible :', e.message);
  }
}
