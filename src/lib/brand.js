import { EmbedBuilder } from 'discord.js';
import { config, COLORS } from '../config.js';

// Charte des embeds DonutSMP FR : ligne d auteur en capitales, vignette logo,
// bleu clair de la commu. Le logo par defaut est l avatar du bot, qui est deja
// le donut tricolore : une URL d attachement Discord serait signee et expirerait
// sous 24 h, laissant une image cassee dans un panneau permanent.
let logoUrl = null;

export function setLogo(url) {
  logoUrl = config.discord.logoUrl || url || null;
}

export function brandEmbed(title, { color = COLORS.fr, logo = true } = {}) {
  const embed = new EmbedBuilder().setColor(color);
  if (title) embed.setAuthor({ name: title });
  if (logo && logoUrl) embed.setThumbnail(logoUrl);
  return embed;
}

export function skinThumb(name) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(String(name).replace(/^\./, ''))}/128`;
}
