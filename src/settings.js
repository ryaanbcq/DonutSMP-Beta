import { store } from './db.js';
import { config } from './config.js';

// Reglages que les commandes posent elles memes. Ils vivent en base : une
// valeur donnee par /panel prend effet tout de suite, sans redemarrage, et le
// .env ne garde que les secrets et les valeurs par defaut.

const lire = (cle, defaut) => store.kvGet(cle) ?? (defaut || null);

export const settings = {
  salonBaltop: () => lire('baltop.salon', config.baltop.salonId),
  poserSalonBaltop: (id) => store.kvSet('baltop.salon', String(id)),

  roleTop: () => lire('baltop.role', config.baltop.roleTopId),
  poserRoleTop: (id) => store.kvSet('baltop.role', String(id)),
  retirerRoleTop: () => store.kvSet('baltop.role', ''),

  salonLink: () => lire('link.salon', config.baltop.salonLinkId),
  poserSalonLink: (id) => store.kvSet('link.salon', String(id)),

  emojis: () => {
    const perso = store.kvGet('baltop.emojis');
    if (perso) return perso.split('|');
    return config.baltop.emojis;
  },
  poserEmojis: (liste) => store.kvSet('baltop.emojis', liste.join('|')),
};
