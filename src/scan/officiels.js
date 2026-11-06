import { createHash } from 'node:crypto';
import { config } from '../config.js';

// Builds officielles de Meteor : chaque jour, le bot telecharge la derniere build de chaque version
// depuis le serveur de Meteor (qui refuse les requetes venant de Cloudflare) et envoie seulement leurs
// empreintes a DonutScan, qui les marque « authentiques ». Rien n est publie, aucun lien n est affiche.
const UA = 'DonutScan-sync/1.0 (donutscan.org)';

async function meteor() {
  const stats = await (await fetch('https://meteorclient.com/api/stats', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })).json();
  const items = [];
  for (const v of Object.keys(stats.builds ?? {}).slice(0, 20)) {
    try {
      const r = await fetch(`https://meteorclient.com/api/download?version=${encodeURIComponent(v)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) continue;
      const fichier = (/filename="?([^";]+)"?/i.exec(r.headers.get('content-disposition') ?? '') ?? [])[1] ?? '';
      const version = (/^meteor-client-(.+)\.jar$/.exec(fichier) ?? [])[1];
      const buf = Buffer.from(await r.arrayBuffer());
      if (!version || buf.length < 100_000) continue;
      items.push({ client: 'meteor-client', version, sha256: createHash('sha256').update(buf).digest('hex') });
    } catch (e) { console.warn(`[scan] meteor ${v} :`, e.message); }
  }
  return items;
}

async function tour() {
  if (!config.donutscan.apiKey) return;
  try {
    const items = await meteor();
    if (!items.length) return console.warn('[scan] builds officielles : aucune build recuperee');
    const res = await fetch(`${config.donutscan.base}/official/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.donutscan.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json().catch(() => ({}));
    const nouveaux = (j.bilan ?? []).filter((b) => b.nouveau).map((b) => b.version);
    console.log(`[scan] builds officielles Meteor : ${items.length} verifiee(s)${nouveaux.length ? `, nouvelles : ${nouveaux.join(', ')}` : ''}`);
  } catch (e) { console.warn('[scan] builds officielles :', e.message); }
}

export function demarrerSyncOfficiels() {
  setTimeout(tour, 60_000).unref();
  setInterval(tour, 24 * 3_600_000).unref();
}
export const syncOfficielsMaintenant = tour;
