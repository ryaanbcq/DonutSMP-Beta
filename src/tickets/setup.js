import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, MessageFlags,
} from 'discord.js';
import { embed, FR } from '../lib/brand.js';
import { verrouiller, peutVerrouiller } from '../lib/salon.js';
import { reglagesTickets, slugCategorie } from './reglages.js';
import { panneauTicket, COULEUR_TICKET } from './panel.js';
import { permissionsManquantes } from './manager.js';

// /setup tickets : un panneau prive ou tout se regle a la souris. Chaque
// choix est enregistre tout de suite et le panneau se redessine sur place.
// Choisir le salon du panneau membres le publie (ou le met a jour) aussitot.

const EPH = { flags: MessageFlags.Ephemeral };

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

export function rendreSetup(guild, note = '') {
  const r = reglagesTickets;
  const cats = r.categories();
  const roles = r.roles().filter((id) => guild.roles.cache.has(id));
  const manque = permissionsManquantes(guild);

  const contenu = embed('⚙️・CONFIGURATION DES TICKETS', {
    couleur: COULEUR_TICKET,
    description:
      'Choisissez chaque élément ci-dessous, tout est enregistré immédiatement.\n\n'
      + `**Panneau membres** · ${r.salonPanneau() ? `<#${r.salonPanneau()}>` : 'pas encore publié'}\n`
      + `**Dossier des tickets** · ${r.dossier() ? `<#${r.dossier()}>` : 'à la racine du serveur'}\n`
      + `**Logs** · ${r.salonLogs() ? `<#${r.salonLogs()}>` : 'aucun'}\n`
      + `**Rôles helpers** (tickets seulement) · ${roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : 'aucun : seuls les admins du bot voient les tickets'}\n`
      + `**Catégories (${cats.length})** · ${cats.map((c) => `${c.emoji} ${c.nom} \`${slugCategorie(c)}\`${c.dossier ? ` → <#${c.dossier}>` : ''}`).join(' · ') || 'aucune'}`
      + (manque.length ? `\n\n⚠️ Il me manque **${manque.join('** et **')}** pour créer les salons de ticket.` : '')
      + (note ? `\n\n${note}` : ''),
  });

  const salon = new ChannelSelectMenuBuilder()
    .setCustomId('tsetup:salon')
    .setPlaceholder('📩 Salon du panneau membres (le publie aussitôt)')
    .setChannelTypes(ChannelType.GuildText);
  if (r.salonPanneau()) salon.setDefaultChannels(r.salonPanneau());

  const dossier = new ChannelSelectMenuBuilder()
    .setCustomId('tsetup:dossier')
    .setPlaceholder('📁 Catégorie Discord où naissent les tickets')
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(0);
  if (r.dossier()) dossier.setDefaultChannels(r.dossier());

  const logs = new ChannelSelectMenuBuilder()
    .setCustomId('tsetup:logs')
    .setPlaceholder('📄 Salon des logs et transcripts')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0);
  if (r.salonLogs()) logs.setDefaultChannels(r.salonLogs());

  const staff = new RoleSelectMenuBuilder()
    .setCustomId('tsetup:roles')
    .setPlaceholder('🛟 Rôles helpers : voient et gèrent les tickets')
    .setMinValues(0)
    .setMaxValues(25);
  if (roles.length) staff.setDefaultRoles(roles);

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tsetup:cat:add').setLabel('Ajouter une catégorie').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tsetup:cat:rm').setLabel('Retirer une catégorie').setEmoji('➖')
      .setStyle(ButtonStyle.Secondary).setDisabled(!cats.length),
    new ButtonBuilder().setCustomId('tsetup:dos').setLabel('Dossiers par catégorie').setEmoji('📁')
      .setStyle(ButtonStyle.Secondary).setDisabled(!cats.length),
    new ButtonBuilder().setCustomId('tsetup:republier').setLabel('Republier le panneau').setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary).setDisabled(!r.salonPanneau()),
  );

  return {
    embeds: [contenu],
    components: [salon, dossier, logs, staff].map((m) => new ActionRowBuilder().addComponents(m)).concat(boutons),
  };
}

