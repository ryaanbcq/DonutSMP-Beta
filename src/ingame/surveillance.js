import { db } from '../db.js';
import { presence } from './presence.js';
import { embed, FR } from '../lib/brand.js';
import { config } from '../config.js';

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

export function surveillerPresence(client, { intervalMs = 30_000 } = {}) {
  let dernierEtat = null;

  const verifier = async () => {
    const etat = await presence();
    if (dernierEtat === null) {
      dernierEtat = etat.enLigne;
      return;
    }
    if (etat.enLigne === dernierEtat) return;
    dernierEtat = etat.enLigne;

    if (!etat.enLigne) {
      console.warn(`[presence] bot en jeu hors ligne (${etat.raison}), /link suspendu`);
      const n = await prevenir(client, (c) => embed('⚠️・PAIEMENT SUSPENDU', {
        couleur: FR.jaune,
        description:
          `Notre bot **${config.mc.linkAccount}** vient de se déconnecter de DonutSMP.\n\n`
          + `**N'envoyez pas les $${c.amount} maintenant** : personne ne verrait le paiement `
          + "et vous perdriez cette somme.\n\n"
          + "Je vous préviens dès qu'il est de retour. Votre vérification reste valable "
          + "jusqu'à son expiration.",
      }));
      if (n) console.log(`[presence] ${n} joueur(s) en attente prevenu(s)`);
      return;
    }

    console.log('[presence] bot en jeu de retour, /link rouvert');
    await prevenir(client, (c) => embed('✅・PAIEMENT POSSIBLE', {
      couleur: FR.vert,
      description:
        `Notre bot est de retour en jeu. Vous pouvez envoyer votre paiement :\n\n`
        + `\`\`\`/pay ${config.mc.linkAccount} ${c.amount}\`\`\``,
    }));
  };

  verifier().catch(() => {});
  const timer = setInterval(() => verifier().catch(() => {}), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
