# Bot Discord DonutSMP FR

Bot de la communaute francaise DonutSMP. Les avantages du bot (vouches, baltop,
stats) sont reserves aux membres qui ont prouve qu'ils possedent bien leur compte
Minecraft, en envoyant une petite somme en jeu au compte du bot.

## Comment marche la verification

1. Le membre tape `/link Sp4cz` sur Discord.
2. Le bot tire un montant **unique** entre 1 et 1000 et repond en prive :
   `/pay <compte du bot> 944`.
3. Le membre envoie exactement cette somme en jeu depuis son compte.
4. Le bot en jeu voit le paiement, le bot Discord le rapproche du challenge,
   et le lien est cree en quelques secondes : role de verifie, MP de confirmation,
   ligne dans le salon de logs.

La preuve tient sur deux facteurs simultanes : **le pseudo de l'expediteur** lu
dans le message systeme, et **le montant exact**, unique parmi tous les
challenges en cours. Connaitre le montant de quelqu'un d'autre ne sert a rien :
il faudrait aussi payer depuis son compte.

## Installation sur un VPS neuf

Debian 12 ou Ubuntu 22.04+, en root ou avec sudo. Trois commandes, le reste est
pose par le script (node 22, pm2, dependances, `.env`, slash commands, compte
Microsoft, demarrage au boot) :

```bash
git clone git@github.com:ryaanbcq/donutsmp-fr-bot.git /opt/donutsmp-fr-bot
cd /opt/donutsmp-fr-bot
bash scripts/vps-install.sh
```

Le script pose deux questions, les seules choses qu'une machine ne peut pas
deviner :

1. **le token du bot** (portail dev > ton application > Bot > Reset Token),
   colle une fois, ecrit en chmod 600, jamais reaffiche ;
2. **le code Microsoft** du compte en jeu, a saisir dans un navigateur. Aucun
   mot de passe ne passe par le script.

Le depot etant prive, la machine a besoin d'une cle SSH autorisee sur GitHub
(`ssh-keygen -t ed25519` puis la cle publique en deploy key du depot).

Il est idempotent : le relancer ne casse rien, il saute ce qui est deja fait.
`--sans-ingame` installe le bot Discord seul, `--auto` ne pose aucune question
et s'arrete si le `.env` est incomplet.

A la fin, `scripts/doctor.js` affiche l'etat de l'installation. Ce qui reste a
remplir a la main dans `.env` : `VERIFIED_ROLE_ID`, `LOG_CHANNEL_ID` et les
salons du classement, puisque ce sont des ids de ton serveur.

## La commande `donut`

`scripts/vps-install.sh` pose un lien dans `/usr/local/bin/donut`. Tout se
pilote ensuite depuis n'importe quel dossier, sans se souvenir du chemin ni de
la syntaxe pm2 :

```
donut setup              installe tout sur cette machine (idempotent)
donut update             git pull, dependances, commandes, redemarrage
donut doctor             diagnostic complet, ne modifie rien
donut status             etat des process et du bot en jeu

donut start   [cible]    demarre    (cible : discord, ingame, all)
donut stop    [cible]    arrete
donut restart [cible]    recharge le code ET le .env
donut logs    [cible]    logs en direct
donut logs    ingame 50  les 50 dernieres lignes, sans suivre

donut config             menu de configuration (voir plus bas)
donut env                ouvre le .env brut dans ton editeur
donut token              saisit un nouveau token Discord
donut auth               refait la connexion Microsoft du compte en jeu
donut deploy             reenregistre les slash commands
donut admin ...          outil staff (list, link, unlink, pending, payments)
donut test               la suite de tests
```

`donut restart` supprime puis recree les process : un `pm2 restart` ne relit ni
`ecosystem.config.cjs` ni le `.env`, et c'est la panne classique du « j'ai
change le .env mais rien ne bouge ».

Sur une machine de dev, le lien se pose a la main :

```bash
sudo ln -sf "$PWD/bin/donut" /usr/local/bin/donut
```

