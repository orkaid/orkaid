import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDecimal, type Decimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { calculateInvoiceTotals } from '../../src/lib/domain/xrechnung/invoice.ts';

// Every expected value in this file is worked out by hand (see comments) and is
// never produced by the code under test. The BR-CO checks use their own integer
// arithmetic on cents, independent of the implementation.

type LineFixture = { quantity: string; unitPrice: string; vatCategory?: string; vatRate?: string };

function line(quantity: string, unitPrice: string, vatRate = '19'): Required<LineFixture> {
  return { quantity, unitPrice, vatCategory: 'S', vatRate };
}

function invoice(lines: unknown[], overrides: Record<string, unknown> = {}) {
  return { documentTypeCode: '380', currency: 'EUR', lines, ...overrides };
}

type Options = Parameters<typeof calculateInvoiceTotals>[1];

function ok(input: unknown, options?: Options) {
  const result = calculateInvoiceTotals(input, options);
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
  return result.ok ? result.value : assert.fail('unreachable');
}

function errors(input: unknown, options?: Options) {
  const result = calculateInvoiceTotals(input, options);
  assert.equal(result.ok, false, 'expected failure');
  return result.ok ? assert.fail('unreachable') : result.errors;
}

function cents(amount: Decimal): bigint {
  assert.equal(amount.scale, 2, 'monetary amounts are stated with two decimals');
  return amount.units;
}

// ---------------------------------------------------------------- mandatory regression example

test('regression: ten lines of EUR 0.03 at 19% -> BT-116 0.30, BT-117 0.06, gross 0.36', () => {
  // Hand calculation: 10 x 0.03 = 0.30; VAT once on 0.30: 0.30 x 19 / 100 = 0.057 -> 0.06; gross 0.36.
  const totals = ok(invoice(Array.from({ length: 10 }, () => line('1', '0.03'))));

  assert.equal(totals.vatBreakdown.length, 1);
  const [bucket] = totals.vatBreakdown;
  assert.equal(bucket?.category, 'S');
  assert.equal(bucket?.rate, '19');
  assert.equal(formatDecimal(bucket!.taxableAmount), '0.30'); // BT-116
  assert.equal(formatDecimal(bucket!.taxAmount), '0.06'); // BT-117
  assert.equal(formatDecimal(totals.totalVat), '0.06'); // BT-110
  assert.equal(formatDecimal(totals.totalWithoutVat), '0.30'); // BT-109
  assert.equal(formatDecimal(totals.totalWithVat), '0.36'); // BT-112
});

test('no per-line-rounded-VAT summation: the ten-line example must not yield 0.10', () => {
  // Per-line VAT is 0.03 x 0.19 = 0.0057 -> 0.01; ten of them would sum to 0.10, which violates the per-bucket VAT policy.
  const totals = ok(invoice(Array.from({ length: 10 }, () => line('1', '0.03'))));
  assert.notEqual(formatDecimal(totals.totalVat), '0.10');
});

test('no per-line-rounded-VAT summation: two lines of 0.50 at 7% give 0.07, not 0.08', () => {
  // Bucket 1.00 x 0.07 = 0.07. Per line: 0.50 x 0.07 = 0.035 -> 0.04, twice = 0.08 (wrong).
  const totals = ok(invoice([line('1', '0.50', '7'), line('1', '0.50', '7')]));
  assert.equal(formatDecimal(totals.vatBreakdown[0]!.taxAmount), '0.07');
  assert.equal(formatDecimal(totals.totalVat), '0.07');
});

// ---------------------------------------------------------------- buckets

test('19% and 7% lines form distinct VAT breakdown buckets', () => {
  // 19%: 2 x 10.00 = 20.00 and 3 x 1.10 = 3.30 -> BT-116 23.30; VAT 23.30 x 0.19 = 4.427 -> 4.43
  // 7%:  1 x 5.50 = 5.50 -> BT-116 5.50; VAT 5.50 x 0.07 = 0.385 -> 0.39 (exact half, HALF_UP)
  // BT-106 = BT-109 = 28.80; BT-110 = 4.43 + 0.39 = 4.82; BT-112 = 33.62
  const totals = ok(invoice([line('2', '10.00'), line('1', '5.50', '7'), line('3', '1.10')]));

  assert.deepEqual(
    totals.vatBreakdown.map((b) => [b.category, b.rate, formatDecimal(b.taxableAmount), formatDecimal(b.taxAmount)]),
    [
      ['S', '19', '23.30', '4.43'],
      ['S', '7', '5.50', '0.39'],
    ],
  );
  assert.deepEqual(totals.lines.map((l) => formatDecimal(l.netAmount)), ['20.00', '5.50', '3.30']);
  assert.equal(formatDecimal(totals.sumOfLineNetAmounts), '28.80');
  assert.equal(formatDecimal(totals.totalWithoutVat), '28.80');
  assert.equal(formatDecimal(totals.totalVat), '4.82');
  assert.equal(formatDecimal(totals.totalWithVat), '33.62');
});

