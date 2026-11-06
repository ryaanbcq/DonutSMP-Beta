// /gcreate en deux temps (Ryan, 06/11) : le formulaire (prix, duree,
// gagnants, description, image) ouvre un BROUILLON prive ou l on choisit les
// roles requis et les roles bonus (+1, +2, +3 entrees, cumulables), puis
// « Lancer ». Le formulaire Discord est limite a 5 champs : pas de place pour
// les roles dedans.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { startGiveaway } from './service.js';

const brouillons = new Map(); // userId -> { data, requis, bonus: {1:[],2:[],3:[]}, at }
const VIE_MS = 30 * 60_000;

function nettoyer() {
  const t = Date.now();
  for (const [k, b] of brouillons) if (t - b.at > VIE_MS) brouillons.delete(k);
}

/** Roles bonus par defaut : ceux de /gsettings. */
function bonusDefaut(ctx, guildId) {
  const s = ctx.settings.get(guildId).giveaways;
  const b = { 1: [], 2: [], 3: [] };
  for (const e of s.bonusEntries ?? []) {
    const plus = Math.min(3, Math.max(1, (e.entries ?? 2) - 1));
    b[plus].push(e.roleId);
  }
  return b;
}

export function vueBrouillon(b) {
  const roles = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : '*aucun*');
  const d = b.data;
  const content = `### 🎉 ${d.prize}\n`
    + `Gagnants : **${d.winners}** · durée : **${d.dureeTexte}**\n`
    + `Rôle requis : ${roles(b.requis)}\n`
    + `Bonus +1 : ${roles(b.bonus[1])} · +2 : ${roles(b.bonus[2])} · +3 : ${roles(b.bonus[3])}\n`
    + '-# Choisis les rôles ci-dessous (vide = personne), puis Lancer. Les bonus s\'additionnent.';
  const menu = (id, placeholder, defauts, max) => {
    const m = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(0).setMaxValues(max);
    if (defauts.length) m.setDefaultRoles(...defauts.slice(0, max));
    return new ActionRowBuilder().addComponents(m);
  };
  return {
    content,
    components: [
      menu('gdraft:requis', '🔒 Rôle(s) requis pour participer', b.requis, 5),
      menu('gdraft:b1', '➕ Rôles bonus : +1 entrée', b.bonus[1], 10),
      menu('gdraft:b2', '➕ Rôles bonus : +2 entrées', b.bonus[2], 10),
      menu('gdraft:b3', '➕ Rôles bonus : +3 entrées', b.bonus[3], 10),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gdraft:go').setLabel('Lancer le giveaway').setEmoji('🎉').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('gdraft:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Appele par le formulaire /gcreate une fois les champs valides. */
export function ouvrirBrouillon(interaction, ctx, data) {
  nettoyer();
  const b = { data, requis: [], bonus: bonusDefaut(ctx, interaction.guildId), at: Date.now() };
  brouillons.set(interaction.user.id, b);
  return interaction.reply({ ...vueBrouillon(b), flags: MessageFlags.Ephemeral });
}

/** Menus et boutons gdraft:* */
export async function surBrouillon(interaction, ctx) {
  const b = brouillons.get(interaction.user.id);
  if (!b) return interaction.update({ content: '⌛ Brouillon expiré : relance `/gcreate`.', components: [] });
  b.at = Date.now();
  const quoi = interaction.customId.slice('gdraft:'.length);
  if (quoi === 'cancel') {
    brouillons.delete(interaction.user.id);
    return interaction.update({ content: 'Giveaway annulé.', components: [] });
  }
  if (quoi === 'requis') { b.requis = [...interaction.values]; return interaction.update(vueBrouillon(b)); }
  if (/^b[123]$/.test(quoi)) {
    const n = Number(quoi[1]);
    // Un role n a qu un seul bonus : le choisir ici le retire des autres paliers.
    for (const k of [1, 2, 3]) if (k !== n) b.bonus[k] = b.bonus[k].filter((id) => !interaction.values.includes(id));
    b.bonus[n] = [...interaction.values];
    return interaction.update(vueBrouillon(b));
  }
  if (quoi !== 'go') return undefined;
  await interaction.update({ content: '⏳ Lancement…', components: [] });
  brouillons.delete(interaction.user.id);
  const bonusEntries = [1, 2, 3].flatMap((k) => b.bonus[k].map((roleId) => ({ roleId, entries: k + 1 })));
  try {
    const g = await startGiveaway(ctx, interaction.guild, {
      ...b.data.lancement,
      options: { ...b.data.lancement.options, requiredRoleIds: b.requis, bonusEntries },
    });
    return interaction.editReply(`🎉 Giveaway #${g.id} lancé dans <#${g.channel_id}> !`);
  } catch (e) {
    return interaction.editReply(`❌ Impossible de publier le giveaway : ${e.message}`);
  }
}
