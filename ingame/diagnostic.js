// Traduit un kick ou une erreur de connexion en diagnostic lisible par le staff.
//
// Le journal disait « deconnecte (xyz) » et laissait deviner la suite. Ici on
// reconnait les pannes deja vecues (ban, session fantome, maintenance, compte
// Microsoft bloque, reseau...) et on dit quoi faire. Rend null quand la cause
// est une coupure banale que la reconnexion automatique regle seule.

/** Texte brut d un motif de kick : chaine, composant de chat JSON, ou objet. */
export function texteDuMotif(motif) {
  if (motif == null) return '';
  if (typeof motif === 'string') {
    try { return texteDuMotif(JSON.parse(motif)); } catch { return motif; }
  }
  if (Array.isArray(motif)) return motif.map(texteDuMotif).join('');
  // NBT type (mineflayer recent, vecu le 08/11 sur le kick DonutSMP_FR) :
  // chaque noeud est { type, value }, les listes { type: 'list', value: { type, value: [...] } }.
  // Sans ce cas le motif sortait vide : « (aucun motif) ».
  if (typeof motif === 'object' && typeof motif.type === 'string' && 'value' in motif) {
    const v = motif.value;
    if (motif.type === 'list') return texteDuMotif(v?.value ?? v);
    if (motif.type === 'compound') return texteDuMotif(deNbt(v));
    return typeof v === 'string' ? v : '';
  }
  if (typeof motif === 'object') {
    // Composants NBT simplifies ou JSON : text, extra, translate/with.
    const valeur = motif.value ?? motif;
    let s = '';
    if (typeof valeur.text === 'string') s += valeur.text;
    else if (valeur.text) s += texteDuMotif(valeur.text);
    if (valeur[''] && typeof valeur[''] === 'string') s += valeur[''];
    if (valeur.translate) s += valeur.translate;
    if (valeur.with) s += ` ${texteDuMotif(valeur.with)}`;
    if (valeur.extra) s += texteDuMotif(valeur.extra);
    return s;
  }
  return String(motif);
}

/** Compound NBT type -> objet de composant de chat ordinaire. */
function deNbt(v) {
  if (Array.isArray(v)) return v.map(deNbt);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (x && typeof x === 'object' && typeof x.type === 'string' && 'value' in x) {
      o[k] = x.type === 'list' ? deNbt(x.value?.value ?? x.value)
        : x.type === 'compound' ? deNbt(x.value) : x.value;
    } else o[k] = deNbt(x);
  }
  return o;
}

const nettoyer = (s) => s.replace(/§./g, '').replace(/\s+/g, ' ').trim();

const KICKS = [
  {
    // Vecu sur le casino (29/09/2026) : le vrai kick dit « Blocked account …
    // Ban ID » sans jamais ecrire « banned ».
    // Vecu sur DonutSMP_FR (08/11/2026) : « Your account has been placed on hold »
    // + Ban ID, sans « banned » non plus ; le meme motif contenait aussi
    // « You are already online » (proxy) : cette regle doit rester AVANT la
    // session fantome.
    re: /blocked account|account (has been |is |was )?(blocked|suspended|terminated|disabled|placed on hold|on hold)|placed on hold|suspended/i,
    niveau: 'err',
    titre: 'Compte du bot bloqué par DonutSMP',
    bloquant: true,
    actions: ['relink'],
    texte: 'DonutSMP a bloqué le compte du bot : plus aucune vérification ne passera.'
      + ' Lis le motif, fais appel auprès de DonutSMP ou change de compte (`MC_LINK_ACCOUNT` + `donut auth`).',
  },
  {
    // Ban temporaire : une duree ou une date de fin dans le motif.
    re: /(\bbann?(ed)?\b|ban id).*(temporar|\bfor \d|\d+\s*(s|m|h|d|w|mo|y|sec|min|hour|day|week|month|year)s?\b|expire|until|remaining|unbanned in)|temp ?ban/i,
    niveau: 'err',
    titre: 'Bot banni temporairement',
    bloquant: true,
    actions: ['relink'],
    texte: 'Le compte du bot est banni pour une durée limitée : aucune vérification ne passe jusqu\'à la fin du ban.'
      + ' Le bot réessaie seul et reviendra à l\'expiration. Pour reprendre plus tôt : autre compte (`MC_LINK_ACCOUNT` + `donut auth`).',
  },
  {
    re: /\bbann?(ed)?\b|ban id|blacklist/i,
    niveau: 'err',
    titre: 'Bot banni définitivement',
    bloquant: true,
    actions: ['relink'],
    texte: 'Le compte du bot est banni à vie : plus aucune vérification ne passera.'
      + ' Fais appel auprès de DonutSMP ou change de compte (`MC_LINK_ACCOUNT` + `donut auth`).',
  },
  {
    re: /already (online|connected|logged|playing)|logged in from another location|duplicate login/i,
    niveau: 'warn',
    titre: 'Session fantôme',
    texte: 'DonutSMP croit le compte déjà connecté. En général une session restée ouverte côté proxy :'
      + ' le bot réessaie seul. Si ça dure, vérifie qu\'aucun autre process n\'utilise ce compte.',
  },
  {
    re: /whitelist|maintenance|restart|shutting down|server (is )?closed|proxy.*(restart|lost)/i,
    niveau: 'warn',
    titre: 'DonutSMP en maintenance',
    texte: 'Le serveur redémarre ou ferme ses portes. Rien à faire : le bot revient quand DonutSMP rouvre.',
  },
  {
    re: /throttl|wait (a moment )?before|too (fast|many)|slow down|rate ?limit/i,
    niveau: 'warn',
    titre: 'Reconnexion trop rapide',
    texte: 'DonutSMP freine les connexions répétées. Le délai de relance grandit tout seul, pas besoin de redémarrer.',
  },
  {
    re: /outdated|incompatible|unsupported|please use|protocol/i,
    niveau: 'err',
    titre: 'Version Minecraft refusée',
    texte: 'DonutSMP refuse la version du bot. Fixe `MC_VERSION` sur la version annoncée dans le motif, puis relance `fr-ingame`.',
  },
  {
    re: /kicked by|you (have been|were) kicked|kicked from (the )?(server|network)/i,
    niveau: 'warn',
    titre: 'Expulsé par le staff',
    texte: 'Un membre du staff DonutSMP a expulsé le bot. Le bot se reconnecte seul ;'
      + ' si ça se répète, lis le motif : un ban peut suivre.',
  },
  {
    re: /idle|afk|inactiv/i,
    niveau: 'info',
    titre: 'Kick pour inactivité',
    texte: 'Expulsé pour inactivité. Le bot se reconnecte seul.',
  },
  {
    re: /fly|flying|cheat|illegal|unfair|hack|invalid (move|packet)/i,
    niveau: 'warn',
    titre: 'Kick par l\'anticheat',
    texte: 'L\'anticheat de DonutSMP a expulsé le bot. Isolé : sans gravité. Répété : risque de ban, à surveiller.',
  },
];

