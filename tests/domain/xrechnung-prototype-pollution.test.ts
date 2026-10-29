import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, type JsonObject } from '../support/fixtures.ts';

// IR35-01 and IR36-01: a property inherited through the prototype chain is never a caller-supplied or validated fact.
// Neither the clearing confirmation (MDR-35) nor an optional field such as BT-11/12/13 (MDR-36) may come from
// Object.prototype, before validation or after it. Every pollution is removed in a finally block, also when an assertion fails.

const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
const POLLUTION = 'UNVALIDATED\u0000REFERENCE';
const REFERENCES = ['projectReference', 'contractReference', 'orderReference'] as const;
// Every optional field the serializers read, at any level of the validated document.
const OPTIONAL_FIELDS = [
  ...REFERENCES, 'dueDate', 'termsText', 'issueDate', 'name', 'bic', 'legalRegistrationId', 'vatId', 'taxRegistrationId', 'additionalLegalInformation',
] as const;
// a-simple (380) and t-credit-note-full-reversal (381) supply none of BT-11/12/13.
const KINDS = [
  { kind: '380', input: () => loadFixtureInput('a-simple') },
  { kind: '381', input: () => loadFixtureInput('t-credit-note-full-reversal') },
] as const;
const SERIALIZERS = [
  { syntax: 'UBL', serialize: serializeUblInvoice },
  { syntax: 'CII', serialize: serializeCiiInvoice },
] as const;

function polluted<T>(keys: readonly string[], value: unknown, body: () => T): T {
  const prototype = Object.prototype as Record<string, unknown>;
  for (const key of keys) assert.equal(Object.hasOwn(prototype, key), false, `Object.prototype.${key} already exists`);
  try {
    for (const key of keys) prototype[key] = value;
    return body();
  } finally {
    for (const key of keys) delete prototype[key];
  }
}

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  assert.equal(result.ok, true, show(result));
  return result.ok ? result.value : assert.fail('unreachable');
}

function xml(serialize: (invoice: Invoice) => { ok: true; xml: string } | { ok: false }, invoice: Invoice): string {
  const result = serialize(invoice);
  return result.ok ? result.xml : assert.fail('serialization failed');
}

// ------------------------------------------------------------------------------------------------ IR35-01

const withoutConfirmation = () => withoutValue(loadFixtureInput('t-credit-note-full-reversal'), 'payment.settlement.reciprocalObligationConfirmed');

test('IR35-01: an inherited Object.prototype confirmation does not confirm clearing', () => {
  const result = polluted(['reciprocalObligationConfirmed'], true, () => buildInvoice(withoutConfirmation()));
  assert.equal(result.ok, false, 'clearing accepted from an inherited confirmation');
  assert.deepEqual(result.ok ? [] : result.errors.map((e) => `${e.code}@${e.path}`), ['missing_clearing_confirmation@payment.settlement.reciprocalObligationConfirmed']);
});

test('IR35-01: a confirmation inherited from the settlement object\'s own prototype does not confirm clearing', () => {
  const input = withoutConfirmation();
  const settlement = Object.create({ reciprocalObligationConfirmed: true }) as Record<string, unknown>;
  settlement.kind = 'clearing';
  (input.payment as Record<string, unknown>).settlement = settlement;
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'clearing accepted from an inherited confirmation');
  assert.deepEqual(result.ok ? [] : result.errors.map((e) => `${e.code}@${e.path}`), ['missing_clearing_confirmation@payment.settlement.reciprocalObligationConfirmed']);
});

test('IR35-01: an explicit own true still confirms clearing, also while Object.prototype is polluted', () => {
  const plain = built(loadFixtureInput('t-credit-note-full-reversal'));
  const underPollution = polluted(['reciprocalObligationConfirmed'], false, () => built(loadFixtureInput('t-credit-note-full-reversal')));
  for (const invoice of [plain, underPollution]) {
    assert.equal(invoice.documentTypeCode, '381');
    assert.deepEqual(invoice.documentTypeCode === '381' ? invoice.payment.settlement : undefined, { kind: 'clearing' });
  }
});

// ------------------------------------------------------------------------------------------------ IR36-01

test('IR36-01: a reference polluted after validation is not emitted by either serializer, on a 380 or a 381', () => {
  for (const { kind, input } of KINDS) {
    const invoice = built(input());
    for (const { syntax, serialize } of SERIALIZERS) {
      const expected = xml(serialize, invoice);
      for (const field of REFERENCES) {
        const actual = polluted([field], POLLUTION, () => xml(serialize, invoice));
        assert.equal(actual.includes('UNVALIDATED'), false, `${kind} ${syntax} emitted an inherited ${field}`);
        assert.equal(actual, expected, `${kind} ${syntax} output changed by an inherited ${field}`);
      }
    }
  }
});

test('IR36-01: no optional field of the validated document can be supplied by Object.prototype after validation', () => {
  for (const { kind, input } of KINDS) {
    const invoice = built(input());
    for (const { syntax, serialize } of SERIALIZERS) {
      const expected = xml(serialize, invoice);
      const actual = polluted(OPTIONAL_FIELDS, POLLUTION, () => xml(serialize, invoice));
      assert.equal(actual, expected, `${kind} ${syntax} output changed by inherited optional fields`);
    }
  }
});

test('IR36-01: a reference polluted before validation is not injected into the model or the XML', () => {
  for (const { kind, input } of KINDS) {
    const reference = built(input());
    for (const field of REFERENCES) {
      polluted([field], POLLUTION, () => {
        const invoice = built(input());
        assert.equal(Object.hasOwn(invoice, field), false, `${kind}: inherited ${field} entered the model`);
        for (const { syntax, serialize } of SERIALIZERS) {
          assert.equal(xml(serialize, invoice), xml(serialize, reference), `${kind} ${syntax}: inherited ${field} changed the output`);
        }
      });
    }
  }
});

test('IR36-01: no optional field can be supplied by Object.prototype before validation', () => {
  for (const { kind, input } of KINDS) {
    const reference = built(input());
    polluted(OPTIONAL_FIELDS, POLLUTION, () => {
      const invoice = built(input());
      for (const { syntax, serialize } of SERIALIZERS) {
        assert.equal(xml(serialize, invoice), xml(serialize, reference), `${kind} ${syntax}: inherited optional fields changed the output`);
      }
    });
  }
});

test('an own, validated reference is still emitted unchanged', () => {
  const invoice = built(loadFixtureInput('x-references-all-three'));
  for (const { serialize } of SERIALIZERS) {
    const actual = polluted(REFERENCES, POLLUTION, () => xml(serialize, invoice));
    assert.equal(actual, xml(serialize, invoice));
    assert.equal(actual.includes('PRJ-2026-77') && actual.includes('VT-2026/12') && actual.includes('PO-4711'), true);
  }
});
