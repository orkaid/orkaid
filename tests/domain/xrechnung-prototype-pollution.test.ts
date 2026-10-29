import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { calculateInvoiceTotals } from '../../src/lib/domain/xrechnung/invoice.ts';
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

function built(input: JsonObject, options?: { notation: 'de' }): Invoice {
  const result = buildInvoice(input, options);
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

// ------------------------------------------------------------------------------------------------ inherited options and array indices

// A missing caller option and an absent array element are never supplied by the prototype chain either: neither an
// inherited Object.prototype.notation nor an inherited Array.prototype[index] may become a caller-provided fact.

function pollutedIndex<T>(index: number, value: unknown, body: () => T): T {
  const prototype = Array.prototype as unknown as Record<number, unknown>;
  assert.equal(Object.hasOwn(prototype, index), false, `Array.prototype[${index}] already exists`);
  try {
    prototype[index] = value;
    return body();
  } finally {
    delete prototype[index];
  }
}

// One line, 2 x 1.500 at 19 %. Canonical (the default): net 3.00, VAT 0.57, due 3.57. German notation reads "1.500"
// as 1500: net 3000.00, VAT 570.00, due 3570.00.
function groupedPriceInput(kind: '380' | '381'): JsonObject {
  const input = KINDS.find((entry) => entry.kind === kind)?.input() ?? assert.fail(kind);
  const [line] = input.lines as JsonObject[];
  input.lines = [{ ...line, quantity: '2', unitPrice: '1.500' }];
  return input;
}

const amountDue = (input: JsonObject, options?: { notation: 'de' }) => {
  const invoice = built(input, options);
  return `${invoice.totals.amountDue.units}/${invoice.totals.amountDue.scale}`;
};

test('an inherited Object.prototype.notation does not change how amounts are read, on a 380 or a 381', () => {
  for (const kind of ['380', '381'] as const) {
    assert.equal(amountDue(groupedPriceInput(kind)), '357/2', `${kind} unpolluted`);
    assert.equal(polluted(['notation'], 'de', () => amountDue(groupedPriceInput(kind))), '357/2', `${kind}: inherited notation changed the amount`);
    const line = { quantity: '2', unitPrice: '1.500', vat: { treatment: 'standard', category: 'S', rate: '19' } };
    const totals = polluted(['notation'], 'de', () => calculateInvoiceTotals({ documentTypeCode: kind, currency: 'EUR', lines: [line] }));
    assert.equal(totals.ok && `${totals.value.amountDue.units}/${totals.value.amountDue.scale}`, '357/2', `${kind}: calculateInvoiceTotals read an inherited notation`);
  }
});

test('an inherited unknown Object.prototype.notation is not read as the caller\'s choice', () => {
  polluted(['notation'], 'xx', () => {
    for (const { kind, input } of KINDS) assert.equal(buildInvoice(input()).ok, true, kind);
  });
});

test('an own notation option still applies, also while Object.prototype.notation is polluted', () => {
  for (const kind of ['380', '381'] as const) {
    assert.equal(amountDue(groupedPriceInput(kind), { notation: 'de' }), '357000/2', kind);
    assert.equal(polluted(['notation'], 'en', () => amountDue(groupedPriceInput(kind), { notation: 'de' })), '357000/2', `${kind} under pollution`);
  }
});

const errorList = (result: ReturnType<typeof buildInvoice>) => (result.ok ? ['accepted'] : result.errors.map((e) => `${e.code}@${e.path}`));

test('a hole in notes, seller identifiers or lines is not filled from Array.prototype', () => {
  const cases = [
    { field: 'notes', inherited: { text: 'INHERITED' }, set: (input: JsonObject) => { input.notes = [, { text: 'own' }]; } },
    { field: 'seller.sellerIdentifiers', inherited: 'INHERITED', set: (input: JsonObject) => { (input.seller as JsonObject).sellerIdentifiers = [, 'OWN']; } },
    { field: 'lines', inherited: (loadFixtureInput('a-simple').lines as JsonObject[])[0], set: (input: JsonObject) => { input.lines = [, (input.lines as JsonObject[])[1]]; } },
  ];
  for (const { kind, input } of KINDS) {
    for (const { field, inherited, set } of cases) {
      const sparse = () => { const value = input(); set(value); return value; };
      const expected = errorList(buildInvoice(sparse()));
      assert.notDeepEqual(expected, ['accepted'], `${kind} ${field}: a hole must be rejected`);
      assert.deepEqual(pollutedIndex(0, inherited, () => errorList(buildInvoice(sparse()))), expected, `${kind} ${field}: hole filled from Array.prototype[0]`);
    }
  }
});

test('dense arrays are read unchanged while Array.prototype is polluted', () => {
  const input = () => ({ ...loadFixtureInput('j-invoice-notes-multiline') });
  const reference = built(input());
  pollutedIndex(5, { text: 'INHERITED' }, () => {
    const invoice = built(input());
    assert.deepEqual(invoice.notes, reference.notes);
    for (const { serialize } of SERIALIZERS) assert.equal(xml(serialize, invoice), xml(serialize, reference));
  });
});
