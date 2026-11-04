import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { consulterStats } from '../donut/ingame-stats.js';
import { presence } from '../ingame/presence.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { isValidName } from '../lib/names.js';
import { valeurNumerique } from '../minecraft/dialog.js';
import { donut } from '../donut/api.js';
import { shortMoney, duration } from '../lib/format.js';
import { lignesStats } from '../stats/carte.js';

// Comme /bal : chaque consultation coute une commande en jeu.
const ATTENTE_MS = 15_000;
const dernier = new Map();

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription("La fiche DonutSMP d'un joueur")
  .addStringOption((o) =>
    o.setName('joueur')
      .setDescription('Le pseudo à consulter (le vôtre par défaut)')
      .setMaxLength(24));

export const requiresLink = true;

export async function execute(interaction) {
  const saisi = interaction.options.getString('joueur');
  const propre = store.getLink(interaction.user.id);
  const pseudo = saisi ?? propre?.mc_name;

  if (!pseudo || !isValidName(pseudo)) {
    return interaction.reply({ content: '❌ Pseudo invalide.', flags: MessageFlags.Ephemeral });
  }

  const reste = ATTENTE_MS - (Date.now() - (dernier.get(interaction.user.id) ?? 0));
  if (reste > 0) {
    return interaction.reply({
      content: `⏳ Patientez ${Math.ceil(reste / 1000)} s avant une nouvelle consultation.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  dernier.set(interaction.user.id, Date.now());

  // Avec une cle API DonutSMP : la fiche complete, sans passer par le bot en jeu.
  if (donut.live) {
    await interaction.deferReply();
    const st = await donut.stats(pseudo).catch((e) => { console.warn('[stats] API :', e.message); return undefined; });
    if (st === null) return interaction.editReply(`Aucun joueur nommé **${pseudo}** sur DonutSMP.`);
    if (st) {
      const vu = await donut.lookup(pseudo).catch(() => null);
      const lien = store.getLinkByName(st.name);
      return interaction.editReply({ embeds: [carte(st.name, {
        argent: shortMoney(st.money), shards: st.shards, kills: st.kills, morts: st.deaths, temps: duration(st.playtimeMs),
        poses: st.placedBlocks, casses: st.brokenBlocks, mobs: st.mobsKilled, enLigne: Boolean(vu), rang: vu?.rank ?? null,
        discordId: lien?.discord_id,
      }, 'API officielle DonutSMP')] });
    }
    // API en panne : on retombe sur le jeu.
  }

  const etat = await presence();
  if (!etat.enLigne) {
    const charge = {
      embeds: [embed('⚠️・SERVICE INDISPONIBLE', {
        couleur: FR.jaune,
        description: "Notre bot n'est pas connecté à DonutSMP, impossible de lire une fiche pour le moment.",
      })],
      flags: MessageFlags.Ephemeral,
    };
    return interaction.deferred ? interaction.editReply(charge) : interaction.reply(charge);
  }

  if (!interaction.deferred) await interaction.deferReply();

  const fiche = await consulterStats(pseudo);

  if (fiche === null) {
    return interaction.editReply("⌛ Le serveur n'a pas répondu à temps, réessayez dans un instant.");
  }
  if (fiche.invalide) return interaction.editReply('❌ Pseudo invalide.');
  if (fiche.inconnu) return interaction.editReply(`Aucun joueur nommé **${pseudo}** sur DonutSMP.`);

  const L = { ...fiche.lignes };
  const prendre = (...cles) => { for (const c of cles) if (L[c] !== undefined) { const x = L[c]; delete L[c]; return x; } return undefined; };
  const lien = store.getLinkByName(fiche.nom);
  const f = {
    argent: prendre('Money', 'Balance'), shardsTexte: prendre('Shards'),
    killsTexte: prendre('Kills'), mortsTexte: prendre('Deaths'), temps: prendre('Playtime'),
    posesTexte: prendre('Blocks Placed', 'Placed Blocks'), cassesTexte: prendre('Blocks Broken', 'Broken Blocks'),
    mobsTexte: prendre('Mobs Killed', 'Mobs'), vu: prendre('Last Seen', 'Last Online', 'Status'),
    discordId: lien?.discord_id,
  };
  f.kills = valeurNumerique(f.killsTexte) ?? undefined;
  f.morts = valeurNumerique(f.mortsTexte) ?? undefined;
  // Discord est deja notre ligne a nous ; le reste de ce que DonutSMP ajoute s affiche tel quel.
  prendre('Discord');
  f.autres = L;
  return interaction.editReply({ embeds: [carte(fiche.nom, f, '/stats en jeu')] });
}

function carte(nom, f, source) {
  return embed(TITRES.stats, { image: 'aucune', description: `## ${nom.replace(/[*_`~|]/g, '\\$&')}\n${lignesStats(f)}` })
    .setThumbnail(`https://mc-heads.net/body/${encodeURIComponent(nom.replace(/^\./, ''))}/128`)
    .setFooter({ text: `Source : ${source}` })
    .setTimestamp();
}
