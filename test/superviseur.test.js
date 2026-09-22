import test from 'node:test';
import assert from 'node:assert/strict';
import { creerSuperviseur } from '../ingame/superviseur.js';

function banc({ silenceMax = 1000 } = {}) {
  const timers = [];
  let horloge = 0;
  let connexions = 0;
  const sup = creerSuperviseur({
    connecter: () => { connexions += 1; },
    base: 100,
    plafond: 400,
    silenceMax,
    minuteur: (fn, ms) => timers.push({ fn, ms }),
    maintenant: () => horloge,
  });
  return {
    sup,
    get connexions() { return connexions; },
    avancer: (ms) => { horloge += ms; },
    declencher: () => { const t = timers.shift(); t?.fn(); return t?.ms; },
    enAttente: () => timers.length,
  };
}

test('une erreur avant connexion relance, comme le ferait un end', () => {
  const b = banc();
  const g = b.sup.nouvelleGeneration();
  assert.equal(b.sup.relancer('erreur avant connexion', g), 100);
  b.declencher();
  assert.equal(b.connexions, 1);
});

test('end et error qui tombent ensemble ne relancent qu une fois', () => {
  const b = banc();
  const g = b.sup.nouvelleGeneration();
  assert.equal(b.sup.relancer('error', g), 100);
  assert.equal(b.sup.relancer('end', g), null);
  assert.equal(b.enAttente(), 1);
});

test('les evenements d une connexion morte sont ignores', () => {
  const b = banc();
  const vieille = b.sup.nouvelleGeneration();
  b.sup.relancer('end', vieille);
  b.declencher();
  const neuve = b.sup.nouvelleGeneration();
  assert.notEqual(neuve, vieille);
  assert.equal(b.sup.relancer('end en retard', vieille), null);
  assert.equal(b.enAttente(), 0);
});

test('le delai double puis plafonne, et repart a zero une fois en jeu', () => {
  const b = banc();
  const suite = [];
  for (let i = 0; i < 4; i += 1) {
    const g = b.sup.nouvelleGeneration();
    suite.push(b.sup.relancer('end', g));
    b.declencher();
  }
  assert.deepEqual(suite, [100, 200, 400, 400]);
  b.sup.connecte();
  const g = b.sup.nouvelleGeneration();
  assert.equal(b.sup.relancer('end', g), 100);
});

test('le chien de garde mord apres un silence trop long, jamais avant', () => {
  const b = banc({ silenceMax: 1000 });
  b.sup.nouvelleGeneration();
  b.avancer(900);
  assert.equal(b.sup.chienDeGarde(false), false);
  b.avancer(200);
  assert.equal(b.sup.chienDeGarde(false), true);
  b.declencher();
  assert.equal(b.connexions, 1);
});

test('le chien de garde ne mord pas si le bot est en jeu', () => {
  const b = banc({ silenceMax: 1000 });
  b.avancer(5000);
  assert.equal(b.sup.chienDeGarde(true), false);
  b.avancer(500);
  assert.equal(b.sup.chienDeGarde(false), false);
});

test('le chien de garde ne double pas une relance deja prevue', () => {
  const b = banc({ silenceMax: 1000 });
  const g = b.sup.nouvelleGeneration();
  b.sup.relancer('end', g);
  b.avancer(5000);
  assert.equal(b.sup.chienDeGarde(false), false);
  assert.equal(b.enAttente(), 1);
});
