import { config } from '../config.js';
import { normName } from '../lib/names.js';

// Client de l'API officielle DonutSMP. Sans cle (DONUT_API_KEY vide) on rend
// des donnees factices pour pouvoir developper le reste sans etre bloque.
// Les formes de reponse sont normalisees ici : si l'API bouge, c'est le seul
// fichier a toucher.

const MOCK_NAMES = ['Sp4cz', 'RafT81', 'JustBlazyy', 'Accoutrement_', 'letenders'];

function mockNumber(seed, scale) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % scale) + Math.floor(scale / 10);
}

async function call(path) {
  if (!config.donut.apiKey) return null;
  const res = await fetch(`${config.donut.base}${path}`, {
    headers: {
      Authorization: `Bearer ${config.donut.apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`API DonutSMP ${res.status}`);
  return res.json();
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

export const donut = {
  get live() {
    return Boolean(config.donut.apiKey);
  },

  async stats(name) {
    const clean = String(name).trim();
    const body = await call(`/lookup/${encodeURIComponent(clean.replace(/^\./, ''))}`);
    if (body === null) {
      const seed = normName(clean);
      return {
        mock: true,
        name: clean,
        money: mockNumber(seed, 5_000_000),
        kills: mockNumber(seed + 'k', 400),
        deaths: mockNumber(seed + 'd', 300),
        playtimeMs: mockNumber(seed + 'p', 200) * 3_600_000,
      };
    }
    if (body.notFound) return null;
    const d = body.result ?? body.data ?? body;
    return {
      mock: false,
      name: pick(d, ['username', 'name', 'player']) ?? clean,
      money: Number(pick(d, ['money', 'balance', 'bal'])) || 0,
      kills: Number(pick(d, ['kills', 'playerKills'])) || 0,
      deaths: Number(pick(d, ['deaths'])) || 0,
      playtimeMs: Number(pick(d, ['playtime', 'playTime', 'time'])) || 0,
    };
  },

  async leaderboard(category = 'money', limit = 10) {
    const body = await call(`/leaderboards/${encodeURIComponent(category)}/1`);
    if (body === null) {
      return MOCK_NAMES.slice(0, limit)
        .map((n) => ({ name: n, value: mockNumber(n + category, 10_000_000), mock: true }))
        .sort((a, b) => b.value - a.value)
        .map((r, i) => ({ rank: i + 1, ...r }));
    }
    const rows = body.result ?? body.data ?? body.leaderboard ?? [];
    const list = Array.isArray(rows)
      ? rows
      : Object.entries(rows).map(([name, value]) => ({ name, value }));
    return list.slice(0, limit).map((r, i) => ({
      rank: Number(pick(r, ['rank', 'position'])) || i + 1,
      name: pick(r, ['username', 'name', 'player']) ?? '?',
      value: Number(pick(r, ['value', 'amount', 'money', 'score'])) || 0,
      mock: false,
    }));
  },
};

export const LEADERBOARDS = [
  { name: 'Argent', value: 'money' },
  { name: 'Kills', value: 'kills' },
  { name: 'Temps de jeu', value: 'playtime' },
  { name: 'Shards', value: 'shards' },
  { name: 'Blocs mines', value: 'brokenblocks' },
];
