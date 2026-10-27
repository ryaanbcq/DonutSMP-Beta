// /mute : voir src/moderation/actions.js.
import { commande } from '../moderation/actions.js';

export const { data, execute, requiresLink } = commande('mute');
