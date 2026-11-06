// Giveaways et invitations repris d Orbit : un fichier, plusieurs commandes.
// Le chargeur (src/index.js et scripts/deploy-commands.js) lit `commandes`.
import { ctx } from '../giveaways/contexte.js';
import { giveawayCommands, giveawayMenus } from '../giveaways/commands.js';
import { invitesModule } from '../invites/index.js';

const adapter = (c) => ({
  data: c.data,
  requiresLink: false,
  execute: (interaction) => c.execute(interaction, ctx),
  autocomplete: c.autocomplete ? (interaction) => c.autocomplete(interaction, ctx) : undefined,
});

export const commandes = [...giveawayCommands, ...giveawayMenus, ...invitesModule.commands].map(adapter);
