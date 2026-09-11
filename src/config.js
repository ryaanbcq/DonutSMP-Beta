import 'dotenv/config';

function num(key, def) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : def;
}

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN ?? '',
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    guildId: process.env.DISCORD_GUILD_ID ?? '',
    verifiedRoleId: process.env.VERIFIED_ROLE_ID ?? '',
    logChannelId: process.env.LOG_CHANNEL_ID ?? '',
    // Vide = avatar du bot. Ne jamais mettre une URL d attachement Discord
    // (parametres ex=/is=/hm=) : elle est signee et expire sous 24 h.
    logoUrl: process.env.LOGO_URL ?? '',
  },
  mc: {
    linkAccount: process.env.MC_LINK_ACCOUNT ?? 'OutmindFR',
  },
  payments: {
    source: process.env.PAYMENT_SOURCE ?? 'jsonl',
    file: process.env.PAYMENT_FILE ?? './data/payments.jsonl',
    pollMs: num('PAYMENT_POLL_MS', 2000),
  },
  link: {
    ttlMs: num('LINK_TTL_MINUTES', 15) * 60_000,
    amountMin: num('LINK_AMOUNT_MIN', 1),
    amountMax: num('LINK_AMOUNT_MAX', 1000),
  },
  donut: {
    apiKey: process.env.DONUT_API_KEY ?? '',
    base: process.env.DONUT_API_BASE ?? 'https://api.donutsmp.net/v1',
    // Donnees inventees pour developper l interface SANS cle. Doit etre
    // demande explicitement : sinon du faux se glisse dans le classement et
    // se lit comme du vrai (vecu le 2026-09-11, un solde de 70M affiche a 3,34M).
    mock: process.env.DONUT_MOCK === 'true',
  },
  dbPath: process.env.DB_PATH ?? './data/bot.db',
  ingame: {
    trackedFile: process.env.TRACKED_FILE ?? './data/tracked.json',
    balanceFile: process.env.BALANCE_FILE ?? './data/balances.jsonl',
  },
  // Repris tel quel par les textes joueurs qui annoncent le remboursement.
  refundDelayMaxS: num('REFUND_DELAY_MAX_S', 120),
  baltop: {
    // Duree visee pour interroger TOUS les membres verifies une fois.
    cycleMs: num('BALTOP_CYCLE_MINUTES', 15) * 60_000,
    // Garde-fou : l API DonutSMP autorise 250 requetes par minute.
    maxParMinute: num('BALTOP_MAX_PER_MINUTE', 60),
    // Panneau public : salon, heure de reecriture, role du premier.
    salonId: process.env.BALTOP_CHANNEL_ID ?? '',
    // Le panneau se reecrit des que le top bouge, jamais plus souvent que ca.
    minEditMs: num('BALTOP_MIN_EDIT_SECONDS', 120) * 1000,
    roleTopId: process.env.BALTOP_TOP_ROLE_ID ?? '',
    salonLinkId: process.env.LINK_CHANNEL_ID ?? '',
    // Emojis du podium. Vides = medailles Unicode.
    emojis: [
      process.env.BALTOP_EMOJI_1 ?? '',
      process.env.BALTOP_EMOJI_2 ?? '',
      process.env.BALTOP_EMOJI_3 ?? '',
    ],
  },
};

export const COLORS = {
  ok: 0x57f287,
  warn: 0xfee75c,
  err: 0xed4245,
  info: 0x5865f2,
  brand: 0xa18cd1,
  fr: 0xaeefff,
  or: 0xfff36e,
};
