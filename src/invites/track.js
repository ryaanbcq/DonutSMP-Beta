/** Logique pure du suivi des invitations (testable sans Discord). */
/** Trouve l'invitation utilisée en comparant avant/après. */
export function findUsedInvite(before, after) {
    const grown = [...after].filter(([code, inv]) => inv.uses > (before.get(code)?.uses ?? 0));
    if (grown.length === 1)
        return { code: grown[0][0], inviterId: grown[0][1].inviterId };
    if (grown.length > 1)
        return null; // plusieurs arrivées en même temps : impossible de savoir
    // Lien à usage limité qui vient d'atteindre sa limite : il a disparu de la liste
    const vanished = [...before].filter(([code, inv]) => !after.has(code) && inv.maxUses > 0 && inv.uses + 1 >= inv.maxUses);
    return vanished.length === 1 ? { code: vanished[0][0], inviterId: vanished[0][1].inviterId } : null;
}
