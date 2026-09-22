// Petite bibliotheque d interface terminal : cadres, degrades, menus au
// clavier. Aucune dependance, le terminal suffit.
//
// Deux modes, choisis tout seuls :
//   - terminal interactif : fleches, Entree, q pour revenir
//   - entree redirigee (pipe, CI, session qui tombe) : menu numerote
// Le second existe parce qu un menu qui n a pas de clavier ne doit pas planter,
// il doit se lire et s automatiser.

import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export const tty = Boolean(stdin.isTTY && stdout.isTTY);
const large = () => Math.min(stdout.columns || 80, 92);

// ------------------------------------------------------------------ couleurs
const vraieCouleur = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
export const RESET = '\x1b[0m';
export const GRAS = '\x1b[1m';
export const PALE = '\x1b[2m';
export const ITAL = '\x1b[3m';

const rgb = (r, g, b, fond = false) => (vraieCouleur
  ? `\x1b[${fond ? 48 : 38};2;${r};${g};${b}m`
  : `\x1b[${fond ? 4 : 3}${r > 150 && g > 150 ? 6 : r > 150 ? 1 : 4}m`);

// Bleu et or de la marque FR (src/lib/brand.js).
export const BLEU = rgb(174, 239, 255);
export const OR = rgb(255, 243, 110);
export const VERT = rgb(87, 242, 135);
export const ROUGE = rgb(237, 66, 69);
export const JAUNE = rgb(254, 231, 92);
export const GRIS = rgb(140, 148, 160);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Texte peint en degradé, caractere par caractere. */
export function degrade(texte, de = '#AEEFFF', a = '#FFF36E') {
  const [r1, g1, b1] = hex(de);
  const [r2, g2, b2] = hex(a);
  const n = Math.max(texte.length - 1, 1);
  return [...texte].map((c, i) => {
    const t = i / n;
    return rgb(
      Math.round(r1 + (r2 - r1) * t),
      Math.round(g1 + (g2 - g1) * t),
      Math.round(b1 + (b2 - b1) * t),
    ) + c;
  }).join('') + RESET;
}

/** Longueur a l ecran : les codes couleur ne prennent pas de place. */
export const nu = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const bourre = (s, n) => s + ' '.repeat(Math.max(0, n - nu(s).length));

export const effacer = () => { if (tty) stdout.write('\x1b[2J\x1b[3J\x1b[H'); };

export function banniere(titre, sous = '') {
  const l = large() - 4;
  const barre = '─'.repeat(l);
  console.log(`\n  ${GRIS}╭${barre}╮${RESET}`);
  console.log(`  ${GRIS}│${RESET} ${bourre(degrade(titre), l - 1)}${GRIS}│${RESET}`);
  if (sous) console.log(`  ${GRIS}│${RESET} ${PALE}${bourre(sous, l - 1)}${RESET}${GRIS}│${RESET}`);
  console.log(`  ${GRIS}╰${barre}╯${RESET}`);
}

export const point = (etat) => ({
  ok: `${VERT}●${RESET}`,
  ko: `${ROUGE}●${RESET}`,
  tiede: `${JAUNE}●${RESET}`,
  off: `${GRIS}○${RESET}`,
}[etat] ?? ' ');

// Un seul listener clavier pour toute la session : les touches qui arrivent
// entre deux ecrans sont gardees en attente au lieu d etre jetees.
let branche = false;
let abonne = null;
const attente = [];

function clavier() {
  if (branche) return;
  readline.emitKeypressEvents(stdin);
  stdin.on('keypress', (car, k) => {
    if (abonne) abonne(car, k);
    else attente.push([car, k]);
  });
  branche = true;
}

/**
 * Menu au clavier. `items` : { cle, libelle, valeur, note, etat, retour }.
 * Rend la cle choisie, ou null si on remonte (q, Echap, fleche gauche).
 */
