import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choisirImages, urlReduite } from '../src/support/images.js';

const img = (name, at, extra = {}) => ({ url: `https://cdn/${name}`, proxyURL: `https://media/${name}?ex=1`, contentType: 'image/png', width: 800, height: 600, size: 1000, name, ...extra });

test('images : seulement celles de l auteur, types image, 4 plus recentes en ordre', () => {
  const messages = [
    { auteur: 'staff', at: 1, pieces: [img('s.png', 1)] },
    { auteur: 'm', at: 2, pieces: [img('a.png'), { ...img('v.mp4'), contentType: 'video/mp4' }] },
    { auteur: 'm', at: 5, pieces: [img('d.jpg', 0, { contentType: 'image/jpeg' })] },
    { auteur: 'm', at: 3, pieces: [img('b.png'), img('c.webp', 0, { contentType: 'image/webp; charset=x' })] },
    { auteur: 'm', at: 6, pieces: [img('e.gif', 0, { contentType: 'image/gif' })] },
  ];
  const r = choisirImages(messages, 'm', 4);
  assert.deepEqual(r.map((p) => p.name), ['b.png', 'c.webp', 'd.jpg', 'e.gif']);
  assert.equal(r[1].type, 'image/webp');
});

test('images : grande capture reduite par le proxy, petite telechargee telle quelle', () => {
  assert.equal(urlReduite(img('p.png')), 'https://cdn/p.png');
  assert.equal(urlReduite(img('g.png', 0, { width: 3136, height: 1764 })), 'https://media/g.png?ex=1&width=1568&height=882');
});
