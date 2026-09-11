// Les zeros de fin sont de la fausse precision : DonutSMP arrondit deja les
// soldes des autres joueurs (« 79.9M »). On ecrit donc $636M, pas $636.00M.
function sansZerosInutiles(x, decimales) {
  return x.toFixed(decimales).replace(/\.?0+$/, '');
}

export function shortMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${sansZerosInutiles(v / 1e9, 2)}B`;
  if (abs >= 1e6) return `$${sansZerosInutiles(v / 1e6, 2)}M`;
  if (abs >= 1e3) return `$${sansZerosInutiles(v / 1e3, 1)}K`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
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
    : ratio >= 80 ? 'Bonne réputation'
    : ratio >= 50 ? 'Mitigé'
    : 'À éviter';
  return { label, score, ratio };
}

export const MEDALS = ['🥇', '🥈', '🥉'];
