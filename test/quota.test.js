import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';

mkdirSync('./data', { recursive: true });
rmSync('./data/test-quota.db', { force: true });
process.env.DB_PATH = './data/test-quota.db';
const { limiteDe, reglagesQuota, FENETRE_MS } = await import('../src/moderation/quota.js');

const MOD = '111111111111111111'; const SR = '222222222222222222';
const quotas = new Map([[MOD, 3], [SR, 10]]);
const g = { ownerId: '9', positionAdmin: 50 };
const m = (roles, x = {}) => ({ id: '5', roleIds: new Set(roles), admin: false, positionMax: 10, ...x });

test('quota : le role le plus genereux compte', () => {
  assert.deepEqual(limiteDe(m([MOD]), g, quotas), { limite: 3, roleId: MOD });
  assert.deepEqual(limiteDe(m([MOD, SR]), g, quotas), { limite: 10, roleId: SR });
  assert.equal(limiteDe(m([]), g, quotas), null);
});

test('quota : proprietaire, admin et roles au niveau Administrateur sans limite', () => {
  assert.equal(limiteDe(m([MOD], { id: '9' }), g, quotas), null);
  assert.equal(limiteDe(m([MOD], { admin: true }), g, quotas), null);
  assert.equal(limiteDe(m([MOD], { positionMax: 50 }), g, quotas), null);
});

test('quota : fenetre glissante de 7 jours, unban sans effet', () => {
  const t0 = Date.now();
  reglagesQuota.noterBan('42', t0 - FENETRE_MS - 1000); // trop vieux
  reglagesQuota.noterBan('42', t0 - 1000);
  reglagesQuota.noterBan('42', t0);
  assert.equal(reglagesQuota.bans('42', t0).length, 2);
});
