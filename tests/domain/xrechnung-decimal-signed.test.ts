import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abs,
  add,
  compare,
  effectiveFractionDigits,
  formatDecimal,
  multiply,
  negate,
  parseDecimal,
  roundHalfUp,
  subtract,
  type Decimal,
} from '../../src/lib/domain/xrechnung/decimal.ts';

// Signed exact kernel (M2-A Foundation Slice 2A). parseDecimal stays non-negative by design, so signed test values are built with
// negate(). Expected strings are worked out by hand, not produced by the code under test.

function d(input: string): Decimal {
  const negative = input.startsWith('-');
  const result = parseDecimal(negative ? input.slice(1) : input);
  assert.equal(result.ok, true, `expected "${input}" to parse`);
  if (!result.ok) return assert.fail('unreachable');
  return negative ? negate(result.value) : result.value;
}

const fmt = formatDecimal;
const round2 = (input: string): string => fmt(roundHalfUp(d(input), 2));

// Magnitudes spanning scales, ties, near-ties and beyond 2^53.
const SAMPLES = [
  '0', '0.00', '0.001', '0.004', '0.005', '0.0049', '0.0051', '0.015', '0.025', '0.5', '1', '1.5', '1.0049', '1.005', '1.0051',
  '2.675', '7', '7.10', '99.995', '100', '0.385', '9007199254740993', '123456789012345678901234567890.123456789',
];

test('signed HALF_UP rounds ties away from zero: +1.005 -> 1.01, -1.005 -> -1.01', () => {
  assert.equal(round2('1.005'), '1.01');
  assert.equal(round2('-1.005'), '-1.01');
  assert.equal(round2('0.005'), '0.01');
  assert.equal(round2('-0.005'), '-0.01');
  assert.equal(round2('2.675'), '2.68');
  assert.equal(round2('-2.675'), '-2.68');
  assert.equal(round2('-0.025'), '-0.03');
  assert.equal(round2('-99.995'), '-100.00');
});

test('signed HALF_UP near-ties fall on the same side of the half for both signs', () => {
  assert.equal(round2('1.0049'), '1.00');
  assert.equal(round2('-1.0049'), '-1.00');
  assert.equal(round2('1.0051'), '1.01');
  assert.equal(round2('-1.0051'), '-1.01');
  assert.equal(round2('-0.0049'), '0.00');
  assert.equal(round2('-0.0051'), '-0.01');
  assert.equal(round2('-0.333'), '-0.33');
  assert.equal(round2('-0.996'), '-1.00');
});

test('R(-x) = -R(x) for every sample and target scale', () => {
  for (const sample of SAMPLES) {
    for (let scale = 0; scale <= 4; scale += 1) {
      const positive = roundHalfUp(d(sample), scale);
      const mirrored = roundHalfUp(negate(d(sample)), scale);
      assert.equal(compare(mirrored, negate(positive)), 0, `${sample} at scale ${scale}`);
      assert.equal(mirrored.scale, scale);
    }
  }
});

test('a negative value that rounds to zero formats as plain zero, never -0.00', () => {
  assert.equal(round2('-0.004'), '0.00');
  assert.equal(round2('-0.001'), '0.00');
  assert.equal(fmt(roundHalfUp(d('-0.4'), 0)), '0');
});

test('roundHalfUp pads signed values that already have fewer decimals than the target', () => {
  assert.equal(round2('-7'), '-7.00');
  assert.equal(round2('-7.1'), '-7.10');
  assert.equal(round2('-7.10'), '-7.10');
});

test('formatDecimal is sign-safe around zero and for negative fractions', () => {
  assert.equal(fmt(d('-0.05')), '-0.05'); // never "0.-5"
  assert.equal(fmt(d('-0.5')), '-0.5'); // never "-.5"
  assert.equal(fmt(d('-0.001')), '-0.001');
  assert.equal(fmt(d('-12.30')), '-12.30');
  assert.equal(fmt(d('-7')), '-7');
  assert.equal(fmt(d('-0')), '0');
  assert.equal(fmt(d('-0.00')), '0.00');
  assert.equal(fmt({ units: -5n, scale: 3 }), '-0.005');
  assert.equal(fmt({ units: 5n, scale: 3 }), '0.005');
  assert.equal(fmt({ units: -123n, scale: 0 }), '-123');
  assert.doesNotMatch(fmt({ units: -1n, scale: 5 }), /\.-|^-\./);
});

test('construction/format round-trip: formatting a signed value and rebuilding it is the identity', () => {
  for (const sample of SAMPLES) {
    for (const value of [d(sample), negate(d(sample))]) {
      const text = fmt(value);
      assert.equal(fmt(d(text)), text, text);
      assert.equal(compare(d(text), value), 0, text);
    }
  }
});

test('negate: -(-x) = x, negate(0) = 0, scale kept', () => {
  for (const sample of SAMPLES) {
    const x = d(sample);
    assert.equal(fmt(negate(negate(x))), fmt(x), sample);
    assert.equal(negate(x).scale, x.scale);
  }
  assert.equal(fmt(negate(d('0.00'))), '0.00');
  assert.equal(fmt(negate(d('1.50'))), '-1.50');
  assert.equal(fmt(negate(d('-1.50'))), '1.50');
});

test('abs returns the magnitude with the scale kept', () => {
  assert.equal(fmt(abs(d('-1.50'))), '1.50');
  assert.equal(fmt(abs(d('1.50'))), '1.50');
  assert.equal(fmt(abs(d('0.00'))), '0.00');
  assert.equal(fmt(abs(d('-0.005'))), '0.005');
});

