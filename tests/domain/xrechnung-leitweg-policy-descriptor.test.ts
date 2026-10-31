import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { loadFixtureInput } from '../support/fixtures.ts';

// IR38-01: buyerReferencePolicy is read through Object.getOwnPropertyDescriptor. The descriptor is an ordinary object, so a
// `value` planted on Object.prototype (or an inherited `value` getter) must not be taken for the descriptor's own data. Each
// scenario runs in a child process: it mutates Object.prototype with an accessor, which must never reach the test runner.

const DOCUMENT = new URL('../../src/lib/domain/xrechnung/document.ts', import.meta.url).href;

// Runs in the child. Plants `value` on Object.prototype as the scenario says, then builds with options whose own
// buyerReferencePolicy is an accessor, counting every getter that runs. Prints one JSON line.
const CHILD = `
import { buildInvoice } from ${JSON.stringify(DOCUMENT)};
const [scenario, optionsKind] = process.argv.slice(1);
const input = JSON.parse(process.env.LEITWEG_INPUT);
const counts = { ownPolicyGetter: 0, inheritedValueGetter: 0 };
// The options exist before the prototype is touched: defineProperty itself reads an inherited value.
const options = optionsKind === 'null-prototype' ? Object.create(null) : {};
Object.defineProperty(options, 'buyerReferencePolicy', { enumerable: true, get() { counts.ownPolicyGetter += 1; return 'leitweg-id'; } });
if (scenario === 'inherited-undefined') Object.defineProperty(Object.prototype, 'value', { value: undefined, writable: true, configurable: true });
else if (scenario === 'inherited-leitweg') Object.defineProperty(Object.prototype, 'value', { value: 'leitweg-id', writable: true, configurable: true });
else if (scenario === 'inherited-throwing-getter') Object.defineProperty(Object.prototype, 'value', { get() { counts.inheritedValueGetter += 1; throw new Error('inherited value getter ran'); }, configurable: true });
else if (scenario !== 'none') throw new Error('unknown scenario');
let outcome;
try {
  const result = buildInvoice(input, options);
  outcome = { returned: true, ok: result.ok };
} catch (error) {
  outcome = { threw: true, name: error?.constructor?.name, message: String(error?.message) };
}
delete Object.prototype.value; // restored before any output: a planted value breaks the stream internals
console.log(JSON.stringify({ outcome, counts }));
`;

type ChildReport = { outcome: { returned?: true; ok?: boolean; threw?: true; name?: string; message?: string }; counts: { ownPolicyGetter: number; inheritedValueGetter: number } };

function runChild(scenario: string, optionsKind: string, input: unknown): ChildReport {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, scenario, optionsKind], {
    encoding: 'utf8',
    env: { ...process.env, LEITWEG_INPUT: JSON.stringify(input) },
  });
  assert.equal(run.status, 0, `${scenario}/${optionsKind}: ${run.stderr}`);
  return JSON.parse(run.stdout) as ChildReport;
}

const KINDS = [
  { kind: '380', input: () => loadFixtureInput('a-simple') },
  { kind: '381', input: () => loadFixtureInput('t-credit-note-full-reversal') },
] as const;
const SCENARIOS = ['none', 'inherited-undefined', 'inherited-leitweg', 'inherited-throwing-getter'] as const;

test('an own accessor policy is rejected with RangeError, whatever an inherited `value` says, and no getter runs', () => {
  for (const { kind, input } of KINDS) {
    for (const optionsKind of ['plain', 'null-prototype']) {
      for (const scenario of SCENARIOS) {
        const report = runChild(scenario, optionsKind, input());
        const label = `${kind} ${optionsKind} ${scenario}`;
        assert.deepEqual(report.outcome, { threw: true, name: 'RangeError', message: 'buyerReferencePolicy must be a data property, not an accessor' }, label);
        assert.deepEqual(report.counts, { ownPolicyGetter: 0, inheritedValueGetter: 0 }, label);
      }
    }
  }
});

// The other half of the contract, in the parent: nothing here plants anything on Object.prototype.
const withOptions = (kind: (typeof KINDS)[number], buyerReference: string, options: object) =>
  buildInvoice({ ...kind.input(), buyerReference }, options);
const codes = (result: ReturnType<typeof buildInvoice>) => (result.ok ? [] : result.errors.map((e) => `${e.code}@${e.path}`));

test('the descriptor fix keeps the other policy semantics on a 380 and a 381', () => {
  for (const kind of KINDS) {
    // An own data policy still activates the mode; a null-prototype options object works the same.
    assert.deepEqual(codes(withOptions(kind, 'PO-1', { buyerReferencePolicy: 'leitweg-id' })), ['invalid_leitweg_id_format@buyerReference'], kind.kind);
    const nullPrototype = Object.assign(Object.create(null), { buyerReferencePolicy: 'leitweg-id' });
    assert.deepEqual(codes(withOptions(kind, 'PO-1', nullPrototype)), ['invalid_leitweg_id_format@buyerReference'], kind.kind);
    assert.equal(withOptions(kind, '04-86', { buyerReferencePolicy: 'leitweg-id' }).ok, true, kind.kind);
    // Explicit own undefined and an absent policy leave the mode off.
    assert.equal(withOptions(kind, 'PO-1', { buyerReferencePolicy: undefined }).ok, true, kind.kind);
    assert.equal(withOptions(kind, 'PO-1', {}).ok, true, kind.kind);
    // A policy inherited from the options' own prototype does not activate it.
    assert.equal(withOptions(kind, 'PO-1', Object.create({ buyerReferencePolicy: 'leitweg-id' })).ok, true, kind.kind);
    // Unknown own values still fail visibly.
    for (const value of ['LEITWEG-ID', '', null, 1, {}]) {
      assert.throws(() => withOptions(kind, 'PO-1', { buyerReferencePolicy: value }), RangeError, `${kind.kind} ${String(value)}`);
    }
  }
});

// An inherited buyerReferencePolicy planted on Object.prototype, in a child so the runner is untouched.
test('an inherited buyerReferencePolicy on Object.prototype does not activate the mode (isolated process)', () => {
  const script = `
    import { buildInvoice } from ${JSON.stringify(DOCUMENT)};
    Object.defineProperty(Object.prototype, 'buyerReferencePolicy', { value: 'leitweg-id', writable: true, configurable: true });
    const input = JSON.parse(process.env.LEITWEG_INPUT);
    console.log(JSON.stringify([buildInvoice(input, {}).ok, buildInvoice(input, Object.create(null)).ok]));
  `;
  for (const { kind, input } of KINDS) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, LEITWEG_INPUT: JSON.stringify({ ...input(), buyerReference: 'PO-1' }) } });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), [true, true], kind);
  }
});
