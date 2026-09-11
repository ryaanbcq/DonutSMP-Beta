// Le lien se confirme de facon asynchrone, quand le paiement arrive en jeu :
// il n y a donc plus d interaction en cours pour repondre en ephemere.
// On garde le token de la commande /link, valide 15 minutes cote Discord,
// exactement la duree de vie d un challenge. Au paiement on l utilise pour
// envoyer un followUp que le membre seul voit, en plus du MP.

const pending = new Map();

export function remember(discordId, interaction, ttlMs) {
  // Discord invalide le token au bout de 15 min, quoi qu on fasse.
  const ceiling = 15 * 60_000 - 10_000;
  pending.set(String(discordId), {
    interaction,
    expiresAt: Date.now() + Math.min(ttlMs, ceiling),
  });
}

export function take(discordId) {
  const key = String(discordId);
  const entry = pending.get(key);
  if (!entry) return null;
  pending.delete(key);
  return entry.expiresAt > Date.now() ? entry.interaction : null;
}

export function forget(discordId) {
  pending.delete(String(discordId));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}, 60_000).unref?.();