export function diagnostiquerKick(motif) {
  const texte = nettoyer(texteDuMotif(motif));
  const cas = KICKS.find((k) => k.re.test(texte));
  const base = cas ?? {
    niveau: 'warn',
    titre: 'Bot expulsé',
    texte: 'DonutSMP a expulsé le bot pour une raison non répertoriée. Le motif est ci-dessous.',
  };
  return {
    niveau: base.niveau,
    titre: base.titre,
    texte: base.texte,
    motif: texte || '(aucun motif)',
    actions: base.actions ?? null,
    // Ban ou compte bloque : se reconnecter toutes les minutes ne sert a rien
    // et peut aggraver le dossier chez DonutSMP.
    bloquant: Boolean(base.bloquant),
    banId: (texte.match(/ban id:?\s*(#?[A-Za-z0-9]+)/i) || [])[1] ?? null,
  };
}

const ERREURS = [
  {
    re: /invalid_grant|interaction is required|AADSTS\d+|account.*(locked|blocked|suspended)/i,
    niveau: 'err',
    titre: 'Compte Microsoft bloqué',
    actions: ['relink'],
    texte: 'Microsoft refuse le jeton du bot. Souvent une action demandée sur le compte'
      + ' (mail de secours, vérification) : règle-la sur account.microsoft.com/security, puis clique sur **Relink le compte**.',
  },
  {
    re: /does ?n[o']t own|not own minecraft|no minecraft|profile.*not found|NOT_FOUND/i,
    niveau: 'err',
    titre: 'Compte sans Minecraft',
    actions: ['relink'],
    texte: 'Le compte Microsoft connecté ne possède pas Minecraft Java. Vérifie `MC_EMAIL` puis `donut auth`.',
  },
  {
    re: /ENOTFOUND|EAI_AGAIN/,
    niveau: 'warn',
    titre: 'DNS en échec',
    texte: 'Impossible de résoudre l\'adresse de DonutSMP : la machine a sans doute perdu internet.',
  },
  {
    // Pas « timed out » tout court : « client timed out after 30000 ms » est un
    // keepAlive perdu par un bot deja en jeu, pas un serveur injoignable.
    re: /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connect(ion)? timed out/i,
    niveau: 'warn',
    titre: 'DonutSMP injoignable',
    texte: 'La connexion au serveur échoue (serveur tombé ou réseau coupé). Le bot réessaie seul.',
  },
  {
    re: /unsupported protocol|version.*(not supported|unsupported)|ping.*version/i,
    niveau: 'err',
    titre: 'Version Minecraft refusée',
    texte: 'Le bot ne sait pas parler la version du serveur. Fixe `MC_VERSION` puis relance `fr-ingame`.',
  },
];

export function diagnostiquerErreur(message) {
  const texte = nettoyer(String(message ?? ''));
  const cas = ERREURS.find((e) => e.re.test(texte));
  return cas ? {
    niveau: cas.niveau, titre: cas.titre, texte: cas.texte, motif: texte, actions: cas.actions ?? null,
  } : null;
}

/** « 3 h 12 min », « 45 s » : la duree d une coupure, lisible d un coup d oeil. */
export function duree(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}
