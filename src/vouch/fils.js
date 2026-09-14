import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration, ChannelType } from 'discord.js';
import { store } from '../db.js';
import { settings } from '../settings.js';
import { embed, FR } from '../lib/brand.js';
import { calculerTrust, etoiles, barre } from './trust.js';

// Un fil par joueur link dans le salon des vouches, nomme « ⭐ Pseudo » pour
// que la barre de recherche le trouve. Verrouille : le bot seul y ecrit. Le
// premier message est la carte de reputation, editee a chaque avis ; chaque
// avis est une carte en dessous.

export const TITRE_REPUTATION = '⭐・RÉPUTATION';
const nomFil = (pseudo) => `⭐ ${pseudo}`.slice(0, 100);

async function salonVouch(client) {
  const id = settings.salonVouch();
  if (!id) return null;
  const salon = await client.channels.fetch(id).catch(() => null);
  return salon?.type === ChannelType.GuildText ? salon : null;
}

async function fetchFil(client, id) {
  const fil = await client.channels.fetch(id).catch(() => null);
  return fil?.isThread?.() ? fil : null;
}

/** Un fil archive ne recoit rien : on le rouvre avant d ecrire, sans le deverrouiller. */
async function reveiller(fil) {
  if (fil.archived) await fil.setArchived(false, 'Nouvel avis').catch(() => {});
  return fil;
}

/**
 * Rend le fil du joueur, en le creant s il manque. Renomme si le pseudo a
 * change (delink/relink). null si aucun salon n est configure.
 */
export async function filDe(client, link) {
  const salon = await salonVouch(client);
  if (!salon) return null;

  const connu = store.getThread(link.discord_id);
  if (connu) {
    const fil = await fetchFil(client, connu.thread_id);
    if (fil) {
      if (connu.mc_name !== link.mc_name) {
        await reveiller(fil);
        await fil.setName(nomFil(link.mc_name)).catch(() => {});
        store.setThread(link.discord_id, fil.id, connu.card_id, link.mc_name);
      }
      return fil;
    }
    store.removeThread(link.discord_id);
  }

  const fil = await salon.threads.create({
    name: nomFil(link.mc_name),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Fil de réputation de ${link.mc_name}`,
  });
  const carte = await fil.send(carteReputation(link));
  await carte.pin().catch(() => {});
  await fil.setLocked(true, 'Seul le bot écrit ici').catch(() => {});
  store.setThread(link.discord_id, fil.id, carte.id, link.mc_name);
  console.log(`[vouch] fil ouvert pour ${link.mc_name}`);
  return fil;
}

export function trustDe(discordId) {
  return calculerTrust(store.vouchAll(discordId));
}

export function carteReputation(link) {
  const t = trustDe(link.discord_id);
  const dernier = store.vouchAll(link.discord_id)[0];
  const pct = t.n ? Math.round((t.pos / t.n) * 100) : null;

  const contenu = embed(TITRE_REPUTATION, {
    couleur: t.palier.emoji === '☠️' ? FR.rouge : t.trusted ? FR.or : FR.bleu,
    image: link.mc_name,
    description:
      `**${link.mc_name}** · <@${link.discord_id}>\n`
      + `## ${t.palier.emoji} ${t.palier.nom}\n`
      + `${etoiles(t.moyenne)} ${t.pos ? t.moyenne.toFixed(1) : 'sans note'} · `
      + `${t.n} avis${pct === null ? '' : ` · ${pct} % positifs`}\n`
      + `\`${barre(t.score)}\` **${t.score} / 100**`,
  }).addFields(
    { name: 'Vouches', value: `✅ ${t.pos}`, inline: true },
    { name: 'Signalements', value: `${t.neg ? '☠️' : '✅'} ${t.neg}`, inline: true },
    { name: 'Dernier avis', value: dernier ? `<t:${Math.floor(dernier.created_at / 1000)}:R>` : 'Aucun', inline: true },
  ).setFooter({ text: 'Trust score : moyenne pondérée, un signalement pèse trois avis. Notez avec /vouch.' });
  return { embeds: [contenu] };
}

