import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// MDR-18 eo-floor-registry-one-disposition-per-capability: every capability of the non-UI reference inventory has
// exactly one allowed disposition, and every disposition other than parity or re-derived states its reason.
// The expected IDs are written out here on purpose, independently of the registry, so that deleting a row from the
// registry can never make this suite pass.
const EXPECTED_IDS = [
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17',
  'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9',
];
const DISPOSITIONS = ['parity', 're-derived', 'intentionally-not-copied', 'outside-floor'];
const REGISTRY = 'docs/semantic-audit/xrechnung-m1-floor-dispositions.json';

type Row = {
  id: unknown;
  capability: unknown;
  disposition: unknown;
  rationale: unknown;
  decisionRefs: unknown;
  implementationEvidence: unknown;
  validatorEvidence: unknown;
};

const root = new URL('../../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL(REGISTRY, root), 'utf8')) as { schemaVersion: unknown; milestone: unknown; inventory: Row[] };
const rows = registry.inventory;
const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

test('the registry is the M1 schema-version-1 registry', () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.milestone, 'M1');
  assert.ok(Array.isArray(rows));
});

test('exactly the 26 inventory IDs, each once: S1-S17 and O1-O9', () => {
  const ids = rows.map((row) => row.id);
  assert.equal(ids.length, 26);
  assert.equal(new Set(ids).size, ids.length, 'no ID appears twice');
  assert.deepEqual([...ids].sort(), [...EXPECTED_IDS].sort());
  assert.deepEqual(ids.filter((id) => String(id).startsWith('S')).sort(), EXPECTED_IDS.filter((id) => id.startsWith('S')).sort());
  assert.deepEqual(ids.filter((id) => String(id).startsWith('O')).sort(), EXPECTED_IDS.filter((id) => id.startsWith('O')).sort());
});

test('every row has a capability description and exactly one allowed disposition', () => {
  for (const row of rows) {
    assert.ok(nonEmpty(row.capability), `${row.id}: capability`);
    assert.equal(typeof row.disposition, 'string', `${row.id}: one disposition, not a list`);
    assert.ok(DISPOSITIONS.includes(row.disposition as string), `${row.id}: disposition ${String(row.disposition)}`);
  }
});

test('every row states a rationale; intentionally-not-copied and outside-floor rows always do', () => {
  for (const row of rows) assert.ok(nonEmpty(row.rationale), `${row.id}: rationale`);
  const needReason = rows.filter((row) => row.disposition === 'intentionally-not-copied' || row.disposition === 'outside-floor');
  for (const row of needReason) assert.ok(nonEmpty(row.rationale), `${row.id}: reason`);
});

test('references are well formed, unique within a row, and point at existing repository files and KoSIT fixtures', () => {
  for (const row of rows) {
    for (const field of ['decisionRefs', 'implementationEvidence', 'validatorEvidence'] as const) {
      const values = row[field];
      assert.ok(stringList(values), `${row.id}: ${field} is a list of strings`);
      assert.equal(new Set(values).size, values.length, `${row.id}: ${field} has no duplicates`);
    }
    for (const ref of row.decisionRefs as string[]) assert.match(ref, /^MDR-[1-9]\d*$/, `${row.id}: ${ref}`);
    for (const path of row.implementationEvidence as string[]) {
      assert.ok(!path.startsWith('/') && !path.includes('..') && !path.startsWith('.cache'), `${row.id}: ${path} is a repository path`);
      assert.ok(existsSync(new URL(path, root)), `${row.id}: ${path} exists`);
    }
    for (const name of row.validatorEvidence as string[]) {
      assert.ok(existsSync(new URL(`tests/fixtures/xrechnung/${name}.json`, root)), `${row.id}: fixture ${name} exists`);
    }
  }
});
