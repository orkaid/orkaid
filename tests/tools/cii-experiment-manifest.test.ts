import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildManifest, MANIFEST_PATH } from '../../tools/cii-experiment/manifest.ts';

// DP-0 (M1 WP-1 human review, 2026-09-27): the active regression gate is only the frozen oracle/protocol material
// that actually defines the bounded experiment (WP-1 §19, option a) -- not the raw input fixtures it exercised
// (they may legitimately evolve with the semantic model, as the M1 VAT-treatment migration just did) and not
// `recorded` (production-code/runtime identities expected to keep evolving). Historical provenance for everything
// else stays recoverable from the preregistration and result commits (2d2ee21, c3f0303), per PROTOCOL.md section 12.
const FROZEN_ORACLE_FILES = [
  'tests/fixtures/xrechnung/cii-experiment/expected-money.json',
  'tests/fixtures/xrechnung/cii-experiment/expected-projections.json',
  'tests/fixtures/xrechnung/cii-experiment/controls.json',
  'tests/fixtures/xrechnung/cii-experiment/PROTOCOL.md',
  'tests/fixtures/xrechnung/cii-experiment/rule-inventory.json',
];

test('the frozen CII experiment oracle/protocol files match their committed SHA-256 manifest', () => {
  const committed = JSON.parse(readFileSync(new URL(`../../${MANIFEST_PATH}`, import.meta.url), 'utf8')) as { files: { path: string }[] };
  const generated = JSON.parse(buildManifest()) as { files: { path: string }[] };
  const only = (files: { path: string }[]) => files.filter((f) => FROZEN_ORACLE_FILES.includes(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const actual = only(generated.files);
  assert.equal(actual.length, FROZEN_ORACLE_FILES.length, 'every named oracle/protocol file is present');
  assert.deepEqual(actual, only(committed.files));
});

// Proves the decoupling rather than merely asserting it: invoice.ts changed for the M1 VAT-treatment migration, so
// its historical `recorded` hash is now stale, and that staleness is expected to never fail this suite. If the
// manifest were ever regenerated with `--write` after such a change, this assertion would fail -- which is the
// point: it also guards against accidentally re-freezing `recorded` in the same change that made it stale.
test('production-code hashes recorded at preregistration are historical provenance, not an active gate', () => {
  const committed = JSON.parse(readFileSync(new URL(`../../${MANIFEST_PATH}`, import.meta.url), 'utf8')) as {
    recorded: { files: { path: string; sha256: string }[] };
  };
  const recordedInvoice = committed.recorded.files.find((f) => f.path === 'src/lib/domain/xrechnung/invoice.ts');
  assert.ok(recordedInvoice, 'the historical manifest still names invoice.ts as recorded provenance');
  const currentHash = createHash('sha256')
    .update(readFileSync(new URL('../../src/lib/domain/xrechnung/invoice.ts', import.meta.url)))
    .digest('hex');
  assert.notEqual(currentHash, recordedInvoice.sha256, 'invoice.ts has evolved since preregistration; the stale hash must not be enforced');
});
