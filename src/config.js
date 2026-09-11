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
  },
  dbPath: process.env.DB_PATH ?? './data/bot.db',
};

export const COLORS = {
  ok: 0x57f287,
  warn: 0xfee75c,
  err: 0xed4245,
  info: 0x5865f2,
  brand: 0xa18cd1,
};
