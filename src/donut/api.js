import { config } from '../config.js';
import { normName } from '../lib/names.js';

// Client de l API officielle DonutSMP.
//
// Formes relevees dans la spec OpenAPI (https://api.donutsmp.net/doc.json) :
//   GET /v1/stats/{user}              -> { status, result: { money, kills, deaths,
//                                          playtime, shards, broken_blocks, ... } }
//   GET /v1/lookup/{user}             -> { status, result: { username, rank, location } }
//   GET /v1/leaderboards/{cat}/{page} -> { status, result: [ { username, uuid, value } ] }
// Toutes les valeurs numeriques arrivent en CHAINES, d ou les Number() partout.
// Auth : Authorization: Bearer <cle>, 250 requetes par minute.
//
// Sans cle, on rend des donnees factices pour pouvoir developper le reste.

const MOCK_NAMES = ['Sp4cz', 'RafT81', 'JustBlazyy', 'Accoutrement_', 'letenders'];

function mockNumber(seed, scale) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % scale) + Math.floor(scale / 10);
}

async function call(path) {
  if (!config.donut.apiKey) {
    // Pas de cle : on ne DEVINE pas. Soit le mode test est demande
    // explicitement, soit on echoue en le disant.
    if (config.donut.mock) return null;
    throw new Error('clé API DonutSMP manquante');
  }
  const res = await fetch(`${config.donut.base}${path}`, {
    headers: {
      Authorization: `Bearer ${config.donut.apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return { notFound: true };
  if (res.status === 401 || res.status === 403) throw new Error('cle API refusee');
  if (res.status === 429) throw new Error('trop de requetes, reessaie dans une minute');
  if (!res.ok) throw new Error(`API DonutSMP ${res.status}`);
  const body = await res.json();
  // Le corps porte son propre statut en plus du code HTTP.
  if (body?.status && Number(body.status) >= 400) return { notFound: true };
  return body;
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const donut = {
  /** Vraies donnees disponibles. Faux en mode test comme sans cle. */
  get live() {
    return Boolean(config.donut.apiKey);
  },

  get mock() {
    return !config.donut.apiKey && config.donut.mock;
  },

  /** Stats de jeu. Le pseudo Bedrock perd son point cote API. */
  async stats(name) {
    const clean = String(name).trim();
    const body = await call(`/stats/${encodeURIComponent(clean.replace(/^\./, ''))}`);

    if (body === null) {
      const seed = normName(clean);
      return {
        mock: true,
        name: clean,
        money: mockNumber(seed, 5_000_000),
        kills: mockNumber(seed + 'k', 400),
        deaths: mockNumber(seed + 'd', 300),
        shards: mockNumber(seed + 's', 900),
        playtimeMs: mockNumber(seed + 'p', 200) * 3_600_000,
      };
    }
    if (body.notFound) return null;

    const r = body.result ?? body;
    return {
      mock: false,
      name: clean,
      money: num(r.money),
      kills: num(r.kills),
      deaths: num(r.deaths),
      shards: num(r.shards),
      mobsKilled: num(r.mobs_killed),
      brokenBlocks: num(r.broken_blocks),
      placedBlocks: num(r.placed_blocks),
      // L API rend le temps de jeu en millisecondes.
      playtimeMs: num(r.playtime),
    };
  },

  /** Rang et localisation, comme /findplayer en jeu. Null si hors ligne. */
  async lookup(name) {
    const clean = String(name).trim().replace(/^\./, '');
    const body = await call(`/lookup/${encodeURIComponent(clean)}`);
    if (body === null || body.notFound) return null;
    const r = body.result ?? body;
    return {
      username: r.username ?? clean,
      rank: r.rank ?? null,
      location: r.location ?? null,
    };
  },

  async leaderboard(category = 'money', limit = 10) {
    const body = await call(`/leaderboards/${encodeURIComponent(category)}/1`);

    if (body === null) {
      return MOCK_NAMES
        .map((n) => ({ name: n, value: mockNumber(n + category, 10_000_000), mock: true }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit)
        .map((r, i) => ({ rank: i + 1, ...r }));
    }
    if (body.notFound) return [];

    const rows = Array.isArray(body.result) ? body.result : [];
    return rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      name: r.username ?? '?',
      uuid: r.uuid ?? null,
      value: num(r.value),
      mock: false,
    }));
  },
};

// Categories exactes de l API. `sell` et `shop` sont des montants en dollars.
export const LEADERBOARDS = [
  { name: 'Argent', value: 'money' },
  { name: 'Kills', value: 'kills' },
  { name: 'Temps de jeu', value: 'playtime' },
  { name: 'Shards', value: 'shards' },
  { name: 'Blocs minés', value: 'brokenblocks' },
  { name: 'Mobs tués', value: 'mobskilled' },
  { name: 'Gains sur /sell', value: 'sell' },
];

export const MONEY_BOARDS = new Set(['money', 'sell', 'shop']);
