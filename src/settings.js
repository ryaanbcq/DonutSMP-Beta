import { store } from './db.js';
import { config } from './config.js';
import { brancherRoleAdmin } from './lib/admin.js';

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

  // Forum des vouches : un post verrouille par joueur verifie.
  salonVouch: () => lire('vouch.forum'),
  poserSalonVouch: (id) => store.kvSet('vouch.forum', String(id)),
  roleTrusted: () => lire('vouch.role'),
  poserRoleTrusted: (id) => store.kvSet('vouch.role', id ? String(id) : ''),

  // /setup general : ce qui vivait dans le .env. Le .env reste la valeur par
  // defaut ; une valeur posee ici gagne, meme vide (= desactive).
  roleVerifie: () => lire('general.roleVerifie', config.discord.verifiedRoleId),
  roleAdmin: () => lire('general.roleAdmin', config.discord.adminRoleId),
  salonLogs: () => lire('general.salonLogs', config.discord.logChannelId),
  salonJournal: () => lire('general.salonJournal', config.discord.opsChannelId),
  salonDonations: () => lire('dons.salonPanneau', config.dons.salonPanneauId),
  salonHistoriqueDons: () => lire('dons.salonHistorique', config.dons.salonId),
  beneficiaire: () => lire('dons.beneficiaire', config.dons.beneficiaire) ?? '',
  poser: (cle, valeur) => store.kvSet(cle, valeur ? String(valeur) : ''),

  emojis: () => {
    const perso = store.kvGet('baltop.emojis');
    if (perso) return perso.split('|');
    return config.baltop.emojis;
  },
  poserEmojis: (liste) => store.kvSet('baltop.emojis', liste.join('|')),
};

/**
 * Ou envoyer un membre pour se lier. La liaison ne passe QUE par le bouton du
 * panneau : aucun texte ne doit renvoyer vers une commande qui n existe plus.
 */
export function ouSeLier() {
  const salon = settings.salonLink();
  return salon
    ? `rendez-vous dans <#${salon}> et cliquez sur **Se connecter**`
    : 'passez par le panneau de connexion du serveur et cliquez sur **Se connecter**';
}

// estAdmin lit le role staff d ici (settings ne peut pas etre importe par
// admin.js : les tests d admin tourneraient sur la vraie base).
brancherRoleAdmin(() => settings.roleAdmin());
