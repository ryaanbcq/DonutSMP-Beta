import { SlashCommandBuilder, escapeMarkdown } from 'discord.js';
import { donut, LEADERBOARDS, MONEY_BOARDS } from '../donut/api.js';
import { balances } from '../donut/balances.js';
import { nomsAffiches, qui } from '../lib/membres.js';
import { embed, TITRES } from '../lib/brand.js';
import { shortMoney, duration, MEDALS } from '../lib/format.js';

// Categories tenues en cache pour la commu. Le classement du serveur entier
// passe, lui, par l API en direct.
const COMMU = [
  { name: 'Argent', value: 'money' },
  { name: 'Shards', value: 'shards' },
  { name: 'Kills', value: 'kills' },
  { name: 'Morts', value: 'deaths' },
  { name: 'Temps de jeu', value: 'playtime' },
];

export const data = new SlashCommandBuilder()
  .setName('baltop')
  .setDescription('Le classement de la commu DonutSMP FR')
  .addStringOption((o) =>
    o.setName('categorie')
      .setDescription('Le classement à afficher')
      .addChoices(...COMMU))
  .addStringOption((o) =>
    o.setName('portee')
      .setDescription('Les membres vérifiés du Discord, ou tout DonutSMP')
      .addChoices(
        { name: 'La commu FR', value: 'commu' },
        { name: 'Tout DonutSMP', value: 'serveur' },
      ));

export const requiresLink = true;

const formateur = (categorie) =>
  MONEY_BOARDS.has(categorie) ? shortMoney
    : categorie === 'playtime' ? duration
    : (v) => Number(v).toLocaleString('fr-FR');

// Nom Discord en texte, pas en mention : une mention dans un embed s affiche
// en id brut chez qui n a pas charge le membre.
function ligne(r, i, fmt, noms = null) {
  const rang = MEDALS[i] ?? `\`${String(r.rank).padStart(2, ' ')}\``;
  return `${rang} ${qui(r.name, noms?.get(String(r.discordId)), escapeMarkdown)} · ${fmt(r.value)}`;
}

function depuis(ms) {
  if (ms === null) return 'jamais';
  const min = Math.round(ms / 60_000);
  if (min < 1) return "à l'instant";
  return min < 60 ? `il y a ${min} min` : `il y a ${Math.round(min / 60)} h`;
}

export async function execute(interaction) {
  const categorie = interaction.options.getString('categorie') ?? 'money';
  const portee = interaction.options.getString('portee') ?? 'commu';
  await interaction.deferReply();

  const fmt = formateur(categorie);

  if (portee === 'serveur') {
    let rows;
    try {
      rows = await donut.leaderboard(categorie, 10);
    } catch (err) {
      return interaction.editReply(`❌ L'API DonutSMP ne répond pas (${err.message}).`);
    }
    const label = LEADERBOARDS.find((l) => l.value === categorie)?.name ?? categorie;
    const classement = embed(TITRES.classement, {
      description: `**${label}** · tout DonutSMP\n\n`
        + (rows.map((r, i) => ligne(r, i, fmt)).join('\n') || 'Classement vide.'),
    });
    if (rows[0]?.mock) classement.setFooter({ text: 'Données de test : aucune clé API DonutSMP configurée.' });
    return interaction.editReply({ embeds: [classement] });
  }

  const rows = balances.classement(categorie, 10);
  const label = COMMU.find((c) => c.value === categorie)?.name ?? categorie;

  if (rows.length === 0 && !donut.live) {
    return interaction.editReply({
      embeds: [embed(TITRES.classement, {
        description: `**${label}** · commu DonutSMP FR\n\n`
          + 'Le classement est en attente de la clé API DonutSMP. Aucun solde n\'est relevé '
          + 'pour le moment, et aucune valeur ne sera inventée.',
      })],
    });
  }

  if (rows.length === 0) {
    return interaction.editReply({
      embeds: [embed(TITRES.classement, {
        description: `**${label}** · commu DonutSMP FR\n\n`
          + 'Aucun solde relevé pour le moment. Les comptes vérifiés sont interrogés '
          + 'en continu, revenez dans quelques minutes.',
      })],
    });
  }

  const noms = await nomsAffiches(interaction.guild, rows.map((r) => r.discordId));
  const classement = embed(TITRES.classement, {
    description: `**${label}** · commu DonutSMP FR\n\n`
      + rows.map((r, i) => ligne(r, i, fmt, noms)).join('\n'),
  }).setFooter({
    text: `${balances.membres()} membres vérifiés · relevés mis à jour ${depuis(balances.fraicheur())}`,
  });

  return interaction.editReply({ embeds: [classement] });
}
