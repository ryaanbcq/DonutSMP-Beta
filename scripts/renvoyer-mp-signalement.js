import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { store } from '../src/db.js';
import { config } from '../src/config.js';
import { setLogo } from '../src/lib/brand.js';
import { envoyerMpSignale } from '../src/vouch/panel.js';

// Outil admin : renvoie le MP de signalement a un membre.
//   node scripts/renvoyer-mp-signalement.js <discord id de la cible>
const cibleId = process.argv[2];
const cible = store.getLink(cibleId);
if (!cible) { console.error('membre non verifie'); process.exit(1); }
const vouch = store.vouchAll(cibleId).find((v) => v.value < 0);
if (!vouch) { console.error('aucun signalement sur ce membre'); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async (c) => {
  setLogo(c.user.displayAvatarURL({ size: 256, extension: 'png' }));
  const auteur = store.getLink(vouch.from_id)?.mc_name ?? (await c.users.fetch(vouch.from_id)).tag;
  await envoyerMpSignale(c, { guildId: config.discord.guildId, cible, vouch, auteur });
  process.exit(0);
});
await client.login(config.discord.token);
