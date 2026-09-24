// Salon des dons : un message par don recu et par reversement, a part du
// journal technique ou ils se perdaient entre les pannes et les links.
// Sans DONATION_LOG_CHANNEL_ID, rien ne part ici (le journal garde tout).

import { config } from '../config.js';
import { embed, FR } from '../lib/brand.js';
import { surCanal } from '../ops/journal.js';

let salon = null;
let file = Promise.resolve();

function poster(e) {
  if (!salon) return;
  file = file.then(() => salon.send({ embeds: [e.setTimestamp()], allowedMentions: { parse: [] } }))
    .catch((err) => console.error('[don] salon des dons :', err.message));
}

export async function demarrerLogDons(client) {
  if (!config.dons.salonId) return;
  salon = await client.channels.fetch(config.dons.salonId).catch(() => null);
  if (!salon?.isTextBased?.()) {
    salon = null;
    console.warn('[don] DONATION_LOG_CHANNEL_ID introuvable, pas de salon des dons');
    return;
  }
  console.log(`[don] historique poste dans #${salon.name}`);

  // Reversements : ecrits par le bot en jeu dans le flux d evenements.
  surCanal('dons', (ev) => {
    const ok = ev.niveau === 'ok';
    const c = ev.champs ?? {};
    const e = embed(ok ? '📤・DONS REVERSÉS' : '⚠️・REVERSEMENT INCERTAIN', {
      couleur: ok ? FR.vert : FR.rouge,
      image: ev.joueur,
      description: ev.texte,
    }).addFields(
      { name: 'Bénéficiaire', value: String(c['Bénéficiaire'] ?? '?'), inline: true },
      { name: 'Montant', value: String(c.Montant ?? '?'), inline: true },
      { name: 'Jour', value: String(c.Jour ?? '?'), inline: true },
    );
    if (c.Cause) e.addFields({ name: 'Cause', value: String(c.Cause) });
    poster(e);
  });
}

export function logDon({ nom, discordId, montant, total, rang, monte }) {
  const e = embed(monte ? '💝・DON REÇU · NOUVEAU RANG' : '💝・DON REÇU', {
    couleur: FR.or,
    image: nom,
    description: discordId
      ? `<@${discordId}> (**${nom}**) a donné **${montant}**.`
      : `**${nom}** a donné **${montant}**. Pas encore lié : son rang arrivera avec son link.`,
  }).addFields(
    { name: 'Don', value: montant, inline: true },
    { name: 'Total donné', value: total, inline: true },
    { name: 'Rang', value: rang, inline: true },
  );
  poster(e);
}
