import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { store } from '../db.js';
import { embed, FR } from '../lib/brand.js';
import { estAdmin } from '../lib/admin.js';
import { pousserMaintenant } from '../scan/membres.js';

// /donutscan api : un membre lie qui a le role API cree, regenere ou coupe SA cle de l'API DonutScan.
// La cle vit cote DonutScan (nom dc-<id Discord>, reliee a son pseudo Minecraft lie) : le bot ne la stocke
// jamais, il l'affiche une seule fois, en ephemere, a son proprietaire.
// Role API : kv scan.roleApi, sinon le role nomme « API », cree au demarrage s'il manque (assurerRoleApi).

const DOC = 'https://donutscan.org/api';
const NOM_ROLE = 'API';
const roleId = () => store.kvGet('scan.roleApi') || null;

export const data = new SlashCommandBuilder()
  .setName('donutscan')
  .setDescription('Les outils DonutScan')
  .addSubcommand((s) => s.setName('api').setDescription('Ta clé personnelle de l’API DonutScan (rôle API requis)'));

export const requiresLink = true;

/** Cree le role API s'il manque (supprime a la main compris). Il nait tout en bas, sans aucune permission. */
export async function assurerRoleApi(guild) {
  const id = roleId();
  if (id && guild.roles.cache.has(id)) return guild.roles.cache.get(id);
  const deja = guild.roles.cache.find((r) => r.name === NOM_ROLE && !r.managed);
  const role = deja ?? await guild.roles.create({ name: NOM_ROLE, permissions: [], reason: 'Accès à /donutscan api (clé de l’API DonutScan)' });
  store.kvSet('scan.roleApi', role.id);
  if (!deja) console.log(`[scan] role ${NOM_ROLE} cree (${role.id})`);
  return role;
}

const aLeRole = (membre) => {
  const id = roleId();
  return Boolean(id && membre?.roles?.cache?.has(id));
};

