import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { calculateInvoice, calculateInvoiceTotals } from '../../src/lib/domain/xrechnung/invoice.ts';

// The calculation module is extended additively: BT-115 (amount due) and the parsed line data a serializer
// needs. The V1 monetary calculation itself (rounding points, notation handling) is unchanged; the existing suites keep asserting it. Expected values
// below are worked out by hand, not produced by the code under test.

const line = (quantity: string, unitPrice: string, vatRate = '19') => ({ quantity, unitPrice, vatCategory: 'S', vatRate });
const invoice = (lines: unknown[], extra: Record<string, unknown> = {}) => ({ documentTypeCode: '380', currency: 'EUR', lines, ...extra });

function okDetails(input: unknown, options?: Parameters<typeof calculateInvoice>[1], callerFields?: Parameters<typeof calculateInvoice>[2]) {
  const result = calculateInvoice(input, options, callerFields);
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
  return result.ok ? result.value : assert.fail('unreachable');
}

test('BT-115 amount due equals BT-112 while BT-113 and BT-114 are absent (BR-CO-16), stated at two decimals', () => {
  // Ten lines of EUR 0.03 at 19%: taxable 0.30, VAT 0.057 -> 0.06, gross 0.36 (the required regression witness of the V1 monetary policy).
  const { totals } = okDetails(invoice(Array.from({ length: 10 }, () => line('1', '0.03'))));
  assert.equal(formatDecimal(totals.totalWithVat), '0.36');
  assert.equal(formatDecimal(totals.amountDue), '0.36');
  assert.equal(totals.amountDue.scale, 2);
});

test('the totals-only entry point reports the same totals, now including BT-115', () => {
  const input = invoice([line('2', '49.90'), line('1.5', '80.00', '7')]);
  const viaTotals = calculateInvoiceTotals(input);
  assert.equal(viaTotals.ok, true);
  assert.deepEqual(viaTotals.ok ? viaTotals.value : undefined, okDetails(input).totals);
  // 99.80 at 19% -> 18.962 -> 18.96; 120.00 at 7% -> 8.40; gross 219.80 + 27.36 = 247.16
  assert.equal(viaTotals.ok ? formatDecimal(viaTotals.value.amountDue) : '', '247.16');
});

test('the calculation retains the parsed line data with the scale the caller typed', () => {
  const { lines } = okDetails(invoice([line('2.50', '0.335'), line('3', '10', '19.00'), line('1', '1', '7')]));
  assert.deepEqual(
    lines.map((l) => [formatDecimal(l.quantity), formatDecimal(l.unitPrice), l.vatRate]),
    [['2.50', '0.335', '19'], ['3', '10', '19'], ['1', '1', '7']],
  );
});

test('the notation applies to the retained line data exactly as it does to the totals', () => {
  const { lines, totals } = okDetails(invoice([line('1,5', '1.234,56', '19,00')]), { notation: 'de' });
  assert.deepEqual(lines.map((l) => [formatDecimal(l.quantity), formatDecimal(l.unitPrice), l.vatRate]), [['1.5', '1234.56', '19']]);
  assert.equal(formatDecimal(totals.sumOfLineNetAmounts), '1851.84'); // 1.5 x 1234.56 = 1851.84 exactly
});

test('fields owned by the caller are ignored by the calculation, all others stay unknown fields', () => {
  const callerFields = { invoice: ['seller'], line: ['name'] };
  const input = invoice([{ ...line('1', '1.00'), name: 'x', surplus: 1 }], { seller: {}, extra: 1 });
  const result = calculateInvoice(input, {}, callerFields);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok ? [] : result.errors.map((e) => `${e.code}@${e.path}`).sort(),
    ['unknown_field@extra', 'unknown_field@lines[0].surplus'],
  );
  // Without the declaration the same fields are rejected, as before.
  const strict = calculateInvoice(invoice([{ ...line('1', '1.00'), name: 'x' }], { seller: {} }));
  assert.deepEqual(
    strict.ok ? [] : strict.errors.map((e) => `${e.code}@${e.path}`).sort(),
    ['unknown_field@lines[0].name', 'unknown_field@seller'],
  );
});

test('a failing calculation reports the same errors through both entry points', () => {
  const input = invoice([line('1', '-1'), line('x', '1', '16')]);
  const viaTotals = calculateInvoiceTotals(input);
  const viaDetails = calculateInvoice(input);
  assert.equal(viaTotals.ok, false);
  assert.deepEqual(viaDetails, viaTotals);
});
