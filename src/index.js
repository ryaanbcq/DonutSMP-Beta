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
import { demarrerJournal, journal, noterSync } from './ops/journal.js';
import { onOpsBouton } from './ops/actions.js';
import { onReclamationBouton, onReclamationSelect } from './vouch/reclamation.js';
import { duree } from '../ingame/diagnostic.js';
import { PaymentWatcher } from './link/watcher.js';
import { take } from './link/interactions.js';
import { setLogo, embed, TITRES, FR } from './lib/brand.js';
import { balances, demarrerRafraichissement } from './donut/balances.js';
import { publierSuivis, surveillerSoldes, demanderSolde, attendreSolde } from './donut/ingame-balances.js';
import { surveillerStats } from './donut/ingame-stats.js';
import { donut } from './donut/api.js';
import { surveiller as surveillerClassement, rafraichirSiBesoin, actualiserAuProchainSolde } from './baltop/panel.js';
import { settings, ouSeLier } from './settings.js';
import { surveillerPresence } from './ingame/surveillance.js';
import { presence } from './ingame/presence.js';
import { repondreChallenge } from './link/flow.js';
import { delier } from './link/unlink.js';
import { shortMoney } from './lib/format.js';
import { bypass } from './lib/names.js';
import { assurerRoles, majRolesDonateur, palierPour, nomRole, paliers as paliersDons } from './dons/dons.js';
import { onDsetupSelect, onDsetupBouton, onDsetupModal } from './dons/setup.js';
import { publierPanneauDons, surveillerPanneauDons, onBoutonDons, onModalDons } from './dons/panneau.js';
import { demarrerLogDons, logDon, salonDonsActif } from './dons/log.js';
import { onSelectionCategorie, onFormulaireOuverture, onBoutonTicket, onSelectTicket } from './tickets/manager.js';
import { onSetupSelect, onSetupBouton, onSetupModal } from './tickets/setup.js';
import { estAdmin } from './lib/admin.js';
import { onSelect as onVouchSelect, onBouton as onVouchBouton, onModal as onVouchModal } from './vouch/panel.js';
import { assurerFils, rafraichir } from './vouch/fils.js';
import { onVsetupSelect, onVsetupBouton } from './vouch/setup.js';

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
  // Le salon des dons d abord : le journal relit le flux des son demarrage.
  await demarrerLogDons(c);
  await demarrerJournal(c);
  journal({
    niveau: 'ok',
    titre: 'Bot Discord démarré',
    texte: 'Journal branché, les événements du bot en jeu arrivent ici.',
    champs: { Commandes: client.commands.size, 'Comptes liés': store.countLinks() },
  });
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
  if (config.discord.guildId) {
    const g = await c.guilds.fetch(config.discord.guildId).catch(() => null);
    if (g) await assurerRoles(g).catch((e) => console.error('[don] roles de donateur :', e.message));
    if (g) await publierPanneauDons(c, g).catch((e) => console.error('[don] panneau :', e.message));
    const verifierPanneau = surveillerPanneauDons(c);
    await verifierPanneau?.().catch(() => {});
  }
  await startWatcher(c);
  const fils = await assurerFils(c).catch((e) => { console.error('[vouch] fils :', e.message); return 0; });
  if (settings.salonVouch()) console.log(`[vouch] fils verifies, ${fils} ouvert(s)`);
});

// Coupures de la passerelle Discord : discord.js reprend seul, on annonce la
// reprise avec la duree (pendant la coupure, rien ne peut etre poste).
let passerelleCoupeeA = null;
client.on('shardReconnecting', () => { passerelleCoupeeA ??= Date.now(); });
client.on('shardDisconnect', (evt) => {
  passerelleCoupeeA ??= Date.now();
  console.warn(`[bot] passerelle Discord fermee (code ${evt?.code})`);
});
client.on('shardResume', () => {
  if (passerelleCoupeeA === null) return;
  const coupure = Date.now() - passerelleCoupeeA;
  passerelleCoupeeA = null;
  if (coupure < 30_000) return; // micro-coupure, reprise transparente
  journal({
    niveau: 'warn',
    titre: 'Connexion Discord rétablie',
    texte: 'Le bot Discord a perdu la passerelle puis l\'a retrouvée. Les boutons cliqués pendant la coupure n\'ont pas répondu.',
    champs: { Coupure: duree(coupure) },
  });
});
client.on('error', (err) => {
  console.error('[bot] erreur client :', err);
  journal({ niveau: 'err', titre: 'Erreur du client Discord', texte: `\`\`\`\n${err.message}\n\`\`\`` });
});

