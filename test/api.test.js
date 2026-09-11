import test from 'node:test';
import assert from 'node:assert/strict';

test('sans cle et sans mode test, l API echoue au lieu d inventer', async () => {
  delete process.env.DONUT_API_KEY;
  process.env.DONUT_MOCK = 'false';
  const { donut } = await import('../src/donut/api.js?nokey');
  assert.equal(donut.live, false);
  assert.equal(donut.mock, false);
  await assert.rejects(() => donut.stats('SentiaZz'), /clé API DonutSMP manquante/);
  await assert.rejects(() => donut.leaderboard('money'), /clé API DonutSMP manquante/);
});
