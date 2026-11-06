import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, FileUploadBuilder, LabelBuilder,
  ModalBuilder, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { embed, FR } from '../lib/brand.js';

// Panneau DonutScan : un membre depose un .jar dans un formulaire, le site donutscan.org
// l analyse (API v1, cle DONUTSCAN_API_KEY) et le resultat lui revient en prive.
// Le bot telecharge la piece jointe et l envoie telle quelle a l API : il ne l ouvre jamais.

const SITE = 'https://donutscan.org/fr/';
const MAX = 25 * 1024 * 1024;
const LIEN = `<${SITE}>`; // chevrons : pas d aperçu geant du site sous un message d erreur

const VERDICTS = {
  DANGER: { titre: '⛔・DANGER', couleur: FR.rouge, phrase: 'Ce mod est piégé. Ne le lance pas.' },
  SUSPECT: { titre: '⚠️・SUSPECT', couleur: 0xff8a00, phrase: 'Ce mod cache des choses inhabituelles. À éviter sauf source officielle.' },
  ATTENTION: { titre: '🔎・À VÉRIFIER', couleur: FR.jaune, phrase: 'Rien de malveillant trouvé, mais certains points méritent un œil.' },
  OK: { titre: '✅・RIEN DE SUSPECT', couleur: FR.vert, phrase: 'Rien d’inquiétant trouvé. Une analyse ne remplace pas une source officielle.' },
  OFFICIEL: { titre: '✅・FICHIER OFFICIEL', couleur: FR.vert, phrase: 'Identique octet pour octet à la version publiée sur Modrinth.' },
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
      + 'voleurs de compte comme Silent Net, programmes cachés.\n'
      + 'Ton résultat n’est visible que par toi. Le fichier est envoyé à DonutScan et conservé pour améliorer la détection : '
      + 'ne scanne pas un mod privé que tu ne veux pas partager.',
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
  const champ = new LabelBuilder().setLabel('Ton mod (.jar)').setDescription('25 Mo max. Jamais lancé, mais envoyé à DonutScan et conservé pour améliorer la détection.').setFileUploadComponent(upload);
  const modal = new ModalBuilder().setCustomId('scan:modal').setTitle('Scanner un mod').addLabelComponents(champ);
  return interaction.showModal(modal);
}

export function resultat(r, fichier) {
  const v = VERDICTS[r.verdict] ?? VERDICTS.ATTENTION;
  const e = embed(v.titre, { couleur: v.couleur, image: 'aucune' });
  const lignes = [`**${clip(fichier, 80)}**${r.mod ? ` · ${clip(r.mod.nom || r.mod.id, 40)} ${clip(r.mod.version, 30)}` : ''}`, v.phrase];
  if (r.family) lignes.push(`Famille connue : **${clip(r.family, 40)}**`);
  if (r.reported?.count) lignes.push(`📣 Déjà signalé **${r.reported.count} fois**${r.reported.verified ? ', confirmé par le staff' : ''}.`);
  e.setDescription(lignes.join('\n'));
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
  const fichier = interaction.fields.getUploadedFiles('jar')?.first();
  if (!fichier) return interaction.editReply('❌ Aucun fichier reçu, réessaie.');
  if (!/\.jar$/i.test(fichier.name)) return interaction.editReply('❌ Il faut un fichier `.jar` (un mod Minecraft).');
  if (fichier.size > MAX) return interaction.editReply('❌ Fichier trop gros (25 Mo maximum). Passe par ' + LIEN);

  let r;
  try {
    // Le bot telecharge la piece jointe lui-meme : le CDN de Discord refuse les telechargements venant du Worker (vecu, 502).
    const dl = await fetch(fichier.url, { signal: AbortSignal.timeout(30_000) });
    if (!dl.ok) throw new Error(`piece jointe ${dl.status}`);
    const jar = Buffer.from(await dl.arrayBuffer());
    if (jar.length > MAX) return interaction.editReply('❌ Fichier trop gros (25 Mo maximum). Passe par ' + LIEN);
    const res = await fetch(`${config.donutscan.base}/scan?lang=fr&explain=1&filename=${encodeURIComponent(fichier.name)}`, {
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
  const embeds = [resultat(r, fichier.name)];
  // L'explication a son propre embed : un champ est limite a 1 024 caracteres (elle etait coupee), une description a 4 096.
  if (r.explanation) embeds.push(embed('🧠・EN CLAIR', { couleur: embeds[0].data.color, image: 'aucune', description: clip(r.explanation, 4000) }));
  return interaction.editReply({ embeds, components: [lien] });
}