// Crash : ecrit dans le flux, poste au redemarrage par pm2.
for (const evt of ['uncaughtException', 'unhandledRejection']) {
  process.on(evt, (err) => {
    console.error(`[crash] ${evt} :`, err);
    noterSync({
      niveau: 'err',
      titre: 'Bot Discord planté',
      texte: 'Le process s\'est arrêté sur une erreur non gérée et a été relancé par pm2.',
      champs: { Erreur: `\`\`\`\n${String(err?.stack ?? err).slice(0, 900)}\n\`\`\`` },
    });
    process.exit(1);
  });
}

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
      if (interaction.customId.startsWith('recl:')) return await onReclamationSelect(interaction);
      if (interaction.customId === 'ticket:cat') return await onSelectionCategorie(interaction);
      if (interaction.customId.startsWith('ticket:add:')) return await onSelectTicket(interaction);
      if (/^(tsetup|vsetup|dsetup):/.test(interaction.customId) && !estAdmin(interaction.member)) return await refusSetup(interaction);
      if (interaction.customId.startsWith('tsetup:')) return await onSetupSelect(interaction);
      if (interaction.customId.startsWith('vouch:')) return await onVouchSelect(interaction);
      if (interaction.customId.startsWith('vsetup:')) return await onVsetupSelect(interaction);
      if (interaction.customId.startsWith('dsetup:')) return await onDsetupSelect(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      console.log(`[ui] /${interaction.commandName} par ${qui}`);
      return await onCommande(interaction);
    }
  } catch (err) {
    console.error(`[ui] echec pour ${qui} :`, err);
    journal({
      niveau: 'err',
      titre: 'Commande en échec',
      texte: `\`\`\`\n${err.message}\n\`\`\``,
      champs: { Membre: qui, Action: interaction.commandName ?? interaction.customId ?? 'inconnue' },
    });
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
  if (command.requiresLink && !store.getLink(interaction.user.id) && !bypass(interaction.member, config)) {
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

// Les panneaux de reglage etaient proteges par la seule permission de la
// commande /setup : un role a qui on l ouvrait, ou un membre qui avait perdu
// ses droits mais gardait le panneau ouvert, pouvait tout changer (y compris
// deplacer le forum des vouches). Le serveur verifie maintenant a chaque clic.
function refusSetup(interaction) {
  return interaction.reply({ content: '🔒 Réservé aux admins du bot.', flags: MessageFlags.Ephemeral });
}

async function onBouton(interaction) {
  if (interaction.customId.startsWith('ops:')) return onOpsBouton(interaction);
  if (interaction.customId.startsWith('recl:')) return onReclamationBouton(interaction);
  if (/^(tsetup|vsetup|dsetup):/.test(interaction.customId) && !estAdmin(interaction.member)) return refusSetup(interaction);
  if (interaction.customId.startsWith('ticket:')) return onBoutonTicket(interaction);
  if (interaction.customId.startsWith('tsetup:')) return onSetupBouton(interaction);
  if (interaction.customId.startsWith('vouch:')) return onVouchBouton(interaction);
  if (interaction.customId.startsWith('vsetup:')) return onVsetupBouton(interaction);
  if (interaction.customId.startsWith('dsetup:')) return onDsetupBouton(interaction);
  if (interaction.customId.startsWith('dons:')) return onBoutonDons(interaction);
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
  if (/^(tsetup|vsetup|dsetup):/.test(interaction.customId) && !estAdmin(interaction.member)) return refusSetup(interaction);
  if (interaction.customId.startsWith('tsetup:')) return onSetupModal(interaction);
  if (interaction.customId.startsWith('dsetup:')) return onDsetupModal(interaction);
  if (interaction.customId.startsWith('dons:')) return onModalDons(interaction);
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
    // rafraichir et pas seulement filDe : le pseudo a pu apporter sa reputation
    // (relie depuis un autre Discord), la carte, les tags et le role Trusted suivent.
    rafraichir(c, discordId).catch((e) => console.error('[vouch] fil :', e.message));

    // Solde releve tout de suite : sans ca le nouveau membre attendrait le
    // prochain tour de cycle, jusqu a un quart d heure, pour apparaitre au
    // classement.
    actualiserAuProchainSolde(challenge.mc_name);
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
    // Des dons faits avant le link comptent des maintenant.
    const guildDons = await c.guilds.fetch(config.discord.guildId).catch(() => null);
    if (guildDons) await majRolesDonateur(guildDons, discordId, challenge.mc_name).catch(() => {});

    await log(c, embed(TITRES.staff, {
      couleur: FR.vert,
      image: challenge.mc_name,
      description: `Nouveau compte vérifié : <@${discordId}> → **${challenge.mc_name}**`,
    }).addFields({ name: 'Payé', value: shortMoney(payment.amount), inline: true }).setTimestamp());

    journal({
      niveau: 'ok',
      titre: 'Compte vérifié',
      texte: `<@${discordId}> est lié à **${challenge.mc_name}**.`,
      champs: { Joueur: challenge.mc_name, Payé: shortMoney(payment.amount) },
      joueur: challenge.mc_name,
    });
  });

  watcher.on('donation', async ({ payment, avant, total }) => {
    const nom = payment.from;
    const lien = store.getLinkByName(nom);
    const paliers = paliersDons();
    const nouveau = palierPour(total);
    const monte = nouveau > palierPour(avant);
    console.log(`[don] ${nom} ${shortMoney(payment.amount)}, total ${shortMoney(total)}${lien ? '' : ' (pas lie)'}`);

    const guild = lien ? await c.guilds.fetch(config.discord.guildId).catch(() => null) : null;
    if (guild) await majRolesDonateur(guild, lien.discord_id, nom).catch((e) => console.warn('[don] roles :', e.message));

    const suivant = paliers[nouveau + 1];
    // Le salon des dons a l historique complet : pas de doublon dans le journal.
    if (!salonDonsActif()) journal({
      niveau: 'ok',
      titre: monte ? 'Don reçu : nouveau rang' : 'Don reçu',
      texte: lien
        ? `<@${lien.discord_id}> (**${nom}**) a donné **${shortMoney(payment.amount)}**.`
        : `**${nom}** a donné **${shortMoney(payment.amount)}**. Pas encore lié : son rang arrivera avec son link.`,
      champs: {
        Don: shortMoney(payment.amount),
        Total: shortMoney(total),
        Rang: nouveau >= 0 ? nomRole(paliers[nouveau]) : 'aucun',
        ...(config.dons.beneficiaire ? { 'Reversé à': config.dons.beneficiaire } : {}),
      },
      joueur: nom,
    });

    logDon({
      nom,
      discordId: lien?.discord_id,
      montant: shortMoney(payment.amount),
      total: shortMoney(total),
      rang: nouveau >= 0 ? nomRole(paliers[nouveau]) : 'aucun',
      monte,
    });

    if (!lien) return;
    const user = await c.users.fetch(lien.discord_id).catch(() => null);
    await user?.send({
      embeds: [embed('💝・MERCI POUR TON DON', {
        couleur: FR.or,
        image: nom,
        description: `Ton don de **${shortMoney(payment.amount)}** est bien arrivé, merci !`
          + (monte ? `\n\nTu passes **${nomRole(paliers[nouveau])}** 🎉` : '')
          + (suivant ? `\n\nProchain rang à **${shortMoney(suivant)}** de dons au total.` : ''),
      }).addFields(
        { name: 'Total donné', value: shortMoney(total), inline: true },
        { name: 'Rang', value: nouveau >= 0 ? nomRole(paliers[nouveau]) : 'Aucun pour le moment', inline: true },
      )],
    }).catch(() => {});
  });

  watcher.on('unmatched', ({ payment, raison, challenge }) => {
    if (raison === 'mauvais_compte') {
      console.warn(`[link] ${payment.reel} a paye pour le challenge ${challenge.mc_name} : autre compte, refuse`);
      journal({
        niveau: 'err',
        titre: 'Vérification refusée : autre compte',
        texte: `<@${challenge.discord_id}> a demandé **${challenge.mc_name}**, mais le paiement vient de **${payment.reel}**`
          + ' (Java et Bedrock s\'écrivent pareil dans le message de paiement). Rien n\'est lié.'
          + ' Tentative d\'usurpation, ou joueur qui a oublié le point Bedrock.',
        champs: { Demandé: challenge.mc_name, Payeur: payment.reel, Montant: shortMoney(payment.amount) },
        joueur: payment.reel,
      });
      return;
    }
    console.log(`[link] paiement sans challenge : ${payment.from} ${shortMoney(payment.amount)}`);
    // Souvent un joueur qui s est trompe de montant : il attend son lien.
    journal({
      niveau: 'warn',
      titre: 'Paiement sans vérification',
      texte: `**${payment.from}** a payé sans montant de vérification correspondant.`
        + ' Souvent un joueur qui s\'est trompé de montant.',
      champs: { Joueur: payment.from, Montant: shortMoney(payment.amount) },
      joueur: payment.from,
    });
  });

  watcher.on('conflict', async ({ challenge, payment }) => {
    console.warn(`[link] conflit sur ${challenge.mc_name} (${shortMoney(payment.amount)})`);
    await log(c, embed(TITRES.staff, {
      couleur: FR.rouge,
      description: `Vérification en conflit : **${challenge.mc_name}** a payé ${shortMoney(payment.amount)} `
        + 'mais le compte était déjà lié. À traiter à la main.',
    }).setTimestamp());

    journal({
      niveau: 'err',
      titre: 'Vérification en conflit',
      texte: `**${challenge.mc_name}** a payé mais le compte était déjà lié. À traiter à la main.`,
      champs: { Joueur: challenge.mc_name, Montant: shortMoney(payment.amount) },
      joueur: challenge.mc_name,
    });
  });

  watcher.on('error', (err) => {
    console.error('[link] watcher :', err.message);
    journal({ niveau: 'err', titre: 'Lecture des paiements en échec', texte: `\`\`\`\n${err.message}\n\`\`\`` });
  });

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
