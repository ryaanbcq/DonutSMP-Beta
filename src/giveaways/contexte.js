import { config } from '../config.js';
import { giveaways, invites } from './stores.js';
import { reglagesGiveaways } from './reglages.js';

/**
 * Le code des giveaways vient d Orbit, qui passe un « contexte » a chaque
 * fonction. Ici, ce contexte relie ce code aux briques du bot DonutSMP :
 * la base, les reglages et le client Discord (pose au demarrage).
 */
export const ctx = {
  client: null,
  config: {
    // Les images envoyees aux giveaways sont gardees a cote de la base (data/images).
    databasePath: config.dbPath,
    // Pas de site pour l instant : pas de bouton « Résumé complet ».
    dashboardUrl: '',
  },
  giveaways,
  invites,
  settings: {
    get: () => ({ giveaways: reglagesGiveaways.get() }),
    update: (_guildId, patch) => {
      if (patch?.giveaways) reglagesGiveaways.set(patch.giveaways);
    },
  },
};

/** Appele une fois le client Discord pret. */
export function brancherClient(client) {
  ctx.client = client;
}
