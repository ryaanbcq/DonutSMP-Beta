// Reglages et memoire du support IA, en base.
//
//   kv support.actif        '1' = l assistant repond dans les tickets
//   kv support.reglages     JSON (delais, heures de nuit, limites), voir DEFAUTS
//   kv support.categories   cles des categories ou il repond sur le fond
//   kv support.salonRevue   salon staff des propositions de FAQ (sinon journal)
//   kv support.faq          JSON [{ id, question, reponse, par, at }]
//   kv support.propositions JSON { id: { question, reponse, at } }
//   table support_messages  messages des tickets (14 jours), pour la revue
//   table support_tickets   etat de l assistant par ticket

import { db, store } from '../db.js';
import { DEFAUTS } from './logique.js';

db.exec(`
CREATE TABLE IF NOT EXISTS support_messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT,
  pieces     INTEGER NOT NULL DEFAULT 0,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_msg ON support_messages(channel_id, at);
CREATE TABLE IF NOT EXISTS support_tickets (
  channel_id TEXT PRIMARY KEY,
  ia_count   INTEGER NOT NULL DEFAULT 0,
  transmis   INTEGER NOT NULL DEFAULT 0,
  resume     TEXT,
  maj        INTEGER NOT NULL DEFAULT 0
);
`);

const q = {
  ajouter: db.prepare('INSERT OR IGNORE INTO support_messages (id, channel_id, role, content, pieces, at) VALUES (?, ?, ?, ?, ?, ?)'),
  messages: db.prepare('SELECT * FROM support_messages WHERE channel_id = ? ORDER BY at'),
  depuis: db.prepare('SELECT * FROM support_messages WHERE at >= ? ORDER BY channel_id, at'),
  purger: db.prepare('DELETE FROM support_messages WHERE at < ?'),
  etat: db.prepare('SELECT * FROM support_tickets WHERE channel_id = ?'),
  poserEtat: db.prepare(`INSERT INTO support_tickets (channel_id, ia_count, transmis, resume, maj) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET ia_count = excluded.ia_count, transmis = excluded.transmis, resume = excluded.resume, maj = excluded.maj`),
  depuisEtats: db.prepare('SELECT * FROM support_tickets WHERE maj >= ?'),
};

const json = (cle, defaut) => { try { return JSON.parse(store.kvGet(cle) ?? '') ?? defaut; } catch { return defaut; } };

export const memoire = {
  noter: (m) => q.ajouter.run(String(m.id), String(m.channelId), m.role, m.content ?? '', m.pieces ?? 0, m.at),
  messages: (channelId) => q.messages.all(String(channelId)),
  depuis: (at) => q.depuis.all(at),
  purger: (avant) => q.purger.run(avant).changes,
  etat: (channelId) => {
    const e = q.etat.get(String(channelId));
    return e ? { iaCount: e.ia_count, transmis: Boolean(e.transmis), resume: e.resume } : { iaCount: 0, transmis: false, resume: null };
  },
  poserEtat: (channelId, e) => q.poserEtat.run(String(channelId), e.iaCount ?? 0, e.transmis ? 1 : 0, e.resume ?? null, Date.now()),
  etatsDepuis: (at) => q.depuisEtats.all(at),
};

// Categories ou l assistant repond sur le fond, par defaut le support
// technique et « autre ». Les autres : accueil et transmission seulement.
export const CATEGORIES_FOND_DEFAUT = ['support-general-technique', 'autre-demande'];

export const reglagesSupport = {
  actif: () => store.kvGet('support.actif') === '1',
  // Allume : on retient l instant, les tickets plus anciens ne sont jamais
  // repris (leurs messages n ont pas ete notes, le staff a pu y repondre).
  poserActif: (v) => {
    store.kvSet('support.actif', v ? '1' : '0');
    if (v) store.kvSet('support.depuis', String(Date.now()));
  },
  depuis: () => Number(store.kvGet('support.depuis') ?? 0),
  reglages: () => ({ ...DEFAUTS, ...json('support.reglages', {}) }),
  poserReglages: (r) => store.kvSet('support.reglages', JSON.stringify({ ...json('support.reglages', {}), ...r })),
  categoriesFond: () => json('support.categories', CATEGORIES_FOND_DEFAUT),
  poserCategoriesFond: (l) => store.kvSet('support.categories', JSON.stringify(l)),
  salonRevue: () => store.kvGet('support.salonRevue') || null,
  poserSalonRevue: (id) => store.kvSet('support.salonRevue', id ? String(id) : ''),
  compteur: () => json('support.compteur', null),
  poserCompteur: (c) => store.kvSet('support.compteur', JSON.stringify(c)),

  faq: () => json('support.faq', []),
  ajouterFaq: (question, reponse, par) => {
    const l = reglagesSupport.faq();
    const id = Date.now().toString(36);
    l.push({ id, question: question.slice(0, 300), reponse: reponse.slice(0, 1500), par, at: Date.now() });
    store.kvSet('support.faq', JSON.stringify(l));
    return id;
  },
  retirerFaq: (id) => store.kvSet('support.faq', JSON.stringify(reglagesSupport.faq().filter((e) => e.id !== id))),
  propositions: () => json('support.propositions', {}),
  poserProposition: (id, p) => {
    const t = reglagesSupport.propositions();
    if (p) t[id] = p; else delete t[id];
    store.kvSet('support.propositions', JSON.stringify(t));
  },
};

/** La FAQ en texte, pour l IA. */
export function faqTexte() {
  return reglagesSupport.faq().map((e) => `Q : ${e.question}\nR : ${e.reponse}`).join('\n\n');
}
