import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { consulterStats } from '../donut/ingame-stats.js';
import { presence } from '../ingame/presence.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { isValidName } from '../lib/names.js';
import { valeurNumerique } from '../minecraft/dialog.js';

// Comme /bal : chaque consultation coute une commande en jeu.
const ATTENTE_MS = 15_000;
const dernier = new Map();

// Ordre et libelles des lignes renvoyees par DonutSMP.
const LIGNES = [
  ['Money', 'Argent'],
  ['Kills', 'Kills'],
  ['Deaths', 'Morts'],
  ['Playtime', 'Temps de jeu'],
  ['Shards', 'Shards'],
];

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

  const etat = await presence();
  if (!etat.enLigne) {
    return interaction.reply({
      embeds: [embed('⚠️・SERVICE INDISPONIBLE', {
        couleur: FR.jaune,
        description: "Notre bot n'est pas connecté à DonutSMP, impossible de lire une fiche pour le moment.",
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  dernier.set(interaction.user.id, Date.now());
  await interaction.deferReply();

  const fiche = await consulterStats(pseudo);

  if (fiche === null) {
    return interaction.editReply("⌛ Le serveur n'a pas répondu à temps, réessayez dans un instant.");
  }
  if (fiche.invalide) return interaction.editReply('❌ Pseudo invalide.');
  if (fiche.inconnu) return interaction.editReply(`Aucun joueur nommé **${pseudo}** sur DonutSMP.`);

  const carte = embed(TITRES.stats, { image: fiche.nom, description: `**${fiche.nom}**` });

  for (const [cle, libelle] of LIGNES) {
    if (fiche.lignes[cle]) carte.addFields({ name: libelle, value: fiche.lignes[cle], inline: true });
  }

  // Lignes que DonutSMP ajouterait sans qu on les ait prevues.
  for (const [cle, valeur] of Object.entries(fiche.lignes)) {
    if (!LIGNES.some(([k]) => k === cle)) carte.addFields({ name: cle, value: valeur, inline: true });
  }

  const kills = valeurNumerique(fiche.lignes.Kills);
  const morts = valeurNumerique(fiche.lignes.Deaths);
  if (kills !== null && morts !== null) {
    carte.addFields({
      name: 'K/D',
      value: morts > 0 ? (kills / morts).toFixed(2) : String(kills),
      inline: true,
    });
  }

  const lien = store.getLinkByName(fiche.nom);
  if (lien) carte.addFields({ name: 'Membre vérifié', value: `<@${lien.discord_id}>` });

  return interaction.editReply({ embeds: [carte] });
}
