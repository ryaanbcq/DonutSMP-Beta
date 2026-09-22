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

import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { Tailer } from '../lib/tail.js';

const COULEURS = { ok: 0x57f287, info: 0xaeefff, warn: 0xfee75c, err: 0xed4245 };
const PUCES = { ok: '🟢', info: '🔵', warn: '🟡', err: '🔴' };

const FENETRE_DOUBLON_MS = 60_000;
const derniers = new Map();   // titre+texte -> { at, message }

let salon = null;
let file = Promise.resolve();

export function salonConfigure() { return Boolean(salon); }

/** Pose un salon a la main. Utilise par les tests, jamais par le bot. */
export function poserSalon(s) {
  salon = s;
  derniers.clear();
  file = Promise.resolve();
}

/** Attend que la file d envoi soit videe (tests). */
export function attendreJournal() { return file; }

function construire({ niveau = 'info', titre, texte, champs, at }) {
  const e = new EmbedBuilder()
    .setColor(COULEURS[niveau] ?? COULEURS.info)
    .setTitle(`${PUCES[niveau] ?? PUCES.info} ${titre}`)
    .setTimestamp(at ? new Date(at) : new Date());
  if (texte) e.setDescription(texte);
  const paires = Object.entries(champs ?? {}).filter(([, v]) => v !== undefined && v !== null);
  if (paires.length) {
    e.addFields(paires.slice(0, 6).map(([name, value]) => ({ name, value: String(value), inline: true })));
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
  const cle = `${evenement.niveau}|${evenement.titre}|${evenement.texte ?? ''}`;
  const vu = derniers.get(cle);
  const maintenant = Date.now();

  if (vu && maintenant - vu.at < FENETRE_DOUBLON_MS) {
    // Meme evenement dans la foulee : on incremente le message deja poste.
    vu.fois += 1;
    vu.at = maintenant;
    const embed = construire(evenement).setFooter({ text: `${vu.fois} fois en moins d'une minute` });
    await vu.message?.edit({ embeds: [embed] }).catch(() => {});
    return;
  }

  const message = await salon.send({ embeds: [construire(evenement)] }).catch((e) => {
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
export async function demarrerJournal(client) {
  if (!config.discord.opsChannelId) {
    console.log('[journal] OPS_CHANNEL_ID absent, journal Discord desactive');
    return;
  }
  salon = await client.channels.fetch(config.discord.opsChannelId).catch((e) => {
    console.error('[journal] salon introuvable :', e.message);
    return null;
  });
  if (!salon) return;
  console.log(`[journal] evenements postes dans #${salon.name}`);

  const tailer = new Tailer({
    file: config.ingame.eventsFile,
    key: 'events.offset',
    pollMs: 2000,
    onLine: (entree) => {
      if (!entree || typeof entree !== 'object' || !entree.titre) return;
      journal({
        niveau: entree.niveau,
        titre: entree.titre,
        texte: entree.texte,
        champs: entree.champs,
        at: entree.at,
      });
    },
  });
  await tailer.start();
}
