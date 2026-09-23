// Import des vouches de l ancien systeme, pilote par le staff.
//
// Ancien systeme : un forum ou chaque membre ouvrait SON post, et les autres
// repondaient dedans pour le vouch. Pendant la periode de reclamation, un
// membre demande au staff ; le staff lance /importer-vouches avec le lien du
// fil : le bot le scanne, garde une reponse par autre membre et prepare une
// fiche. Le staff exclut ce qui ne va pas, puis importe. Les vouches importes
// deviennent des avis du nouveau systeme : auteur et date d origine, positifs,
// sans etoiles (« ancien avis »), texte prefixe [Ancien vouch].
//
// Garanties :
//   - un ancien message n est importe qu une fois (vouch_imports), rescanner
//     un fil ne montre que ce qui n a pas encore ete importe ;
//   - si l auteur a deja note le membre dans le nouveau systeme, son avis
//     recent gagne ;
//   - l auteur du fil et le membre ne se vouchent pas eux-memes.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { db, store } from '../db.js';
import { embed, FR } from '../lib/brand.js';
import { estStaff } from '../tickets/manager.js';
import { journal } from '../ops/journal.js';
import { rafraichir, filDe } from './fils.js';

const PAR_MENU = 25;
const MAX_CANDIDATS = PAR_MENU * 4; // 4 menus + 1 rangee de boutons = limite Discord
const MAX_PAGES_MESSAGES = 10; // 1000 reponses par post, largement assez
const EPH = { flags: MessageFlags.Ephemeral };

db.exec(`
CREATE TABLE IF NOT EXISTS reclamations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT NOT NULL,
  fil_id      TEXT NOT NULL,
  posts       TEXT NOT NULL,
  candidats   TEXT NOT NULL,
  exclus      TEXT NOT NULL DEFAULT '[]',
  etat        TEXT NOT NULL DEFAULT 'attente',
  fiche_salon TEXT,
  fiche_id    TEXT,
  cree_at     INTEGER NOT NULL,
  traite_par  TEXT,
  traite_at   INTEGER,
  importes    INTEGER
);
CREATE TABLE IF NOT EXISTS vouch_imports (
  message_id  TEXT PRIMARY KEY,
  to_id       TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  importe_at  INTEGER NOT NULL
);
`);

// ---------------------------------------------------------------------------
// Lecture de l ancien forum (partie pure testable : selectionnerCandidats)
// ---------------------------------------------------------------------------

/**
 * Une reponse par autre membre, la plus ancienne (le vouch d origine, pas les
 * relances). Rend des candidats tries par date.
 *   messages : [{ id, auteurId, auteurNom, bot, texte, pieces, date, lien }]
 */
export function selectionnerCandidats(messages, exclusIds, dejaImportes = new Set()) {
  const ignores = new Set([exclusIds].flat());
  const parAuteur = new Map();
  for (const m of messages) {
    if (m.bot || ignores.has(m.auteurId)) continue;
    if (dejaImportes.has(m.id)) continue;
    const texte = String(m.texte ?? '').trim();
    if (!texte && !m.pieces) continue;
    const actuel = parAuteur.get(m.auteurId);
    if (!actuel || m.date < actuel.date) {
      parAuteur.set(m.auteurId, {
        messageId: m.id,
        auteurId: m.auteurId,
        auteurNom: m.auteurNom,
        texte: texte.slice(0, 280),
        pieces: m.pieces ?? 0,
        date: m.date,
        lien: m.lien,
      });
    }
  }
  return [...parAuteur.values()].sort((a, b) => a.date - b.date);
}

async function messagesDuFil(fil) {
  const tous = [];
  let avant;
  for (let page = 0; page < MAX_PAGES_MESSAGES; page += 1) {
    const lot = await fil.messages.fetch({ limit: 100, before: avant });
    for (const m of lot.values()) {
      tous.push({
        id: m.id,
        auteurId: m.author.id,
        auteurNom: m.author.globalName ?? m.author.username,
        bot: m.author.bot || m.system,
        texte: m.content,
        pieces: m.attachments.size,
        date: m.createdTimestamp,
        lien: m.url,
      });
    }
    if (lot.size < 100) break;
    avant = lot.last().id;
  }
  return tous;
}

