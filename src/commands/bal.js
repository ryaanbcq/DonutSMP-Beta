import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { store } from '../db.js';
import { consulterSolde } from '../donut/ingame-balances.js';
import { presence } from '../ingame/presence.js';
import { balances } from '../donut/balances.js';
import { embed, TITRES, FR } from '../lib/brand.js';
import { shortMoney } from '../lib/format.js';
import { isValidName } from '../lib/names.js';

// Chaque consultation coute une commande en jeu : sans delai d attente, dix
// personnes qui spamment /bal saturent la file et font kicker le bot pour spam.
const ATTENTE_MS = 15_000;
const dernier = new Map();

export function option(o) {
  return o.setName('joueur')
    .setDescription('Le pseudo à consulter (le vôtre par défaut)')
    .setMaxLength(24);
}

export const data = new SlashCommandBuilder()
  .setName('bal')
  .setDescription("Consulte le solde DonutSMP d'un joueur")
  .addStringOption(option);

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
        description: "Notre bot n'est pas connecté à DonutSMP, impossible de lire un solde pour le moment.",
      })],
      flags: MessageFlags.Ephemeral,
    });
  }

  dernier.set(interaction.user.id, Date.now());
  await interaction.deferReply();

  const reponse = await consulterSolde(pseudo, { timeoutMs: 30_000 });

  if (reponse === null) {
    return interaction.editReply("⌛ Le serveur n'a pas répondu à temps, réessayez dans un instant.");
  }
  if (reponse.invalide) return interaction.editReply('❌ Pseudo invalide.');
  if (reponse.inconnu) {
    return interaction.editReply(`Aucun joueur nommé **${pseudo}** sur DonutSMP.`);
  }

  const lien = store.getLinkByName(pseudo);
  const fiche = embed(TITRES.stats, {
    image: pseudo,
    description: `**${pseudo}**\n### ${shortMoney(reponse.money)}`,
  });

  if (lien) {
    const rang = balances.classement('money', 100)
      .findIndex((r) => r.discordId === lien.discord_id) + 1;
    fiche.addFields({
      name: 'Membre vérifié',
      value: rang > 0
        ? `<@${lien.discord_id}> · ${rang}${rang === 1 ? 'er' : 'e'} du classement`
        : `<@${lien.discord_id}>`,
    });
  }

  return interaction.editReply({ embeds: [fiche] });
}
