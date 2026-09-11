import { store } from '../db.js';
import { cancelLink } from './manager.js';
import { forget } from './interactions.js';
import { balances } from '../donut/balances.js';
import { publierSuivis } from '../donut/ingame-balances.js';
import { config } from '../config.js';

/**
 * Detache le compte d un membre. Partage par la commande /unlink et par le
 * bouton du panneau, pour que les deux chemins fassent exactement la meme
 * chose : sans ca, l un des deux finit par oublier de retirer le role ou de
 * sortir le compte du classement.
 */
export async function delier(userId, member) {
  const annule = cancelLink(userId);
  forget(userId);

  const lien = store.getLink(userId);
  if (!lien) return { etat: annule ? 'verification_annulee' : 'rien' };

  store.removeLink(userId);
  balances.oublier(lien.mc_name);
  publierSuivis().catch(() => {});

  if (config.discord.verifiedRoleId) {
    await member?.roles?.remove(config.discord.verifiedRoleId).catch(() => {});
  }

  return { etat: 'delie', pseudo: lien.mc_name };
}
