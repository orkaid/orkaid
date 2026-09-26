import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildManifest, MANIFEST_PATH } from '../../tools/cii-experiment/manifest.ts';

// The preregistered CII experiment package must stay byte for byte what was committed (PROTOCOL.md section 12).
test('the CII experiment package matches its committed SHA-256 manifest', () => {
  assert.equal(readFileSync(new URL(`../../${MANIFEST_PATH}`, import.meta.url), 'utf8'), buildManifest());
});