/** Un dossier Discord par categorie de ticket (Support, Signalement...). */
function vueDossiers(guild, cle = null, note = '') {
  const r = reglagesTickets;
  const cats = r.categories();
  const choisie = cats.find((c) => c.cle === cle) ?? null;
  const general = r.dossier() ? `<#${r.dossier()}>` : 'la racine du serveur';
  const lignes = cats.map((c) => `${c.emoji} **${c.nom}** → ${c.dossier ? `<#${c.dossier}>` : `*dossier général (${general})*`}`);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tsetup:dos:cat')
    .setPlaceholder('1️⃣ Choisissez une catégorie de ticket')
    .addOptions(cats.slice(0, 25).map((c) => ({ label: c.nom.slice(0, 100), value: c.cle, emoji: c.emoji || undefined, default: c.cle === choisie?.cle })));
  const lignesComp = [new ActionRowBuilder().addComponents(menu)];
  if (choisie) {
    const dossier = new ChannelSelectMenuBuilder()
      .setCustomId(`tsetup:dos:pose:${choisie.cle}`)
      .setPlaceholder(`2️⃣ Dossier Discord pour « ${choisie.nom} » (vide = dossier général)`.slice(0, 150))
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0);
    if (choisie.dossier && guild.channels.cache.has(choisie.dossier)) dossier.setDefaultChannels(choisie.dossier);
    lignesComp.push(new ActionRowBuilder().addComponents(dossier));
  }
  lignesComp.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tsetup:retour').setLabel('Retour').setStyle(ButtonStyle.Secondary),
  ));
  return {
    embeds: [embed('📁・DOSSIERS PAR CATÉGORIE', {
      couleur: COULEUR_TICKET,
      description: 'Chaque type de ticket peut naître dans son propre dossier Discord. '
        + `Sans dossier propre, il va dans le dossier général (${general}). Un dossier plein (50 salons) ou supprimé renvoie au dossier général.\n\n`
        + lignes.join('\n') + (note ? `\n\n${note}` : ''),
    })],
    components: lignesComp,
  };
}

