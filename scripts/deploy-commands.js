import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');
const body = [];
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(dir, file)).href);
  if (mod.data) body.push(mod.data.toJSON());
}

const { token, clientId, guildId } = config.discord;
if (!token || !clientId) {
  console.error('DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis.');
  process.exit(1);
}

const rest = new REST().setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

const data = await rest.put(route, { body });
console.log(`${data.length} commandes deployees${guildId ? ` sur la guilde ${guildId}` : ' globalement'} :`);
for (const c of data) console.log(`  /${c.name}`);
