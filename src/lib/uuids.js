// UUID Minecraft des pseudos (pour les tetes de skin, voir brand.skin).
// Cache en base (kv skin.uuids = { pseudo minuscule: uuid }) recharge au
// demarrage ; les pseudos inconnus sont demandes a Mojang par paquets de 10.

import { store } from '../db.js';
import { poserUuid } from './brand.js';

const CLE = 'skin.uuids';
const lire = () => { try { return JSON.parse(store.kvGet(CLE) ?? '{}') ?? {}; } catch { return {}; } };

export function chargerUuids() {
  const c = lire();
  for (const [n, u] of Object.entries(c)) poserUuid(n, u);
  return Object.keys(c).length;
}

/** Resout les pseudos Java encore inconnus. Rend le nombre de nouveaux UUID. */
export async function resoudreUuids(pseudos) {
  const c = lire();
  const manquants = [...new Set(pseudos.map((p) => String(p ?? '').trim()).filter((p) => /^[A-Za-z0-9_]{3,16}$/.test(p)))]
    .filter((p) => !c[p.toLowerCase()]);
  let n = 0;
  for (let i = 0; i < manquants.length; i += 10) {
    const paquet = manquants.slice(i, i + 10);
    const res = await fetch('https://api.mojang.com/profiles/minecraft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(paquet),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const liste = res?.ok ? await res.json().catch(() => []) : [];
    for (const p of liste) {
      if (!p?.id || !p?.name) continue;
      c[p.name.toLowerCase()] = p.id;
      poserUuid(p.name, p.id);
      n += 1;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (n) store.kvSet(CLE, JSON.stringify(c));
  return n;
}
