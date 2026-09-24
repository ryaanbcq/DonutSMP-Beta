// Outil staff : lier, delier et inspecter a la main, sans passer par Discord.
//   node scripts/admin.js list
//   node scripts/admin.js link <discordId> <pseudo>
//   node scripts/admin.js unlink <discordId|pseudo>
//   node scripts/admin.js pending
//   node scripts/admin.js payments [n]
import { store, db } from '../src/db.js';
import { shortMoney } from '../src/lib/format.js';

const [cmd, ...args] = process.argv.slice(2);
const when = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

switch (cmd) {
  case 'list': {
    const rows = db.prepare('SELECT * FROM links ORDER BY linked_at DESC').all();
    if (!rows.length) { console.log('Aucun compte lie.'); break; }
    for (const r of rows) {
      const { pos, neg } = store.vouchScore(r.discord_id);
      console.log(`${r.mc_name.padEnd(20)} discord:${r.discord_id.padEnd(20)} +${pos}/-${neg}  ${when(r.linked_at)}`);
    }
    console.log(`\n${rows.length} compte(s).`);
    break;
  }

  case 'link': {
    const [discordId, pseudo] = args;
    if (!discordId || !pseudo) { console.error('usage: admin.js link <discordId> <pseudo>'); process.exit(1); }
    if (store.getLink(discordId)) { console.error('Ce Discord est deja lie.'); process.exit(1); }
    if (store.getLinkByName(pseudo)) { console.error('Ce pseudo est deja lie.'); process.exit(1); }
    store.createLink(discordId, pseudo, 0);
    console.log(`Lie : ${pseudo} <-> ${discordId} (sans paiement, pose par le staff).`);
    break;
  }

  case 'unlink': {
    // Meme chemin que le bouton Unlink : sortie du classement, reputation
    // laissee au pseudo, liste des soldes suivis mise a jour. Le role des
    // verifies ne peut pas etre retire d ici (pas de client Discord).
    const [cible] = args;
    const link = store.getLink(cible) ?? store.getLinkByName(cible ?? '');
    if (!link) { console.error('Ni ce Discord ni ce pseudo ne sont lies.'); process.exit(1); }
    const { delier } = await import('../src/link/unlink.js');
    await delier(link.discord_id, null);
    console.log(`Delie : ${link.mc_name} (discord ${link.discord_id}). Le classement se met a jour sous 2 min.`);
    break;
  }

  case 'pending': {
    const rows = db.prepare("SELECT * FROM challenges WHERE status = 'pending' ORDER BY created_at").all();
    if (!rows.length) { console.log('Aucune verification en cours.'); break; }
    for (const r of rows) {
      const left = Math.max(0, Math.round((r.expires_at - Date.now()) / 60_000));
      console.log(`${r.mc_name.padEnd(20)} $${String(r.amount).padEnd(5)} discord:${r.discord_id}  expire dans ${left} min`);
    }
    break;
  }

  case 'payments': {
    const n = Number(args[0]) || 20;
    const rows = db.prepare('SELECT * FROM payments ORDER BY seen_at DESC LIMIT ?').all(n);
    for (const r of rows) {
      console.log(`${when(r.seen_at)}  ${r.from_name.padEnd(20)} ${shortMoney(r.amount).padEnd(10)} ${r.outcome}`);
    }
    console.log(`\n${rows.length} paiement(s) vus.`);
    break;
  }

  default:
    console.log(`usage:
  node scripts/admin.js list                       les comptes lies
  node scripts/admin.js link <discordId> <pseudo>  lier a la main
  node scripts/admin.js unlink <discordId|pseudo>  delier (classement, reputation)
  node scripts/admin.js pending                    verifications en cours
  node scripts/admin.js payments [n]               derniers paiements vus`);
}
