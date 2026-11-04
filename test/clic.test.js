import { test } from 'node:test';
import assert from 'node:assert/strict';
import nbt from 'prismarine-nbt';
import { varint, nbtAnonyme, paquetClicCustom } from '../src/minecraft/clic.js';

test('clic custom : varint, NBT anonyme et paquet', () => {
  assert.deepEqual([...varint(0x41)], [0x41]);
  assert.deepEqual([...varint(300)], [0xac, 0x02]);
  const c = nbt.comp({ cmd: nbt.string('stats') });
  const a = nbtAnonyme(c);
  assert.equal(a[0], 0x0a);
  assert.deepEqual([...a.subarray(1, 4)], [0x08, 0x00, 0x03]); // tag string « cmd », sans nom de racine
  const p = paquetClicCustom(0x41, 'donutdialogues:action', c);
  assert.equal(p[0], 0x41);
  assert.equal(p[1], 'donutdialogues:action'.length);
  assert.equal(p[2 + 21], a.length); // longueur du payload
  assert.deepEqual([...nbtAnonyme(null)], [0]);
});
