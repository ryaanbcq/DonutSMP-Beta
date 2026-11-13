// Anciens vouches attestes par le staff : des avis d avant le bot, perdus,
// dont le staff se porte garant. Aucune carte n est creee : ils comptent dans
// le trust score et la carte de reputation les annonce comme tels.
//   node scripts/attester-vouches.js <pseudo Minecraft | id Discord> <nombre>   (0 = retirer)
// La carte du post est reecrite au prochain redemarrage de fr-discord.
import { store } from '../src/db.js';

const [qui, nombre] = process.argv.slice(2);
const n = Number(nombre);
if (!qui || !Number.isInteger(n) || n < 0 || n > 200) {
  console.error('Usage : node scripts/attester-vouches.js <pseudo | id Discord> <nombre de 0 a 200>');
  process.exit(1);
}
const link = /^\d{15,}$/.test(qui) ? store.getLink(qui) : store.getLinkByName(qui);
if (!link) {
  console.error(`Aucun compte lie pour « ${qui} ».`);
  process.exit(1);
}
const cle = `vouch.attestes:${link.discord_id}`;
const avant = store.kvGet(cle);
store.kvSet(cle, n ? `${n}|${Date.now()}` : '');
console.log(`${link.mc_name} (${link.discord_id}) : ${n} ancien(s) vouch(es) atteste(s) par le staff (avant : ${avant || 'aucun'}).`);
