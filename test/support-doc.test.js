import { test } from 'node:test';
import assert from 'node:assert/strict';
import { texteDePage } from '../src/support/doc-donut.js';

test('doc : html en texte, sans script ni style', () => {
  const t = texteDePage('<html><style>a{}</style><script>var x=1</script><h3>3.1 Cheats</h3><ul><li>No hacked clients</li><li>No  macros &amp; scripts</li></ul><p>Terms</p></html>');
  assert.equal(t, '3.1 Cheats\nNo hacked clients\nNo macros & scripts');
});
