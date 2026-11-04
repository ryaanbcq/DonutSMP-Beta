// Compteurs vocaux, partie pure (testee).

export const TYPES = {
  membres: { label: 'Membres', emoji: '👥', defaut: '👥 Membres : {nombre}' },
  en_ligne: { label: 'En ligne', emoji: '🟢', defaut: '🟢 En ligne : {nombre}' },
  en_vocal: { label: 'En vocal', emoji: '🔊', defaut: '🔊 En vocal : {nombre}' },
};

export const MINUTES = 5; // Discord : 2 renommages par salon et par 10 min
export const FENETRE = 10 * 60_000;

/** 1234 -> « 1 234 ». */
export function formater(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Nom du salon a partir du modele ({nombre} = le chiffre), 100 caracteres max. */
export function nomSalon(modele, n) {
  const m = String(modele || '').includes('{nombre}') ? modele : `${modele || ''} {nombre}`.trim();
  return m.replaceAll('{nombre}', formater(n)).slice(0, 100);
}

/** Peut on renommer maintenant ? Rend { ok, recents } (renommages des 10 dernieres min). */
export function peutRenommer(renommages = [], now = Date.now()) {
  const recents = renommages.filter((d) => now - d < FENETRE);
  return { ok: recents.length < 2, recents };
}
