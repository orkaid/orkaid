import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatDecimal,
  multiply,
  parseDecimal,
  roundHalfUp,
} from '../../src/lib/domain/xrechnung/decimal.ts';

// Expected strings below are worked out by hand, not produced by the code under test.

function parsed(input: string) {
  const result = parseDecimal(input);
  assert.equal(result.ok, true, `expected "${input}" to parse`);
  return result.ok ? result.value : assert.fail('unreachable');
}

// quantity x unit price, rounded to two decimals (the BT-131 boundary)
function lineNet(quantity: string, unitPrice: string): string {
  return formatDecimal(roundHalfUp(multiply(parsed(quantity), parsed(unitPrice)), 2));
}

test('parseDecimal keeps the input scale, including trailing zeros', () => {
  assert.equal(formatDecimal(parsed('10.50')), '10.50');
  assert.equal(formatDecimal(parsed('0.03')), '0.03');
  assert.equal(formatDecimal(parsed('7')), '7');
  assert.equal(formatDecimal(parsed('0.0049')), '0.0049');
});

test('parseDecimal accepts values that are inexact in binary floating-point without drift', () => {
  // 0.1 + 0.2 style traps: the digits must survive exactly.
  assert.equal(formatDecimal(parsed('0.1')), '0.1');
  assert.equal(formatDecimal(parsed('1.005')), '1.005');
  assert.equal(formatDecimal(parsed('9007199254740993')), '9007199254740993'); // 2^53 + 1
  assert.equal(formatDecimal(parsed('123456789012345678901234567890.123456789')), '123456789012345678901234567890.123456789');
});

test('multiply is exact: scales add and no digit is lost', () => {
  assert.equal(formatDecimal(multiply(parsed('1.5'), parsed('0.01'))), '0.015');
  assert.equal(formatDecimal(multiply(parsed('2.675'), parsed('1'))), '2.675');
  assert.equal(formatDecimal(multiply(parsed('0.03'), parsed('0.19'))), '0.0057');
});

test('roundHalfUp rounds exact half-cent cases up (positive values)', () => {
  assert.equal(lineNet('0.5', '0.01'), '0.01'); // 0.005 -> 0.01 (half-even would give 0.00)
  assert.equal(lineNet('2.5', '0.01'), '0.03'); // 0.025 -> 0.03 (half-even would give 0.02)
  assert.equal(lineNet('1.005', '1'), '1.01'); // binary floats give 1.00
  assert.equal(lineNet('2.675', '1'), '2.68'); // binary floats give 2.67
  assert.equal(lineNet('0.385', '1'), '0.39'); // 0.385 -> 0.39
});

test('roundHalfUp rounds below the half down and above the half up', () => {
  assert.equal(lineNet('0.0049', '1'), '0.00');
  assert.equal(lineNet('0.004', '1'), '0.00');
  assert.equal(lineNet('0.333', '1'), '0.33');
  assert.equal(lineNet('0.0051', '1'), '0.01');
  assert.equal(lineNet('0.996', '1'), '1.00');
});

test('roundHalfUp pads values that already have fewer decimals than the target', () => {
  assert.equal(formatDecimal(roundHalfUp(parsed('7'), 2)), '7.00');
  assert.equal(formatDecimal(roundHalfUp(parsed('7.1'), 2)), '7.10');
  assert.equal(formatDecimal(roundHalfUp(parsed('7.10'), 2)), '7.10');
});

test('parseDecimal rejects malformed decimal input explicitly', () => {
  const malformed: unknown[] = [
    '',
    ' ',
    ' 1',
    '1 ',
    'abc',
    '1e3',
    '1E3',
    '1,5',
    '.5',
    '5.',
    '+1',
    '1.2.3',
    'NaN',
    'Infinity',
    '0x10',
    '１２', // full-width digits
    '-',
    '-abc',
    1.5,
    10,
    10n,
    null,
    undefined,
    {},
    ['1'],
  ];
  for (const input of malformed) {
    assert.deepEqual(parseDecimal(input), { ok: false, code: 'invalid_decimal' }, `input: ${String(input)}`);
  }
});

test('parseDecimal rejects negative amounts with a dedicated code', () => {
  for (const input of ['-1', '-0.01', '-0', '-0.00', '-1000.50']) {
    assert.deepEqual(parseDecimal(input), { ok: false, code: 'negative_amount' }, `input: ${input}`);
  }
});

test('parseDecimal applies a protective length guard with its own distinct code', () => {
  const huge = '1'.repeat(10_000);
  assert.deepEqual(parseDecimal(huge), { ok: false, code: 'input_length_guard' });
});