/** Appel de l'API DonutScan (droit « keys » de la cle du bot). */
async function cle(action, extra) {
  const res = await fetch(`${config.donutscan.base}/members/keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.donutscan.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(15_000),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.message || d.error || `HTTP ${res.status}`);
  return d;
}

const date = (t) => (t ? `<t:${Math.floor(t / 1000)}:R>` : 'jamais');

function carte(info, lien) {
  const lignes = info.exists && info.active
    ? [
      `🟢 **Clé active**, reliée à **${lien.mc_name}**`,
      `Droits : scanner des fichiers, chercher pseudos et empreintes`,
      `Utilisation : **${info.uses}** appel${info.uses > 1 ? 's' : ''}, dernier ${date(info.last_used)}`,
      `Aujourd’hui : **${info.scans_today}**${info.daily_max ? ` / ${info.daily_max}` : ''} scans`,
      '',
      'La clé elle-même n’est jamais réaffichée. Perdue ou fuitée ? **Régénère-la** : l’ancienne cesse de marcher tout de suite.',
    ]
    : [
      info.exists ? '⚪ **Clé coupée.** Tu peux en générer une nouvelle.' : '⚪ **Pas encore de clé.**',
      '',
      `Elle sera reliée à ton compte **${lien.mc_name}** et s’arrête toute seule si tu n’es plus lié.`,
      'Droits : scanner des fichiers et chercher pseudos et empreintes, 20 appels par minute, 200 scans par jour.',
    ];
  return embed('🔑・API DONUTSCAN', { description: lignes.join('\n'), image: lien.mc_name });
}

function boutons(info) {
  const row = new ActionRowBuilder();
  if (info.exists && info.active) {
    row.addComponents(
      new ButtonBuilder().setCustomId('dscan:api:regen').setLabel('Régénérer la clé').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('dscan:api:revoke').setLabel('Couper la clé').setEmoji('⛔').setStyle(ButtonStyle.Danger),
    );
  } else {
    row.addComponents(new ButtonBuilder().setCustomId('dscan:api:create').setLabel('Générer ma clé').setEmoji('🔑').setStyle(ButtonStyle.Primary));
  }
  row.addComponents(new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(DOC));
  return [row];
}

function refus(interaction) {
  const lien = store.getLink(interaction.user.id);
  if (!config.donutscan.apiKey) return '❌ Le lien avec DonutScan n’est pas configuré sur ce bot.';
  if (!lien) return '🔒 Lie d’abord ton compte Minecraft : la clé lui est rattachée.';
  if (!aLeRole(interaction.member) && !estAdmin(interaction.member)) {
    return `🔒 Réservé aux membres qui ont le rôle **${NOM_ROLE}**. Ouvre un ticket pour le demander.`;
  }
  return null;
}

export async function execute(interaction) {
  const non = refus(interaction);
  if (non) return interaction.reply({ content: non, flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lien = store.getLink(interaction.user.id);
  try {
    const info = await cle('info', { discord: interaction.user.id });
    return interaction.editReply({ embeds: [carte(info, lien)], components: boutons(info) });
  } catch (e) {
    console.warn('[scan] /donutscan api :', e.message);
    return interaction.editReply('❌ DonutScan ne répond pas pour le moment, réessaie dans un instant.');
  }
}

export async function onBoutonApi(interaction) {
  const non = refus(interaction);
  if (non) return interaction.reply({ content: non, flags: MessageFlags.Ephemeral });
  const lien = store.getLink(interaction.user.id);
  const action = interaction.customId.split(':')[2];

  // Confirmation avant de casser une cle qui marche.
  if (action === 'regen' || action === 'revoke') {
    const texte = action === 'regen'
      ? 'Régénérer ta clé ? L’**ancienne cesse de marcher tout de suite** : pense à mettre la nouvelle dans ton bot.'
      : 'Couper ta clé ? Tes outils ne pourront plus appeler DonutScan tant que tu n’en génères pas une nouvelle.';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dscan:api:${action}ok`).setLabel(action === 'regen' ? 'Oui, régénérer' : 'Oui, couper').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('dscan:api:retour').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed('🔑・API DONUTSCAN', { description: texte, couleur: FR.jaune, image: null })], components: [row] });
  }

  await interaction.deferUpdate();
  try {
    if (action === 'retour') {
      const info = await cle('info', { discord: interaction.user.id });
      return interaction.editReply({ embeds: [carte(info, lien)], components: boutons(info) });
    }
    if (action === 'revokeok') {
      const info = await cle('revoke', { discord: interaction.user.id });
      console.log(`[scan] cle API coupee par ${interaction.user.id} (${lien.mc_name})`);
      return interaction.editReply({ embeds: [carte(info, lien)], components: boutons(info) });
    }
    if (action === 'create' || action === 'regenok') {
      const d = await cle('create', { discord: interaction.user.id, mc: lien.mc_name });
      console.log(`[scan] cle API ${action === 'create' ? 'creee' : 'regeneree'} par ${interaction.user.id} (${lien.mc_name})`);
      // La cle est verifiee contre la liste des membres lies : on la renvoie tout de suite a DonutScan.
      pousserMaintenant().catch(() => {});
      const texte = [
        '✅ **Voici ta clé.** Copie-la maintenant : elle ne sera **plus jamais affichée**.',
        `\`\`\`\n${d.key}\n\`\`\``,
        'Garde-la secrète : ne la colle jamais dans un salon, un dépôt public ou un screen. Si elle fuit, régénère-la.',
        `Dans tes requêtes : en-tête \`Authorization: Bearer <ta clé>\`. Tout est expliqué sur ${DOC}`,
      ].join('\n');
      return interaction.editReply({ embeds: [embed('🔑・TA CLÉ API', { description: texte, couleur: FR.vert, image: null })], components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('dscan:api:retour').setLabel('J’ai copié ma clé').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(DOC),
        ),
      ] });
    }
  } catch (e) {
    console.warn('[scan] bouton api :', e.message);
    return interaction.editReply({ content: '❌ DonutScan ne répond pas pour le moment, réessaie dans un instant.', embeds: [], components: [] });
  }
  return undefined;
}
