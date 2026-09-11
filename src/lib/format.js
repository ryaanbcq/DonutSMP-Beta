export function shortMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toLocaleString('en-US')}`;
}

export function duration(ms) {
  const h = Math.floor((Number(ms) || 0) / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}j ${h % 24}h`;
  return `${h}h`;
}

export function reputation(pos, neg) {
  const total = pos + neg;
  if (total === 0) return { label: 'Aucun avis', score: 0, ratio: null };
  const score = pos - neg;
  const ratio = Math.round((pos / total) * 100);
  const label = neg === 0 && pos >= 5 ? 'Fiable'
    : ratio >= 80 ? 'Bonne reputation'
    : ratio >= 50 ? 'Mitige'
    : 'A eviter';
  return { label, score, ratio };
}

export const MEDALS = ['🥇', '🥈', '🥉'];
