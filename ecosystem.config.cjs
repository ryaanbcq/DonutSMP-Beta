// pm2. Rappel vecu sur le VPS du casino : UN SEUL --only par commande,
// deux --only dans la meme ligne et seul le dernier process demarre.
//   pm2 start ecosystem.config.cjs --only fr-discord
//   pm2 start ecosystem.config.cjs --only fr-ingame
// Apres modification du .env : pm2 delete <proc> puis pm2 start (un restart
// ne relit pas l ecosystem).
module.exports = {
  apps: [
    {
      name: 'fr-discord',
      script: 'src/index.js',
      max_memory_restart: '400M',
      restart_delay: 5000,
      max_restarts: 20,
      out_file: 'logs/discord.log',
      error_file: 'logs/discord.err.log',
      time: true,
    },
    {
      name: 'fr-ingame',
      script: 'ingame/bot.js',
      node_args: '--max-old-space-size=512',
      // 700 Mo de plafond pour la beta. Un mineflayer sain tient a 40-60 Mo de
      // tas ; ce qui grimpe c est le RSS par fragmentation glibc, d ou
      // MALLOC_ARENA_MAX. Toucher 700 Mo = bug a regarder, pas RAM a rajouter.
      max_memory_restart: '700M',
      env: { MALLOC_ARENA_MAX: '2' },
      restart_delay: 10000,
      max_restarts: 50,
      out_file: 'logs/ingame.log',
      error_file: 'logs/ingame.err.log',
      time: true,
    },
  ],
};
