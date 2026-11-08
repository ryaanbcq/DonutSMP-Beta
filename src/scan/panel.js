import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, FileUploadBuilder, LabelBuilder,
  ModalBuilder, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { embed, FR } from '../lib/brand.js';
import { store } from '../db.js';
import { memoire } from '../support/reglages.js';

// Panneau DonutScan : un membre depose un .jar dans un formulaire, le site donutscan.org
// l analyse (API v1, cle DONUTSCAN_API_KEY) et le resultat lui revient en prive.
// Le bot telecharge la piece jointe et l envoie telle quelle a l API : il ne l ouvre jamais.

const SITE = 'https://donutscan.org/fr/';
const MAX = 25 * 1024 * 1024;
const LIEN = `<${SITE}>`; // chevrons : pas d aperçu geant du site sous un message d erreur

const VERDICTS = {
  DANGER: { titre: '⛔・DANGER', couleur: FR.rouge, phrase: 'Ce mod est piégé. Ne le lance pas.' },
  OBFUSQUE: { titre: '🔒・CODE OFFUSQUÉ', couleur: 0xd70015, phrase: 'L’auteur a caché le code de ce mod : soit pour protéger son travail, soit pour cacher ce qu’il fait. Impossible de tout vérifier.' },
  SUSPECT: { titre: '⚠️・SUSPECT', couleur: 0xff8a00, phrase: 'Ce mod cache des choses inhabituelles. À éviter sauf source officielle.' },
  ATTENTION: { titre: '🔎・À VÉRIFIER', couleur: FR.jaune, phrase: 'Rien de malveillant trouvé, mais certains points méritent un œil.' },
  OK: { titre: '✅・RIEN DE SUSPECT', couleur: FR.vert, phrase: 'Rien d’inquiétant trouvé. Une analyse ne remplace pas une source officielle.' },
  OFFICIEL: { titre: '✅・FICHIER AUTHENTIQUE', couleur: FR.vert, phrase: 'Identique octet pour octet à la version d’origine.' },
};
const SEV = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// Les preuves viennent de l interieur du mod : on neutralise mentions et mise en forme Discord.
const brut = (s) => clip(String(s ?? '').replace(/[`@<>*_~|\\]/g, ' ').replace(/https?:\/\//g, ''), 120);

export function panneauScan() {
  const contenu = embed('🔍・SCANNER UN MOD', {
    description:
      'Un mod reçu en DM, un client « cracké », une « bêta exclusive » ? **Vérifie-le avant de le lancer.**\n\n'
      + '**1.** Clique sur **Scanner un mod**.\n'
      + '**2.** Dépose ton fichier `.jar` dans le formulaire.\n'
      + '**3.** Le résultat t’arrive en privé en quelques secondes.\n\n'
      + 'L’analyse est faite par **DonutScan** sans jamais lancer le mod : `/pay` cachés, fausses preuves de paiement, '
      + 'voleurs de compte (Silent Net, WeedHack, Fractureiser, Stargazers…), programmes cachés.\n'
      + 'Ton résultat n’est visible que par toi. Le fichier est envoyé à DonutScan et conservé pour améliorer la détection, et son empreinte (jamais le fichier) est vérifiée par nos partenaires VirusTotal, MalwareBazaar, Hybrid Analysis et CIRCL : '
      + 'ne scanne pas un mod privé que tu ne veux pas partager.\n\n'
      + '📦 Fichier de plus de **25 Mo** ? Discord le refuse : scanne-le directement sur **donutscan.org**.',
  });
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('scan:start').setLabel('Scanner un mod').setEmoji('🔍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel('donutscan.org').setStyle(ButtonStyle.Link).setURL(SITE),
  );
  return { embeds: [contenu], components: [boutons] };
}

export async function onBoutonScan(interaction) {
  if (!config.donutscan.apiKey) {
    return interaction.reply({ content: '❌ Le scanner n’est pas configuré (clé DonutScan absente). Utilise ' + LIEN, flags: MessageFlags.Ephemeral });
  }
  const upload = new FileUploadBuilder().setCustomId('jar').setMinValues(1).setMaxValues(1).setRequired(true);
  const champ = new LabelBuilder().setLabel('Ton mod (.jar)').setDescription('Tu acceptes que DonutScan le garde et que nos partenaires vérifient son empreinte. 25 Mo max.').setFileUploadComponent(upload);
  // Depuis le guide anti-rat : scan:start:1 = le membre a deja lance le mod (conseils d apres coup).
  const lance = interaction.customId === 'scan:start:1';
  const modal = new ModalBuilder().setCustomId(lance ? 'scan:modal:1' : 'scan:modal').setTitle('Scanner un mod').addLabelComponents(champ);
  return interaction.showModal(modal);
}

export function resultat(r, fichier, lance = false) {
  const v = VERDICTS[r.verdict] ?? VERDICTS.ATTENTION;
  const e = embed(v.titre, { couleur: v.couleur, image: 'aucune' });
  const lignes = [`**${clip(fichier, 80)}**${r.mod ? ` · ${clip(r.mod.nom || r.mod.id, 40)} ${clip(r.mod.version, 30)}` : ''}`, r.verdict === 'OFFICIEL' && r.summary ? clip(r.summary, 300) : v.phrase];
  if (r.family) lignes.push(`Famille connue : **${clip(r.family, 40)}**`);
  const ext = r.external?.sources ?? {};
  const extLignes = [];
  if (ext.virustotal?.found) extLignes.push(`[VirusTotal](${ext.virustotal.link}) : **${ext.virustotal.malicious + ext.virustotal.suspicious}/${ext.virustotal.engines}** antivirus le détectent`);
  if (ext.malwarebazaar?.found) extLignes.push(`[MalwareBazaar](${ext.malwarebazaar.link}) : répertorié comme malware${ext.malwarebazaar.signature ? ` (${clip(ext.malwarebazaar.signature, 30)})` : ''}`);
  if (ext.hybrid?.found && ext.hybrid.verdict) extLignes.push(`[Hybrid Analysis](${ext.hybrid.link}) : ${clip(ext.hybrid.verdict, 30)}`);
  if (extLignes.length) lignes.push('', '🌐 **Sources externes**', ...extLignes);
  if (r.reported?.count) lignes.push(`📣 Déjà signalé **${r.reported.count} fois**${r.reported.verified ? ', confirmé par le staff' : ''}.`);
  if (lance && ['DANGER', 'SUSPECT', 'ATTENTION'].includes(r.verdict)) lignes.push('', '⚠️ **Tu l’as déjà lancé** : suis tout de suite les étapes du guide anti-rat (mots de passe depuis un autre appareil, déconnexion partout, antivirus).');
  e.setDescription(lignes.join('\n'));
  // Fichier authentique : ses fonctions sensibles sont d'origine, on les liste en neutre, sans texte d'alerte.
  if (r.verdict === 'OFFICIEL') {
    const fonctions = (r.findings ?? []).filter((f) => ['critical', 'high', 'medium'].includes(f.severity)).map((f) => `• ${f.title}`);
    if (fonctions.length) e.addFields({ name: '🔵 Fonctions sensibles d’origine', value: clip(`${fonctions.slice(0, 8).join('\n')}\n-# Elles font partie du mod tel que publié par ses auteurs.`, 1000) });
    e.setFooter({ text: `SHA-256 ${r.file?.sha256?.slice(0, 16) ?? '?'} · analyse DonutScan, pas une garantie` });
    return e;
  }
  const alertes = (r.findings ?? []).filter((f) => f.severity !== 'info').slice(0, 5);
  for (const f of alertes) {
    const preuve = f.evidence?.[0] ? `\n\`${brut(f.evidence[0])}\`` : '';
    e.addFields({ name: clip(`${SEV[f.severity] ?? '•'} ${f.title}`, 250), value: clip(`${f.detail}${preuve}`, 1000) });
  }
  if ((r.findings ?? []).filter((f) => f.severity !== 'info').length > 5) e.addFields({ name: '…', value: 'Le détail complet est sur donutscan.org.' });
  e.setFooter({ text: `SHA-256 ${r.file?.sha256?.slice(0, 16) ?? '?'} · analyse DonutScan, pas une garantie` });
  return e;
}

export async function onModalScan(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lance = interaction.customId === 'scan:modal:1';
  const fichier = interaction.fields.getUploadedFiles('jar')?.first();
  if (!fichier) return interaction.editReply('❌ Aucun fichier reçu, réessaie.');
  if (!/\.jar$/i.test(fichier.name)) return interaction.editReply('❌ Il faut un fichier `.jar` (un mod Minecraft).');
  if (fichier.size > MAX) return interaction.editReply('❌ Fichier de plus de 25 Mo : scanne-le directement sur ' + LIEN + ', il n’y a pas de limite là-bas.');

  let r;
  try {
    // Le bot telecharge la piece jointe lui-meme : le CDN de Discord refuse les telechargements venant du Worker (vecu, 502).
    const dl = await fetch(fichier.url, { signal: AbortSignal.timeout(30_000) });
    if (!dl.ok) throw new Error(`piece jointe ${dl.status}`);
    const jar = Buffer.from(await dl.arrayBuffer());
    if (jar.length > MAX) return interaction.editReply('❌ Fichier trop gros (25 Mo maximum). Passe par ' + LIEN);
    const res = await fetch(`${config.donutscan.base}/scan?lang=fr&explain=1${lance ? '&ran=1' : ''}&filename=${encodeURIComponent(fichier.name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.donutscan.apiKey}`, 'Content-Type': 'application/java-archive' },
      body: jar,
      signal: AbortSignal.timeout(90_000),
    });
    r = await res.json().catch(() => ({ error: `http_${res.status}` }));
    if (!res.ok || r.error) {
      console.error(`[scan] API ${res.status} ${r.error ?? ''}`);
      const msg = r.error === 'rate_limited' ? 'Trop de scans en ce moment, réessaie dans une minute.'
        : r.error === 'not_a_jar' ? 'Ce fichier n’est pas un mod lisible.'
          : `Le scanner n’a pas pu analyser ce fichier. Essaie directement sur ${LIEN}`;
      return interaction.editReply(`❌ ${msg}`);
    }
  } catch (err) {
    console.error('[scan] API injoignable :', err.message);
    return interaction.editReply(`❌ DonutScan ne répond pas. Essaie directement sur ${LIEN}`);
  }

  console.log(`[scan] ${interaction.user.tag} : ${fichier.name} -> ${r.verdict}${r.family ? ` (${r.family})` : ''}`);
  const lien = new ActionRowBuilder().addComponents(
    // Le lien ouvre CE résultat sur le site (gardé 30 jours par DonutScan), sinon l'accueil.
    new ButtonBuilder().setLabel('Voir le détail sur DonutScan').setStyle(ButtonStyle.Link)
      .setURL(/^https:\/\/donutscan\.org\//.test(r.link ?? '') ? r.link : SITE),
  );
  const embeds = [resultat(r, fichier.name, lance)];
  // Dans un ticket : le resultat rejoint la memoire du support, l IA ne redemande rien et adapte ses conseils.
  if (store.getTicket?.(interaction.channelId)) {
    memoire.noter({ id: `${interaction.id}`, channelId: interaction.channelId, role: 'membre', at: Date.now(),
      content: `[Scan DonutScan du fichier « ${fichier.name} » : verdict ${r.verdict}${r.family ? `, famille ${r.family}` : ''}${r.reported?.count ? `, déjà signalé ${r.reported.count} fois` : ''}.${lance ? ' Le membre l’a déjà lancé.' : ''}]` });
  }
  // L'explication a son propre embed : un champ est limite a 1 024 caracteres (elle etait coupee), une description a 4 096.
  if (r.explanation) embeds.push(embed('🧠・EN CLAIR', { couleur: embeds[0].data.color, image: 'aucune', description: clip(r.explanation, 4000) }));
  return interaction.editReply({ embeds, components: [lien] });
}
