import { SlashCommandBuilder } from 'discord.js';
import { executerVocal, autocompleteVocal } from '../vocaux/hub.js';

// Gerer son vocal temporaire sans passer par le panneau.
export const requiresLink = false;

export const data = new SlashCommandBuilder()
  .setName('vocal')
  .setDescription('Gérer ton salon vocal temporaire')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('renommer').setDescription('Changer le nom du salon')
    .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setRequired(true).setMaxLength(100)))
  .addSubcommand((s) => s.setName('limite').setDescription('Nombre maximum de personnes (0 = illimité)')
    .addIntegerOption((o) => o.setName('nombre').setDescription('0 à 99').setRequired(true).setMinValue(0).setMaxValue(99)))
  .addSubcommand((s) => s.setName('verrouiller').setDescription('Plus personne ne peut entrer'))
  .addSubcommand((s) => s.setName('deverrouiller').setDescription('Tout le monde peut entrer'))
  .addSubcommand((s) => s.setName('autoriser').setDescription('Laisser entrer un membre ou un rôle')
    .addMentionableOption((o) => o.setName('cible').setDescription('Membre ou rôle').setRequired(true)))
  .addSubcommand((s) => s.setName('refuser').setDescription('Bloquer et expulser un membre ou un rôle')
    .addMentionableOption((o) => o.setName('cible').setDescription('Membre ou rôle').setRequired(true)))
  .addSubcommand((s) => s.setName('transferer').setDescription('Donner le salon à quelqu\'un d\'autre')
    .addUserOption((o) => o.setName('membre').setDescription('Nouveau propriétaire').setRequired(true)))
  .addSubcommand((s) => s.setName('region').setDescription('Région du salon (propriétaire du serveur)')
    .addStringOption((o) => o.setName('region').setDescription('Région').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('panneau').setDescription('Reposter le panneau dans le salon'));

export const execute = executerVocal;
export const autocomplete = autocompleteVocal;
