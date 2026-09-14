// DonutSMP mange le point des pseudos Bedrock dans ses messages, et la casse
// n'est jamais fiable. Toute comparaison de pseudo passe par normName().
export function normName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/^\./, '');
}

// Un pseudo Java valide, ou un pseudo Bedrock (prefixe . et espaces convertis).
const VALID = /^\.?[A-Za-z0-9_]{1,24}$/;

export function isValidName(name) {
  return VALID.test(String(name ?? '').trim());
}

export function money(n) {
  return '$' + Number(n).toLocaleString('en-US');
}

/** Vrai si le membre porte le role de bypass (beta) : plus de mur du /link ni d anciennete. */
export function bypass(member, config) {
  const id = config?.discord?.bypassRoleId;
  return Boolean(id && member?.roles?.cache?.has?.(id));
}
