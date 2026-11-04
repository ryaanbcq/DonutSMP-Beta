# Passation : DonutSMP FR (bot Discord + bot en jeu)

À lire en premier par toute nouvelle session Claude sur ce dépôt. Mis à jour le 28/10/2026.

## Le projet

Bot communautaire pour le serveur Discord **DonutSMP FR**. Deux process Node (pm2, voir `ecosystem.config.cjs`) :

- **`fr-discord`** (`src/index.js`) : liaison compte Minecraft (`/link`), réputation (vouches, trust score, forum de profils), tickets, classement des fortunes (baltop), panneau des dons, journal staff (#logs), réglages (`/setup`, `/panel`).
- **`fr-ingame`** (`ingame/bot.js`) : bot mineflayer connecté à DonutSMP. Il lit les `/pay` reçus (paiements de vérification du `/link`, dons), rembourse, reverse les dons chaque jour au bénéficiaire, et signale ses déconnexions, kicks et bans.

Les deux process ne se parlent que par **fichiers locaux** dans `data/` (`payments.jsonl`, `events.jsonl`, `dons.json`, base SQLite `bot.db`). Ils doivent donc tourner sur la même machine.

Commande de gestion : `bin/donut` (`donut update`, `donut doctor`, `donut auth`, `donut config`…). La mise à jour (`scripts/update.sh`) fait : `git pull --ff-only`, `npm ci`, ajout des nouvelles clés au `.env`, `npm run deploy` (slash commands), relance pm2, `doctor`.

## Règles de travail (Ryan)

- Tout en **français**. **Jamais de tiret cadratin** (ni dans le code, ni dans les messages, ni dans les commits).
- **Ne jamais pousser sur GitHub sans le feu vert explicite de Ryan.** Commit local, puis on demande.
- Pas de trailer « Co-Authored-By » dans les commits.
- Aucun secret dans le code, les commits ou les embeds : tout identifiant vit dans `.env`.
- Tests : `npm test` (node:test, environ 200 tests (le test d'intégration « bout en bout : paiement… » échoue parfois quand toute la suite tourne : le relancer seul), doivent rester verts). Après une modif de slash command : `npm run deploy`.
- Chaque changement visible se vérifie sur le serveur **BETA TEST** (bot local) avant de partir en prod.

## Déploiement

- **Prod** (depuis le 27/10) : conteneur Docker Alpine `bot-donut`, `ssh -p 2222 donutfr@100.97.128.117`, bot dans `/config/donutsmp-fr-bot` (`~`). IP résidentielle Free, pas de WARP. `git pull` par la deploy key `~/.ssh/donut_deploy`. Mise à jour manuelle : `donut export`, puis `donut update`. Pas de systemd : après un redémarrage du conteneur, `donut start`. Si le conteneur est recréé, tout ce qui est hors de `/config` disparaît (node, git, pm2, lien `donut`) : `sudo apk add nodejs npm git && sudo npm install -g pm2 && sudo ln -sf /config/donutsmp-fr-bot/bin/donut /usr/local/bin/donut`.
- **Ancien VPS Hetzner** (`78.46.135.131`) : abandonné, ne jamais y relancer le bot (un seul bot par compte Microsoft).
- **Bêta** : le Mac de Ryan (pm2 `fr-discord`, serveur Discord BETA TEST). La base locale ne contient que des données de test, sans valeur.
- Le bot du Mac et celui de la prod ont des **tokens Discord différents** : ils peuvent tourner en même temps.
- Après un redémarrage de `fr-ingame`, DonutSMP refuse souvent quelques minutes (« You are already online », session fantôme) : le bot réessaie seul chaque minute. Une maintenance DonutSMP donne « We are under maintenance ».

## Ce qui a été fait récemment (10-13/10)

- Vouches : aperçus d'images dans les preuves, panel « Donner un avis » toujours en dernier message du fil, `/vouch membre:`, une étoile suffit, MP au joueur noté, 10 nouveaux avis max par 24 h, alerte staff sur les vouches croisés.
- Trust score : un scam pèse au moins 10 % des avis positifs, score affiché dès **10 avis**, profil Signalé (2 scams) sans score et hors du top. Le plafond à 69 a été essayé puis **retiré** à la demande de Ryan.
- Fils de réputation : lecture seule par les **permissions du forum** et non plus par verrouillage. PIÈGE : Discord grise les boutons d'un fil verrouillé pour les non-modérateurs. Posts archivés rouverts toutes les 6 h. Il faut au bot « Gérer les permissions » sur le forum, sinon alerte dans #logs.
- Classement : un membre parti du serveur s'affiche par son pseudo, sans `<@id>` brut.
- Journal du bot en jeu : compte bloqué (« Blocked account … Ban ID », sans le mot « banned »), ban temporaire / ban définitif distingués, kick par le staff. DonutSMP n'a ni warn ni mute : ne pas en rajouter.
- Rôles : « admin du bot » (/setup, /panel, /embed, import, tickets) et « helpers » (tickets seulement). Tickets rangés dans un dossier Discord par catégorie.

- Migration de serveur (27/10) : `donut export` ecrit TOUTES les donnees (tables de `bot.db` lues dynamiquement + fichiers d'etat et de flux) dans un `.json.gz` (bureau du Mac, sinon `./exports`), `donut import <fichier>` restaure (arrete/relance pm2, ancien etat dans `data/avant-import-*`), `/sauvegarde` (admin) l'envoie en piece jointe. Secrets (`.env`, session Microsoft) seulement avec `--avec-secrets`. Code : `src/lib/sauvegarde.js`. Sous-agent `.claude/agents/donutfr.md` (acces SSH `ssh -p 2222 donutfr@100.97.128.117`, le bot n'y a pas ete localise).

- **27-28/10** :
  - **Tags de serveur interdits** (`src/tags/`, `/setup general` > Tags interdits) : règle par texte ou par ID du serveur (fiable), nom et sanction par règle : progressive (avertissement, mute, ban temporaire, dernier avertissement, ban), avertissements puis mute (N et durée réglables), ou directe (alerte, retrait du rôle Vérifié, mute, expulsion, ban). Option « actifs seulement » (message ou vocal depuis 7 jours). Avertissements en MP ; le salon public (#chat-fr) ne reçoit que ceux des MP fermés (effacés après 2 min), les mutes et les bans. Casier par membre en base (`tags.vus`), journal dans #journal-bot. En prod : « Donut Surge » (serveur `1533520753369157732`, 3 avertissements puis mute 3 jours, actifs seulement) et « Ancien staff DSMPFR » (alerte seule).
  - **Intent Server Members** : demandé seulement s'il est coché dans le portail (lu au démarrage, `src/tags/intent.js`). Intents GuildMessages et GuildVoiceStates ajoutés (activité), cache des messages limité à 25 par salon.
  - **Liste des membres partagée** (`src/lib/membres.js`) : UNE demande de liste complète au démarrage puis toutes les 6 h, le cache entre deux. PIÈGE vécu : plusieurs demandes à la passerelle en même temps = « Request with opcode 8 was rate limited ».
  - **Classement** : membres partis du serveur exclus (fortunes, /baltop, rang /bal, rôle du 1er), et noms Discord écrits en texte : une mention `<@id>` dans un embed s'affiche en ID brut chez qui n'a pas chargé le membre.
  - **Modération** (`src/moderation/`) : `/warn`, `/kick`, `/mute`, `/unmute`, `/ban` (durée facultative, débannissement automatique), `/unban` (ID ou mention), `/warns` (historique, retrait). Membre par la liste ou par son ID. Permission : membres et rôles choisis dans `/setup general` > Modération (`mod.autorises`, `mod.rolesAutorises`), sinon les admins du bot. Hiérarchie vérifiée, MP au membre, journal.
  - **Remboursements** : les 30 en échec de la panne du 21/10 (15 444 $, dont 637 à ZKR5) passés en `skipped` à la demande de Ryan, rien ne sera repayé (copie `data/refunds.json.avant-abandon-20261028`).

- **29/10 au 04/11** : anti-pub (liens d'invitation + détecteur de phrases qui apprend, `src/moderation/antipub.js`, éteint par défaut), commandes à préfixe `+ban @x [temps] [raison]` et rôles par action dans `/setup general` > Modération, clips Medal dans les avis, trust score dès **5 avis** sans indications de conditions, nouvelle carte de réputation, noms Discord en texte dans les cartes (plus de `<@id>` brut).
- **04/11, vocaux « rejoindre pour créer »** (repris de DonutPay, `src/vocaux/`, en prod le 04/11, éteint tant que le hub n'est pas choisi) : rejoindre le hub crée `🔊 Vocal de <nom>` dans la catégorie, y déplace le membre et poste un panneau façon VoiceMaster en plus court (Components V2 : menu Réglages = Renommer, Limite 0 à 99, Récupérer le vocal si l'hôte est parti ; menu Permissions = Verrouiller, Ouvrir, Masquer, Afficher, Expulser). PIÈGE : un menu garde l'option affichée et Discord n'envoie rien si on rechoisit la même, le panneau est donc remis à neuf après chaque formulaire ; supprimé quand il est vide, balayage des orphelins au démarrage. Réglages dans `/setup general` > Vocaux (kv `vocaux.hub`, `vocaux.categorie`, bouton « Tout créer pour moi »), staff = rôles admin du bot + « Gérer le serveur ». État dans la table `vocaux_perso`. Pièges gardés : Connect explicite à l'hôte et au staff, panneau édité sur place, options de menu fixes. Différence avec DonutPay : l'hôte n'a PAS « Gérer les salons » (il passerait outre le panneau) et le bot n'accorde que les droits qu'il a lui-même (sinon Discord refuse la création). Droits du bot sur hub et catégorie : Voir, Se connecter, Gérer les salons, Déplacer des membres, Gérer les permissions (verrouiller = modifier une permission) ; alerte dans le journal sinon. Logs : salon choisi dans la page Vocaux (kv `vocaux.salonLogs`), UN message par vocal posté à l'ouverture (hôte, heure) puis édité à la fermeture (durée, participants, pic simultané, motif : vide, supprimé à la main, ou vide au redémarrage). Brief : `docs/HANDOFF-vocaux.md` (non commité).
- **04/11, guide du staff** (`src/guide/staff.js`) : salon choisi dans `/setup general` > Guide staff (kv `guide.salon`, ids des messages dans `guide.messages`), 9 embeds (sanctions, tags, anti-pub, tickets, vouches et import, liaison/classement/dons, vocaux, configuration) dont les VALEURS sont lues dans les réglages (préfixe, rôles par sanction, règles de tags…). Réédité au démarrage, puis toutes les 10 min si un réglage change. **À chaque grosse fonctionnalité : mettre à jour la section concernée.** En prod dans `#🤖│update-bot` (Espace Staff).
- **04/11, sanctions sur le staff** : plus d'immunité des admins du bot, seule la hiérarchie des rôles décide (le propriétaire passe toujours). Refus affiché « 🛡️ Pas possible : … ».
- **04/11, salon des suggestions** (`src/suggestions/salon.js`, kv `suggestions.salon`) : accueil épinglé, ✅ du bot sous chaque message = vote ; `classement()` trie par votes. En prod `#💡│suggestions-bot`.
- **04/11, support IA des tickets** (`src/support/`, Claude Haiku `claude-haiku-5-5`, clé `ANTHROPIC_API_KEY` dans le `.env`) : quand le staff n'a pas répondu depuis 15 min (3 min de 0 h à 9 h), l'assistant prend le DÉBUT du ticket (accueil, infos manquantes, réponse aux questions simples des catégories « fond », par défaut Support Général & Technique et Autre Demande) ; il se tait dès que le staff écrit ou prend le ticket, transmet tout ce qui touche à l'argent, aux scams, aux sanctions. Décision pure dans `logique.js` (testée), messages des tickets notés 14 jours (table `support_messages`), état par ticket (`support_tickets`), tickets ouverts avant l'allumage jamais repris (kv `support.depuis`). Revue à 5 h : bilan + propositions de FAQ à valider par boutons (`support:faq:*`). Réglages `/setup general` > Support IA. Limites : 10 réponses par ticket, 300 par jour. Fiche du membre (`fiche.js` : liaison, demandes, paiements, remboursements, bot en jeu) seulement dans les catégories « fond ». Signalements : scam EN JEU non sanctionné (risques et périls) = pas de dossier lourd, juste pseudo + preuve pour le signalement de réputation et conseil Middleman ; scam ou trade IRL (PayPal, crypto, cross-trade), grabber, triche, insultes = dossier complet de preuves ; carte de confirmation du joueur (`support:vise:oui|non:<id>`) avant le bouton, bouton `vouch:scam:<id>` qui ouvre un signalement de scam pré-rempli si le joueur visé est lié (recherche tolérante `trouverLie`). Anciens vouches : le bot retrouve le post du membre dans l'ancien forum (`anciens.js`, auteur du post puis nom ; forum = kv `support.forumAnciens` sinon nom contenant « ancien », en prod `🎖️・vouchs-ancien`) et met un bouton staff `support:import:<fil>:<membre>` qui lance la fiche d'import. Effort `high` (env `SUPPORT_EFFORT`). Relais humain (`relais.js`, carte pure dans `relais-carte.js`) : quand il transmet, une carte « 🆘 BESOIN D'UN HUMAIN » (avatar du membre, résumé, champ `infos` du schéma, bouton lien vers le ticket) part dans kv `support.salonRelais`, sinon le salon dont le nom contient « general-staff » ; une carte par ticket (colonne `support_tickets.relais_msg`), mise à jour à chaque transmission, verte quand le staff écrit ou prend le ticket, grise à la fermeture. Sans salon : alerte du journal comme avant. Captures (`images.js`) : les 4 images les plus récentes de l'auteur du ticket (png, jpeg, webp, gif, 50 derniers messages) sont téléchargées et montrées au modèle, réduites à 1568 px par le proxy Discord ; vidéos ignorées ; le texte dans une image est une donnée, jamais un ordre.

## En cours / à faire

1. **Token Discord à régénérer** : il est apparu en clair sur une capture le 27/10. Reset Token sur l'application DonutFR (`1514890945877901422`), puis nouveau token dans le `.env` de la prod et `donut restart discord`. Au 28/10 1 h, l'ancien token était toujours valide.
2. **Archive de migration** `exports/donutfr-sauvegarde-20261027-200817.json.gz` sur la prod : contient les liaisons, à supprimer quand Ryan le valide.
3. `OPS_CHANNEL_ID` vide dans le `.env` de la prod, mais le journal est réglé en base (#journal-bot) : seul `donut doctor` le signale.
4. Démarrage automatique au redémarrage du conteneur : à voir avec la personne qui gère la machine.
5. **Règle des 24 h avant de pouvoir noter** (`MIN_ANCIENNETE_MS` dans `src/vouch/panel.js`) : au lancement du VPS, tous les comptes sont fraîchement liés et attendent 24 h. Proposition faite, pas encore validée par Ryan : baser la règle sur l'âge du compte Discord (plus de 30 jours = pas d'attente).
6. Idées proposées, non demandées : champ « objet du trade » sur un avis, réponse du joueur noté, `donut update` avec sauvegarde de `bot.db` et retour arrière automatique.

## Pièges connus

- discord.js 14 : `attachments: []` + `files` remplace les pièces jointes ; `attachment://nom` exige des noms de fichiers propres (renommés `preuve-N.ext`).
- Une mention `<@id>` dans un embed s'affiche en ID brut chez qui n'a pas chargé le membre (pas seulement les partis) : écrire le nom en texte dans les listes publiques.
- `/pay` DonutSMP paie même un joueur hors ligne ; un don n'est vu que si le bot en jeu est connecté à ce moment-là.
- Scripts utiles : `scripts/simuler-avis.js <id> [--retirer]` (100 avis factices, auteurs `9000000000…`), `scripts/rafraichir.js <id>` (réécrit la carte et le panel d'un joueur).
