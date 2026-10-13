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
    // Beta : ce role passe le mur du /link et le delai de 24 h avant de noter.
    bypassRoleId: process.env.BYPASS_ROLE_ID ?? '',
    logChannelId: process.env.LOG_CHANNEL_ID ?? '',
    // Salon staff du journal technique : liens, avis, pannes, erreurs.
    opsChannelId: process.env.OPS_CHANNEL_ID ?? '',
    // Acces aux commandes staff, en plus de la permission « Gerer le serveur ».
    adminRoleId: process.env.ADMIN_ROLE_ID ?? '',
    adminUserIds: (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    // Developpeurs du bot : acces staff sur tout serveur, quels que soient
    // les roles et le .env de la machine.
    devUserIds: (process.env.DEV_USER_IDS ?? '1559619449324044299').split(',').map((s) => s.trim()).filter(Boolean),
    // Vide = avatar du bot. Ne jamais mettre une URL d attachement Discord
    // (parametres ex=/is=/hm=) : elle est signee et expire sous 24 h.
    logoUrl: process.env.LOGO_URL ?? '',
    // Intent privilegie « Message Content », a cocher dans le portail
    // developpeur AVANT de le passer a true, sinon Discord refuse la connexion.
    // Sans lui les transcripts de tickets sortent sans le texte des messages.
    messageContent: process.env.DISCORD_MESSAGE_CONTENT === 'true',
  },
  mc: {
    linkAccount: process.env.MC_LINK_ACCOUNT ?? '',
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
    statusFile: process.env.INGAME_STATUS ?? './data/ingame-status.json',
    priorityFile: process.env.BALANCE_PRIORITY_FILE ?? './data/balance-priority.txt',
    statsRequestFile: process.env.STATS_PRIORITY_FILE ?? './data/stats-priority.txt',
    statsFile: process.env.STATS_FILE ?? './data/stats.jsonl',
    eventsFile: process.env.EVENTS_FILE ?? './data/events.jsonl',
    // Code Microsoft en attente, depose par le bot en jeu (jamais dans le flux).
    msaCodeFile: process.env.MSA_CODE_FILE ?? './data/msa-code.json',
    // Ordres du journal staff vers le bot en jeu (relink).
    controlFile: process.env.INGAME_CONTROL_FILE ?? './data/ingame-control.json',
  },
  // Dons au bot : tout /pay a partir de `min`, rangs par total cumule,
  // reversement quotidien au beneficiaire (fait par le bot en jeu).
  dons: {
    min: num('DONATION_MIN', 10_000),
    paliers: (process.env.DONATION_TIERS ?? '500000000,1000000000,5000000000')
      .split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b),
    beneficiaire: (process.env.DONATION_RECIPIENT ?? '').trim(),
    // Historique des dons et des reversements, a part du journal technique.
    salonId: process.env.DONATION_LOG_CHANNEL_ID ?? '',
    // Salon public ou le bot publie le panneau des dons (rangs, comment donner).
    salonPanneauId: process.env.DONATION_CHANNEL_ID ?? '',
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
