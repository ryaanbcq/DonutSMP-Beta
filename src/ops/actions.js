// Boutons du journal staff.
//
// « Afficher le code » : le bot en jeu a besoin qu un humain valide une
// connexion Microsoft. Le code donne le compte a qui le lit, donc :
//   - il n est jamais poste dans le salon, seulement en ephemere ;
//   - seul un admin (estAdmin) peut le voir ;
//   - chaque consultation est tracee dans le journal, sans le code.
//
// « Relink le compte » : met le jeton de cote et force une connexion neuve.
// Confirmation obligatoire (le bot en jeu est coupe), trace dans le journal.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { config } from '../config.js';
import { estAdmin } from '../lib/admin.js';
import { embed, FR } from '../lib/brand.js';
import { journal } from './journal.js';

/** Le code en attente, ou null s il n y en a pas ou plus. */
export async function lireCodeMsa(fichier = config.ingame.msaCodeFile, maintenant = Date.now()) {
  let brut;
  try { brut = JSON.parse(await readFile(fichier, 'utf8')); } catch { return null; }
  if (!brut?.code || !brut?.expireA || brut.expireA <= maintenant) return null;
  return brut;
}

const prive = (payload) => ({ ...payload, flags: MessageFlags.Ephemeral });

/** Depose l ordre de relink, lu par le bot en jeu sous 2 s. */
export async function demanderRelink(par, fichier = config.ingame.controlFile) {
  await mkdir(dirname(fichier), { recursive: true });
  await writeFile(fichier, JSON.stringify({ action: 'relink', par, at: Date.now() }), { mode: 0o600 });
}

const refus = () => prive({
  embeds: [embed('🔒・ACCÈS RÉSERVÉ', {
    couleur: FR.rouge,
    image: 'aucune',
    description: 'Seuls les admins peuvent agir sur le compte du bot.',
  })],
});

export async function onOpsBouton(interaction) {
  if (!interaction.customId.startsWith('ops:')) return;
  if (!estAdmin(interaction.member)) return interaction.reply(refus());

  if (interaction.customId === 'ops:relink') {
    // Etape de confirmation : le relink coupe le bot en jeu.
    return interaction.reply(prive({
      embeds: [embed('🔄・RELINK LE COMPTE', {
        couleur: FR.jaune,
        image: 'aucune',
        description: 'Le bot en jeu va être **déconnecté** et son jeton Microsoft mis de côté (sauvegardé, pas supprimé).\n\n'
          + 'Un message **Connexion Microsoft requise** arrive ensuite dans le journal : clique sur **Afficher le code**'
          + ' et valide avec le compte du bot. Pendant ce temps, les `/link` sont suspendus.\n\n'
          + 'Si le compte est bloqué chez Microsoft, règle-le d\'abord sur account.microsoft.com/security.',
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ops:relink:ok').setLabel('Confirmer le relink').setEmoji('🔄')
          .setStyle(ButtonStyle.Danger),
      )],
    }));
  }

  if (interaction.customId === 'ops:relink:ok') {
    const par = interaction.user.tag ?? interaction.user.id;
    await demanderRelink(par);
    journal({
      niveau: 'info',
      titre: 'Relink demandé',
      texte: `<@${interaction.user.id}> a demandé un relink du compte du bot.`,
      champs: { Par: par },
    });
    return interaction.update({
      embeds: [embed('🔄・RELINK LANCÉ', {
        couleur: FR.vert,
        image: 'aucune',
        description: 'Ordre transmis au bot en jeu. Le code de connexion arrive dans le journal d\'ici quelques secondes.',
      })],
      components: [],
    });
  }

  if (interaction.customId !== 'ops:msa') return;

  const code = await lireCodeMsa();
  if (!code) {
    return interaction.reply(prive({
      embeds: [embed('🔑・CONNEXION MICROSOFT', {
        couleur: FR.vert,
        image: 'aucune',
        description: 'Aucun code en attente : le bot est déjà reconnecté, ou le code a expiré.'
          + ' Dans ce cas, un nouveau message arrive au prochain essai de connexion.',
      })],
    }));
  }

  journal({
    niveau: 'info',
    titre: 'Code Microsoft consulté',
    texte: `<@${interaction.user.id}> a affiché le code de connexion du bot.`,
    champs: { Par: interaction.user.tag ?? interaction.user.id },
  });

  const lien = `https://www.microsoft.com/link?otc=${encodeURIComponent(code.code)}`;
  return interaction.reply(prive({
    embeds: [embed('🔑・CONNEXION MICROSOFT', {
      couleur: FR.jaune,
      image: 'aucune',
      description:
        `# \`${code.code}\`\n`
        + '1. Ouvre la page Microsoft avec le bouton ci-dessous (le code est déjà rempli).\n'
        + '2. Connecte-toi avec **le compte Microsoft du bot**, pas le tien.\n'
        + '3. Accepte : le bot entre en jeu tout seul, le journal confirme.\n\n'
        + `Expire <t:${Math.floor(code.expireA / 1000)}:R>. **Ne partage ce code avec personne** :`
        + ' qui le valide prend le compte du bot.',
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ouvrir la page Microsoft').setEmoji('🌐').setURL(lien),
    )],
  }));
}
