// node scripts/rafraichir.js <discord_id> : reecrit la carte et le panel du bas.
import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../src/config.js';
import { rafraichir } from '../src/vouch/fils.js';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(config.discord.token);
await new Promise((r) => client.once('clientReady', r));
await rafraichir(client, process.argv[2]);
await client.destroy();
