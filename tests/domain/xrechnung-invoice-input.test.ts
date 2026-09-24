import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDecimal, PROVISIONAL_INPUT_LENGTH_GUARD } from '../../src/lib/domain/xrechnung/decimal.ts';
import { calculateInvoiceTotals, PROVISIONAL_MAX_REPORTED_ERRORS } from '../../src/lib/domain/xrechnung/invoice.ts';

// Expected values are worked out by hand (see comments) and never produced by the code under test.

type Options = Parameters<typeof calculateInvoiceTotals>[1];

function line(quantity: string, unitPrice: string, vatRate = '19') {
  return { quantity, unitPrice, vatCategory: 'S', vatRate };
}

function invoice(lines: unknown, overrides: Record<string, unknown> = {}) {
  return { documentTypeCode: '380', currency: 'EUR', lines, ...overrides };
}

function ok(input: unknown, options?: Options) {
  const result = calculateInvoiceTotals(input, options);
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
  return result.ok ? result.value : assert.fail('unreachable');
}

function failure(input: unknown, options?: Options) {
  const result = calculateInvoiceTotals(input, options);
  assert.equal(result.ok, false, 'expected failure');
  return result.ok ? assert.fail('unreachable') : result;
}

function errors(input: unknown, options?: Options) {
  return failure(input, options).errors;
}

// ---------------------------------------------------------------- sparse arrays and missing line entries

test('new Array(1) is rejected: a hole is a missing line, never an empty invoice', () => {
  assert.deepEqual(errors(invoice(new Array(1))), [{ code: 'invalid_type', path: 'lines[0]' }]);
});

test('holes between valid lines are rejected with the path of every missing entry', () => {
  const lines = new Array(4);
  lines[0] = line('1', '1.00');
  lines[3] = line('2', '2.00');
  assert.deepEqual(errors(invoice(lines)), [
    { code: 'invalid_type', path: 'lines[1]' },
    { code: 'invalid_type', path: 'lines[2]' },
  ]);
});

test('a trailing hole (length larger than the assigned entries) is rejected', () => {
  const lines: unknown[] = [line('1', '1.00')];
  lines.length = 3;
  assert.deepEqual(errors(invoice(lines)), [
    { code: 'invalid_type', path: 'lines[1]' },
    { code: 'invalid_type', path: 'lines[2]' },
  ]);
});

test('a deleted entry leaves a hole that is rejected', () => {
  const lines = [line('1', '1.00'), line('2', '2.00'), line('3', '3.00')];
  delete lines[1];
  assert.deepEqual(errors(invoice(lines)), [{ code: 'invalid_type', path: 'lines[1]' }]);
});

test('explicit undefined entries are rejected', () => {
  assert.deepEqual(errors(invoice([undefined])), [{ code: 'invalid_type', path: 'lines[0]' }]);
  assert.deepEqual(errors(invoice([line('1', '1.00'), undefined])), [{ code: 'invalid_type', path: 'lines[1]' }]);
  assert.deepEqual(errors(invoice(Array.from({ length: 2 }))), [
    { code: 'invalid_type', path: 'lines[0]' },
    { code: 'invalid_type', path: 'lines[1]' },
  ]);
});

test('invalid arrays never produce a success, an empty line list or an empty VAT breakdown', () => {
  const holed = new Array(3);
  holed[1] = line('1', '1.00');
  const trailing: unknown[] = [line('1', '1.00')];
  trailing.length = 2;
  const deleted = [line('1', '1.00'), line('2', '2.00')];
  delete deleted[0];

  for (const lines of [new Array(1), new Array(5), holed, trailing, deleted, [undefined], [line('1', '1.00'), undefined], [null]]) {
    const result = calculateInvoiceTotals(invoice(lines));
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
  }
});

test('a huge sparse array fails fast with a bounded, explicitly truncated error list', () => {
  const start = Date.now();
  const result = failure(invoice(new Array(2 ** 32 - 1)));
  assert.ok(result.errors.length >= 1 && result.errors.length <= 1000, `error list length ${result.errors.length}`);
  assert.deepEqual(result.errors[0], { code: 'invalid_type', path: 'lines[0]' });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.errors.at(-1), { code: 'error_list_truncated', path: `lines[${PROVISIONAL_MAX_REPORTED_ERRORS}]` });
  assert.ok(Date.now() - start < 2000, 'validation must stop early');
});

