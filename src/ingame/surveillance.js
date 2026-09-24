import { db } from '../db.js';
import { compteBot } from './compte.js';
import { presence } from './presence.js';
import { embed, FR } from '../lib/brand.js';
import { config } from '../config.js';
import { journal } from '../ops/journal.js';

// Un joueur peut avoir son montant en main au moment ou le bot en jeu tombe.
// Refuser les nouveaux /link ne le protege pas : lui a deja l instruction de
// payer. On le previent donc en prive des la chute, et on le rappelle au
// retour.

const enAttente = db.prepare(
  "SELECT discord_id, mc_name, amount FROM challenges WHERE status = 'pending' AND expires_at > ?",
);

async function prevenir(client, embedMessage) {
  const cibles = enAttente.all(Date.now());
  for (const c of cibles) {
    const user = await client.users.fetch(c.discord_id).catch(() => null);
    await user?.send({ embeds: [embedMessage(c)] }).catch(() => {});
  }
  return cibles.length;
}

// Le refus des /link reste immediat (presence() est lu a chaque demande). Ce
// qui attend, c est le BRUIT : journal staff et MP aux joueurs en attente ne
// partent que si la coupure dure. Le 23/09, ~40 micro-coupures de 8 s ont
// fait 80 messages dans #logs et deux MP chacune aux joueurs en verification.
export const ANNONCE_APRES_MS = 90_000;

export function surveillerPresence(client, { intervalMs = 30_000, annonceApresMs = ANNONCE_APRES_MS } = {}) {
  let horsLigneDepuis = null;
  let raison = null;
  let annonce = false;

  const verifier = async () => {
    const etat = await presence();

    if (!etat.enLigne) {
      if (horsLigneDepuis === null) {
        horsLigneDepuis = Date.now();
        raison = etat.raison;
        console.warn(`[presence] bot en jeu hors ligne (${etat.raison}), /link suspendu`);
      }
      if (annonce || Date.now() - horsLigneDepuis < annonceApresMs) return;
      annonce = true;
      journal({
        niveau: 'warn',
        titre: 'Vérifications suspendues',
        texte: 'Le bot en jeu ne répond plus : les nouveaux `/link` sont refusés'
          + ' et les paiements en cours ne seraient pas vus.',
        champs: { Raison: raison, Depuis: `<t:${Math.floor(horsLigneDepuis / 1000)}:R>` },
      });
      const n = await prevenir(client, (c) => embed('⚠️・PAIEMENT SUSPENDU', {
        couleur: FR.jaune,
        description:
          `Notre bot **${compteBot()}** vient de se déconnecter de DonutSMP.\n\n`
          + `**N'envoyez pas les $${c.amount} maintenant** : personne ne verrait le paiement `
          + "et vous perdriez cette somme.\n\n"
          + "Je vous préviens dès qu'il est de retour. Votre vérification reste valable "
          + "jusqu'à son expiration.",
      }));
      if (n) console.log(`[presence] ${n} joueur(s) en attente prevenu(s)`);
      return;
    }

    if (horsLigneDepuis === null) return;
    const etaitAnnonce = annonce;
    horsLigneDepuis = null;
    annonce = false;
    console.log('[presence] bot en jeu de retour, /link rouvert');
    if (!etaitAnnonce) return; // micro-coupure : personne n a ete prevenu, rien a dire
    journal({ niveau: 'ok', titre: 'Vérifications rouvertes', texte: 'Le bot en jeu est revenu, `/link` est de nouveau ouvert.' });
    await prevenir(client, (c) => embed('✅・PAIEMENT POSSIBLE', {
      couleur: FR.vert,
      description:
        `Notre bot est de retour en jeu. Vous pouvez envoyer votre paiement :\n\n`
        + `\`\`\`/pay ${compteBot()} ${c.amount}\`\`\``,
    }));
  };

  verifier().catch(() => {});
  const timer = setInterval(() => verifier().catch(() => {}), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
