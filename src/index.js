import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Client, GatewayIntentBits, Collection, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { config } from './config.js';
import { store } from './db.js';
import { PaymentWatcher } from './link/watcher.js';
import { take } from './link/interactions.js';
import { setLogo, embed, TITRES, FR } from './lib/brand.js';
import { balances, demarrerRafraichissement } from './donut/balances.js';
import { publierSuivis, surveillerSoldes, demanderSolde, attendreSolde } from './donut/ingame-balances.js';
import { surveillerStats } from './donut/ingame-stats.js';
import { donut } from './donut/api.js';
import { surveiller as surveillerClassement, rafraichirSiBesoin } from './baltop/panel.js';
import { settings, ouSeLier } from './settings.js';
import { surveillerPresence } from './ingame/surveillance.js';
import { presence } from './ingame/presence.js';
import { repondreChallenge } from './link/flow.js';
import { delier } from './link/unlink.js';
import { shortMoney } from './lib/format.js';
import { onSelectionCategorie, onFormulaireOuverture, onBoutonTicket } from './tickets/manager.js';
import { onSetupSelect, onSetupBouton, onSetupModal } from './tickets/setup.js';
import { onSelect as onVouchSelect, onBouton as onVouchBouton, onModal as onVouchModal } from './vouch/panel.js';
import { filDe, assurerFils } from './vouch/fils.js';

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

const intents = [GatewayIntentBits.Guilds];
// Sans cet intent les transcripts de tickets n ont pas le texte des messages.
if (config.discord.messageContent) intents.push(GatewayIntentBits.MessageContent);
const client = new Client({ intents });
client.commands = await loadCommands();

client.once('clientReady', async (c) => {
  setLogo(c.user.displayAvatarURL({ size: 256, extension: 'png' }));
  console.log(`[bot] connecte en tant que ${c.user.tag}`);
  console.log(`[bot] ${client.commands.size} commandes, ${store.countLinks()} comptes lies`);
  console.log(`[link] compte receveur : ${config.mc.linkAccount}`);

  const etat = await presence();
  console.log(etat.enLigne
    ? `[presence] bot en jeu connecte (${etat.username})`
    : `[presence] bot en jeu INDISPONIBLE (${etat.raison}) : les /link seront refuses`);
  surveillerPresence(c);

  const suivis = balances.resynchroniser();
  // Toujours branche : le salon du panneau peut etre choisi plus tard par
  // /panel baltop, sans redemarrage.
  const onUpdate = surveillerClassement(c);

  if (donut.live) {
    // Une cle API existe : on releve par l API, c est plus precis.
    demarrerRafraichissement({
      ...config.baltop,
      onError: (err, row) => console.warn(`[baltop] ${row.mc_name} : ${err.message}`),
      onUpdate,
    });
    const cadence = Math.round(config.baltop.cycleMs / 60_000);
    console.log(`[baltop] ${suivis} comptes, releve par l API, cycle ${cadence} min`);
  } else {
    // Pas d API : le bot en jeu lit /balance et alimente le flux.
    const n = await publierSuivis();
    surveillerSoldes({ onUpdate });
    surveillerStats();
    console.log(`[baltop] ${n} comptes publies pour le bot en jeu, soldes lus via /balance`);
  }
  const secondes = Math.round(config.baltop.minEditMs / 1000);
  if (settings.salonBaltop()) {
    console.log(`[baltop] panneau reecrit des que le top bouge, au plus une fois par ${secondes} s`);
    await rafraichirSiBesoin(c, { force: true });
  } else {
    console.log('[baltop] aucun panneau pose, utilise /panel baltop dans un salon');
  }
  await startWatcher(c);
  const fils = await assurerFils(c).catch((e) => { console.error('[vouch] fils :', e.message); return 0; });
  if (settings.salonVouch()) console.log(`[vouch] fils verifies, ${fils} ouvert(s)`);
});

