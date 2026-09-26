// SHA-256 manifest of the preregistered CII experiment package (tests/fixtures/xrechnung/cii-experiment).
//
//   node tools/cii-experiment/manifest.ts           # check: the committed MANIFEST.json matches the files
//   node tools/cii-experiment/manifest.ts --write   # regenerate MANIFEST.json
//
// `files` are the preregistration artifacts; they are checked byte for byte by the test suite. `recorded` holds the
// identities the future experiment run compares against (runtime, lockfile, the code under test, KoSIT tooling);
// they are written here but not enforced by the test suite, so ordinary development is not frozen by them.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const PACKAGE = 'tests/fixtures/xrechnung/cii-experiment';
export const MANIFEST_PATH = `${PACKAGE}/MANIFEST.json`;

// Preregistration artifacts outside the package directory: the baseline fixtures it references and the tools that
// generate or check its derived files.
const REFERENCED = [
  'tests/fixtures/xrechnung/a-simple.json',
  'tests/fixtures/xrechnung/b-ten-lines.json',
  'tests/fixtures/xrechnung/c-rounded-line-net.json',
  'tests/fixtures/xrechnung/d-mixed-rates.json',
  'tools/cii-experiment/manifest.ts',
  'tools/kosit/kosit-manifest.json',
  'tools/kosit/rule-inventory.ts',
];

const RECORDED = [
  '.node-version',
  'package-lock.json',
  'src/lib/domain/xrechnung/decimal.ts',
  'src/lib/domain/xrechnung/document.ts',
  'src/lib/domain/xrechnung/invoice.ts',
  'src/lib/domain/xrechnung/number-notation.ts',
  'src/lib/domain/xrechnung/ubl.ts',
];

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function entry(path: string): { path: string; bytes: number; sha256: string } {
  const data = readFileSync(join(ROOT, path));
  return { path, bytes: data.length, sha256: sha256(data) };
}

export function buildManifest(): string {
  const packaged = readdirSync(join(ROOT, PACKAGE)).map((name) => `${PACKAGE}/${name}`).filter((path) => path !== MANIFEST_PATH);
  const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const kosit = JSON.parse(readFileSync(join(ROOT, 'tools/kosit/kosit-manifest.json'), 'utf8')) as {
    bundle: { file: string; sha256: string };
    validator: { version: string; sha256: string };
    configuration: { version: string; sha256: string };
  };
  const manifest = {
    purpose: 'Preregistration manifest of the Increment 3 CII experiment. See PROTOCOL.md section 12.',
    algorithm: 'sha256',
    files: [...packaged, ...REFERENCED].sort(byPath).map(entry),
    recorded: {
      node: readFileSync(join(ROOT, '.node-version'), 'utf8').trim(),
      kosit: {
        bundle: kosit.bundle.file,
        bundleSha256: kosit.bundle.sha256,
        validatorVersion: kosit.validator.version,
        validatorJarSha256: kosit.validator.sha256,
        configurationVersion: kosit.configuration.version,
        configurationSha256: kosit.configuration.sha256,
      },
      files: [...RECORDED].sort(byPath).map(entry),
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (import.meta.main) {
  const generated = buildManifest();
  if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, MANIFEST_PATH), generated);
    console.log(`written ${MANIFEST_PATH} (sha256 ${sha256(generated)})`);
  } else if (readFileSync(join(ROOT, MANIFEST_PATH), 'utf8') !== generated) {
    console.error(`${MANIFEST_PATH} does not match the package`);
    process.exit(1);
  } else {
    console.log(`${MANIFEST_PATH} matches (sha256 ${sha256(generated)})`);
  }
}
