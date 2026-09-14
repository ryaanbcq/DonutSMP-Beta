// Transcript d un ticket : un fichier texte lisible, dans l ordre
// chronologique, joint au salon des logs avant toute suppression.
//
// Discord ne rend le contenu des messages qu avec l intent « Message
// Content » : sans lui les lignes sortent vides, on le dit en tete du fichier
// plutot que de laisser croire a un ticket muet.

const dateFr = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium',
});

function ligne(m) {
  const quand = dateFr.format(new Date(m.createdTimestamp ?? Date.now()));
  const qui = m.author?.tag ?? m.author?.username ?? m.author?.id ?? '?';
  const bot = m.author?.bot ? ' [bot]' : '';
  const morceaux = [];
  if (m.content) morceaux.push(m.content);
  for (const e of m.embeds ?? []) {
    const titre = e.author?.name ?? e.title ?? '';
    const corps = e.description ?? '';
    const texte = [titre, corps].filter(Boolean).join(' : ');
    if (texte) morceaux.push(`[embed] ${texte}`);
  }
  for (const a of m.attachments?.values?.() ?? []) morceaux.push(`[fichier] ${a.name ?? ''} ${a.url ?? ''}`.trim());
  const corps = morceaux.length ? morceaux.join('\n    ') : '(vide)';
  return `[${quand}] ${qui}${bot} : ${corps}`;
}

/**
 * messages : liste dans n importe quel ordre (createdTimestamp, author, content,
 * embeds, attachments). ticket : ligne de la base, enrichie du pseudo.
 */
export function rendreTranscript({ ticket, messages, contenuDisponible = true }) {
  const tri = [...messages].sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0));
  const entete = [
    `Ticket #${ticket.id} : ${ticket.categorie ?? 'sans catégorie'}`,
    `Ouvert par : ${ticket.auteur ?? ticket.discord_id}`,
    `Ouvert le : ${dateFr.format(new Date(ticket.created_at))}`,
    ticket.closed_at ? `Fermé le : ${dateFr.format(new Date(ticket.closed_at))}` : null,
    ticket.sujet ? `Sujet : ${ticket.sujet}` : null,
    `Messages : ${tri.length}`,
    contenuDisponible ? null
      : "Attention : le bot n'a pas l'intent Message Content, le texte des messages n'est pas lisible ici.",
    '',
  ].filter((l) => l !== null);
  return entete.join('\n') + '\n' + tri.map(ligne).join('\n') + '\n';
}

/** Tous les messages d un salon, par pages de 100, du plus ancien au plus recent. */
export async function collecterMessages(salon, { max = 5000 } = {}) {
  const tous = [];
  let avant;
  while (tous.length < max) {
    const page = await salon.messages.fetch({ limit: 100, ...(avant ? { before: avant } : {}) });
    if (page.size === 0) break;
    for (const m of page.values()) tous.push(m);
    avant = page.last().id;
    if (page.size < 100) break;
  }
  return tous;
}
