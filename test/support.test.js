import test from 'node:test';
import assert from 'node:assert/strict';
import { decider, DEFAUTS, MIN, estLaNuit, budgetDispo, transcriptPourIA, heureParis } from '../src/support/logique.js';

const r = { ...DEFAUTS, delaiJourMin: 15, delaiNuitMin: 3, nuitDebut: 0, nuitFin: 9 };
// Un mercredi a 14 h et a 3 h, heure de Paris (hiver, UTC+1).
const JOUR = Date.parse('2026-11-04T13:00:00Z');
const NUIT = Date.parse('2026-11-04T02:00:00Z');
const ouvert = (at) => ({ etat: 'ouvert', pris_par: null, created_at: at });

test('support : heure de Paris et nuit', () => {
  assert.equal(heureParis(JOUR), 14);
  assert.equal(heureParis(NUIT), 3);
  assert.equal(estLaNuit(NUIT, r), true);
  assert.equal(estLaNuit(JOUR, r), false);
  assert.equal(estLaNuit(Date.parse('2026-11-04T22:30:00Z'), { nuitDebut: 22, nuitFin: 7 }), true); // 23 h 30
});

test('support : attend le delai, plus court la nuit, puis repond', () => {
  const t = ouvert(JOUR - 10 * MIN);
  const d = decider({ ticket: t, messages: [], reglages: r, actif: true, now: JOUR });
  assert.equal(d.action, 'attendre');
  assert.equal(d.dans, 5 * MIN);
  assert.equal(decider({ ticket: ouvert(JOUR - 16 * MIN), messages: [], reglages: r, actif: true, now: JOUR }).action, 'repondre');
  assert.equal(decider({ ticket: ouvert(NUIT - 4 * MIN), messages: [], reglages: r, actif: true, now: NUIT }).action, 'repondre');
});

test('support : un membre qui relance ne repousse pas la premiere reponse', () => {
  const t = ouvert(JOUR - 16 * MIN);
  const messages = [{ role: 'membre', at: JOUR - 60_000 }, { role: 'membre', at: JOUR - 5000 }];
  assert.equal(decider({ ticket: t, messages, reglages: r, actif: true, now: JOUR }).action, 'repondre');
});

test('support : en conversation, reponse 4 s apres le dernier message du membre', () => {
  const t = ouvert(JOUR - 60 * MIN);
  const etat = { iaCount: 1 };
  const vient = [{ role: 'ia', at: JOUR - 40 * MIN }, { role: 'membre', at: JOUR - 1000 }];
  const d = decider({ ticket: t, messages: vient, etat, reglages: r, actif: true, now: JOUR });
  assert.equal(d.action, 'attendre');
  assert.equal(d.dans, 3000);
  const passe = [{ role: 'ia', at: JOUR - 40 * MIN }, { role: 'membre', at: JOUR - 5_000 }];
  assert.equal(decider({ ticket: t, messages: passe, etat, reglages: r, actif: true, now: JOUR }).action, 'repondre');
  // Apres sa propre reponse, l IA attend le membre ; avoir transmis ne la coupe pas.
  assert.equal(decider({ ticket: t, messages: [{ role: 'ia', at: JOUR - 40 * MIN }], etat, reglages: r, actif: true, now: JOUR }).action, 'rien');
  assert.equal(decider({ ticket: t, messages: passe, etat: { iaCount: 1, transmis: true }, reglages: r, actif: true, now: JOUR }).action, 'repondre');
});

test('support : se tait si staff, prise en charge, limite, eteint, ancien ticket', () => {
  const t = ouvert(JOUR - 60 * MIN);
  const base = { ticket: t, reglages: r, actif: true, now: JOUR };
  assert.equal(decider({ ...base, messages: [{ role: 'membre', at: JOUR - 55 * MIN }, { role: 'staff', at: JOUR - 50 * MIN }] }).action, 'rien');
  assert.equal(decider({ ...base, ticket: { ...t, pris_par: '1' }, messages: [{ role: 'staff', at: JOUR - 5 * MIN }] }).action, 'rien');
  assert.equal(decider({ ...base, messages: [], etat: { iaCount: r.maxIaParTicket } }).action, 'rien');
  assert.equal(decider({ ...base, actif: false, messages: [] }).action, 'rien');
  assert.equal(decider({ ...base, ticket: { ...t, etat: 'ferme' }, messages: [] }).action, 'rien');
  assert.equal(decider({ ...base, messages: [], depuis: JOUR - 30 * MIN }).action, 'rien');
});

test('support : budget journalier et transcript', () => {
  assert.deepEqual(budgetDispo(null, 2, JOUR), { ok: true, suivant: { jour: '2026-11-04', n: 1 } });
  assert.equal(budgetDispo({ jour: '2026-11-04', n: 2 }, 2, JOUR).ok, false);
  assert.equal(budgetDispo({ jour: '2026-11-03', n: 99 }, 2, JOUR).ok, true); // nouveau jour
  assert.equal(transcriptPourIA([{ role: 'membre', content: 'salut', pieces: 1 }, { role: 'ia', content: 'bonjour' }]),
    '[Membre] salut (+1 pièce(s) jointe(s))\n[Assistant IA] bonjour');
});

test('support : apres le staff, reprise si la demande du membre attend 30 min', () => {
  const t = ouvert(JOUR - 120 * MIN);
  const base = { ticket: t, reglages: r, actif: true, now: JOUR };
  const msgs = (minMembre) => [{ role: 'staff', at: JOUR - 90 * MIN }, { role: 'membre', at: JOUR - minMembre * MIN }];
  const tot = decider({ ...base, messages: msgs(10) });
  assert.equal(tot.action, 'attendre');
  assert.equal(tot.dans, 20 * MIN);
  const d = decider({ ...base, messages: msgs(31) });
  assert.equal(d.action, 'repondre');
  assert.equal(d.reprise, true);
  // Pris en charge sans un mot : la demande d ouverture attend depuis 2 h.
  assert.equal(decider({ ...base, ticket: { ...t, pris_par: '1' }, messages: [] }).reprise, true);
  // Apres la reprise de l IA, elle attend de nouveau le membre.
  assert.equal(decider({ ...base, messages: [...msgs(40), { role: 'ia', at: JOUR - MIN }] }).action, 'rien');
});