test('a bucket exists only for rates that occur on some line', () => {
  const totals = ok(invoice([line('1', '100.00', '7')]));
  assert.deepEqual(totals.vatBreakdown.map((b) => b.rate), ['7']);
  assert.equal(formatDecimal(totals.totalVat), '7.00');
});

// ---------------------------------------------------------------- HALF_UP boundaries

test('BT-131: quantity x unit price is rounded HALF_UP to two decimals per line', () => {
  // 0.5 x 0.01 = 0.005 -> 0.01; 2.5 x 0.01 = 0.025 -> 0.03; 1.005 x 1 = 1.005 -> 1.01; 0.0049 x 1 -> 0.00;
  // 1.5 x 0.333 = 0.4995 -> 0.50; 3 x 0.3333 = 0.9999 -> 1.00
  const totals = ok(
    invoice([
      line('0.5', '0.01'),
      line('2.5', '0.01'),
      line('1.005', '1'),
      line('0.0049', '1'),
      line('1.5', '0.333'),
      line('3', '0.3333'),
    ]),
  );
  assert.deepEqual(totals.lines.map((l) => formatDecimal(l.netAmount)), ['0.01', '0.03', '1.01', '0.00', '0.50', '1.00']);
});

test('BT-116 sums the rounded line net amounts, not the unrounded products', () => {
  // Each line: 1 x 0.005 = 0.005 -> 0.01. Rounded sum = 0.02 (unrounded sum 0.010 would round to 0.01).
  const totals = ok(invoice([line('1', '0.005'), line('1', '0.005')]));
  assert.equal(formatDecimal(totals.vatBreakdown[0]!.taxableAmount), '0.02');
});

test('BT-117 is rounded HALF_UP once per bucket, at the exact half-cent boundary', () => {
  const cases: Array<[taxable: string, rate: string, vat: string]> = [
    ['5.50', '7', '0.39'], // 0.385 exact half -> up
    ['0.50', '7', '0.04'], // 0.035 exact half -> up
    ['0.50', '19', '0.10'], // 0.095 exact half -> up
    ['0.05', '19', '0.01'], // 0.0095 -> 0.01
    ['0.07', '7', '0.00'], // 0.0049 -> 0.00
    ['0.10', '7', '0.01'], // 0.007 -> 0.01
    ['0.30', '19', '0.06'], // 0.057 -> 0.06
    ['0.00', '19', '0.00'], // zero stays zero
  ];
  for (const [taxable, rate, vat] of cases) {
    const totals = ok(invoice([line('1', taxable, rate)]));
    assert.equal(formatDecimal(totals.vatBreakdown[0]!.taxAmount), vat, `${taxable} @ ${rate}%`);
  }
});

// ---------------------------------------------------------------- determinism

test('repeated calculation is deterministic', () => {
  const input = invoice([line('2', '10.00'), line('1', '5.50', '7'), line('3', '1.10')]);
  const first = ok(input);
  for (let i = 0; i < 5; i++) assert.deepEqual(ok(input), first);
});

test('line order does not change buckets, bucket order or totals', () => {
  const a = line('2', '10.00');
  const b = line('1', '5.50', '7');
  const c = line('3', '1.10');
  const forward = ok(invoice([a, b, c]));
  const shuffled = ok(invoice([c, b, a]));
  assert.deepEqual(shuffled.vatBreakdown, forward.vatBreakdown);
  assert.deepEqual(
    [shuffled.sumOfLineNetAmounts, shuffled.totalWithoutVat, shuffled.totalVat, shuffled.totalWithVat],
    [forward.sumOfLineNetAmounts, forward.totalWithoutVat, forward.totalVat, forward.totalWithVat],
  );
});

