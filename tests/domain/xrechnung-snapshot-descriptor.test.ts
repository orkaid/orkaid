import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { loadFixtureInput } from '../support/fixtures.ts';

// IR38-03: snapshot() must tell an own accessor from an own data property with Object.hasOwn(descriptor, 'value'). A descriptor
// is an ordinary object, so `'value' in descriptor` also saw a `value` planted on Object.prototype. Each case runs in a child
// process: it mutates Object.prototype, which must never reach the test runner.

const DOCUMENT = new URL('../../src/lib/domain/xrechnung/document.ts', import.meta.url).href;

// Runs in the child: replaces one field with an enumerable own accessor (counting getter runs), plants Object.prototype.value
// as the scenario says, builds, prints one JSON line. The accessor exists before the pollution: defineProperty reads an inherited value.
const CHILD = `
import { buildInvoice } from ${JSON.stringify(DOCUMENT)};
const [scenario, fieldPath, rootKind, policy] = process.argv.slice(1);
const input = JSON.parse(process.env.INVOICE_INPUT);
const counts = { ownGetter: 0, inheritedGetter: 0 };
const keys = fieldPath.split('.').flatMap((part) => part.replace(/\\[(\\d+)\\]/g, '.$1').split('.'));
let holder = input;
for (const key of keys.slice(0, -1)) holder = holder[key];
const last = keys.at(-1);
delete holder[last];
Object.defineProperty(holder, last, { enumerable: true, configurable: true, get() { counts.ownGetter += 1; return '1000'; } });
const root = rootKind === 'null-prototype' ? Object.defineProperties(Object.create(null), Object.getOwnPropertyDescriptors(input)) : input; // Object.assign would run a top-level getter
if (scenario === 'inherited-undefined') Object.defineProperty(Object.prototype, 'value', { value: undefined, writable: true, configurable: true });
else if (scenario === 'inherited-1000') Object.defineProperty(Object.prototype, 'value', { value: '1000', writable: true, configurable: true });
else if (scenario === 'inherited-throwing-getter') Object.defineProperty(Object.prototype, 'value', { get() { counts.inheritedGetter += 1; throw new Error('inherited value getter ran'); }, configurable: true });
else if (scenario !== 'none') throw new Error('unknown scenario');
let outcome;
try {
  const result = buildInvoice(root, policy === 'leitweg' ? { buyerReferencePolicy: 'leitweg-id' } : {});
  outcome = result.ok ? { ok: true } : { ok: false, errors: result.errors.map((e) => e.code + '@' + e.path) };
} catch (error) {
  outcome = { threw: String(error?.message) };
}
delete Object.prototype.value; // restored before any output: a planted value breaks the stream internals
console.log(JSON.stringify({ outcome, counts }));
`;

type Report = { outcome: { ok?: boolean; errors?: string[]; threw?: string }; counts: { ownGetter: number; inheritedGetter: number } };

function runChild(scenario: string, fieldPath: string, rootKind: string, policy: string, input: unknown): Report {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, scenario, fieldPath, rootKind, policy], {
    encoding: 'utf8',
    env: { ...process.env, INVOICE_INPUT: JSON.stringify(input) },
  });
  assert.equal(run.status, 0, `${scenario} ${fieldPath}: ${run.stderr}`);
  return JSON.parse(run.stdout) as Report;
}

const KINDS = [
  { kind: '380', name: 'a-simple' },
  { kind: '381', name: 't-credit-note-full-reversal' },
] as const;
const SCENARIOS = ['none', 'inherited-undefined', 'inherited-1000', 'inherited-throwing-getter'] as const;
// Required line price, required number, optional date (must not turn into "absent"), and BT-10 with the Leitweg-ID mode on.
const FIELDS = [
  { path: 'lines[0].unitPrice', policy: 'off' },
  { path: 'invoiceNumber', policy: 'off' },
  { path: 'deliveryDate', policy: 'off' },
  { path: 'buyerReference', policy: 'leitweg' },
] as const;

test('an own accessor input field is rejected as invalid_type at its path, whatever an inherited `value` says, and no getter runs', () => {
  const mismatches: string[] = [];
  for (const { kind, name } of KINDS) {
    const input = loadFixtureInput(name) as Record<string, unknown>;
    for (const field of FIELDS) {
      if (field.path === 'deliveryDate' && !('deliveryDate' in input)) continue; // optional field absent from this fixture
      for (const rootKind of ['plain', 'null-prototype']) {
        for (const scenario of SCENARIOS) {
          const label = `${kind} ${field.path} ${rootKind} ${scenario}`;
          const report = runChild(scenario, field.path, rootKind, field.policy, input);
          const expected = { outcome: { ok: false, errors: [`invalid_type@${field.path}`] }, counts: { ownGetter: 0, inheritedGetter: 0 } };
          if (JSON.stringify(report) !== JSON.stringify(expected)) mismatches.push(`${label}: ${JSON.stringify(report)}`);
        }
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test('ordinary own data properties still build, on a 380 and a 381', () => {
  for (const { kind, name } of KINDS) {
    const input = loadFixtureInput(name);
    assert.equal(buildInvoice(input).ok, true, kind);
    assert.equal(buildInvoice(Object.assign(Object.create(null), input)).ok, true, `${kind} null-prototype`);
  }
});