function importesDeja() {
  return new Set(db.prepare('SELECT message_id FROM vouch_imports').all().map((r) => r.message_id));
}

// ---------------------------------------------------------------------------
// Fiche staff
// ---------------------------------------------------------------------------

const lireRec = (id) => db.prepare('SELECT * FROM reclamations WHERE id = ?').get(Number(id)) ?? null;
const extrait = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function rendreFiche(rec) {
  const candidats = JSON.parse(rec.candidats);
  const exclus = new Set(JSON.parse(rec.exclus));
  const posts = JSON.parse(rec.posts);
  const lien = store.getLink(rec.discord_id);
  const gardes = candidats.filter((c) => !exclus.has(c.messageId)).length;

  const lignes = candidats.map((c, i) => {
    const texte = c.texte ? `« ${extrait(c.texte.replace(/\s+/g, ' '), 70)} »` : '*(capture seule)*';
    const ligne = `\`${i + 1}.\` <@${c.auteurId}> · <t:${Math.floor(c.date / 1000)}:d> · ${texte}`
      + `${c.pieces ? ` 📎${c.pieces}` : ''} [↗](${c.lien})`;
    return exclus.has(c.messageId) ? `~~${ligne}~~` : ligne;
  });
  const avertissements = [];
  if (!lien) avertissements.push('⚠️ Ce membre n\'a pas encore de compte vérifié : les vouches seront gardés et apparaîtront à sa vérification.');
  if (posts[0]?.auteur && posts[0].auteur !== rec.discord_id) avertissements.push(`⚠️ Le post a été ouvert par <@${posts[0].auteur}>, pas par ce membre.`);
  let description = `**Membre** : <@${rec.discord_id}>${lien ? ` · **${lien.mc_name}**` : ''}\n`
    + `**Ancien(s) post(s)** : ${posts.map((p) => `[${extrait(p.nom, 40)}](${p.lien})`).join(', ')}\n`
    + `**${candidats.length}** vouch(es) trouvé(s), **${gardes}** retenu(s).\n`
    + (avertissements.length ? `${avertissements.join('\n')}\n` : '') + '\n';
  for (const l of lignes) {
    if (description.length + l.length + 40 > 4000) {
      description += `… et ${lignes.length - lignes.indexOf(l)} autre(s), voir le post.`;
      break;
    }
    description += `${l}\n`;
  }

  const etats = {
    attente: { couleur: FR.jaune, titre: '📥・IMPORT D\'ANCIENS VOUCHES' },
    acceptee: { couleur: FR.vert, titre: '✅・ANCIENS VOUCHES IMPORTÉS' },
    refusee: { couleur: FR.rouge, titre: '❌・IMPORT REFUSÉ' },
  };
  const etat = etats[rec.etat] ?? etats.attente;
  if (rec.etat !== 'attente') {
    description += `\n${rec.etat === 'acceptee' ? `**${rec.importes}** vouch(es) importé(s)` : 'Refusée'}`
      + ` par <@${rec.traite_par}> <t:${Math.floor(rec.traite_at / 1000)}:R>.`;
  }
  const e = embed(etat.titre, { couleur: etat.couleur, image: lien?.mc_name ?? 'aucune', description });
  if (rec.etat !== 'attente') return { embeds: [e], components: [] };

  const menus = [];
  for (let debut = 0; debut < candidats.length; debut += PAR_MENU) {
    const tranche = candidats.slice(debut, debut + PAR_MENU);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`recl:excl:${rec.id}:${debut / PAR_MENU}`)
      .setPlaceholder(`🚫 Exclure des vouches (${debut + 1}-${debut + tranche.length})`)
      .setMinValues(0)
      .setMaxValues(tranche.length)
      .addOptions(tranche.map((c, i) => ({
        label: extrait(`${debut + i + 1}. ${c.auteurNom}`, 100),
        description: extrait(c.texte || '(capture seule)', 100),
        value: c.messageId,
        default: exclus.has(c.messageId),
      })));
    menus.push(new ActionRowBuilder().addComponents(menu));
  }
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`recl:ok:${rec.id}`).setLabel(`Importer ${gardes} vouch(es)`)
      .setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(gardes === 0),
    new ButtonBuilder().setCustomId(`recl:non:${rec.id}`).setLabel('Refuser').setEmoji('❌').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [e], components: [...menus, boutons] };
}

