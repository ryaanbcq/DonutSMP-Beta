// Resolution de la vraie casse d un pseudo Java. Un joueur qui tape
// « sentiazz » doit s afficher « SentiaZz » : sinon le pseudo est moche dans
// les embeds et les tetes de skin ne se resolvent pas.
// Les comptes Bedrock (prefixe .) n existent pas chez Mojang : on les laisse
// tels quels, la vraie casse viendra du message de paiement.

const CACHE = new Map();
const TTL = 6 * 3600_000;

export async function realCase(name) {
  const clean = String(name ?? '').trim();
  if (!clean || clean.startsWith('.')) return clean;

  const key = clean.toLowerCase();
  const hit = CACHE.get(key);
  if (hit && hit.until > Date.now()) return hit.name;

  try {
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return clean;
    const body = await res.json();
    const resolved = typeof body?.name === 'string' ? body.name : clean;
    CACHE.set(key, { name: resolved, until: Date.now() + TTL });
    return resolved;
  } catch {
    return clean; // Mojang muet : on n empeche pas le link pour autant
  }
}