test('the input is not mutated', () => {
  const input = invoice([line('2', '10.00')]);
  const snapshot = structuredClone(input);
  ok(input);
  assert.deepEqual(input, snapshot);
});

// ---------------------------------------------------------------- BR-CO relationships (V1 scope)

test('BR-CO-10/13/14/15/17 hold for every vector, checked with independent integer arithmetic', () => {
  const vectors = [
    invoice(Array.from({ length: 10 }, () => line('1', '0.03'))),
    invoice([line('2', '10.00'), line('1', '5.50', '7'), line('3', '1.10')]),
    invoice([line('0.5', '0.01'), line('2.5', '0.01'), line('1.005', '1', '7'), line('0.0049', '1', '7')]),
    invoice([line('1', '0.005'), line('1', '0.005', '7'), line('7', '19.99'), line('12.345', '9.876', '7')]),
    invoice([line('1000000', '999999.99'), line('0.001', '0.001', '7')]),
  ];
  for (const input of vectors) {
    const totals = ok(input);

    // BR-CO-10: BT-106 = sum of BT-131
    const sumBt131 = totals.lines.reduce((sum, l) => sum + cents(l.netAmount), 0n);
    assert.equal(cents(totals.sumOfLineNetAmounts), sumBt131, 'BR-CO-10');

    // BR-CO-13: BT-109 = BT-106 - BT-107 + BT-108, with BT-107 = BT-108 = 0 in V1 (no document-level allowances/charges)
    assert.equal(cents(totals.totalWithoutVat), sumBt131 - 0n + 0n, 'BR-CO-13');

    // BR-CO-17: BT-117 = BT-116 x BT-119 / 100 rounded half up to 2 decimals.
    //   For non-negative integer cents c and integer rate r: floor((c x r + 50) / 100).
    let sumBt117 = 0n;
    let sumBt116 = 0n;
    for (const bucket of totals.vatBreakdown) {
      const expectedVat = (cents(bucket.taxableAmount) * BigInt(bucket.rate) + 50n) / 100n;
      assert.equal(cents(bucket.taxAmount), expectedVat, `BR-CO-17 @ ${bucket.rate}%`);
      sumBt117 += cents(bucket.taxAmount);
      sumBt116 += cents(bucket.taxableAmount);
    }

    // Buckets partition the invoice: their taxable amounts add up to BT-109 (BR-CO-... consistency of V1 with no allowances)
    assert.equal(sumBt116, cents(totals.totalWithoutVat), 'sum of BT-116 = BT-109 in V1');

    // BR-CO-14: BT-110 = sum of BT-117
    assert.equal(cents(totals.totalVat), sumBt117, 'BR-CO-14');

    // BR-CO-15: BT-112 = BT-109 + BT-110
    assert.equal(cents(totals.totalWithVat), cents(totals.totalWithoutVat) + cents(totals.totalVat), 'BR-CO-15');
  }
});

test('BR-CO-18: at least one VAT breakdown is present for any accepted invoice', () => {
  const totals = ok(invoice([line('1', '0.00')]));
  assert.equal(totals.vatBreakdown.length >= 1, true);
});

test('large exact values do not lose precision', () => {
  // 1,000,000 x 999,999.99 = 999,999,990,000.00; VAT 19%: x 0.19 = 189,999,998,100.00 exactly
  const totals = ok(invoice([line('1000000', '999999.99')]));
  assert.equal(formatDecimal(totals.totalWithoutVat), '999999990000.00');
  assert.equal(formatDecimal(totals.totalVat), '189999998100.00');
  assert.equal(formatDecimal(totals.totalWithVat), '1189999988100.00');
});

// ---------------------------------------------------------------- rejection: invalid decimals and negatives

test('invalid decimal input is rejected with the offending field path', () => {
  assert.deepEqual(errors(invoice([line('1', '0.03'), line('1,5', '0.03'), line('1', 'abc')])), [
    { code: 'invalid_decimal', path: 'lines[1].quantity' },
    { code: 'invalid_decimal', path: 'lines[2].unitPrice' },
  ]);
});

test('numbers (binary floats) are rejected as decimal input; only strings are accepted', () => {
  assert.deepEqual(errors(invoice([{ quantity: 1, unitPrice: 0.03, vatCategory: 'S', vatRate: '19' }])), [
    { code: 'invalid_decimal', path: 'lines[0].quantity' },
    { code: 'invalid_decimal', path: 'lines[0].unitPrice' },
  ]);
});