// ---------------------------------------------------------------------------
// Scan d un fil (commande /importer-vouches)
// ---------------------------------------------------------------------------

/** Id du fil dans un lien discord.com/channels/<serveur>/<fil>[/<message>], ou un id nu. */
export function idDuFil(texte) {
  const s = String(texte ?? '').trim();
  const lien = s.match(/discord(?:app)?\.com\/channels\/\d+\/(\d{15,25})/);
  if (lien) return lien[1];
  return /^\d{15,25}$/.test(s) ? s : null;
}

export async function scannerFil(interaction, texteLien, membreForce = null) {
  if (!estStaff(interaction.member)) return interaction.reply({ content: '🔒 Réservé au staff.', ...EPH });
  const filId = idDuFil(texteLien);
  if (!filId) return interaction.reply({ content: '❌ Collez le lien du post de l\'ancien forum (clic droit sur le post, Copier le lien).', ...EPH });

  await interaction.deferReply();
  const fil = await interaction.client.channels.fetch(filId).catch(() => null);
  if (!fil?.isThread?.()) {
    return interaction.editReply('❌ Ce lien ne mène pas à un post de forum que le bot peut lire (il lui faut Voir le salon et Lire l\'historique).');
  }
  const membreId = membreForce?.id ?? fil.ownerId;
  if (!membreId) return interaction.editReply('❌ Auteur du post introuvable : précisez le membre avec l\'option `membre`.');

  const messages = await messagesDuFil(fil);
  const candidats = selectionnerCandidats(messages, [membreId, fil.ownerId], importesDeja()).slice(0, MAX_CANDIDATS);
  if (!candidats.length) {
    return interaction.editReply(`Aucune réponse d'un autre membre à importer dans [${fil.name}](${fil.url}) (ou tout est déjà importé).`);
  }
  if (!messages.some((m) => m.texte)) {
    console.warn('[reclamation] aucun texte lu : intent Message Content absent ou refuse ?');
  }

  const posts = [{ id: fil.id, nom: fil.name, lien: fil.url, auteur: fil.ownerId }];
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO reclamations (discord_id, fil_id, posts, candidats, cree_at) VALUES (?, ?, ?, ?, ?)',
  ).run(membreId, fil.id, JSON.stringify(posts), JSON.stringify(candidats), Date.now());
  const rec = lireRec(lastInsertRowid);
  const reponse = await interaction.editReply(rendreFiche(rec));
  db.prepare('UPDATE reclamations SET fiche_salon = ?, fiche_id = ? WHERE id = ?').run(interaction.channelId, reponse.id, rec.id);
  console.log(`[reclamation] ${interaction.user.tag} scanne ${fil.name} : ${candidats.length} candidat(s) pour ${membreId}`);
  return reponse;
}

// ---------------------------------------------------------------------------
// Cote staff
// ---------------------------------------------------------------------------

export async function onReclamationSelect(interaction) {
  const [, , id, page] = interaction.customId.split(':');
  if (!estStaff(interaction.member)) return interaction.reply({ content: '🔒 Réservé au staff.', ...EPH });
  const rec = lireRec(id);
  if (!rec || rec.etat !== 'attente') return interaction.update(rec ? rendreFiche(rec) : { components: [] });

  // Chaque menu couvre sa tranche : on remplace les exclusions de CETTE tranche.
  const candidats = JSON.parse(rec.candidats);
  const tranche = new Set(candidats.slice(Number(page) * PAR_MENU, (Number(page) + 1) * PAR_MENU).map((c) => c.messageId));
  const exclus = JSON.parse(rec.exclus).filter((m) => !tranche.has(m)).concat(interaction.values);
  db.prepare('UPDATE reclamations SET exclus = ? WHERE id = ?').run(JSON.stringify(exclus), rec.id);
  return interaction.update(rendreFiche(lireRec(id)));
}

