// SHA-256 manifest of the semantic-audit policy: profile, source map, both corpora, protocol and the tooling that
// applies them. The runner refuses to run unless the committed manifest matches, and the test suite checks it, so a
// change to any policy file is a visible manifest change. It detects changes; it does not prevent them.
//
//   node tools/semantic-audit/manifest.ts           # check
//   node tools/semantic-audit/manifest.ts --write   # regenerate (a deliberate, reviewable policy change)
//
// The audited governance documents are not listed: they are the target, and they change independently.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_ROOT = resolve(import.meta.dirname, '../..');
export const MANIFEST_PATH = 'tests/fixtures/semantic-audit/MANIFEST.json';

export const POLICY_FILES = [
  'tests/fixtures/semantic-audit/PROTOCOL.md',
  'tests/fixtures/semantic-audit/calibration/cases.json',
  'tests/fixtures/semantic-audit/holdout/cases.json',
  'tests/fixtures/semantic-audit/holdout/owner-cases.json',
  'tools/semantic-audit/extract-governance.ts',
  'tools/semantic-audit/governance/SOURCE_MAP.md',
  'tools/semantic-audit/governance/sources.json',
  'tools/semantic-audit/manifest.ts',
  'tools/semantic-audit/policy.ts',
  'tools/semantic-audit/profiles/governance-phase1.json',
  'tools/semantic-audit/run.ts',
] as const;

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

export function buildManifest(root = DEFAULT_ROOT): string {
  const files = POLICY_FILES.map((path) => {
    const data = readFileSync(join(root, path));
    return { path, bytes: data.length, sha256: sha256(data) };
  });
  return `${JSON.stringify({ purpose: 'Semantic-audit policy manifest. See tests/fixtures/semantic-audit/PROTOCOL.md.', algorithm: 'sha256', files }, null, 2)}\n`;
}

if (import.meta.main) {
  const generated = buildManifest();
  if (process.argv.includes('--write')) {
    writeFileSync(join(DEFAULT_ROOT, MANIFEST_PATH), generated);
    console.log(`written ${MANIFEST_PATH} (sha256 ${sha256(generated)})`);
  } else if (readFileSync(join(DEFAULT_ROOT, MANIFEST_PATH), 'utf8') !== generated) {
    console.error(`${MANIFEST_PATH} does not match the policy files`);
    process.exit(1);
  } else {
    console.log(`${MANIFEST_PATH} matches (sha256 ${sha256(generated)})`);
  }
}
