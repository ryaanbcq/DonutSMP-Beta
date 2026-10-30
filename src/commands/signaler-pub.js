// Clic droit sur un message > Applications > Signaler comme pub : voir src/moderation/antipub.js.
import { commandeSignaler } from '../moderation/antipub.js';

export const { data, execute, requiresLink } = commandeSignaler;