export async function menu({ titre, sous, items, aide, entete }) {
  const choisissables = items.filter((i) => i.separateur === undefined);
  if (!tty) return menuNumerote({ titre, sous, items, entete });

  let i = 0;
  const largeurLibelle = Math.max(...choisissables.map((x) => nu(x.libelle).length), 10);

  const dessiner = () => {
    effacer();
    banniere(titre, sous);
    if (entete) console.log(entete);
    console.log('');
    let n = 0;
    for (const item of items) {
      if (item.separateur !== undefined) {
        console.log(item.separateur ? `   ${PALE}${item.separateur}${RESET}` : '');
        continue;
      }
      const actif = n === i;
      const fleche = actif ? `${BLEU}❯${RESET}` : ' ';
      const libelle = actif ? `${GRAS}${item.libelle}${RESET}` : item.libelle;
      const etat = item.etat ? `${point(item.etat)} ` : '';
      const valeur = item.valeur ? `  ${item.valeur}` : '';
      const note = item.note ? `   ${PALE}${item.note}${RESET}` : '';
      console.log(`  ${fleche} ${etat}${bourre(libelle, largeurLibelle)}${valeur}${note}`);
      n += 1;
    }
    console.log(`\n   ${PALE}${aide ?? '↑↓ naviguer   ↵ ouvrir   q revenir'}${RESET}\n`);
  };

  clavier();
  stdin.setRawMode(true);
  stdin.resume();
  dessiner();

  return new Promise((resolve) => {
    const fin = (valeur) => {
      abonne = null;
      resolve(valeur);
    };
    const touche = (car, k) => {
      const nom = k?.name;
      if (k?.ctrl && nom === 'c') { effacer(); process.exit(0); }
      if (nom === 'up' || nom === 'k') { i = (i - 1 + choisissables.length) % choisissables.length; dessiner(); }
      else if (nom === 'down' || nom === 'j' || nom === 'tab') { i = (i + 1) % choisissables.length; dessiner(); }
      else if (nom === 'home') { i = 0; dessiner(); }
      else if (nom === 'end') { i = choisissables.length - 1; dessiner(); }
      else if (nom === 'return' || nom === 'space') fin(choisissables[i].cle);
      else if (nom === 'escape' || nom === 'q' || nom === 'left') fin(null);
      else if (/^[1-9]$/.test(car ?? '')) {
        const n = Number(car) - 1;
        if (choisissables[n]) { i = n; fin(choisissables[n].cle); }
      }
    };
    abonne = touche;
    // Les touches tapees pendant le chargement de l ecran ont ete mises de
    // cote : un terminal les livre en un seul bloc, et sans ca tout ce qui
    // suit la premiere touche du bloc etait perdu.
    while (abonne && attente.length) {
      const [car, k] = attente.shift();
      touche(car, k);
    }
  });
}

// Repli sans clavier : on imprime, on lit un numero sur stdin.
async function menuNumerote({ titre, sous, items, entete }) {
  const choisissables = items.filter((i) => i.separateur === undefined);
  console.log(`\n== ${titre} ==${sous ? `  ${sous}` : ''}`);
  if (entete) console.log(nu(entete));
  choisissables.forEach((item, n) => {
    console.log(`  ${n + 1}. ${nu(item.libelle)}${item.valeur ? `  ${nu(item.valeur)}` : ''}`);
  });
  console.log('  0. Retour');
  const r = (await demander('> ')).trim();
  if (!r || r === '0') return null;
  const item = choisissables[Number(r) - 1];
  return item ? item.cle : null;
}

// ------------------------------------------------------------------- saisies
// PIEGE VECU : apres un menu, stdin est en mode brut. Forcer setRawMode(false)
// avant de poser une question coupe le flux pour de bon, plus une seule touche
// n arrive et le programme reste pendu sur la question. readline veut gerer le
// terminal lui meme : on lui laisse le mode brut et on ferme son interface
// apres chaque reponse, sinon elle continue a lire les fleches du menu suivant.
let rl = null;
let ferme = false;

