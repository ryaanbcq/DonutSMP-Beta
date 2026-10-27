# Passation : DonutSMP FR (bot Discord + bot en jeu)

À lire en premier par toute nouvelle session Claude sur ce dépôt. Mis à jour le 13/10/2026.

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
- Tests : `npm test` (node:test, environ 170 tests, doivent rester verts). Après une modif de slash command : `npm run deploy`.
- Chaque changement visible se vérifie sur le serveur **BETA TEST** (bot local) avant de partir en prod.

## Déploiement

- **Prod** : VPS Hetzner (Ubuntu, nom DonutSMPBOT, géré par un ami de Ryan). Mise à jour **manuelle** par `donut update` sur le VPS, rien n'est automatique.
- **Bêta** : le Mac de Ryan (pm2 `fr-discord`, serveur Discord BETA TEST). La base locale ne contient que des données de test, sans valeur.
- Le bot du Mac et celui du VPS ont des **tokens Discord différents** : ils peuvent tourner en même temps.
- Le VPS fait passer son trafic par **Cloudflare WARP** (DonutSMP bloque les IP d'hébergeurs), indispensable au bot en jeu.

## Ce qui a été fait récemment (10-13/10)

- Vouches : aperçus d'images dans les preuves, panel « Donner un avis » toujours en dernier message du fil, `/vouch membre:`, une étoile suffit, MP au joueur noté, 10 nouveaux avis max par 24 h, alerte staff sur les vouches croisés.
- Trust score : un scam pèse au moins 10 % des avis positifs, score affiché dès **10 avis**, profil Signalé (2 scams) sans score et hors du top. Le plafond à 69 a été essayé puis **retiré** à la demande de Ryan.
- Fils de réputation : lecture seule par les **permissions du forum** et non plus par verrouillage. PIÈGE : Discord grise les boutons d'un fil verrouillé pour les non-modérateurs. Posts archivés rouverts toutes les 6 h. Il faut au bot « Gérer les permissions » sur le forum, sinon alerte dans #logs.
- Classement : un membre parti du serveur s'affiche par son pseudo, sans `<@id>` brut.
- Journal du bot en jeu : compte bloqué (« Blocked account … Ban ID », sans le mot « banned »), ban temporaire / ban définitif distingués, kick par le staff. DonutSMP n'a ni warn ni mute : ne pas en rajouter.
- Rôles : « admin du bot » (/setup, /panel, /embed, import, tickets) et « helpers » (tickets seulement). Tickets rangés dans un dossier Discord par catégorie.

- Migration de serveur (27/10) : `donut export` ecrit TOUTES les donnees (tables de `bot.db` lues dynamiquement + fichiers d'etat et de flux) dans un `.json.gz` (bureau du Mac, sinon `./exports`), `donut import <fichier>` restaure (arrete/relance pm2, ancien etat dans `data/avant-import-*`), `/sauvegarde` (admin) l'envoie en piece jointe. Secrets (`.env`, session Microsoft) seulement avec `--avec-secrets`. Code : `src/lib/sauvegarde.js`. Sous-agent `.claude/agents/donutfr.md` (acces SSH `ssh -p 2222 donutfr@100.97.128.117`, le bot n'y a pas ete localise).

## En cours / à faire

1. **Commit local non poussé** : `783c41e` (alerte #logs « Dons sans bénéficiaire »). À pousser quand Ryan le dit.
2. **Dons de cctsuyo non reversés depuis le passage au VPS.** Cause probable : bénéficiaire vide sur le VPS (sur le Mac il venait de `DONATION_RECIPIENT` dans le `.env`, le `.env` du VPS est neuf). Correction : `/setup general` > Dons > cctsuyo, ou `DONATION_RECIPIENT=cctsuyo` dans le `.env` du VPS. Le cumul est conservé et part au reversement suivant (minuit, heure de Paris). Confirmer avec `pm2 logs fr-ingame --lines 300 --nostream | grep "\[don\]"`.
3. **Accès SSH au VPS impossible** (connexion qui expire). Les paquets arrivent sur eth0, mais WARP renvoie ou bloque la réponse. Piste en cours : `warp-cli tunnel ip add <IP de Ryan>/32` (WARP 2026.8, l'ancienne syntaxe `add-excluded-route` n'existe plus), puis clé publique de Ryan par `curl -sL github.com/ryaanbcq.keys >> ~/.ssh/authorized_keys`. PIÈGE : la console web Hetzner déforme le texte collé (majuscules, `&&` devenus `77`, `>` devenu `.`) : tout taper à la main, Verr. Maj désactivé. Ne jamais désactiver WARP ni vider ses règles nftables.
4. **Clé de déploiement GitHub du VPS** : le dépôt est privé et le VPS l'a cloné en HTTPS, donc `donut update` demande un identifiant. À faire sur le VPS : `ssh-keygen -t ed25519 -f ~/.ssh/donut_deploy -N "" -C donut-vps`, ajouter la clé publique dans Settings > Deploy keys (lecture seule), `Host github.com` + `IdentityFile ~/.ssh/donut_deploy` dans `~/.ssh/config`, `git remote set-url origin git@github.com:ryaanbcq/DonutSMP-Beta.git`.
5. **Règle des 24 h avant de pouvoir noter** (`MIN_ANCIENNETE_MS` dans `src/vouch/panel.js`) : au lancement du VPS, tous les comptes sont fraîchement liés et attendent 24 h. Proposition faite, pas encore validée par Ryan : baser la règle sur l'âge du compte Discord (plus de 30 jours = pas d'attente).
6. Idées proposées, non demandées : champ « objet du trade » sur un avis, réponse du joueur noté, `donut update` avec sauvegarde de `bot.db` et retour arrière automatique.

## Pièges connus

- discord.js 14 : `attachments: []` + `files` remplace les pièces jointes ; `attachment://nom` exige des noms de fichiers propres (renommés `preuve-N.ext`).
- Une mention `<@id>` d'un membre parti du serveur s'affiche en ID brut.
- `/pay` DonutSMP paie même un joueur hors ligne ; un don n'est vu que si le bot en jeu est connecté à ce moment-là.
- Scripts utiles : `scripts/simuler-avis.js <id> [--retirer]` (100 avis factices, auteurs `9000000000…`), `scripts/rafraichir.js <id>` (réécrit la carte et le panel d'un joueur).
