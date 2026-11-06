/** « #aeefff » → 0xaeefff (couleur d embed). Couleur invalide = bleu de la commu. */
export function hexToInt(hex) {
  const n = parseInt(String(hex ?? '').replace('#', ''), 16);
  return Number.isFinite(n) && /^#?[0-9a-f]{6}$/i.test(String(hex ?? '')) ? n : 0xaeefff;
}

export const COLORS = {
  brand: 0xaeefff,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  info: 0x5865f2,
};