function interfacePartagee() {
  if (!rl) rl = createInterface({ input: stdin, output: stdout });
  return rl;
}

// Sans terminal, tout le script peut arriver d un coup : readline emet alors
// ses lignes PUIS se ferme dans la foulee. Un simple drapeau « ferme » sautait
// toutes les questions suivantes alors que les reponses etaient deja la. On
// consomme les lignes une par une avec l iterateur, qui ne dit « fini » qu au
// vrai bout du flux.
let lignes = null;
async function ligneSuivante() {
  if (!lignes) lignes = interfacePartagee()[Symbol.asyncIterator]();
  const { value, done } = await lignes.next();
  if (done) { ferme = true; return ''; }
  return value;
}

export const entreeFermee = () => ferme;

/**
 * Ce qui a ete tape avant que la question soit posee. Un terminal livre une
 * rafale (frappe rapide, coller) en un seul bloc : ces touches ont deja ete
 * lues par le decodeur, readline ne les verra jamais. Les jeter perdait un
 * token colle juste apres avoir choisi la ligne.
 */
function texteEnAttente() {
  let texte = '';
  while (attente.length) {
    const [car, k] = attente.shift();
    const nom = k?.name;
    if (nom === 'return' || nom === 'enter') return { texte, complet: true };
    if (nom === 'backspace') { texte = texte.slice(0, -1); continue; }
    if (k?.ctrl || k?.meta) continue;
    if (typeof car === 'string' && car.length === 1 && car >= ' ') texte += car;
  }
  return { texte, complet: false };
}

export async function demander(question) {
  if (ferme) return '';
  abonne = null;
  const avance = tty ? texteEnAttente() : { texte: '', complet: false };
  if (avance.complet) {
    // La ligne entiere etait deja tapee : on l affiche et on repond.
    console.log(`${question}${avance.texte}`);
    return avance.texte;
  }
  if (!tty) {
    stdout.write(question);
    const r = await ligneSuivante();
    if (r) stdout.write(`${r}\n`);
    return r;
  }
  const it = createInterface({ input: stdin, output: stdout });
  stdin.resume();

  return new Promise((resolve) => {
    let repondu = false;
    const fermeture = () => {
      if (repondu) return;
      repondu = true;
      ferme = true;      // stdin est mort : plus personne ne repondra
      resolve('');
    };
    it.once('close', fermeture);
    const promesse = it.question(question);
    if (avance.texte) it.write(avance.texte);   // la rafale deja tapee, rejouee
    promesse.then(
      (r) => {
        repondu = true;
        it.off('close', fermeture);
        it.close();
        resolve(r);
      },
      () => fermeture(),
    );
  });
}

/** Saisie d une valeur, avec la valeur actuelle rappelee au dessus. */
export async function saisie(libelle, actuel, { secret = false, aide = '' } = {}) {
  console.log(`\n  ${degrade(libelle)}`);
  if (aide) console.log(`  ${PALE}${aide}${RESET}`);
  const vu = actuel ? (secret ? masquer(actuel) : actuel) : `${PALE}vide${RESET}`;
  console.log(`  ${PALE}actuel${RESET}  ${vu}`);
  const r = (await demander(`  ${BLEU}❯${RESET} `)).trim();
  if (!r) return undefined;
  return r === '-' ? '' : r;
}

export async function confirmer(question, defaut = true) {
  const r = (await demander(`  ${question} ${PALE}[${defaut ? 'O/n' : 'o/N'}]${RESET} `)).trim();
  if (!r) return defaut;
  return /^o|^y/i.test(r);
}

export async function pause(texte = 'Entree pour continuer') {
  await demander(`\n  ${PALE}${texte}${RESET} `);
}

export function fermer() { if (rl && !ferme) rl.close(); rl = null; }

export const masquer = (v) => (v ? (v.length > 12 ? `${v.slice(0, 6)}${PALE}...${RESET}${v.slice(-4)}` : '******') : '');
