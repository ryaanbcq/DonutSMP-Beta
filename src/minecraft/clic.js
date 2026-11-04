// Paquet serverbound « custom_click_action » (clic sur un bouton custom d un
// dialogue, 1.21.6+), ecrit a la main : minecraft-data le decrit comme
// « option anonymousNbt » (un booleen puis le NBT), alors que Minecraft lit
// une LONGUEUR (varint, 65536 max) puis un NBT anonyme. VECU le 04/11/2026 :
// le paquet de mineflayer = kick « Failed to decode packet custom_click_action ».

import nbt from 'prismarine-nbt';

export function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

const chaine = (s) => { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([varint(b.length), b]); };

/** NBT anonyme (1.20.2+) : le type, puis le contenu, sans nom de racine. */
export function nbtAnonyme(compound) {
  if (!compound) return Buffer.from([0]); // TAG_End = pas de payload
  const nomme = nbt.writeUncompressed(compound, 'big'); // 0a 00 00 <contenu>
  return Buffer.concat([nomme.subarray(0, 1), nomme.subarray(3)]);
}

/** Paquet complet (id de paquet compris), a passer a client.writeRaw. */
export function paquetClicCustom(idPaquet, id, compound) {
  const charge = nbtAnonyme(compound);
  return Buffer.concat([varint(idPaquet), chaine(id), varint(charge.length), charge]);
}