function vueRetrait(guild) {
  const cats = reglagesTickets.categories();
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tsetup:cat:rm:choix')
    .setPlaceholder('Catégories à retirer')
    .setMinValues(1)
    .setMaxValues(cats.length)
    .addOptions(cats.map((c) => ({ label: c.nom.slice(0, 100), value: c.cle, emoji: c.emoji || undefined })));
  return {
    embeds: [embed('➖・RETIRER DES CATÉGORIES', {
      couleur: FR.jaune,
      description: 'Sélectionnez une ou plusieurs catégories. Le panneau membres sera mis à jour.',
    })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tsetup:retour').setLabel('Retour').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Publication du panneau membres
// ---------------------------------------------------------------------------

/** Publie le panneau dans ce salon, ou met a jour celui qui s y trouve deja. */
export async function publierPanneau(guild, salonId, { verrou = true } = {}) {
  const salon = await guild.channels.fetch(salonId).catch(() => null);
  if (!salon?.isTextBased?.()) throw new Error('salon introuvable');

  const existant = await trouverPanneau(guild.client, salon);
  if (existant) {
    await existant.edit(panneauTicket());
    return { salon, note: 'panneau mis à jour' };
  }

  await salon.send(panneauTicket());
  reglagesTickets.poserSalonPanneau(salon.id);
  let note = 'panneau publié';
  const moi = guild.members.me;
  if (verrou && peutVerrouiller(salon, moi)) {
    await verrouiller(salon, moi).catch(() => { note += ', salon non verrouillé'; });
  } else if (verrou) {
    note += ', salon non verrouillé (il me faut « Gérer les rôles » dessus)';
  }
  return { salon, note };
}

async function trouverPanneau(client, salon) {
  const recents = await salon.messages.fetch({ limit: 50 }).catch(() => null);
  return recents?.find((m) => m.author.id === client.user.id
    && m.components?.[0]?.components?.[0]?.customId === 'ticket:cat') ?? null;
}

/** Le panneau publie liste les categories : on le reecrit quand elles changent. */
export async function rafraichirPanneau(guild) {
  const id = reglagesTickets.salonPanneau();
  if (!id) return '';
  try {
    await publierPanneau(guild, id, { verrou: false });
    return 'Le panneau membres a été mis à jour.';
  } catch (err) {
    return `⚠️ Panneau membres non mis à jour : ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Interactions (customId prefixe tsetup:)
// ---------------------------------------------------------------------------

export async function onSetupSelect(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;
  const r = reglagesTickets;
  let note = '';

  if (id === 'tsetup:salon') {
    const salonId = interaction.values[0];
    await interaction.deferUpdate();
    try {
      const { salon, note: n } = await publierPanneau(guild, salonId);
      r.poserSalonPanneau(salon.id);
      note = `✅ ${salon} : ${n}.`;
    } catch (err) {
      note = `❌ Publication impossible : ${err.message}`;
    }
    return interaction.editReply(rendreSetup(guild, note));
  }
  if (id === 'tsetup:dos:cat') return interaction.update(vueDossiers(guild, interaction.values[0]));
  if (id.startsWith('tsetup:dos:pose:')) {
    const cle = id.slice('tsetup:dos:pose:'.length);
    const dossierId = interaction.values[0] ?? '';
    r.poserDossierCategorie(cle, dossierId);
    const c = r.categorie(cle);
    return interaction.update(vueDossiers(guild, cle, dossierId
      ? `✅ Les tickets « ${c?.nom} » naîtront dans <#${dossierId}>.`
      : `✅ « ${c?.nom} » revient au dossier général.`));
  }
  if (id === 'tsetup:dossier') {
    r.poserDossier(interaction.values[0] ?? '');
    note = interaction.values[0] ? '✅ Les prochains tickets naîtront dans ce dossier.' : '✅ Dossier retiré, tickets à la racine.';
  } else if (id === 'tsetup:logs') {
    r.poserSalonLogs(interaction.values[0] ?? '');
    note = interaction.values[0] ? '✅ Salon des logs enregistré.' : '✅ Plus de salon de logs.';
  } else if (id === 'tsetup:roles') {
    const actuels = r.roles();
    for (const role of actuels) if (!interaction.values.includes(role)) r.retirerRole(role);
    for (const role of interaction.values) r.ajouterRole(role);
    note = '✅ Rôles staff enregistrés. Les tickets déjà ouverts ne changent pas.';
  } else if (id === 'tsetup:cat:rm:choix') {
    let n = 0;
    for (const cle of interaction.values) if (r.retirerCategorie(cle)) n += 1;
    await interaction.deferUpdate();
    note = `✅ ${n} catégorie(s) retirée(s). ${await rafraichirPanneau(guild)}`;
    return interaction.editReply(rendreSetup(guild, note));
  } else {
    return;
  }
  return interaction.update(rendreSetup(guild, note));
}

export async function onSetupBouton(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;

  if (id === 'tsetup:cat:add') {
    const modal = new ModalBuilder()
      .setCustomId('tsetup:cat:modal')
      .setTitle('Nouvelle catégorie de ticket')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nom').setLabel('Nom').setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(60).setPlaceholder('Service Middleman'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(32).setPlaceholder('🎩'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph)
            .setRequired(false).setMaxLength(200).setPlaceholder('Une ligne pour expliquer quand ouvrir ce ticket.'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('slug').setLabel('Identifiant dans le nom du salon').setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(16).setPlaceholder('middleman  →  pseudo-middleman-001'),
        ),
      );
    return interaction.showModal(modal);
  }
  if (id === 'tsetup:cat:rm') return interaction.update(vueRetrait(guild));
  if (id === 'tsetup:dos') return interaction.update(vueDossiers(guild));
  if (id === 'tsetup:retour') return interaction.update(rendreSetup(guild));
  if (id === 'tsetup:republier') {
    await interaction.deferUpdate();
    return interaction.editReply(rendreSetup(guild, await rafraichirPanneau(guild)));
  }
}

export async function onSetupModal(interaction) {
  if (interaction.customId !== 'tsetup:cat:modal') return;
  const guild = interaction.guild;
  const champs = interaction.fields;
  let note;
  try {
    reglagesTickets.poserCategorie({
      nom: champs.getTextInputValue('nom'),
      emoji: champs.getTextInputValue('emoji'),
      description: champs.getTextInputValue('description'),
      slug: champs.getTextInputValue('slug'),
    });
    note = `✅ Catégorie **${champs.getTextInputValue('nom').trim()}** enregistrée.`;
  } catch (err) {
    note = `❌ ${err.message}`;
  }
  // Le formulaire vient d un bouton du panneau prive : on peut le redessiner.
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
    return interaction.editReply(rendreSetup(guild, `${note} ${await rafraichirPanneau(guild)}`));
  }
  return interaction.reply({ content: `${note} ${await rafraichirPanneau(guild)}`, ...EPH });
}
