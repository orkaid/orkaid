import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { formatDecimal, parseDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import {
  calculateInvoice,
  MAX_CALCULATED_AMOUNT_EXCLUSIVE,
  MAX_QUANTITY_EFFECTIVE_FRACTION_DIGITS,
  MAX_QUANTITY_EXCLUSIVE,
  MAX_UNIT_PRICE_EFFECTIVE_FRACTION_DIGITS,
  MAX_UNIT_PRICE_EXCLUSIVE,
} from '../../src/lib/domain/xrechnung/invoice.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withValue } from '../support/fixtures.ts';
import { one, parseXml, select, textAt } from '../support/xml.ts';

// M1 numeric profile: BT-129 and BT-146 allow at most 6 effective fractional digits and a value below 10^9; every
// calculated EUR amount (BT-131, BT-116, BT-117, BT-106, BT-109, BT-110, BT-112, BT-115) stays below 10^10. Both upper
// bounds are exclusive. PROFILE limits: not EN 16931, XRechnung or XSD maxima. Expected values are worked by hand.

type Notation = 'canonical' | 'de' | 'en';
type Treatment = 'standard' | 'kleinunternehmer';

const VAT = {
  standard: { treatment: 'standard', category: 'S', rate: '19' },
  kleinunternehmer: { treatment: 'kleinunternehmer', category: 'E', rate: '0' },
} as const;

const line = (quantity: string, unitPrice: string, treatment: Treatment = 'standard') => ({ quantity, unitPrice, vat: VAT[treatment] });
const invoice = (...lines: unknown[]) => ({ documentTypeCode: '380', currency: 'EUR', lines });

function calculated(input: unknown, notation: Notation = 'canonical') {
  const result = calculateInvoice(input, { notation });
  assert.ok(result.ok, `expected success, got ${JSON.stringify(result.ok ? null : result.errors)}`);
  return result.value;
}

function errors(input: unknown, notation: Notation = 'canonical'): string[] {
  const result = calculateInvoice(input, { notation });
  assert.ok(!result.ok, 'expected failure');
  return result.errors.map((error) => `${error.code}@${error.path}`);
}

const FIELDS = [
  { field: 'quantity', at: (value: string) => line(value, '1') },
  { field: 'unitPrice', at: (value: string) => line('1', value) },
] as const;

test('the limits are the approved values, held as exact decimals', () => {
  assert.equal(MAX_QUANTITY_EFFECTIVE_FRACTION_DIGITS, 6);
  assert.equal(MAX_UNIT_PRICE_EFFECTIVE_FRACTION_DIGITS, 6);
  assert.deepEqual(MAX_QUANTITY_EXCLUSIVE, { units: 1_000_000_000n, scale: 0 });
  assert.deepEqual(MAX_UNIT_PRICE_EXCLUSIVE, { units: 1_000_000_000n, scale: 0 });
  assert.deepEqual(MAX_CALCULATED_AMOUNT_EXCLUSIVE, { units: 10_000_000_000n, scale: 0 });
  assert.ok(Object.isFrozen(MAX_QUANTITY_EXCLUSIVE) && Object.isFrozen(MAX_UNIT_PRICE_EXCLUSIVE) && Object.isFrozen(MAX_CALCULATED_AMOUNT_EXCLUSIVE));
});

// ---------------------------------------------------------------- precision (effective fractional digits)

for (const { field, at } of FIELDS) {
  test(`${field}: 6 effective fractional digits are accepted, 7 are rejected`, () => {
    calculated(invoice(at('1.123456')));
    calculated(invoice(at('0.000001')));
    assert.deepEqual(errors(invoice(at('1.1234567'))), [`fraction_digits_limit@lines[0].${field}`]);
    assert.deepEqual(errors(invoice(at('0.0000001'))), [`fraction_digits_limit@lines[0].${field}`]);
  });

  test(`${field}: trailing zeros do not count towards precision, and the written scale is kept`, () => {
    // 1.230000000 has 9 written but 2 effective fractional digits; 1.0000000 has 0.
    for (const value of ['1.230000000', '1.2300000', '1.0000000', '1.1234560000']) {
      const parsed = calculated(invoice(at(value))).lines[0];
      assert.ok(parsed !== undefined);
      assert.equal(formatDecimal(parsed[field]), value, value);
    }
  });

  test(`${field}: precision is judged the same way in every notation`, () => {
    assert.deepEqual(errors(invoice(at('1,1234567')), 'de'), [`fraction_digits_limit@lines[0].${field}`]);
    assert.deepEqual(errors(invoice(at('1.1234567')), 'en'), [`fraction_digits_limit@lines[0].${field}`]);
    calculated(invoice(at('1,230000000')), 'de');
  });

  // ---------------------------------------------------------------- magnitude (exact value, exclusive bound)

  test(`${field}: a value below 10^9 is accepted, 10^9 is rejected however it is written`, () => {
    // 999999999.999999 x 1 = 999999999.999999 -> BT-131 1000000000.00; VAT 19% 190000000.00; gross 1190000000.00.
    const totals = calculated(invoice(at('999999999.999999'))).totals;
    assert.equal(formatDecimal(totals.totalWithVat), '1190000000.00');
    for (const value of ['1000000000', '1000000000.000000', '1000000000.5', '0001000000000']) {
      assert.deepEqual(errors(invoice(at(value))), [`magnitude_limit@lines[0].${field}`], value);
    }
    assert.deepEqual(errors(invoice(at('1.000.000.000')), 'de'), [`magnitude_limit@lines[0].${field}`]);
    calculated(invoice(at('999,999,999.999999')), 'en');
  });

  test(`${field}: the checks run in order (guard, sign, precision, magnitude) and report only the first failure`, () => {
    assert.deepEqual(errors(invoice(at('-1.1234567'))), [`negative_amount@lines[0].${field}`]);
    assert.deepEqual(errors(invoice(at('1000000000.1234567'))), [`fraction_digits_limit@lines[0].${field}`]);
    assert.deepEqual(errors(invoice(at('1'.repeat(129)))), [`input_length_guard@lines[0].${field}`]);
  });
}

test('zero quantity and zero price keep their current behaviour, whatever their written scale', () => {
  calculated(invoice(line('0', '1'), line('1', '0.0000000')));
});

test('the limits apply to quantity and unit price only: VAT-rate parsing and the decimal engine are untouched', () => {
  calculated(invoice({ quantity: '1', unitPrice: '1', vat: { treatment: 'standard', category: 'S', rate: '19.0000000' } }));
  assert.equal(parseDecimal('1.1234567').ok, true);
  assert.equal(parseDecimal('1000000000').ok, true);
});

test('quantity and unit price at their limits together are not an invoice: the line amount is over the ceiling', () => {
  assert.deepEqual(errors(invoice(line('999999999.999999', '999999999.999999'))), ['calculated_amount_limit@lines[0]']);
});

// ---------------------------------------------------------------- calculated-amount ceiling, below 10^10 EUR

test('calculated amounts just below 10^10 are accepted', () => {
  // 10 x 840336134.453 = 8403361344.53; VAT 19% = 1596638655.4607 -> 1596638655.46; gross 9999999999.99.
  const standard = calculated(invoice(line('10', '840336134.453'))).totals;
  assert.equal(formatDecimal(standard.lines[0]!.netAmount), '8403361344.53');
  assert.equal(formatDecimal(standard.totalVat), '1596638655.46');
  assert.equal(formatDecimal(standard.totalWithVat), '9999999999.99');
  assert.equal(formatDecimal(standard.amountDue), '9999999999.99');
  // Kleinunternehmer (no VAT): 10 x 999999999.999 = 9999999999.99 is BT-131, BT-106 and BT-112 at once.
  const exempt = calculated(invoice(line('10', '999999999.999', 'kleinunternehmer'))).totals;
  assert.equal(formatDecimal(exempt.lines[0]!.netAmount), '9999999999.99');
  assert.equal(formatDecimal(exempt.totalWithVat), '9999999999.99');
});

// Ownership: a line whose BT-131 reaches the ceiling owns the diagnostic (path lines[i]); every document total
// necessarily reaches it too, so no document diagnostic is added. Only when no line does, and a document or
// breakdown amount still reaches it, is one single diagnostic reported for the document, at path 'lines'.

test('a line amount at the ceiling is rejected at that line, without redundant document diagnostics', () => {
  // 10 x 999999999.999999 = 9999999999.99999 -> HALF_UP 10000000000.00: rounding alone reaches the ceiling.
  assert.deepEqual(errors(invoice(line('10', '999999999.999999'))), ['calculated_amount_limit@lines[0]']);
  assert.deepEqual(errors(invoice(line('10', '999999999.999999', 'kleinunternehmer'))), ['calculated_amount_limit@lines[0]']);
  // Two causing lines report one diagnostic each; the line within the ceiling reports nothing.
  assert.deepEqual(errors(invoice(line('10', '999999999.999999'), line('1', '1'), line('20', '999999999'))), [
    'calculated_amount_limit@lines[0]',
    'calculated_amount_limit@lines[2]',
  ]);
});

test('a document amount that reaches the ceiling on its own is rejected once, at the document', () => {
  // Two Kleinunternehmer lines of 10 x 500000000 = 5000000000.00 each: BT-116 = BT-106 = BT-112 = 10000000000.00.
  assert.deepEqual(errors(invoice(line('10', '500000000', 'kleinunternehmer'), line('10', '500000000', 'kleinunternehmer'))), ['calculated_amount_limit@lines']);
  // One cent above the accepted case: 8403361344.54 + VAT 1596638655.4626 -> 1596638655.46 = 10000000000.00 (BT-112, BT-115).
  assert.deepEqual(errors(invoice(line('10', '840336134.454'))), ['calculated_amount_limit@lines']);
});

test('the ceiling is enforced before serialization: buildInvoice yields no invoice', () => {
  const input = withValue(withValue(loadFixtureInput('a-simple'), 'lines.0.quantity', '10'), 'lines.0.unitPrice', '999999999.999999');
  const built = buildInvoice(input);
  assert.ok(!built.ok);
  assert.deepEqual(built.errors.map((error) => `${error.code}@${error.path}`), ['calculated_amount_limit@lines[0]']);
});

// ---------------------------------------------------------------- the permanent KoSIT boundary fixture

test('boundary fixture: BT-129 and BT-146 keep their written scale in UBL and CII', () => {
  const built = buildInvoice(loadFixtureInput('r-numeric-precision-boundary'));
  assert.ok(built.ok);
  const ubl = serializeUblInvoice(built.value);
  const cii = serializeCiiInvoice(built.value);
  assert.ok(ubl.ok && cii.ok);
  const ublLines = select(parseXml(ubl.xml), 'cac:InvoiceLine');
  assert.deepEqual(ublLines.map((l) => textAt(l, 'cbc:InvoicedQuantity')), ['1234.567891', '2.500000']);
  assert.deepEqual(ublLines.map((l) => textAt(l, 'cac:Price/cbc:PriceAmount')), ['0.123456', '999999.999999']);
  const ciiLines = select(parseXml(cii.xml), 'rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem');
  assert.deepEqual(ciiLines.map((l) => one(l, 'ram:SpecifiedLineTradeDelivery/ram:BilledQuantity').text), ['1234.567891', '2.500000']);
  assert.deepEqual(ciiLines.map((l) => textAt(l, 'ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount')), ['0.123456', '999999.999999']);
});
