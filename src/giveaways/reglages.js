import { store } from '../db.js';

// Reglages des giveaways, en base (cle kv), comme le reste du bot : ils se
// changent avec /gsettings et prennent effet tout de suite, sans redemarrage.

const CLE = 'giveaways.reglages';

export function defautsGiveaways() {
  return {
    color: '#aeefff',
    endedColor: '#2b2d31',
    emoji: '🎉',
    buttonLabel: '',
    managerRoleIds: [],
    pingRoleId: '',
    bonusEntries: [],
    winMessage: 'Félicitations {winners} ! Vous remportez **{prize}** !',
    noWinnerMessage: 'Pas de participant éligible pour **{prize}** : aucun gagnant.',
    dmWinners: true,
    dmHost: true,
    entriesPerInvite: 0,
    maxInviteEntries: 10,
    inviteMinAccountDays: 7,
    blacklistUserIds: [],
    channelCategoryId: '',
  };
}

function lire() {
  const brut = store.kvGet(CLE);
  if (!brut) return defautsGiveaways();
  try {
    return { ...defautsGiveaways(), ...JSON.parse(brut) };
  } catch {
    return defautsGiveaways();
  }
}

export const reglagesGiveaways = {
  get: () => lire(),
  /** Fusionne `patch` dans les reglages (les listes sont remplacees entieres). */
  set: (patch) => {
    const suivant = { ...lire(), ...patch };
    store.kvSet(CLE, JSON.stringify(suivant));
    return suivant;
  },
};