export function carteAvis(vouch, auteurLink, cibleLink) {
  const positif = vouch.value > 0;
  const contenu = embed(positif ? '✅・VOUCH' : '⚠️・SIGNALEMENT', {
    couleur: positif ? FR.vert : FR.rouge,
    image: auteurLink?.mc_name ?? 'aucune',
    description:
      `**${auteurLink?.mc_name ?? 'Membre'}** <@${vouch.from_id}> `
      + (positif ? `· ${etoiles(vouch.stars ?? 5)}` : '· signale **' + cibleLink.mc_name + '**')
      + (vouch.comment ? `\n> ${vouch.comment.replace(/\n/g, '\n> ')}` : ''),
  }).setTimestamp(vouch.created_at);
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vouch:suppr:${vouch.from_id}:${vouch.to_id}`)
      .setLabel('Retirer (staff)').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [contenu], components: [boutons] };
}

/** Reecrit la carte de reputation et pose ou retire le role Trusted. */
export async function rafraichir(client, discordId) {
  const link = store.getLink(discordId);
  if (!link) return;
  const fil = await filDe(client, link);
  if (fil) {
    const connu = store.getThread(discordId);
    const carte = connu?.card_id ? await fil.messages.fetch(connu.card_id).catch(() => null) : null;
    await reveiller(fil);
    if (carte) await carte.edit(carteReputation(link)).catch(() => {});
    else {
      const neuve = await fil.send(carteReputation(link));
      await neuve.pin().catch(() => {});
      store.setThread(discordId, fil.id, neuve.id, link.mc_name);
    }
  }
  await majRoleTrusted(client, discordId);
}

/** Publie (ou reecrit) la carte d un avis dans le fil de la cible. Rend le fil. */
export async function posterAvis(client, fromId, toId) {
  const vouch = store.getVouch(fromId, toId);
  const cible = store.getLink(toId);
  if (!vouch || !cible) return null;
  const fil = await filDe(client, cible);
  if (!fil) return null;
  await reveiller(fil);
  const carte = carteAvis(vouch, store.getLink(fromId), cible);
  const ancien = vouch.message_id ? await fil.messages.fetch(vouch.message_id).catch(() => null) : null;
  if (ancien) await ancien.edit(carte).catch(() => {});
  else {
    const m = await fil.send(carte);
    store.setVouchMessage(fromId, toId, m.id);
  }
  await rafraichir(client, toId);
  return fil;
}

/** Retire un avis : carte supprimee dans le fil, score recalcule. */
export async function retirerAvis(client, fromId, toId) {
  const vouch = store.getVouch(fromId, toId);
  if (!vouch) return false;
  if (vouch.message_id) {
    const connu = store.getThread(toId);
    const fil = connu ? await fetchFil(client, connu.thread_id) : null;
    if (fil) {
      await reveiller(fil);
      await fil.messages.delete(vouch.message_id).catch(() => {});
    }
  }
  store.removeVouch(fromId, toId);
  await rafraichir(client, toId);
  return true;
}

async function majRoleTrusted(client, discordId) {
  const roleId = settings.roleTrusted();
  const guildId = settings.salonVouch() ? (await client.channels.fetch(settings.salonVouch()).catch(() => null))?.guildId : null;
  if (!roleId || !guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const membre = await guild?.members.fetch(discordId).catch(() => null);
  if (!membre) return;
  const t = trustDe(discordId);
  const a = membre.roles.cache.has(roleId);
  if (t.trusted && !a) await membre.roles.add(roleId, 'Trust score').catch((e) => console.warn('[vouch] role :', e.message));
  if (!t.trusted && a) await membre.roles.remove(roleId, 'Trust score').catch((e) => console.warn('[vouch] role :', e.message));
}

/** Au demarrage et a chaque link : chaque compte verifie a son fil. */
export async function assurerFils(client) {
  if (!settings.salonVouch()) return 0;
  let n = 0;
  for (const link of store.allLinks()) {
    const avant = store.getThread(link.discord_id);
    const fil = await filDe(client, link).catch((e) => { console.warn(`[vouch] fil de ${link.mc_name} :`, e.message); return null; });
    if (fil && !avant) n += 1;
  }
  return n;
}
