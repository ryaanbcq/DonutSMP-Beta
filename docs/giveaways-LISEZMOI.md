# Giveaways du bot donutfr (repris d'Orbit)

Toute la partie giveaways : le panneau (message du giveaway avec le bouton
« Participer »), les commandes `/`, les images, le tirage, les giveaways
programmés et les invitations.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `/gstart duree gagnants prix …` | Lance un giveaway. Options : `description`, `salon` ou `nouveau_salon` (+ `categorie`), `ping`, `drop`, `role_requis`, `role_interdit`, `compte_lie`, `vouchs_min`, `messages_min`, `invitations_min`, `entrees_par_invite`, `reclamer_heures`, `role_gagnant`, `rappel_minutes`, **`image`** (fichier), **`image_lien`** (lien https), **`miniature`** (fichier) |
| `/gcreate` | Crée un giveaway pas à pas dans une fenêtre |
| `/gdrop` | Drop : les premiers à cliquer gagnent tout de suite (avec `image`, `image_lien`, `miniature`) |
| `/gedit image` · `miniature` | Change ou retire la grande image / la miniature (fichier ou lien) |
| `/gedit prix` · `description` · `gagnants` · `duree` · `hote` · `couleur` | Modifie un giveaway en cours |
| `/gparticipants` | Liste des participants (pages + export CSV) |
| `/gend` · `/greroll` · `/gdelete` | Terminer maintenant, retirer au sort, supprimer |
| `/glist` | Giveaways en cours et programmés |
| `/gprogrammer creer · liste · annuler` | Giveaways programmés, une fois ou récurrents (mêmes options que `/gstart`) |
| `/gblacklist` | Membres exclus des giveaways |
| `/gsettings` | Couleurs, emoji, rôles gestionnaires, entrées bonus par rôle, messages, MP aux gagnants |
| Clic droit sur le message > Applications > **Relancer le giveaway** | Nouveau tirage sur un giveaway fini |
| `/invites voir · classement` | Invitations restées sur le serveur |

Les images envoyées en fichier sont **gardées par le bot** (les liens de
fichiers Discord expirent), dans le dossier des images à côté de la base.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `src/giveaways/commands.js` | Toutes les commandes `/` ci-dessus |
| `src/giveaways/index.js` | Boutons « Participer » / « Quitter », formulaire `/gcreate`, tâches de fond (toutes les 10 s) |
| `src/giveaways/service.js` | Le panneau du giveaway, lancer, terminer, relancer, rôle gagnant, réclamation, programmés |
| `src/giveaways/rules.js` | Conditions, entrées bonus, tirage au sort |
| `src/giveaways/entrants.js` | Liste des participants (pages + CSV) |
| `src/giveaways/stores.js` | Tables SQLite |
| `src/giveaways/reglages.js` | Réglages de `/gsettings` |
| `src/giveaways/contexte.js` | Lien entre les giveaways et le reste du bot |
| `src/giveaways/outils/` | Durées, images, couleurs, journal |
| `src/invites/` | Suivi des invitations |
| `src/commands/giveaways.js` | Branche toutes les commandes dans le chargeur de commandes du bot |
| `test/giveaways-stats.test.js` | Tests |

## Pour le brancher dans un bot

Ce code s'appuie sur quelques fichiers du bot donutfr : `src/db.js` (base
SQLite), `src/config.js`, `src/lib/admin.js` (admins du bot) et
`src/stats/store.js` (messages envoyés, pour « messages minimum »).

Dans le `src/index.js` du bot :

```js
import { ctx as ctxGiveaways, brancherClient } from './giveaways/contexte.js';
import { giveawaysModule } from './giveaways/index.js';
import { invitesModule } from './invites/index.js';

// Au démarrage (ClientReady) :
brancherClient(client);
giveawaysModule.setup(ctxGiveaways);
invitesModule.setup(ctxGiveaways);   // si l'intent « Server Members » est activé

// Boutons :
if (interaction.customId.startsWith('giveaway:'))
  return giveawaysModule.buttons.giveaway(interaction, ctxGiveaways, interaction.customId.split(':').slice(1));

// Formulaires :
if (interaction.customId.startsWith('gcreate:'))
  return giveawaysModule.modals.gcreate(interaction, ctxGiveaways, interaction.customId.split(':').slice(1));
```

Intents utilisés : `Guilds`, `GuildInvites`, et `GuildMembers` pour le suivi
des invitations. Il faut aussi router l'autocomplétion et les menus contextuels
vers les commandes.