// ---------------------------------------------------------------- complete versus truncated diagnostics
// The collection bound is a provisional guard, so these tests derive their inputs from the exported constant
// instead of a literal; the expected paths and counts are worked out from it by hand (see comments).

const CAP = PROVISIONAL_MAX_REPORTED_ERRORS;

function holePaths(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({ code: 'invalid_type', path: `lines[${index}]` }));
}

test('a failure that collected every error says so: truncated is false and no marker error is present', () => {
  const cases: unknown[] = [
    invoice([line('1', '1.00'), undefined]),
    invoice([line('-1', '1.00')]),
    invoice([]),
    invoice([line('1', '1.00')], { currency: 'USD' }),
    null,
    invoice(new Array(CAP)), // exactly the bound: every line was scanned, nothing was omitted
  ];
  for (const input of cases) {
    const result = failure(input);
    assert.equal(result.truncated, false);
    assert.equal(result.errors.some((e) => e.code === 'error_list_truncated'), false);
  }
});

test('exactly at the collection bound the list is complete and unchanged', () => {
  // CAP holes -> CAP errors lines[0]..lines[CAP-1]; all lines were scanned.
  const result = failure(invoice(new Array(CAP)));
  assert.deepEqual(result.errors, holePaths(CAP));
  assert.equal(result.truncated, false);
});

test('one line beyond the bound is identifiable as truncated, with the first unscanned line named', () => {
  // CAP + 1 holes -> the first CAP are reported, scanning stops before lines[CAP], then the marker names lines[CAP].
  const result = failure(invoice(new Array(CAP + 1)));
  assert.equal(result.truncated, true);
  assert.deepEqual(result.errors, [...holePaths(CAP), { code: 'error_list_truncated', path: `lines[${CAP}]` }]);
});

test('a truncated list keeps every existing error and path; the marker is the only addition, and last', () => {
  // Each of these lines yields 4 errors (quantity, unitPrice, vatCategory, vatRate). Scanning stops after the
  // first line at which the collected count reaches CAP, i.e. after ceil(CAP / 4) lines.
  const bad = { quantity: 'x', unitPrice: 'y', vatCategory: 'Z', vatRate: '1' };
  const scanned = Math.ceil(CAP / 4);
  const expected = Array.from({ length: scanned }, (_unused, index) => [
    { code: 'invalid_decimal', path: `lines[${index}].quantity` },
    { code: 'invalid_decimal', path: `lines[${index}].unitPrice` },
    { code: 'unsupported_vat_category', path: `lines[${index}].vatCategory` },
    { code: 'unsupported_vat_rate', path: `lines[${index}].vatRate` },
  ]).flat();

  const result = failure(invoice(Array.from({ length: scanned + 10 }, () => bad)));
  assert.equal(result.truncated, true);
  assert.deepEqual(result.errors, [...expected, { code: 'error_list_truncated', path: `lines[${scanned}]` }]);
});

test('invoice-level errors are still reported alongside a truncated line list, and the marker stays last', () => {
  // The currency error is collected before any line is scanned and uses one of the CAP slots, so only lines[0] ..
  // lines[CAP - 2] are scanned and the first unscanned line is lines[CAP - 1]. The unknown field is reported after
  // the scan; the marker comes after everything else.
  const result = failure(invoice(new Array(CAP + 1), { currency: 'USD', surplus: true }));
  assert.equal(result.truncated, true);
  assert.deepEqual(result.errors[0], { code: 'unsupported_currency', path: 'currency' });
  assert.deepEqual(result.errors.slice(1, CAP), holePaths(CAP - 1));
  assert.equal(result.errors.some((e) => e.code === 'unknown_field' && e.path === 'surplus'), true);
  assert.deepEqual(result.errors.at(-1), { code: 'error_list_truncated', path: `lines[${CAP - 1}]` });
  assert.equal(result.errors.filter((e) => e.code === 'error_list_truncated').length, 1);
});

test('valid input and successes carry no truncation marker', () => {
  const result = calculateInvoiceTotals(invoice([line('1', '1.00')]));
  assert.equal(result.ok, true);
  assert.equal('truncated' in result, false);
});

