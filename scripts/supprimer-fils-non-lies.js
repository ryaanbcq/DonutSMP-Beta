import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client, GatewayIntentBits } from 'discord.js';
import { store } from '../src/db.js';
import { config } from '../src/config.js';

// Outil admin (06/11, demande de Ryan) : supprime les posts de reputation des
// membres NON lies. Les avis restent en base : si le membre lie son compte un
// jour, son post renait avec eux. Avant de supprimer, les pieces jointes des
// cartes d avis sont copiees dans exports/fils-non-lies/ (preuves de scam).
// Usage : node scripts/supprimer-fils-non-lies.js [--oui]   (sans --oui : liste seulement)

const OUI = process.argv.includes('--oui');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async (c) => {
  const fils = store.filsNonLies().filter((r) => !store.getLink(r.discord_id));
  console.log(`${fils.length} post(s) de non lies${OUI ? '' : ' (liste seulement, --oui pour supprimer)'}`);
  const dossier = './exports/fils-non-lies';
  let n = 0;
  for (const r of fils) {
    const avis = store.vouchAll(r.discord_id);
    const fil = await c.channels.fetch(r.thread_id).catch(() => null);
    console.log(`- ${r.mc_name || r.discord_id} : ${fil ? fil.name : 'post introuvable'}, ${avis.length} avis`);
    if (!OUI) continue;
    if (fil) {
      // Copie des pieces jointes de tout le post (preuves).
      const msgs = await fil.messages.fetch({ limit: 100 }).catch(() => null);
      for (const m of msgs?.values() ?? []) {
        const urls = [...m.attachments.values()].map((a) => [a.name, a.url])
          .concat((m.embeds ?? []).filter((e) => e.image?.url).map((e) => [`embed-${m.id}.png`, e.image.url]));
        for (const [nom, url] of urls) {
          const res = await fetch(url).catch(() => null);
          if (!res?.ok) continue;
          mkdirSync(`${dossier}/${r.discord_id}`, { recursive: true });
          writeFileSync(`${dossier}/${r.discord_id}/${m.id}-${nom}`, Buffer.from(await res.arrayBuffer()));
        }
      }
      await fil.delete('Membre non lié : plus de post de réputation').catch((e) => console.warn('  suppression :', e.message));
    }
    for (const v of avis) store.setVouchMessage(v.from_id, v.to_id, null);
    store.removeThread(r.discord_id);
    n += 1;
  }
  if (OUI) console.log(`${n} post(s) supprime(s), avis gardes en base, pieces dans ${dossier}`);
  process.exit(0);
});
await client.login(config.discord.token);
