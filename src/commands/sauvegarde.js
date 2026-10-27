import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { db } from '../db.js';
import { estAdmin } from '../lib/admin.js';
import { journal } from '../ops/journal.js';
import { exporter, nomArchive } from '../lib/sauvegarde.js';

// Staff : telecharge toutes les donnees du bot en un fichier, sans passer par
// le serveur. Pratique pour migrer (puis `donut import` sur la nouvelle machine).
// Jamais de secrets ici : le .env ne quitte pas le serveur par Discord.
export const data = new SlashCommandBuilder()
  .setName('sauvegarde')
  .setDescription('Staff : télécharger toutes les données du bot en un fichier (pour changer de serveur)');

export const requiresLink = false;

// Limite d'envoi des bots, avec de la marge.
const LIMITE = 9 * 1024 * 1024;

export async function execute(interaction) {
  if (!estAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Réservé aux admins du bot (rôle choisi dans /setup general, ou « Gérer le serveur »).', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { archive, resume } = exporter(db);
  const lignes = Object.entries(resume.tables).filter(([n]) => n !== 'sqlite_sequence').reduce((a, [, c]) => a + c, 0);

  journal({
    niveau: 'warn',
    titre: 'Sauvegarde téléchargée',
    texte: 'Une sauvegarde complète des données du bot a été générée.',
    champs: { Staff: `<@${interaction.user.id}>`, Lignes: String(lignes) },
  });

  if (archive.length > LIMITE) {
    return interaction.editReply(
      `❌ La sauvegarde pèse ${(archive.length / 1_048_576).toFixed(1)} Mo, trop pour Discord. Sur le serveur : \`donut export\`.`,
    );
  }
  return interaction.editReply({
    content: `✅ Sauvegarde prête : ${Object.keys(resume.tables).length - 1} tables, ${lignes} lignes.\n`
      + 'Sur le nouveau serveur : `donut import <fichier>`. Ne la partagez pas, elle contient les liens Discord / Minecraft.',
    files: [new AttachmentBuilder(archive, { name: nomArchive() })],
  });
}