test('valid lines around valid data still succeed (no false rejection of dense arrays)', () => {
  const totals = ok(invoice([line('1', '1.00'), line('2', '2.00')]));
  assert.equal(totals.lines.length, 2);
  assert.equal(formatDecimal(totals.totalWithoutVat), '5.00');
});

// ---------------------------------------------------------------- VAT-rate normalization

test('equivalent representations of 19% and 7% normalize to the canonical rates', () => {
  for (const vatRate of ['19', '19.0', '19.00', '19.000', '019']) {
    const totals = ok(invoice([line('1', '100.00', vatRate)]));
    assert.deepEqual(totals.vatBreakdown.map((b) => b.rate), ['19'], `rate ${vatRate}`);
    assert.equal(formatDecimal(totals.totalVat), '19.00', `rate ${vatRate}`);
  }
  for (const vatRate of ['7', '7.0', '7.00', '7.000', '07']) {
    const totals = ok(invoice([line('1', '100.00', vatRate)]));
    assert.deepEqual(totals.vatBreakdown.map((b) => b.rate), ['7'], `rate ${vatRate}`);
    assert.equal(formatDecimal(totals.totalVat), '7.00', `rate ${vatRate}`);
  }
});

test('equivalent spellings of one rate share a single VAT bucket, not several', () => {
  // Three lines of 0.03 -> one bucket 0.09; VAT 0.09 x 0.19 = 0.0171 -> 0.02.
  // Separate buckets would give 3 x (0.03 x 0.19 = 0.0057 -> 0.01) = 0.03.
  const totals = ok(invoice([line('1', '0.03', '19'), line('1', '0.03', '19.0'), line('1', '0.03', '19.00')]));
  assert.equal(totals.vatBreakdown.length, 1);
  assert.equal(formatDecimal(totals.vatBreakdown[0]!.taxableAmount), '0.09');
  assert.equal(formatDecimal(totals.vatBreakdown[0]!.taxAmount), '0.02');
  assert.equal(formatDecimal(totals.totalVat), '0.02');
});

test('German notation accepts 19,00 and 7,0 as the same rates', () => {
  for (const [vatRate, expected] of [['19,00', '19'], ['19,0', '19'], ['19', '19'], ['7,00', '7'], ['7,0', '7'], ['7', '7']] as const) {
    const totals = ok(invoice([line('1', '100,00', vatRate)]), { notation: 'de' });
    assert.deepEqual(totals.vatBreakdown.map((b) => b.rate), [expected], `rate ${vatRate}`);
  }
});

