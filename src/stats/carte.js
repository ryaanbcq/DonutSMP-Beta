// Fiche /stats, partie pure (testee) : une ligne par stat, valeur en code,
// facon liste. Les champs absents (le jeu n en donne que 4, l API officielle
// tous) ne s affichent pas.

const fr = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ') : null);

/** « 8d 9h » (DonutSMP, anglais) -> « 8j 9h ». */
export const tempsFr = (t) => (t ? String(t).replace(/(\d+)d\b/g, '$1j') : null);

/** Kills / morts : « 0.30 », ou le nombre de kills sans mort. */
export function ratio(kills, morts) {
  if (!Number.isFinite(kills) || !Number.isFinite(morts)) return null;
  return morts > 0 ? (kills / morts).toFixed(2) : String(kills);
}

/**
 * f : { argent, shards, kills, morts, killsTexte, mortsTexte, temps, poses,
 *       casses, mobs, enLigne (true/false/null), rang, discordId }
 */
export function lignesStats(f) {
  const l = [];
  const v = (x) => `\`${x}\``;
  if (f.argent) l.push(`💰 **Argent** ${v(f.argent)}`);
  const shards = f.shardsTexte ?? (Number.isFinite(f.shards) ? fr(f.shards) : null);
  if (shards) l.push(`💎 **Shards** ${v(shards)}`);
  const kills = f.killsTexte ?? fr(f.kills);
  const morts = f.mortsTexte ?? fr(f.morts);
  if (kills) l.push(`⚔️ **Kills** ${v(kills)}`);
  if (morts) l.push(`💀 **Morts** ${v(morts)}`);
  const kd = ratio(f.kills, f.morts);
  if (kd) l.push(`📈 **K/D** ${v(kd)}`);
  if (f.temps) l.push(`⏱️ **Temps de jeu** ${v(tempsFr(f.temps))}`);
  const t = (texte, n) => texte ?? (Number.isFinite(n) ? fr(n) : null);
  if (t(f.posesTexte, f.poses)) l.push(`🧱 **Blocs posés** ${v(t(f.posesTexte, f.poses))}`);
  if (t(f.cassesTexte, f.casses)) l.push(`⛏️ **Blocs cassés** ${v(t(f.cassesTexte, f.casses))}`);
  if (t(f.mobsTexte, f.mobs)) l.push(`🧟 **Mobs tués** ${v(t(f.mobsTexte, f.mobs))}`);
  for (const [k, x] of Object.entries(f.autres ?? {})) l.push(`▫️ **${k}** ${v(x)}`);
  if (f.vu) l.push(/online|en ligne/i.test(f.vu) ? '🟢 **En ligne** maintenant' : `👀 **Vu** ${f.vu}`);
  else if (f.enLigne === true) l.push(`🟢 **En ligne**${f.rang ? ` · ${f.rang}` : ''}`);
  else if (f.enLigne === false) l.push('⚫ **Hors ligne**');
  l.push(f.discordId ? `🔗 **Discord** <@${f.discordId}>` : '🔗 **Discord** pas lié');
  return l.join('\n');
}
