// Lien video d un avis : un clip Medal (medal.tv), pour montrer un trade sans
// la limite de 8 Mo des fichiers Discord. Le lien est poste en texte sous la
// carte de l avis : Discord en affiche le lecteur.

/** Lien Medal propre (sans parametres de suivi), ou null s il n en est pas un. */
export function lireLienMedal(texte) {
  const s = String(texte ?? '').trim();
  if (!s) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const hote = url.hostname.toLowerCase();
  if (hote !== 'medal.tv' && !hote.endsWith('.medal.tv')) return null;
  if (!/\/clips?\//i.test(url.pathname)) return null;
  return `https://medal.tv${url.pathname.replace(/\/+$/, '')}`;
}
