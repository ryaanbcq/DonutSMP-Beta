import { PermissionFlagsBits } from 'discord.js';

// Verrouillage d un salon de panneau : personne n y ecrit, le bot si.
// Un bot ne peut poser que des permissions qu il detient lui meme, et il lui
// faut « Gerer les roles » sur le salon : sans ca Discord renvoie une erreur
// de permissions, qu on remonte en clair plutot que de laisser un panneau
// publie dans un salon reste ouvert.

const REFUS = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
};

export function peutVerrouiller(salon, moi) {
  return salon.permissionsFor(moi)?.has(PermissionFlagsBits.ManageRoles) ?? false;
}

export async function verrouiller(salon, moi) {
  await salon.permissionOverwrites.edit(salon.guild.roles.everyone, REFUS, {
    reason: 'Salon de panneau DonutSMP FR',
  });
  // Le bot fait partie de @everyone : sans cette exception il se verrouille
  // lui meme et ne pourra plus reecrire son propre panneau.
  // Fils compris : le salon des vouches est verrouille mais le bot y ouvre
  // un fil par joueur et y poste les avis.
  await salon.permissionOverwrites.edit(moi.id, {
    SendMessages: true,
    EmbedLinks: true,
    ReadMessageHistory: true,
    CreatePublicThreads: true,
    SendMessagesInThreads: true,
    ManageThreads: true,
  }, { reason: 'Le bot doit pouvoir tenir son panneau a jour' });
}

export async function deverrouiller(salon) {
  await salon.permissionOverwrites.edit(salon.guild.roles.everyone, {
    SendMessages: null,
    SendMessagesInThreads: null,
    CreatePublicThreads: null,
    CreatePrivateThreads: null,
  }, { reason: 'Salon rouvert' });
}