test('negative quantity and negative unit price are rejected explicitly', () => {
  assert.deepEqual(errors(invoice([line('-1', '10.00'), line('1', '-0.01')])), [
    { code: 'negative_amount', path: 'lines[0].quantity' },
    { code: 'negative_amount', path: 'lines[1].unitPrice' },
  ]);
});

test('failure never returns partial totals', () => {
  const result = calculateInvoiceTotals(invoice([line('1', '0.03'), line('-1', '1')]));
  assert.equal(result.ok, false);
  assert.equal('value' in result, false);
});

// ---------------------------------------------------------------- rejection: unsupported scenarios

test('BT-3 other than 380 is unsupported, never treated as 380', () => {
  for (const code of ['381', '384', '', '0380', 380]) {
    assert.deepEqual(errors(invoice([line('1', '1')], { documentTypeCode: code })), [
      { code: 'unsupported_document_type', path: 'documentTypeCode' },
    ]);
  }
});

test('currency other than EUR is unsupported, never treated as EUR', () => {
  for (const currency of ['USD', 'eur', 'EUR ', '']) {
    assert.deepEqual(errors(invoice([line('1', '1')], { currency })), [
      { code: 'unsupported_currency', path: 'currency' },
    ]);
  }
});

test('VAT category other than S is unsupported, never treated as S', () => {
  for (const vatCategory of ['Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M', 's', '']) {
    assert.deepEqual(errors(invoice([{ quantity: '1', unitPrice: '1', vatCategory, vatRate: '19' }])), [
      { code: 'unsupported_vat_category', path: 'lines[0].vatCategory' },
    ]);
  }
});

test('VAT rate other than 19 or 7 is unsupported, never rounded or mapped to a supported rate', () => {
  for (const vatRate of ['0', '16', '5', '20', '19.01', '18.99', '190', '1.9', '7.5', '6.99', '-19', '', 'abc']) {
    assert.deepEqual(errors(invoice([{ quantity: '1', unitPrice: '1', vatCategory: 'S', vatRate }])), [
      { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
    ]);
  }
});

test('deferred features are rejected as unknown fields, not silently ignored', () => {
  assert.deepEqual(errors(invoice([line('1', '1')], { allowances: [] })), [
    { code: 'unknown_field', path: 'allowances' },
  ]);
  assert.deepEqual(errors(invoice([line('1', '1')], { paidAmount: '5.00' })), [
    { code: 'unknown_field', path: 'paidAmount' },
  ]);
  assert.deepEqual(errors(invoice([{ ...line('1', '1'), priceBaseQuantity: '10' }])), [
    { code: 'unknown_field', path: 'lines[0].priceBaseQuantity' },
  ]);
  assert.deepEqual(errors(invoice([{ ...line('1', '1'), allowance: '1.00' }])), [
    { code: 'unknown_field', path: 'lines[0].allowance' },
  ]);
});

test('an invoice without lines is rejected (BR-16 / BR-CO-18)', () => {
  assert.deepEqual(errors(invoice([])), [{ code: 'no_lines', path: 'lines' }]);
});

test('structurally invalid input is rejected with invalid_type', () => {
  assert.deepEqual(errors(null), [{ code: 'invalid_type', path: '' }]);
  assert.deepEqual(errors('invoice'), [{ code: 'invalid_type', path: '' }]);
  assert.deepEqual(errors([]), [{ code: 'invalid_type', path: '' }]);
  assert.deepEqual(errors({ documentTypeCode: '380', currency: 'EUR', lines: 'x' }), [
    { code: 'invalid_type', path: 'lines' },
  ]);
  assert.deepEqual(errors(invoice([null])), [{ code: 'invalid_type', path: 'lines[0]' }]);
});

test('all independent problems are reported together', () => {
  const found = errors(
    invoice([{ quantity: '-1', unitPrice: 'x', vatCategory: 'Z', vatRate: '16' }], {
      documentTypeCode: '381',
      currency: 'USD',
    }),
  );
  assert.deepEqual(found, [
    { code: 'unsupported_document_type', path: 'documentTypeCode' },
    { code: 'unsupported_currency', path: 'currency' },
    { code: 'negative_amount', path: 'lines[0].quantity' },
    { code: 'invalid_decimal', path: 'lines[0].unitPrice' },
    { code: 'unsupported_vat_category', path: 'lines[0].vatCategory' },
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
});