test('x + (-x) = 0 at the larger operand scale, for every sample', () => {
  for (const sample of SAMPLES) {
    const x = d(sample);
    const sum = add(x, negate(x));
    assert.equal(sum.units, 0n, sample);
    assert.equal(compare(sum, d('0')), 0, sample);
    assert.equal(sum.scale, x.scale);
  }
});

test('add is sign-correct across mixed scales and signs (hand-worked)', () => {
  assert.equal(fmt(add(d('1.5'), d('-2.25'))), '-0.75');
  assert.equal(fmt(add(d('-1.5'), d('2.25'))), '0.75');
  assert.equal(fmt(add(d('-1.5'), d('-2.25'))), '-3.75');
  assert.equal(fmt(add(d('0.1'), d('-0.10'))), '0.00');
  assert.equal(fmt(add(d('-9007199254740993'), d('9007199254740994'))), '1');
});

test('subtract is hand-worked, and equals x + (-y) across all sign and scale combinations', () => {
  assert.equal(fmt(subtract(d('1.5'), d('2.25'))), '-0.75');
  assert.equal(fmt(subtract(d('2.25'), d('1.5'))), '0.75');
  assert.equal(fmt(subtract(d('0.1'), d('0.10'))), '0.00');
  assert.equal(fmt(subtract(d('-1.5'), d('-2.25'))), '0.75');
  assert.equal(fmt(subtract(d('-1.5'), d('2.25'))), '-3.75');
  assert.equal(fmt(subtract(d('9007199254740994'), d('9007199254740993'))), '1');
  for (const a of SAMPLES) {
    for (const b of SAMPLES) {
      const pairs: Array<[Decimal, Decimal]> = [[d(a), d(b)], [negate(d(a)), d(b)], [d(a), negate(d(b))], [negate(d(a)), negate(d(b))]];
      for (const [x, y] of pairs) assert.equal(fmt(subtract(x, y)), fmt(add(x, negate(y))), `${fmt(x)} - ${fmt(y)}`);
    }
  }
});

test('multiplication sign rules: scales add, the sign is the product of signs, zero has no sign', () => {
  assert.equal(fmt(multiply(d('1.5'), d('2'))), '3.0');
  assert.equal(fmt(multiply(d('-1.5'), d('2'))), '-3.0');
  assert.equal(fmt(multiply(d('1.5'), d('-2'))), '-3.0');
  assert.equal(fmt(multiply(d('-1.5'), d('-2'))), '3.0');
  assert.equal(fmt(multiply(d('-0.03'), d('0.19'))), '-0.0057');
  assert.equal(fmt(multiply(d('-0.03'), d('-0.19'))), '0.0057');
  assert.equal(fmt(multiply(d('-1.5'), d('0'))), '0.0');
  assert.equal(fmt(multiply(d('0'), d('-1.5'))), '0.0');
  assert.equal(fmt(multiply(d('-9007199254740993'), d('2'))), '-18014398509481986');
});

test('signed line net: quantity x price rounded to cents mirrors the positive result', () => {
  for (const [quantity, price] of [['2.5', '0.01'], ['1.005', '1'], ['0.5', '0.01'], ['3', '0.335']] as const) {
    const positive = fmt(roundHalfUp(multiply(d(quantity), d(price)), 2));
    const negated = fmt(roundHalfUp(multiply(d(`-${quantity}`), d(price)), 2));
    assert.equal(negated, `-${positive}`, `${quantity} x ${price}`);
  }
});

test('compare orders exact values across negative, zero and positive, regardless of scale', () => {
  assert.equal(compare(d('-1'), d('1')), -1);
  assert.equal(compare(d('1'), d('-1')), 1);
  assert.equal(compare(d('-0.01'), d('0')), -1);
  assert.equal(compare(d('0'), d('-0.01')), 1);
  assert.equal(compare(d('-0'), d('0.00')), 0);
  assert.equal(compare(d('-0.10'), d('-0.1')), 0);
  assert.equal(compare(d('-0.11'), d('-0.1')), -1);
  assert.equal(compare(d('-0.1'), d('-0.11')), 1);
  assert.equal(compare(d('-10000000000.00'), d('-9999999999.99')), -1);
  assert.equal(compare(d('-9007199254740994'), d('-9007199254740993')), -1);
});

test('two-sided magnitude bounds: compare(abs(x), max) treats x and -x identically, exclusive upper bound', () => {
  const max = d('1000000000'); // 10^9, exclusive
  const cases: Array<[string, -1 | 0 | 1]> = [
    ['999999999.999999', -1],
    ['1000000000', 0],
    ['1000000000.000000', 0],
    ['1000000000.000001', 1],
  ];
  for (const [input, expected] of cases) {
    assert.equal(compare(abs(d(input)), max), expected, input);
    assert.equal(compare(abs(d(`-${input}`)), max), expected, `-${input}`);
  }
  // The one-sided compare alone would wrongly accept every large negative value; that is why abs() exists.
  assert.equal(compare(d('-2000000000'), max), -1);
  assert.equal(compare(abs(d('-2000000000')), max), 1);
});

test('effectiveFractionDigits is sign-agnostic and leaves the value untouched', () => {
  for (const [input, digits] of [['-1.2300', 2], ['-1.0000', 0], ['-0.000001', 6], ['-120', 0], ['-120.50', 1]] as const) {
    const value = d(input);
    assert.equal(effectiveFractionDigits(value), digits, input);
    assert.equal(fmt(value), input);
  }
});

test('the public input boundary stays non-negative: parseDecimal still rejects every signed string', () => {
  for (const input of ['-1', '-0.01', '-0', '-0.00', '-1000.50', '-1.005']) {
    assert.deepEqual(parseDecimal(input), { ok: false, code: 'negative_amount' }, input);
  }
});
