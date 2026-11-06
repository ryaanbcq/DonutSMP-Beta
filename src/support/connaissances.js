// Ce que l assistant IA sait du serveur et du bot, cote MEMBRE. Ecrit a la
// main depuis le code : rien d invente. Les salons sont lus dans les
// reglages. A mettre a jour avec le guide du staff a chaque grosse
// fonctionnalite. La FAQ validee par le staff s y ajoute (revue.js).

import { config } from '../config.js';
import { settings } from '../settings.js';
import { compteBot } from '../ingame/compte.js';
import { shortMoney } from '../lib/format.js';
import { docDonutTexte } from './doc-donut.js';

const salon = (id, sinon) => (id ? `<#${id}>` : sinon);

export function connaissancesServeur() {
  const delai = Math.round(config.refundDelayMaxS / 60);
  const ttl = Math.round(config.link.ttlMs / 60_000);
  return [
    '## Le serveur',
    'DonutSMP FR est la communauté francophone du serveur Minecraft DonutSMP (donutsmp.net). Le bot DonutFR gère la liaison des comptes, la réputation (vouches), le classement, les dons, les tickets et les vocaux temporaires.',
    '',
    '## Règlement du serveur Discord (résumé)',
    '- Respect des Conditions d\'utilisation et des Règles de la communauté Discord.',
    '- Interdits : insultes, propos haineux, comportements toxiques (y compris en MP), contenu NSFW (le serveur accueille des mineurs), spam, flood, majuscules abusives, troll, politique et religion, discrimination, contenu illégal.',
    '- Les Owners ont le dernier mot sur chaque décision.',
    '- Conflit avec un membre : ouvrir un ticket avec des preuves, ne pas régler le conflit soi-même.',
    '- Publicité interdite sous toutes ses formes sans l\'accord du staff, y compris faire allusion à un autre serveur.',
    '- Pseudo, avatar, statut et description corrects ; les modifier si le staff le demande.',
    '- Échanges de spawners autorisés entre joueurs, À VOS RISQUES ET PÉRILS : en cas de scam, le serveur décline toute responsabilité. Pour sécuriser un trade, demander un Middleman officiel en ouvrant un ticket.',
    '- Respect des règles de DonutSMP : cheats, hacks, mods interdits, exploits de bugs interdits et lourdement sanctionnés.',
    '- Interdit de partager des liens de clients Minecraft non officiels, mods suspects ou logiciels tiers ; un faux « client » qui vole les identifiants ou prend le contrôle du PC (grabber, RAT = virus) = ban définitif immédiat. Ne jamais télécharger quelque chose venant d\'un membre.',
    '- Cross-trading et échanges contre de l\'argent réel (IRL, crypto, PayPal, cartes cadeaux) formellement interdits.',
    '- Recrutement staff : 18 ans minimum, au moins le rôle Spider, casier vierge de sanction grave, maturité ; candidature par ticket.',
    '',
    '## Middleman (trade sécurisé)',
    '- Un trade en middleman se fait par ticket. Seuls **Nozz** ou **Tsuyo** font les middleman officiels : il faut que l\'un des deux soit présent, sinon le trade attend.',
    '- Déroulé : les deux parties envoient leur part au middleman, qui vérifie puis fait l\'échange en sécurité. Le middleman prend une petite commission sur la transaction (le montant exact est donné par le middleman, ne l\'invente pas).',
    '- D\'autres membres du staff peuvent servir d\'intermédiaire, mais à titre personnel : ils ne représentent pas le staff, et le serveur ne prend aucune responsabilité sur ces trades.',
    '- Pour préparer la demande : le pseudo Minecraft de l\'autre partie, ce que chacun donne (objets, spawners, montant), et un créneau où les deux sont disponibles.',
    '',
    '## Lier son compte Minecraft',
    `- Dans ${salon(settings.salonLink(), 'le salon de connexion')}, cliquer sur **Se connecter** puis donner son pseudo Minecraft (Bedrock : avec le point devant).`,
    `- Le bot demande d'envoyer EN JEU une petite somme exacte au compte du bot : \`/pay ${compteBot()} <montant demandé>\`. Ce n'est pas un frais : la somme est rendue automatiquement sous ${delai} minutes. Elle prouve que le compte est à soi.`,
    `- La demande expire au bout d'environ ${ttl} minutes : en refaire une si besoin. Il faut envoyer le montant EXACT, au bon compte.`,
    '- La liaison se fait TOUTE SEULE dès que le bot voit le paiement : rien d\'autre à faire ni à cliquer ensuite. Une fois lié : rôle Vérifié, accès au classement et à la réputation.',
    '- Si la liaison ne passe pas : vérifier le pseudo, le montant exact, le compte destinataire, et que la demande n\'a pas expiré. Le bot en jeu peut aussi être momentanément hors ligne : dans ce cas les liaisons attendent, et il faut réessayer plus tard.',
    '- Le bouton de déliaison ou `/unlink` détache le compte.',
    '',
    '## Réputation (vouches)',
    `- Chaque membre VÉRIFIÉ (compte lié) a un post de réputation dans ${salon(settings.salonVouch(), 'le forum des vouches')}. Un membre qui n'a pas lié son compte n'a pas de réputation et ne peut pas être noté. On note quelqu'un avec qui on a tradé via le bouton du post ou \`/vouch\`.`,
    '- Vouch : 1 à 5 étoiles et un message facultatif. Signalement de scam : message de 20 caractères minimum et une preuve obligatoire (capture, vidéo ou clip Medal).',
    '- Il faut être lié depuis 24 h pour noter, 10 nouveaux avis au plus par 24 h, un seul avis par personne (modifiable). `/vouches retirer` retire son propre avis.',
    '- Le trust score apparaît à partir de 5 avis. `/vouches membre` et `/profil` affichent une réputation.',
    '- Un faux avis ou un avis abusif : seul le staff peut le retirer, le signaler dans le ticket.',
    '- Récupérer ses vouches de l\'ANCIEN système (ancien forum où chacun avait son post) : c\'est possible, le staff les importe lui même. Les membres n\'ont plus accès à l\'ancien forum : c\'est le bot qui retrouve leur post et l\'indique au staff, ne demande donc aucun lien. Il faut juste que le membre ait lié son compte. Les vouches gardent leur auteur et leur date.',
    '',
    '## Commandes utiles',
    '- `/bal [pseudo]` : solde DonutSMP d\'un joueur. `/baltop` : classement. `/stats [pseudo]` : fiche DonutSMP. `/profil` : profil d\'un membre vérifié.',
    `- Le classement des fortunes est dans ${salon(settings.salonBaltop(), 'le salon du classement')} ; il ne compte que les membres liés.`,
    '',
    '## Dons',
    `- On peut faire un don en jeu au compte du bot (\`/pay ${compteBot()} <montant>\`, minimum ${shortMoney(config.dons.min)}). ${salon(settings.salonDonations(), 'Le panneau des donations')} affiche les plus gros donateurs ; les rôles de donateur sont donnés automatiquement aux comptes liés.`,
    '',
    '## Vocaux temporaires',
    '- Rejoindre le salon « Créer un vocal » crée un vocal perso, réglable depuis son panneau (renommer, limite, verrouiller, masquer, expulser).',
    '',
    '## Ce que seul le staff officiel de DonutSMP peut faire',
    '- DonutSMP FR est une communauté de joueurs : son staff ne gère que ce Discord. Il ne peut RIEN faire en jeu sur DonutSMP.',
    '- Relève du support officiel https://support.donutsmp.net : ban, mute ou sanction EN JEU et leur contestation, objets ou argent perdus en jeu (bug, rollback), achats de la boutique (rangs, clés, paiement), bug ou duplication à signaler, problème de compte sur le serveur, joueur qui triche en jeu.',
    '- Procédure : se connecter sur le site avec Discord ou Google, lier son compte Minecraft en générant un code puis en tapant `/link <code>` en jeu sur DonutSMP, puis ouvrir un ticket. Réponse en général sous 24 à 48 h (indiqué sur le site).',
  ].join('\n') + (docDonutTexte() ? `\n\n${docDonutTexte()}` : '');
}
