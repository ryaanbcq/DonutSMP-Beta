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
  if (f.shards !== undefined && f.shards !== null) l.push(`💎 **Shards** ${v(fr(f.shards))}`);
  const kills = f.killsTexte ?? fr(f.kills);
  const morts = f.mortsTexte ?? fr(f.morts);
  if (kills) l.push(`⚔️ **Kills** ${v(kills)}`);
  if (morts) l.push(`💀 **Morts** ${v(morts)}`);
  const kd = ratio(f.kills, f.morts);
  if (kd) l.push(`📈 **K/D** ${v(kd)}`);
  if (f.temps) l.push(`⏱️ **Temps de jeu** ${v(tempsFr(f.temps))}`);
  if (Number.isFinite(f.poses)) l.push(`🧱 **Blocs posés** ${v(fr(f.poses))}`);
  if (Number.isFinite(f.casses)) l.push(`⛏️ **Blocs cassés** ${v(fr(f.casses))}`);
  if (Number.isFinite(f.mobs)) l.push(`🧟 **Mobs tués** ${v(fr(f.mobs))}`);
  if (f.enLigne === true) l.push(`🟢 **En ligne**${f.rang ? ` · ${f.rang}` : ''}`);
  else if (f.enLigne === false) l.push('⚫ **Hors ligne**');
  l.push(f.discordId ? `🔗 **Discord** <@${f.discordId}>` : '🔗 **Discord** pas lié');
  return l.join('\n');
}
