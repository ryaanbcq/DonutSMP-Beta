// Salon des suggestions pour le bot (staff) : un message d accueil epingle,
// et le bot met ✅ sous chaque message. Les ✅ servent de vote : plus une
// idee en a, plus elle pese. classement() les trie pour le developpement.

import { store } from '../db.js';
import { config } from '../config.js';
import { embed, FR } from '../lib/brand.js';

export const VOTE = '✅';

export const reglagesSuggestions = {
  salon: () => store.kvGet('suggestions.salon') || null,
  poserSalon: (id) => store.kvSet('suggestions.salon', id ? String(id) : ''),
  accueil: () => store.kvGet('suggestions.accueil') || null,
  poserAccueil: (id) => store.kvSet('suggestions.accueil', id ? String(id) : ''),
};

export function messageAccueil() {
  return embed('💡・SUGGESTIONS POUR LE BOT', {
    couleur: FR.jaune,
    description: '### Des problèmes ? Des idées ? C\'est ici.\n'
      + 'Partagez ce que vous souhaitez voir dans le bot, un bug, une gêne, une amélioration.\n\n'
      + `${VOTE} **Réagissez aux idées que vous appréciez** : plus une idée a de ${VOTE}, plus elle a de poids.\n`
      + '📝 Tout est noté pour le développement à venir du bot.\n'
      + '-# Une idée par message, c\'est plus simple à voter.',
  });
}

/** Poste (une fois) le message d accueil et l epingle. */
export async function publierAccueil(client) {
  const id = reglagesSuggestions.salon();
  if (!id) return 'aucun salon';
  const s = await client.channels.fetch(id).catch(() => null);
  if (!s?.isTextBased?.()) return 'salon introuvable';
  const connu = reglagesSuggestions.accueil();
  if (connu && await s.messages.fetch(connu).catch(() => null)) return 'accueil déjà en place';
  const m = await s.send({ embeds: [messageAccueil()], allowedMentions: { parse: [] } });
  reglagesSuggestions.poserAccueil(m.id);
  await m.pin('Accueil des suggestions').catch(() => {});
  return 'accueil publié';
}

export async function surMessage(message) {
  if (message.author.bot || message.guildId !== config.discord.guildId) return;
  if (message.channelId !== reglagesSuggestions.salon()) return;
  await message.react(VOTE).catch((e) => console.warn('[suggestions] reaction :', e.message));
}

/**
 * Les suggestions triees par nombre de ✅ (celui du bot non compte).
 * Rend [{ id, auteur, texte, votes, at, lien }].
 */
export async function classement(client, limite = 100) {
  const id = reglagesSuggestions.salon();
  const s = id ? await client.channels.fetch(id).catch(() => null) : null;
  if (!s) return [];
  const msgs = await s.messages.fetch({ limit: Math.min(limite, 100) }).catch(() => null);
  if (!msgs) return [];
  return [...msgs.values()].filter((m) => !m.author.bot).map((m) => {
    const r = m.reactions.cache.get(VOTE);
    return {
      id: m.id, auteur: m.member?.displayName ?? m.author.username, texte: m.content,
      votes: Math.max(0, (r?.count ?? 0) - (r?.me ? 1 : 0)), at: m.createdTimestamp, lien: m.url,
    };
  }).sort((a, b) => b.votes - a.votes || a.at - b.at);
}

export function demarrerSuggestions(client) {
  client.on('messageCreate', (m) => surMessage(m).catch((e) => console.warn('[suggestions] :', e.message)));
  if (reglagesSuggestions.salon()) {
    publierAccueil(client).then((n) => console.log(`[suggestions] ${n}`)).catch((e) => console.warn('[suggestions] :', e.message));
  }
}