client.on('interactionCreate', async (interaction) => {
  const qui = interaction.user?.tag ?? interaction.user?.id;
  try {
    if (interaction.isButton()) {
      console.log(`[ui] bouton ${interaction.customId} par ${qui}`);
      return await onBouton(interaction);
    }
    if (interaction.isModalSubmit()) {
      console.log(`[ui] formulaire ${interaction.customId} par ${qui}`);
      return await onModal(interaction);
    }
    if (interaction.isAnySelectMenu()) {
      console.log(`[ui] menu ${interaction.customId} par ${qui}`);
      if (interaction.customId === 'ticket:cat') return await onSelectionCategorie(interaction);
      if (interaction.customId.startsWith('tsetup:')) return await onSetupSelect(interaction);
      if (interaction.customId.startsWith('vouch:')) return await onVouchSelect(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      console.log(`[ui] /${interaction.commandName} par ${qui}`);
      return await onCommande(interaction);
    }
  } catch (err) {
    console.error(`[ui] echec pour ${qui} :`, err);
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
          + `Pour vous vérifier, ${ouSeLier()}. Le bot vous donnera une somme exacte `
          + 'à lui envoyer en jeu, qui vous sera rendue aussitôt après vérification.',
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  await command.execute(interaction);
}

async function onBouton(interaction) {
  if (interaction.customId.startsWith('ticket:')) return onBoutonTicket(interaction);
  if (interaction.customId.startsWith('tsetup:')) return onSetupBouton(interaction);
  if (interaction.customId.startsWith('vouch:')) return onVouchBouton(interaction);
  if (interaction.customId === 'link:unlink') return onDelier(interaction);
  if (interaction.customId !== 'link:start') return;

  // Le panneau est un message unique : son bouton porte le meme libelle pour
  // tout le monde. On repond donc en prive, avec le bouton qui correspond a
  // l etat de CE membre.
  const dejaLie = store.getLink(interaction.user.id);
  if (dejaLie) {
    return interaction.reply({
      embeds: [embed(TITRES.verifie, {
        image: dejaLie.mc_name,
        description: `Votre profil est déjà associé à **${dejaLie.mc_name}**.\n\n`
          + 'Vous pouvez le détacher pour en lier un autre, mais il faudra '
          + 'refaire une vérification et donc un nouveau paiement.',
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('link:unlink')
          .setLabel('Se déconnecter')
          .setEmoji('🔓')
          .setStyle(ButtonStyle.Danger),
      )],
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

async function onDelier(interaction) {
  const res = await delier(interaction.user.id, interaction.member);

  const contenu = res.etat === 'delie'
    ? embed('🔓・COMPTE DÉTACHÉ', {
      couleur: FR.jaune,
      image: 'aucune',
      description: `**${res.pseudo}** n'est plus associé à votre profil.\n\n`
        + 'Cliquez de nouveau sur **Se connecter** pour lier un compte.',
    })
    : embed('🔓・COMPTE DÉTACHÉ', {
      couleur: FR.jaune,
      image: 'aucune',
      description: "Vous n'avez aucun compte associé.",
    });

  // On remplace le message prive : le bouton a fait son office.
  return interaction.update({ embeds: [contenu], components: [] });
}

async function onModal(interaction) {
  if (interaction.customId.startsWith('ticket:modal:')) return onFormulaireOuverture(interaction);
  if (interaction.customId.startsWith('tsetup:')) return onSetupModal(interaction);
  if (interaction.customId.startsWith('vouch:')) return onVouchModal(interaction);
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
    publierSuivis().catch((e) => console.error('[baltop] liste des suivis :', e.message));
    filDe(c, store.getLink(discordId)).catch((e) => console.error('[vouch] fil :', e.message));

    // Solde releve tout de suite : sans ca le nouveau membre attendrait le
    // prochain tour de cycle, jusqu a un quart d heure, pour apparaitre au
    // classement.
    await demanderSolde(challenge.mc_name).catch(() => {});
    const solde = await attendreSolde(challenge.mc_name).catch(() => null);

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
