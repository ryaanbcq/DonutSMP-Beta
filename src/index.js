import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Client, GatewayIntentBits, Collection, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import { config } from './config.js';
import { store } from './db.js';
import { PaymentWatcher } from './link/watcher.js';
import { take } from './link/interactions.js';
import { setLogo, embed, TITRES, FR } from './lib/brand.js';
import { balances, demarrerRafraichissement } from './donut/balances.js';
import { surveiller as surveillerClassement, rafraichirSiBesoin } from './baltop/panel.js';
import { repondreChallenge } from './link/flow.js';
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
  setLogo(c.user.displayAvatarURL({ size: 256, extension: 'png' }));
  console.log(`[bot] connecte en tant que ${c.user.tag}`);
  console.log(`[bot] ${client.commands.size} commandes, ${store.countLinks()} comptes lies`);
  console.log(`[link] compte receveur : ${config.mc.linkAccount}`);

  const suivis = balances.resynchroniser();
  const onUpdate = config.baltop.salonId ? surveillerClassement(c) : () => {};
  demarrerRafraichissement({
    ...config.baltop,
    onError: (err, row) => console.warn(`[baltop] ${row.mc_name} : ${err.message}`),
    onUpdate,
  });
  const cadence = Math.round(config.baltop.cycleMs / 60_000);
  console.log(`[baltop] ${suivis} comptes suivis, cycle vise ${cadence} min, `
    + `plafond ${config.baltop.maxParMinute} req/min`);
  if (config.baltop.salonId) {
    const secondes = Math.round(config.baltop.minEditMs / 1000);
    console.log(`[baltop] panneau reecrit des que le top bouge, au plus une fois par ${secondes} s`);
    await rafraichirSiBesoin(c, { force: true });
  } else {
    console.log('[baltop] pas de salon de panneau (BALTOP_CHANNEL_ID vide)');
  }
  await startWatcher(c);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) return await onBouton(interaction);
    if (interaction.isModalSubmit()) return await onModal(interaction);
    if (interaction.isChatInputCommand()) return await onCommande(interaction);
  } catch (err) {
    console.error('[interaction] erreur :', err);
    const payload = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  }
});

async function onCommande(interaction) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Mur de verification : les fonctionnalites sont reservees aux comptes lies.
  if (command.requiresLink && !store.getLink(interaction.user.id)) {
    return interaction.reply({
      embeds: [embed(TITRES.reserve, {
        couleur: FR.jaune,
        description:
          'Cette commande est réservée aux membres qui ont associé leur compte DonutSMP.\n\n'
          + 'Utilisez `/link <votre pseudo>` : le bot vous donnera une somme exacte à lui '
          + 'envoyer en jeu, qui vous sera rendue aussitôt après vérification.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await command.execute(interaction);
}

async function onBouton(interaction) {
  if (interaction.customId !== 'link:start') return;

  const dejaLie = store.getLink(interaction.user.id);
  if (dejaLie) {
    return interaction.reply({
      embeds: [embed(TITRES.verifie, {
        image: dejaLie.mc_name,
        description: `Votre profil est déjà associé à **${dejaLie.mc_name}**.\n`
          + 'Utilisez `/unlink` si vous souhaitez le détacher.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('link:modal')
    .setTitle('Associer mon compte Minecraft')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('pseudo')
        .setLabel('Votre pseudo Minecraft')
        .setPlaceholder('Exactement comme en jeu')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(24),
    ));

  return interaction.showModal(modal);
}

async function onModal(interaction) {
  if (interaction.customId !== 'link:modal') return;
  return repondreChallenge(interaction, interaction.fields.getTextInputValue('pseudo'));
}

async function startWatcher(c) {
  if (config.payments.source === 'none') {
    console.log('[link] surveillance des paiements desactivee');
    return;
  }

  const watcher = new PaymentWatcher();

  watcher.on('linked', async ({ discordId, challenge, payment }) => {
    console.log(`[link] ${challenge.mc_name} verifie pour ${discordId} (${shortMoney(payment.amount)})`);
    balances.suivre({ mc_name: challenge.mc_name, discord_id: discordId });

    const delai = Math.round(config.refundDelayMaxS / 60);
    const confirmation = embed(TITRES.verifie, {
      couleur: FR.vert,
      image: challenge.mc_name,
      description:
        `**${challenge.mc_name}** est maintenant associé à votre profil Discord.\n`
        + 'Toutes les fonctionnalités du bot vous sont ouvertes.',
    }).addFields(
      { name: 'Compte', value: `\`${challenge.mc_name}\``, inline: true },
      { name: 'Remboursement', value: `${shortMoney(payment.amount)} sous ${delai} min`, inline: true },
    );

    // Confirmation visible du seul membre, dans le salon ou il a tape /link.
    const origin = take(discordId);
    if (origin) {
      await origin.followUp({ embeds: [confirmation], flags: MessageFlags.Ephemeral })
        .catch((e) => console.warn('[link] ephemere impossible :', e.message));
    }

    const user = await c.users.fetch(discordId).catch(() => null);
    await user?.send({ embeds: [confirmation] }).catch(() => {});

    if (config.discord.verifiedRoleId && config.discord.guildId) {
      const guild = await c.guilds.fetch(config.discord.guildId).catch(() => null);
      const member = await guild?.members.fetch(discordId).catch(() => null);
      await member?.roles.add(config.discord.verifiedRoleId).catch((e) =>
        console.error('[link] role non attribue :', e.message));
    }

    await log(c, embed(TITRES.staff, {
      couleur: FR.vert,
      image: challenge.mc_name,
      description: `Nouveau compte vérifié : <@${discordId}> → **${challenge.mc_name}**`,
    }).addFields({ name: 'Payé', value: shortMoney(payment.amount), inline: true }).setTimestamp());
  });

  watcher.on('unmatched', ({ payment }) => {
    console.log(`[link] paiement sans challenge : ${payment.from} ${shortMoney(payment.amount)}`);
  });

  watcher.on('conflict', async ({ challenge, payment }) => {
    console.warn(`[link] conflit sur ${challenge.mc_name} (${shortMoney(payment.amount)})`);
    await log(c, embed(TITRES.staff, {
      couleur: FR.rouge,
      description: `Vérification en conflit : **${challenge.mc_name}** a payé ${shortMoney(payment.amount)} `
        + 'mais le compte était déjà lié. À traiter à la main.',
    }).setTimestamp());
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
