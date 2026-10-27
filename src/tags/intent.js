// L intent « Server Members » est-il coche dans le portail developpeur ?
//
// Demander un intent privilegie non coche fait refuser la connexion par
// Discord (code 4014) : le bot ne demarrerait plus du tout. On lit donc les
// drapeaux de l application avant de se connecter, et on ne le demande que
// s il est autorise. Cocher la case puis `donut restart` suffit, rien a
// ecrire dans le .env.

// Drapeaux d application : 1<<14 (bot verifie, +100 serveurs), 1<<15 (case cochee).
const MEMBRES = (1 << 14) | (1 << 15);

export const aIntentMembres = (app) => Boolean((app?.flags ?? 0) & MEMBRES);

export async function intentMembresCoche(token, { fetch: f = fetch } = {}) {
  // Forcage manuel, utile si l API ne repond pas au demarrage.
  if (process.env.DISCORD_GUILD_MEMBERS === 'true') return true;
  if (process.env.DISCORD_GUILD_MEMBERS === 'false' || !token) return false;
  try {
    const res = await f('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    return aIntentMembres(await res.json());
  } catch {
    return false;
  }
}