/**
 * Importe les candidats retenus. Rend le nombre d avis crees. Un auteur qui a
 * deja note le membre dans le nouveau systeme garde son avis recent.
 */
export function importer(rec, maintenant = Date.now()) {
  const exclus = new Set(JSON.parse(rec.exclus));
  const inserer = db.prepare(
    'INSERT OR IGNORE INTO vouches (from_id, to_id, value, comment, created_at, stars) VALUES (?, ?, 1, ?, ?, NULL)',
  );
  const tracer = db.prepare(
    'INSERT OR IGNORE INTO vouch_imports (message_id, to_id, from_id, importe_at) VALUES (?, ?, ?, ?)',
  );
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const c of JSON.parse(rec.candidats)) {
      if (exclus.has(c.messageId) || c.auteurId === rec.discord_id) continue;
      const trace = tracer.run(c.messageId, rec.discord_id, c.auteurId, maintenant);
      if (!trace.changes) continue; // deja importe par ailleurs
      const texte = `[Ancien vouch] ${c.texte || '(capture)'}`.slice(0, 280);
      n += inserer.run(c.auteurId, rec.discord_id, texte, c.date).changes;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

export async function onReclamationBouton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!estStaff(interaction.member)) return interaction.reply({ content: '🔒 Réservé au staff.', ...EPH });
  const rec = lireRec(id);
  if (!rec) return interaction.update({ components: [] });
  if (rec.etat !== 'attente') return interaction.update(rendreFiche(rec));

  await interaction.deferUpdate();
  const staff = interaction.user.id;
  const lien = store.getLink(rec.discord_id);
  const client = interaction.client;

  if (action === 'ok') {
    const n = importer(rec);
    db.prepare("UPDATE reclamations SET etat = 'acceptee', traite_par = ?, traite_at = ?, importes = ? WHERE id = ?")
      .run(staff, Date.now(), n, rec.id);
    await rafraichir(client, rec.discord_id).catch((e) => console.error('[reclamation] carte :', e.message));
    if (lien && n) {
      const fil = await filDe(client, lien).catch(() => null);
      await fil?.send({
        embeds: [embed('📥・ANCIENS VOUCHES IMPORTÉS', {
          couleur: FR.bleu,
          image: 'aucune',
          description: `**${n}** vouch(es) de l'ancien système, vérifiés par le staff, comptent désormais dans ce score.`,
        })],
      }).catch(() => {});
    }
    journal({
      niveau: 'info',
      titre: 'Anciens vouches importés',
      texte: `<@${staff}> a importé les anciens vouches de <@${rec.discord_id}>.`,
      champs: { Joueur: lien?.mc_name, Importés: n },
      joueur: lien?.mc_name,
    });
    await prevenir(client, rec.discord_id, `✅ Vos anciens vouches ont été importés : **${n}** ajouté(s) à votre réputation.`);
  } else if (action === 'non') {
    db.prepare("UPDATE reclamations SET etat = 'refusee', traite_par = ?, traite_at = ? WHERE id = ?")
      .run(staff, Date.now(), rec.id);
    await prevenir(client, rec.discord_id,
      '❌ L\'import de vos anciens vouches a été refusé par le staff. Ouvrez un ticket si vous pensez que c\'est une erreur.');
  }
  return interaction.editReply(rendreFiche(lireRec(id)));
}

async function prevenir(client, userId, texte) {
  const membre = await client.users.fetch(userId).catch(() => null);
  await membre?.send({ embeds: [embed('📥・ANCIENS VOUCHES', { image: 'aucune', description: texte })] })
    .catch(() => console.warn(`[reclamation] MP impossible pour ${userId}`));
}
