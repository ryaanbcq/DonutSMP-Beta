import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { store } from '../src/db.js';
import { config } from '../src/config.js';
import { setLogo } from '../src/lib/brand.js';
import { posterAvis } from '../src/vouch/fils.js';

// Outil admin : reecrit toutes les cartes d avis (apres un changement de
// mise en page). Le bot principal peut tourner en meme temps.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async (c) => {
  setLogo(c.user.displayAvatarURL({ size: 256, extension: 'png' }));
  let n = 0;
  for (const toId of store.vouchTargets()) {
    for (const v of store.vouchAll(toId)) {
      const fil = await posterAvis(c, v.from_id, v.to_id).catch((e) => { console.error(e.message); return null; });
      if (fil) n += 1;
    }
  }
  console.log(`${n} carte(s) reecrite(s)`);
  process.exit(0);
});
await client.login(config.discord.token);
