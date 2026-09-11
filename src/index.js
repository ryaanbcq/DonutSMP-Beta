import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Client, GatewayIntentBits, Collection, EmbedBuilder, MessageFlags } from 'discord.js';
import { config, COLORS } from './config.js';
import { store } from './db.js';
import { PaymentWatcher } from './link/watcher.js';
import { shortMoney } from './lib/format.js';

const here = dirname(fileURLToPath(import.meta.url));

async function loadCommands() {
  const dir = join(here, 'commands');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
  const commands = new Collection();
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    if (!mod.data || !mod.execute) continue;
    commands.set(mod.data.name, mod);
  }
  return commands;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = await loadCommands();

client.once('clientReady', async (c) => {
  console.log(`[bot] connecte en tant que ${c.user.tag}`);
  console.log(`[bot] ${client.commands.size} commandes, ${store.countLinks()} comptes lies`);
  console.log(`[link] compte receveur : ${config.mc.linkAccount}`);
  await startWatcher(c);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Mur de verification : les avantages sont reserves aux comptes lies.
  if (command.requiresLink && !store.getLink(interaction.user.id)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.warn)
        .setTitle('Compte non vérifié')
        .setDescription(
          'Cette commande est réservée aux membres qui ont lié leur compte DonutSMP.\n\n'
          + 'Fais `/link <ton pseudo>` : le bot te donnera une somme exacte à lui envoyer en jeu, '
          + 'et ton compte sera vérifié en quelques secondes.',
        )],
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[cmd] ${interaction.commandName} :`, err);
    const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

async function startWatcher(c) {
  if (config.payments.source === 'none') {
    console.log('[link] surveillance des paiements desactivee');
    return;
  }

  const watcher = new PaymentWatcher();

  watcher.on('linked', async ({ discordId, challenge, payment }) => {
    console.log(`[link] ${challenge.mc_name} verifie pour ${discordId} (${shortMoney(payment.amount)})`);

    const user = await c.users.fetch(discordId).catch(() => null);
    await user?.send({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.ok)
        .setTitle('Compte vérifié')
        .setDescription(`**${challenge.mc_name}** est maintenant lié à ton Discord. Toutes les commandes du bot te sont ouvertes.`)],
    }).catch(() => {});

    if (config.discord.verifiedRoleId && config.discord.guildId) {
      const guild = await c.guilds.fetch(config.discord.guildId).catch(() => null);
      const member = await guild?.members.fetch(discordId).catch(() => null);
      await member?.roles.add(config.discord.verifiedRoleId).catch((e) =>
        console.error('[link] role non attribue :', e.message));
    }

    await log(c, new EmbedBuilder()
      .setColor(COLORS.ok)
      .setTitle('Nouveau compte vérifié')
      .setDescription(`<@${discordId}> → **${challenge.mc_name}**`)
      .addFields({ name: 'Payé', value: shortMoney(payment.amount), inline: true })
      .setTimestamp());
  });

  watcher.on('unmatched', ({ payment }) => {
    console.log(`[link] paiement sans challenge : ${payment.from} ${shortMoney(payment.amount)}`);
  });

  watcher.on('conflict', async ({ challenge, payment }) => {
    console.warn(`[link] conflit sur ${challenge.mc_name} (${shortMoney(payment.amount)})`);
    await log(c, new EmbedBuilder()
      .setColor(COLORS.err)
      .setTitle('Vérification en conflit')
      .setDescription(`**${challenge.mc_name}** a payé ${shortMoney(payment.amount)} mais le compte était déjà lié. À traiter à la main.`)
      .setTimestamp());
  });

  watcher.on('error', (err) => console.error('[link] watcher :', err.message));

  await watcher.start();
  console.log(`[link] surveillance de ${config.payments.file}`);
}

async function log(c, embed) {
  if (!config.discord.logChannelId) return;
  const channel = await c.channels.fetch(config.discord.logChannelId).catch(() => null);
  await channel?.send({ embeds: [embed] }).catch(() => {});
}

if (!config.discord.token) {
  console.error('DISCORD_TOKEN manquant. Copie .env.example vers .env et remplis le.');
  process.exit(1);
}
await client.login(config.discord.token);