## Le menu `donut config`

Tout ce qui se regle sans ouvrir le `.env` a la main. Fleches pour naviguer,
Entree pour ouvrir, `q` pour revenir, `1` a `9` en acces direct. Les roles et
les salons sont **lus sur ton serveur et proposes dans une liste** : plus d'id
a copier coller, plus de faute de frappe qui casse une fonction en silence.
Chaque ligne porte une pastille : vert pose, gris vide, jaune a surveiller,
rouge cassé.

```
donut config
```

Sans clavier (entree redirigee, script, CI) le meme menu s'affiche numerote et
se pilote au chiffre : un menu sans terminal doit se lire et s'automatiser, pas
planter.

```
  1. Discord            token, serveur, roles, salons
  2. Administrateurs    qui a acces aux commandes staff
  3. Compte Minecraft   pseudo, Microsoft, cle API
  4. Interrupteurs      remboursements, releves, mock
  5. Valeurs            delais, montants, cycles
  6. Diagnostic         relance le doctor
```

- **Discord** : coller un nouveau token (jamais reaffiche, seulement masque),
  choisir le serveur parmi ceux ou le bot est invite, puis le role des
  verifies, le role beta, le role du premier du classement et les trois salons.
- **Administrateurs** : `ADMIN_ROLE_ID` et `ADMIN_USER_IDS`, qui ouvrent les
  commandes staff. La permission Discord « Gerer le serveur » les ouvre de
  toute facon : ces deux cles s'ajoutent a elle, elles ne la remplacent pas,
  sinon un role supprime enfermerait le proprietaire dehors.
- **Compte Minecraft** : pseudo receveur, adresse Microsoft, etat du jeton
  prismarine (`valide`, `expire`, `absent`) et refaire l'authentification sur
  place, hote et version du serveur, cle API DonutSMP.
- **Interrupteurs** : remboursement des micro-paiements, releve des soldes,
  intent Message Content, faux soldes de dev, source des paiements (`jsonl` ou
  `mock`).

Rien n'est ecrit tant qu'une valeur n'est pas validee, le `.env` garde ses
commentaires, et a la sortie le menu propose de redemarrer les process.

## Journal Discord

Un salon staff (`OPS_CHANNEL_ID`, choisi dans `donut config`) recoit un embed par
evenement, pour comprendre une panne sans ouvrir les logs :

| Couleur | Ce qui arrive |
|---|---|
| Vert | bot Discord demarre, bot en jeu connecte, compte verifie, verifications rouvertes |
| Bleu | nouvel avis |
| Jaune | bot en jeu deconnecte (avec le delai avant la prochaine tentative), verifications suspendues, paiement sans verification, remboursement refuse, signalement |
| Rouge | jeton Microsoft expire, mauvais compte en jeu, chien de garde declenche, remboursement abandonne, verification en conflit, commande en echec |

Le bot en jeu n'a pas de client Discord : il ecrit ses evenements dans
`data/events.jsonl` et le bot Discord les lit par offset, comme les paiements.
Une panne du salon ne peut donc ni bloquer le bot ni lui faire perdre un
evenement.

Deux garde-fous : un evenement identique qui se repete en moins d'une minute
n'est pas repose, le message existant affiche « N fois en moins d'une minute »
(une boucle de reconnexion ne noie pas le salon), et **le code Microsoft n'est
jamais poste** : qui le lit prend le compte. Le journal dit seulement de lancer
`donut auth` sur la machine.

Sans `OPS_CHANNEL_ID`, tout reste silencieux et rien d'autre ne change.

## Mise a jour

```bash
donut update
```

Pull, `npm ci`, nouvelles cles ajoutees au `.env`, slash commands reenregistrees,
les deux process recrees (un `pm2 restart` ne relit ni `ecosystem.config.cjs`
ni le `.env`), puis diagnostic. Le script refuse de tourner si des
modifications locales trainent.

## Diagnostic

```bash
donut doctor
```

