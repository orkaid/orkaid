import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { LEITWEG_FIXTURE_NAMES, loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { compareProjections, extractProjection } from '../support/projection.ts';
import { parseXml, textAt } from '../support/xml.ts';

// Leitweg-ID validation mode for BT-10 (MDR-38), on a 380 and on a 381.
//   OFFICIAL      Leitweg-ID Format-Spezifikation v2.0.2: Grob and check digits mandatory, Fein optional, "-" separator,
//                 total length 5-46, hyphens excluded from the checksum, letters case-insensitive.
//   DERIVED       allowed Grob lengths 2, 3, 5, 8, 9, 12 and "no empty Fein" (a reading of Table 1 and section 2.2.4).
//   PROFILE       the exact canonical check digits (98 - remainder); the specification's remainder-1 verification would
//                 also admit 00, 01 and 99.
// Every vector below was derived with an independent oracle (Python big integers, written from the MDR text), and the
// exhaustive checks use a second oracle (a streaming remainder, no BigInt), never the code under test.

const POLICY = { buyerReferencePolicy: 'leitweg-id' } as const;
const KINDS = [
  { kind: '380', input: () => loadFixtureInput('a-simple') },
  { kind: '381', input: () => loadFixtureInput('t-credit-note-full-reversal') },
] as const;
const FORMAT = 'invalid_leitweg_id_format@buyerReference';
const CHECKSUM = 'invalid_leitweg_id_checksum@buyerReference';

const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
const withReference = (input: JsonObject, value: unknown) => withValue(input, 'buyerReference', value);
const pairs = (input: unknown, options?: object): string[] => {
  const result = buildInvoice(input, options);
  return result.ok ? [] : result.errors.map((e) => `${e.code}@${e.path}`);
};
const accepted = (input: JsonObject, options: object = POLICY): Invoice => {
  const result = buildInvoice(input, options);
  assert.equal(result.ok, true, show(result));
  return result.ok ? result.value : assert.fail('unreachable');
};
const ublXml = (invoice: Invoice) => {
  const result = serializeUblInvoice(invoice);
  return result.ok ? result.xml : assert.fail('serialization failed');
};
const ciiXml = (invoice: Invoice) => {
  const result = serializeCiiInvoice(invoice);
  return result.ok ? result.xml : assert.fail('serialization failed');
};

// Second oracle: the remainder is carried digit by digit, so no integer wider than 97 * 10 + 9 is ever formed.
function oracleCheckDigits(body: string): string {
  let remainder = 0;
  for (const ch of `${[...body.toUpperCase()].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('')}00`) {
    remainder = (remainder * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  return String(98 - remainder).padStart(2, '0');
}
const leitweg = (grob: string, fein: string): string => `${grob}${fein === '' ? '' : `-${fein}`}-${oracleCheckDigits(grob + fein)}`;

// -------------------------------------------------------------------------------------------- positive vectors

const POSITIVE = [
  '04011000-1234512345-06', // the official example
  '04-86', // minimal: 2-digit Grob, no Fein
  '99-92',
  '123456789012-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-71', // maximum: 74 digits in the calculation, 46 characters
  '123456789012-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-71', // the same identifier in lowercase
  '123456789012-aZaZaZaZaZaZaZaZaZaZaZaZaZaZaZ-52', // mixed case
  '991234567-abc-80',
  '04011000-ABC123-36',
  '04011000-abc123-36',
  '04011000-AbC123-36',
  '04106-02', // canonical 02 (alias 99)
  '04139-97', // canonical 97 (alias 00)
  '04171-98', // canonical 98 (alias 01)
  '04-1-72', // a Fein of one digit; no "starts with a letter" rule is imposed
];

test('positive vectors are accepted on a 380 and on a 381, with the caller text unchanged', () => {
  for (const { kind, input } of KINDS) {
    for (const value of POSITIVE) {
      const invoice = accepted(withReference(input(), value));
      assert.equal(invoice.documentTypeCode, kind);
      assert.equal(invoice.buyerReference, value, `${kind} ${value}`);
    }
  }
});

test('the positive vectors agree with the independent oracle', () => {
  const body = (value: string) => value.slice(0, -3).replaceAll('-', '');
  for (const value of POSITIVE) assert.equal(value.slice(-2), oracleCheckDigits(body(value)), value);
});

test('every allowed Grob code 01-16 and 99 is accepted', () => {
  for (const code of [...Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(2, '0')), '99']) {
    for (const { input } of KINDS) accepted(withReference(input(), leitweg(code, '')));
  }
});

test('exhaustive: for each Grob length and Fein length exactly one of the 100 check-digit pairs is accepted', () => {
  const groblengths = [2, 3, 5, 8, 9, 12];
  const feins = ['', '1', 'a', 'Z9', 'x'.repeat(29), 'aB0'.repeat(10), 'Q'.repeat(30)];
  const input = loadFixtureInput('a-simple');
  for (const length of groblengths) {
    const grob = `04${'7'.repeat(length - 2)}`;
    for (const fein of feins) {
      const canonical = oracleCheckDigits(grob + fein);
      const base = `${grob}${fein === '' ? '' : `-${fein}`}`;
      let acceptedCount = 0;
      for (let digits = 0; digits < 100; digits += 1) {
        const pair = String(digits).padStart(2, '0');
        const outcome = pairs(withReference(input, `${base}-${pair}`), POLICY);
        if (outcome.length === 0) {
          acceptedCount += 1;
          assert.equal(pair, canonical, `${base}: accepted a non-canonical pair`);
        } else {
          assert.deepEqual(outcome, [CHECKSUM], `${base}-${pair}`);
        }
      }
      assert.equal(acceptedCount, 1, `${base}: canonical pair not accepted exactly once`);
    }
  }
});

// -------------------------------------------------------------------------------------------- checksum

test('an incorrect checksum is invalid_leitweg_id_checksum at buyerReference, on both kinds', () => {
  for (const { input } of KINDS) {
    assert.deepEqual(pairs(withReference(input(), '04011000-1234512345-07'), POLICY), [CHECKSUM]);
    assert.deepEqual(pairs(withReference(input(), '04-87'), POLICY), [CHECKSUM]);
    assert.deepEqual(pairs(withReference(input(), '123456789012-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-72'), POLICY), [CHECKSUM]);
  }
});

test('the noncanonical check-digit aliases 00, 01 and 99 are rejected as checksum errors', () => {
  for (const { input } of KINDS) {
    for (const alias of ['04139-00', '04171-01', '04106-99']) {
      assert.deepEqual(pairs(withReference(input(), alias), POLICY), [CHECKSUM], alias);
    }
  }
});

// -------------------------------------------------------------------------------------------- structure

const MALFORMED: [string, string][] = [
  ['no separators at all', '04011000123451234506'],
  ['no hyphen before the check digits', '04011000-123451234506'],
  ['missing check-digit segment', '04011000-1234512345'],
  ['one check digit', '04-8'],
  ['three check digits', '04-860'],
  ['letter as check digit', '04-8A'],
  ['empty Fein', '04011000--06'],
  ['leading hyphen', '-04-86'],
  ['trailing hyphen', '04-86-'],
  ['extra separator inside the Fein', '04011000-12345-12345-06'],
  ['underscore separator', '04011000_1234512345_06'],
  ['space as separator', '04011000 1234512345 06'],
  ['a letter in the Grob', '04A-86'],
  ['Grob length 1', '4-86'],
  ['Grob length 4', '0401-86'],
  ['Grob length 6', '040110-86'],
  ['Grob length 7', '0401100-86'],
  ['Grob length 10', '0401100012-86'],
  ['Grob length 11', '04011000123-86'],
  ['Grob length 13', '0401100012345-86'],
  ['code 00', '00-86'],
  ['code 17', '17-86'],
  ['code 20', '20-86'],
  ['code 98', '98-86'],
  ['Fein with 31 characters', `04011000-${'A'.repeat(31)}-00`],
  ['Fein with a punctuation character', '04011000-ABC.12-00'],
  ['en dash (U+2013) as separator', '04011000–1234512345–06'],
  ['non-breaking hyphen (U+2011)', '04011000‑1234512345‑06'],
  ['minus sign (U+2212)', '04−86'],
  ['hyphen-minus lookalike in the final separator only', '04011000-1234512345‐06'],
  ['full-width digits in the Grob', '０４-86'],
  ['full-width digits in the check digits', '04-８６'],
  ['Arabic-Indic digits in the Fein', '04011000-١٢-00'],
  ['a non-ASCII letter in the Fein', '04011000-ÄBC-00'],
  ['long s (U+017F), whose uppercase is S', '04011000-ſ-00'],
  ['Kelvin sign (U+212A), whose lowercase is k', '04011000-K-00'],
  ['dotless i (U+0131), whose uppercase is I', '04011000-ı-00'],
  ['too short overall', '04-8'],
  ['one more than the maximum length', `1234567890123-${'A'.repeat(30)}-00`],
];

test('structure violations are invalid_leitweg_id_format at buyerReference, never a checksum error, on both kinds', () => {
  for (const { kind, input } of KINDS) {
    for (const [label, value] of MALFORMED) {
      assert.deepEqual(pairs(withReference(input(), value), POLICY), [FORMAT], `${kind}: ${label}: ${JSON.stringify(value)}`);
    }
  }
});

test('structure is checked before the checksum: a malformed value with valid-looking digits reports only the format', () => {
  assert.deepEqual(pairs(withReference(loadFixtureInput('a-simple'), `17-${oracleCheckDigits('17')}`), POLICY), [FORMAT]);
});

test('a total length of 46 is the maximum and 5 the minimum', () => {
  assert.equal('123456789012-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-71'.length, 46);
  assert.equal('04-86'.length, 5);
  assert.equal(accepted(withReference(loadFixtureInput('a-simple'), '04-86')).buyerReference, '04-86');
});

test('the documented limit: a hyphen moved between Grob and Fein that still forms a valid composition is not detected', () => {
  // The checksum ignores hyphens, so only the Grob composition rule can notice a shifted hyphen (MDR-38).
  const body = '04011000123';
  const check = oracleCheckDigits(body);
  assert.equal(pairs(withReference(loadFixtureInput('a-simple'), `04011000-123-${check}`), POLICY).length, 0);
  assert.equal(pairs(withReference(loadFixtureInput('a-simple'), `040110001-23-${check}`), POLICY).length, 0);
  assert.deepEqual(pairs(withReference(loadFixtureInput('a-simple'), `0401100-0123-${check}`), POLICY), [FORMAT]);
});

// -------------------------------------------------------------------------------------------- BT-10 text rules come first

test('the existing BT-10 text diagnostics are unchanged and precede the Leitweg-ID checks', () => {
  for (const { input } of KINDS) {
    const cases: [unknown, string][] = [
      ['', 'empty_text@buyerReference'],
      ['   ', 'empty_text@buyerReference'],
      [42, 'invalid_type@buyerReference'],
      [null, 'invalid_type@buyerReference'],
      [' 04-86', 'invalid_text@buyerReference'],
      ['04-86 ', 'invalid_text@buyerReference'],
      ['04-86\n', 'invalid_text@buyerReference'],
      ['04\u0000-86', 'invalid_text@buyerReference'],
      ['0'.repeat(513), 'text_too_long@buyerReference'],
    ];
    for (const [value, expected] of cases) {
      assert.deepEqual(pairs(withReference(input(), value), POLICY), [expected], JSON.stringify(value));
      assert.deepEqual(pairs(withReference(input(), value)), [expected], `${JSON.stringify(value)} with the mode off`);
    }
    assert.deepEqual(pairs(withoutValue(input(), 'buyerReference'), POLICY), ['missing_field@buyerReference']);
  }
});

test('with the mode on, Leitweg-ID errors join other document errors in the established order', () => {
  const input = withValue(withReference(loadFixtureInput('a-simple'), 'bad'), 'invoiceNumber', '');
  assert.deepEqual(pairs(input, POLICY), ['empty_text@invoiceNumber', FORMAT]);
});

// -------------------------------------------------------------------------------------------- mode off

test('with the mode off, ordinary and Leitweg-ID-like buyer references keep their existing behaviour', () => {
  for (const { input } of KINDS) {
    for (const value of ['PO-2026-0815', 'not a Leitweg-ID', '04-87', '04011000-1234512345-07', 'abc', '04-86']) {
      assert.equal(accepted(withReference(input(), value), {}).buyerReference, value);
      assert.equal(accepted(withReference(input(), value), { buyerReferencePolicy: undefined }).buyerReference, value);
      assert.equal(accepted(withReference(input(), value), { notation: 'canonical' }).buyerReference, value);
    }
  }
});

test('with the mode on, an ordinary buyer reference is rejected as a format error', () => {
  for (const { input } of KINDS) assert.deepEqual(pairs(withReference(input(), 'PO-2026-0815'), POLICY), [FORMAT]);
});

// -------------------------------------------------------------------------------------------- policy boundary and ownership

test('the policy composes with the notation option', () => {
  const invoice = accepted(withReference(loadFixtureInput('a-simple'), '04-86'), { buyerReferencePolicy: 'leitweg-id', notation: 'canonical' });
  assert.equal(invoice.buyerReference, '04-86');
});

test('an own policy value that is not exactly "leitweg-id" is rejected visibly, before any input is read', () => {
  const unknownValues: unknown[] = ['LEITWEG-ID', 'Leitweg-ID', 'leitweg', ' leitweg-id', 'leitweg-id ', '', 'off', null, 0, 1, true, false, {}, [], ['leitweg-id'], () => 'leitweg-id', Symbol('leitweg-id'), 10n];
  for (const value of unknownValues) {
    for (const input of [loadFixtureInput('a-simple'), 'not an object']) {
      assert.throws(() => buildInvoice(input, { buyerReferencePolicy: value } as never), RangeError, String(typeof value));
    }
  }
});

test('an own undefined policy is the same as no policy', () => {
  const input = withReference(loadFixtureInput('a-simple'), 'PO-1');
  assert.equal(accepted(input, { buyerReferencePolicy: undefined }).buyerReference, 'PO-1');
});

test('an own accessor policy is never executed and is rejected visibly', () => {
  let reads = 0;
  const options = {};
  Object.defineProperty(options, 'buyerReferencePolicy', { enumerable: true, get: () => { reads += 1; return 'leitweg-id'; } });
  assert.throws(() => buildInvoice(loadFixtureInput('a-simple'), options), RangeError);
  assert.equal(reads, 0, 'the getter ran');
});

function polluted<T>(value: unknown, body: () => T): T {
  const prototype = Object.prototype as Record<string, unknown>;
  assert.equal(Object.hasOwn(prototype, 'buyerReferencePolicy'), false, 'Object.prototype.buyerReferencePolicy already exists');
  try {
    prototype.buyerReferencePolicy = value;
    return body();
  } finally {
    delete prototype.buyerReferencePolicy;
  }
}

test('a policy planted on Object.prototype does not activate the mode, on a 380 or a 381', () => {
  for (const { input } of KINDS) {
    const ordinary = withReference(input(), 'PO-2026-0815');
    assert.equal(polluted('leitweg-id', () => accepted(ordinary, {}).buyerReference), 'PO-2026-0815');
    assert.equal(polluted('leitweg-id', () => accepted(ordinary, { notation: 'canonical' }).buyerReference), 'PO-2026-0815');
    assert.equal(polluted('leitweg-id', () => accepted(ordinary, Object.create(null)).buyerReference), 'PO-2026-0815');
  }
});

test('an inherited unknown policy value is not read as the caller\'s choice and does not throw', () => {
  assert.equal(polluted('nonsense', () => accepted(withReference(loadFixtureInput('a-simple'), 'PO-1'), {}).buyerReference), 'PO-1');
});

test('an inherited getter planted on Object.prototype never runs and does not select the mode', () => {
  const prototype = Object.prototype;
  let reads = 0;
  assert.equal(Object.hasOwn(prototype, 'buyerReferencePolicy'), false);
  Object.defineProperty(prototype, 'buyerReferencePolicy', { configurable: true, get: () => { reads += 1; return 'leitweg-id'; } });
  try {
    assert.equal(accepted(withReference(loadFixtureInput('a-simple'), 'PO-1'), {}).buyerReference, 'PO-1');
    assert.equal(accepted(withReference(loadFixtureInput('a-simple'), 'PO-1'), { notation: 'canonical' }).buyerReference, 'PO-1');
  } finally {
    delete (prototype as Record<string, unknown>).buyerReferencePolicy;
  }
  assert.equal(reads, 0, 'the inherited getter ran');
});

test('an options object that inherits the policy from its own prototype does not activate the mode', () => {
  const options = Object.create(POLICY) as object;
  assert.equal(accepted(withReference(loadFixtureInput('a-simple'), 'PO-1'), options).buyerReference, 'PO-1');
});

test('an own policy still applies while Object.prototype is polluted with another value', () => {
  assert.deepEqual(polluted('nonsense', () => pairs(withReference(loadFixtureInput('a-simple'), 'PO-1'), POLICY)), [FORMAT]);
});

test('buyerReference values planted on Object.prototype are not read as BT-10 under the mode', () => {
  const prototype = Object.prototype as Record<string, unknown>;
  const input = withoutValue(loadFixtureInput('a-simple'), 'buyerReference');
  try {
    prototype.buyerReference = '04-86';
    assert.deepEqual(pairs(input, POLICY), ['missing_field@buyerReference']);
  } finally {
    delete prototype.buyerReference;
  }
});

test('the policy is not a document field: it is refused as an unknown field and never stored', () => {
  for (const { input } of KINDS) {
    assert.deepEqual(pairs(withValue(withReference(input(), '04-86'), 'buyerReferencePolicy', 'leitweg-id'), POLICY), ['unknown_field@buyerReferencePolicy']);
    assert.deepEqual(pairs(withValue(input(), 'buyerReferencePolicy', 'leitweg-id')), ['unknown_field@buyerReferencePolicy']);
    const on = accepted(withReference(input(), '04-86'));
    const off = accepted(withReference(input(), '04-86'), {});
    assert.deepEqual(Object.keys(on).sort(), Object.keys(off).sort());
    assert.equal(Object.hasOwn(on, 'buyerReferencePolicy'), false);
  }
});

// -------------------------------------------------------------------------------------------- 380 and 381 identity

test('the policy gives identical verdicts on a 380 and on a 381', () => {
  const [invoice, creditNote] = KINDS;
  for (const value of [...POSITIVE, ...MALFORMED.map(([, v]) => v), '04-87', '04139-00', 'PO-1']) {
    assert.deepEqual(pairs(withReference(invoice.input(), value), POLICY), pairs(withReference(creditNote.input(), value), POLICY), JSON.stringify(value));
  }
});

// -------------------------------------------------------------------------------------------- serialization

test('UBL and CII carry the exact caller text, and the mode changes no serializer output', () => {
  for (const { kind, input } of KINDS) {
    for (const value of ['04011000-1234512345-06', '991234567-abc-80', '123456789012-aZaZaZaZaZaZaZaZaZaZaZaZaZaZaZ-52']) {
      const on = accepted(withReference(input(), value));
      const off = accepted(withReference(input(), value), {});
      assert.equal(ublXml(on), ublXml(off), `${kind} UBL ${value}`);
      assert.equal(ciiXml(on), ciiXml(off), `${kind} CII ${value}`);
      assert.equal(textAt(parseXml(ublXml(on)), 'cbc:BuyerReference'), value);
      assert.equal(textAt(parseXml(ciiXml(on)), 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerReference'), value);
    }
  }
});

test('BT-11, BT-12, BT-13 and the electronic address scheme 0204 stay independent of the mode', () => {
  const base = loadFixtureInput('o-eas-0204-seller-0088-buyer');
  const input = withValue(withValue(withValue(withReference(base, '04011000-1234512345-06'), 'projectReference', 'PRJ-1'), 'contractReference', 'CT-1'), 'orderReference', 'ORD-1');
  const on = accepted(input);
  assert.equal(ublXml(on), ublXml(accepted(input, {})));
  assert.equal(ciiXml(on), ciiXml(accepted(input, {})));
  assert.equal(on.seller.electronicAddress.schemeId, '0204');
  assert.equal(on.buyerReference, '04011000-1234512345-06');
  assert.equal(on.projectReference, 'PRJ-1');
  assert.equal(on.contractReference, 'CT-1');
  assert.equal(on.orderReference, 'ORD-1');
});

// -------------------------------------------------------------------------------------------- fixtures

test('the Leitweg-ID fixtures build under the mode and differ from their base fixtures only in BT-10', () => {
  const bases = { 'ze-leitweg-id-invoice': 'a-simple', 'zf-leitweg-id-credit-note': 't-credit-note-full-reversal' } as const;
  for (const name of LEITWEG_FIXTURE_NAMES) {
    const input = loadFixtureInput(name);
    accepted(input);
    assert.deepEqual(withReference(input, 'x'), withReference(loadFixtureInput(bases[name]), 'x'), name);
  }
});

const golden = (file: string) => readFileSync(new URL(`../fixtures/xrechnung/golden/${file}`, import.meta.url), 'utf8');

// The projection of the CII experiment covers a 380 only; a 381 is compared on the facts the mode touches or must leave alone.
const CII_AGREEMENT = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement';
const CII_SUMMATION = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation';

for (const name of LEITWEG_FIXTURE_NAMES) {
  test(`fixture ${name}: serializer output equals the committed golden files byte for byte, and UBL and CII agree`, () => {
    const invoice = accepted(loadFixtureInput(name));
    const ubl = ublXml(invoice);
    const cii = ciiXml(invoice);
    assert.equal(ubl, golden(`${name}.xml`));
    assert.equal(cii, golden(`${name}.cii.xml`));
    const ublRoot = parseXml(ubl);
    const ciiRoot = parseXml(cii);
    assert.equal(textAt(ublRoot, 'cbc:BuyerReference'), invoice.buyerReference);
    assert.equal(textAt(ciiRoot, `${CII_AGREEMENT}/ram:BuyerReference`), invoice.buyerReference);
    assert.equal(textAt(ublRoot, 'cbc:ID'), textAt(ciiRoot, 'rsm:ExchangedDocument/ram:ID'));
    assert.equal(textAt(ublRoot, 'cac:LegalMonetaryTotal/cbc:PayableAmount'), textAt(ciiRoot, `${CII_SUMMATION}/ram:DuePayableAmount`));
    if (invoice.documentTypeCode === '380') {
      const fromUbl = extractProjection(ubl, 'ubl');
      const fromCii = extractProjection(cii, 'cii');
      assert.deepEqual([...fromUbl.errors, ...fromCii.errors], []);
      assert.deepEqual(compareProjections(fromUbl.projection, fromCii.projection), []);
      assert.equal(fromUbl.projection['BT-10'], invoice.buyerReference);
    } else {
      assert.equal(textAt(ublRoot, 'cbc:CreditNoteTypeCode'), '381');
      assert.equal(textAt(ciiRoot, 'rsm:ExchangedDocument/ram:TypeCode'), '381');
    }
  });
}