test('English notation accepts 19.00 and rejects the German spelling 19,00', () => {
  assert.deepEqual(ok(invoice([line('1', '100.00', '19.00')]), { notation: 'en' }).vatBreakdown.map((b) => b.rate), ['19']);
  assert.deepEqual(errors(invoice([line('1', '100.00', '19,00')]), { notation: 'en' }), [
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
});

test('localized grouping is never mistaken for a supported rate', () => {
  // In German "19.000" is nineteen thousand; in English "19,000" is nineteen thousand.
  assert.deepEqual(errors(invoice([line('1', '1,00', '19.000')]), { notation: 'de' }), [
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
  assert.deepEqual(errors(invoice([line('1', '1.00', '19,000')]), { notation: 'en' }), [
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
  // German "19.00" is a malformed group, not 19.00 %.
  assert.deepEqual(errors(invoice([line('1', '1,00', '19.00')]), { notation: 'de' }), [
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
});

test('near-miss rates stay unsupported in every notation', () => {
  for (const [vatRate, notation] of [['19,01', 'de'], ['18,99', 'de'], ['7,5', 'de'], ['19.01', 'en'], ['7.5', 'en'], ['19.01', 'canonical']] as const) {
    assert.deepEqual(errors(invoice([line('1', '1', vatRate)]), { notation }), [
      { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
    ]);
  }
});

test('the VAT category is never inferred from the rate', () => {
  // Rate 19 does not make category Z or a missing category valid, and rate 0 does not imply category Z.
  assert.deepEqual(errors(invoice([{ quantity: '1', unitPrice: '1', vatCategory: 'Z', vatRate: '19' }])), [
    { code: 'unsupported_vat_category', path: 'lines[0].vatCategory' },
  ]);
  assert.deepEqual(errors(invoice([{ quantity: '1', unitPrice: '1', vatRate: '19.00' }])), [
    { code: 'unsupported_vat_category', path: 'lines[0].vatCategory' },
  ]);
  assert.deepEqual(errors(invoice([{ quantity: '1', unitPrice: '1', vatCategory: 'Z', vatRate: '0' }])), [
    { code: 'unsupported_vat_category', path: 'lines[0].vatCategory' },
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
});

// ---------------------------------------------------------------- DE / EN / canonical input at invoice level

test('regression holds in every notation: ten lines of EUR 0.03 at 19% -> 0.30 / 0.06 / 0.36', () => {
  const cases: Array<[notation: 'canonical' | 'de' | 'en', price: string, rate: string]> = [
    ['canonical', '0.03', '19'],
    ['en', '0.03', '19.00'],
    ['de', '0,03', '19,00'],
  ];
  for (const [notation, price, rate] of cases) {
    const totals = ok(invoice(Array.from({ length: 10 }, () => line('1', price, rate))), { notation });
    assert.equal(formatDecimal(totals.vatBreakdown[0]!.taxableAmount), '0.30', notation);
    assert.equal(formatDecimal(totals.totalVat), '0.06', notation);
    assert.equal(formatDecimal(totals.totalWithVat), '0.36', notation);
  }
});

test('DE and EN inputs of the same amounts give identical results', () => {
  // 1.5 x 1234.56 = 1851.84; VAT 19%: 1851.84 x 0.19 = 351.8496 -> 351.85; gross 2203.69
  const de = ok(invoice([line('1,5', '1.234,56', '19,00')]), { notation: 'de' });
  const en = ok(invoice([line('1.5', '1,234.56', '19.00')]), { notation: 'en' });
  const canonical = ok(invoice([line('1.5', '1234.56', '19')]), { notation: 'canonical' });
  for (const totals of [de, en, canonical]) {
    assert.equal(formatDecimal(totals.lines[0]!.netAmount), '1851.84');
    assert.equal(formatDecimal(totals.totalVat), '351.85');
    assert.equal(formatDecimal(totals.totalWithVat), '2203.69');
  }
  assert.deepEqual(de, en);
  assert.deepEqual(en, canonical);
});

test('canonical notation is the default and rejects localized amounts', () => {
  assert.deepEqual(errors(invoice([line('1,5', '1.234,56')])), [
    { code: 'invalid_decimal', path: 'lines[0].quantity' },
    { code: 'invalid_decimal', path: 'lines[0].unitPrice' },
  ]);
  assert.deepEqual(errors(invoice([line('1,5', '1.234,56')]), { notation: 'canonical' }), [
    { code: 'invalid_decimal', path: 'lines[0].quantity' },
    { code: 'invalid_decimal', path: 'lines[0].unitPrice' },
  ]);
});

test('amounts in the wrong locale are rejected, never reinterpreted', () => {
  assert.deepEqual(errors(invoice([line('1,5', '1,234.56')]), { notation: 'de' }), [
    { code: 'invalid_decimal', path: 'lines[0].unitPrice' },
  ]);
  assert.deepEqual(errors(invoice([line('1.5', '1.234,56')]), { notation: 'en' }), [
    { code: 'invalid_decimal', path: 'lines[0].unitPrice' },
  ]);
  // "1,5" is not one and a half in English, and "1.5" is not one and a half in German
  assert.deepEqual(errors(invoice([line('1,5', '1.00')]), { notation: 'en' }), [
    { code: 'invalid_decimal', path: 'lines[0].quantity' },
  ]);
  assert.deepEqual(errors(invoice([line('1.5', '1,00')]), { notation: 'de' }), [
    { code: 'invalid_decimal', path: 'lines[0].quantity' },
  ]);
});

test('localized negative amounts are rejected explicitly', () => {
  assert.deepEqual(errors(invoice([line('-1,5', '1,00')]), { notation: 'de' }), [
    { code: 'negative_amount', path: 'lines[0].quantity' },
  ]);
  assert.deepEqual(errors(invoice([line('1.5', '-1,234.56')]), { notation: 'en' }), [
    { code: 'negative_amount', path: 'lines[0].unitPrice' },
  ]);
});

test('the provisional input guard is reported per field in every notation', () => {
  const tooLong = '1'.repeat(PROVISIONAL_INPUT_LENGTH_GUARD + 1);
  for (const notation of ['canonical', 'de', 'en'] as const) {
    assert.deepEqual(errors(invoice([line(tooLong, '1')]), { notation }), [
      { code: 'input_length_guard', path: 'lines[0].quantity' },
    ]);
  }
  // The rate field is subject to the same guard; a rate can never be a supported one when it is that long.
  assert.deepEqual(errors(invoice([line('1', '1', '1'.repeat(PROVISIONAL_INPUT_LENGTH_GUARD + 1))])), [
    { code: 'unsupported_vat_rate', path: 'lines[0].vatRate' },
  ]);
});

// ---------------------------------------------------------------- large exact values and retained behaviour

test('large exact values stay exact through the whole calculation', () => {
  // 12345678901234567890.5 x 2 = 24691357802469135781.0 -> 24691357802469135781.00
  // VAT 19%: 24691357802469135781.00 x 19 / 100 = 4691357982469135798.39 (exact; 24691357802469135781 x 19 = 469135798246913579839)
  // Gross: 24691357802469135781.00 + 4691357982469135798.39 = 29382715784938271579.39
  const inputs: Array<[notation: 'canonical' | 'de' | 'en', quantity: string]> = [
    ['canonical', '12345678901234567890.5'],
    ['de', '12345678901234567890,5'],
    ['en', '12345678901234567890.5'],
  ];
  for (const [notation, quantity] of inputs) {
    const totals = ok(invoice([line(quantity, '2')]), { notation });
    assert.equal(formatDecimal(totals.lines[0]!.netAmount), '24691357802469135781.00', notation);
    assert.equal(formatDecimal(totals.totalVat), '4691357982469135798.39', notation);
    assert.equal(formatDecimal(totals.totalWithVat), '29382715784938271579.39', notation);
  }
});

test('grouped German and English input reaches the same large totals as canonical input', () => {
  // 1,000,000 x 999,999.99 = 999,999,990,000.00; VAT 19% = 189,999,998,100.00; gross 1,189,999,988,100.00
  for (const [notation, quantity, price] of [
    ['de', '1.000.000', '999.999,99'],
    ['en', '1,000,000', '999,999.99'],
  ] as const) {
    const totals = ok(invoice([line(quantity, price)]), { notation });
    assert.equal(formatDecimal(totals.totalWithoutVat), '999999990000.00', notation);
    assert.equal(formatDecimal(totals.totalVat), '189999998100.00', notation);
    assert.equal(formatDecimal(totals.totalWithVat), '1189999988100.00', notation);
  }
});

test('retained monetary behaviour under localized input: HALF_UP per line and per bucket, no per-line VAT summation', () => {
  // DE: 0,5 x 0,01 = 0.005 -> 0.01 (line); two lines of 0,50 at 7% -> bucket 1.00, VAT 0.07 (not 0.04 + 0.04)
  const half = ok(invoice([line('0,5', '0,01')]), { notation: 'de' });
  assert.equal(formatDecimal(half.lines[0]!.netAmount), '0.01');
  const buckets = ok(invoice([line('1', '0,50', '7,00'), line('1', '0,50', '7')]), { notation: 'de' });
  assert.equal(formatDecimal(buckets.vatBreakdown[0]!.taxableAmount), '1.00');
  assert.equal(formatDecimal(buckets.totalVat), '0.07');
});

test('the amounts of a supported invoice do not depend on which notation carried them (determinism)', () => {
  const de = invoice([line('2', '10,00', '19,00'), line('1', '5,50', '7,00'), line('3', '1,10', '19')]);
  const en = invoice([line('2', '10.00', '19.00'), line('1', '5.50', '7.00'), line('3', '1.10', '19')]);
  const first = ok(de, { notation: 'de' });
  for (let i = 0; i < 3; i++) assert.deepEqual(ok(de, { notation: 'de' }), first);
  assert.deepEqual(ok(en, { notation: 'en' }), first);
  // 19%: 23.30 -> 4.43; 7%: 5.50 -> 0.39; gross 33.62 (hand calculation)
  assert.equal(formatDecimal(first.totalVat), '4.82');
  assert.equal(formatDecimal(first.totalWithVat), '33.62');
});

test('an unknown notation is rejected instead of falling back to canonical', () => {
  assert.throws(() => calculateInvoiceTotals(invoice([line('1', '1')]), { notation: 'fr' as never }));
});