Un ecran, aucune modification, aucun secret affiche : version de node, droits et
cles du `.env`, token accepte par Discord, presence sur le serveur, permissions
et **position du role des verifies** (au dessus du bot, il ne pourra jamais le
donner), intent Message Content, nombre de slash commands enregistrees, salons
cites dans le `.env`, dossiers de donnees ecrivables, validite du cache
Microsoft, fraicheur du bot en jeu, etat pm2. Sortie 1 s'il reste un point
bloquant.

## Installation en local (dev)

```bash
npm install
npm run setup           # colle le token, le reste se remplit tout seul
npm run deploy          # enregistre les slash commands
npm start
```

Si le projet a gagne des variables depuis la creation de ton `.env`,
`node scripts/sync-env.js` ajoute les cles manquantes sans toucher a celles
deja remplies.

`scripts/setup.js` demande le token du bot sur stdin (jamais en argument, pour
qu'il ne finisse pas dans l'historique du shell), puis interroge Discord pour
recuperer l'id de l'application, le nom du bot et la liste des serveurs. Il
ecrit `DISCORD_TOKEN` et `DISCORD_CLIENT_ID` dans `.env` en chmod 600, pose
`DISCORD_GUILD_ID` si le bot n'est que sur un serveur, et affiche le lien
d'invitation avec les bonnes permissions. Le token n'est jamais reaffiche en
clair. Les autres variables (`MC_LINK_ACCOUNT`, `VERIFIED_ROLE_ID`,
`DONUT_API_KEY`) restent a remplir a la main.

Node 22.5+ requis (le bot utilise `node:sqlite`, aucune dependance native).

## Variables importantes

| Variable | Role |
|---|---|
| `MC_LINK_ACCOUNT` | Pseudo du compte DonutSMP qui encaisse les micro-paiements. **Un compte neuf, jamais celui du casino.** |
| `PAYMENT_FILE` | Fichier JSONL que le bot en jeu alimente avec les paiements recus. |
| `LINK_AMOUNT_MIN` / `MAX` | Bornes du montant de verification (1 a 1000 par defaut). |
| `LINK_TTL_MINUTES` | Duree de validite d'un challenge. |
| `VERIFIED_ROLE_ID` | Role donne automatiquement au membre verifie. |
| `DONUT_API_KEY` | Cle de l'API DonutSMP, posee a la main. Vide = stats de test. |

## Le bot en jeu

`ingame/bot.js` est un mineflayer qui se connecte a DonutSMP avec le compte
receveur et ecrit chaque paiement recu dans `data/payments.jsonl`. Les deux
process sont independants : le bot Discord ne parle jamais a Minecraft, il lit
le fichier.

```bash
node scripts/auth.js        # une seule fois : connexion Microsoft
node ingame/bot.js          # en dev
pm2 start ecosystem.config.cjs --only fr-ingame
```

### Connexion Microsoft

`scripts/auth.js` fait l authentification une fois et met le jeton en cache
dans `data/msa-cache`, que le bot reutilise ensuite a chaque demarrage.

```bash
node scripts/auth.js                 # demande l adresse si MC_EMAIL est vide
node scripts/auth.js mail@exemple.com
node scripts/auth.js --force         # oublie le cache, refait l auth
node scripts/auth.js --check         # le cache est il encore valide ? (code 2 sinon)
```

Microsoft affiche une page et un code a saisir : aucun mot de passe ne passe
par le script, il ne voit jamais les identifiants du compte. Sur macOS le code
est copie dans le presse papier.

Le script lit le pseudo en jeu depuis le profil Minecraft et le compare a
`MC_LINK_ACCOUNT` : si les deux different il refuse de continuer, parce que les
joueurs paieraient un autre compte que celui annonce. Si `MC_LINK_ACCOUNT` est
vide, il le remplit tout seul avec le vrai pseudo.

