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

## Installation

```bash
npm install
node scripts/setup.js   # colle le token, le reste se remplit tout seul
npm run deploy          # enregistre les slash commands
npm start
```

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
| `DONUT_API_KEY` | Cle de l'API DonutSMP (`/api` en jeu). Vide = stats de test. |

## Le bot en jeu

`ingame/bot.js` est un mineflayer qui se connecte a DonutSMP avec le compte
receveur et ecrit chaque paiement recu dans `data/payments.jsonl`. Les deux
process sont independants : le bot Discord ne parle jamais a Minecraft, il lit
le fichier.

```bash
node ingame/bot.js          # en dev
pm2 start ecosystem.config.cjs --only fr-ingame
```

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
npm test                       # 20 tests, dont tous les scenarios de triche
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