Le bot et le script partagent `MC_PROFILES_FOLDER` et les memes reglages de
flux (`live`, titre Nintendo Switch, comme mineflayer par defaut) : c est ce qui
fait que le cache est commun. Si le jeton expire pendant que le bot tourne, le
code de reconnexion s affiche dans les logs pm2 au lieu d attendre en silence.

Ce bot **ne fait que recevoir**. Aucun chemin de code n envoie d argent, et le
garde `sendSafe` refuse `/pay`, `/eco`, `/give`, `/trade`, `/sell` meme si la
commande est ajoutee plus tard par accident. Il previent au demarrage si le
pseudo connecte ne correspond pas a `MC_LINK_ACCOUNT`, sinon les joueurs
paieraient le mauvais compte.

Il ecrit la ligne de chat **brute**, jamais un pseudo ou un montant recopie :
le bot Discord la reparse lui meme avec des motifs ancres. Un test verrouille
ce contrat entre les deux process, y compris le cas ou une ligne arrive coupee
en deux ecritures.

Si les deux process ne tournent pas sur la meme machine, il suffit que
`PAYMENT_FILE` pointe sur le meme fichier partage. Le watcher lit par offset,
supporte la troncature et reprend la ou il en etait apres un redemarrage.

### Memoire

`ecosystem.config.cjs` plafonne `fr-ingame` a **700 Mo** avec
`MALLOC_ARENA_MAX=2` et `--max-old-space-size=512`. Un mineflayer sain tient a
40 a 60 Mo de tas ; ce qui grimpe sur Linux c est le RSS par fragmentation
glibc, pas une vraie fuite. Le bot purge en plus les entites a plus de 64 blocs
toutes les minutes et loggue `[mem] rss … heap …` toutes les 2 minutes. Si la
beta tape le plafond, c est un bug a regarder, pas de la RAM a rajouter.

## Securite

Le parsing des paiements reprend les regles apprises sur le bridge du casino :

- les motifs sont **ancres** `^...$` apres retrait des codes couleur, donc un
  joueur qui tape `Sp4cz paid you $944` dans le chat public n'est pas cru ;
- toute ligne portant une marque de chat ou de MP (`:`, `whispers`, `-> me`)
  est rejetee d'office ;
- les pseudos sont normalises (casse, point Bedrock mange par DonutSMP) avant
  toute comparaison ;
- un montant ne peut pas etre attribue a deux challenges en cours, donc aucune
  ambiguite au moment de rapprocher un paiement ;
- SQLite rend des objets a prototype nul, un pseudo appele `constructor` ou
  `__proto__` ne peut pas polluer la table des liens.

Tout paiement vu est journalise dans la table `payments` avec son verdict
(`linked`, `unmatched`, `conflict`), ce qui permet de rembourser a la main un
joueur qui s'est trompe de montant.

## Commandes

| Commande | Acces | Effet |
|---|---|---|
| `/link <pseudo>` | libre | Ouvre la verification |
| `/unlink` | libre | Detache le compte |
| `/profil [membre]` | libre | Fiche d'un membre verifie |
| `/vouch <membre> <avis> [commentaire]` | verifie | Note un membre |
| `/vouches membre [membre]` | verifie | Avis recus |
| `/vouches top` | verifie | Classement reputation |
| `/vouches retirer <membre>` | verifie | Retire son avis |
| `/baltop [categorie]` | verifie | Classement DonutSMP |
| `/stats [pseudo]` | verifie | Stats d'un joueur |

## Dev

```bash
npm test                       # 88 tests, dont tous les scenarios de triche
node scripts/demo.js           # deroule le flux complet sans Discord
npm run pay -- Sp4cz 944       # simule un paiement recu en jeu
```

## Outil staff

```bash
node scripts/admin.js list                       # les comptes lies
node scripts/admin.js link <discordId> <pseudo>  # lier a la main (conflit, dedommagement)
node scripts/admin.js unlink <discordId>
node scripts/admin.js pending                    # verifications en cours
node scripts/admin.js payments 20                # derniers paiements vus et leur verdict
```
