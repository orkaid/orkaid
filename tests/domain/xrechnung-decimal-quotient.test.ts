import assert from 'node:assert/strict';
import test from 'node:test';

import {
  add,
  formatDecimal,
  multiply,
  negate,
  parseDecimal,
  roundHalfUp,
  roundQuotientHalfUp,
  type Decimal,
} from '../../src/lib/domain/xrechnung/decimal.ts';

// Exact rounded quotient (M2-A Foundation Slice 2B). The primitive evaluates numerator / denominator exactly and rounds
// once at the requested output scale; it has no internal precision to configure and exposes no intermediate quotient.
// parseDecimal stays non-negative by design, so signed test values are built with negate(). Every expected string below
// is worked out by hand; the independent oracle is checked against those hand values before it is trusted.

function d(input: string): Decimal {
  const negative = input.startsWith('-');
  const result = parseDecimal(negative ? input.slice(1) : input);
  assert.equal(result.ok, true, `expected "${input}" to parse`);
  if (!result.ok) return assert.fail('unreachable');
  return negative ? negate(result.value) : result.value;
}

const fmt = formatDecimal;
const same = (a: Decimal, b: Decimal): boolean => a.units === b.units && a.scale === b.scale;

type Quotient = (numerator: Decimal, denominator: Decimal, outputScale: number) => Decimal;

// ---------------------------------------------------------------------------------------------------------------
// The independent oracle. It shares no code and no method with the implementation under test:
//  - the implementation splits the sign, scales both operands to one integer ratio and decides the tie with
//    2 * remainder >= divisor; the oracle works on gcd-reduced fractions, never splits the sign, and picks the nearest
//    candidate quantum by comparing exact distances |target - k * q| (cross-multiplication), breaking a tie towards the
//    larger magnitude;
//  - BigInt division is used only to seed the candidate window {seed - 1, seed, seed + 1}; the choice inside it is by
//    distance, so a wrong seed direction cannot produce a wrong answer as long as the true nearest is in the window.

const magnitudeOf = (x: bigint): bigint => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  let x = magnitudeOf(a);
  let y = magnitudeOf(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

type Fraction = { readonly p: bigint; readonly q: bigint }; // q > 0, in lowest terms

function reduced(p: bigint, q: bigint): Fraction {
  const g = gcd(p, q);
  return { p: p / g, q: q / g };
}

const fractionOf = (value: Decimal): Fraction => reduced(value.units, 10n ** BigInt(value.scale));

function oracleUnits(numerator: Decimal, denominator: Decimal, outputScale: number): bigint {
  const a = fractionOf(numerator);
  const b = fractionOf(denominator);
  const value = reduced(a.p * b.q, a.q * b.p); // a / b with b.p > 0
  const target = value.p * 10n ** BigInt(outputScale); // value * 10^s == target / value.q
  const seed = target / value.q;
  const distance = (k: bigint): bigint => magnitudeOf(target - k * value.q);
  return [seed - 1n, seed, seed + 1n].reduce((best, k) => {
    const dk = distance(k);
    const db = distance(best);
    if (dk < db) return k;
    if (dk > db) return best;
    return magnitudeOf(k) > magnitudeOf(best) ? k : best;
  });
}

const oracle = (numerator: Decimal, denominator: Decimal, outputScale: number): Decimal => ({
  units: oracleUnits(numerator, denominator, outputScale),
  scale: outputScale,
});

// Hand-worked cases: [numerator, denominator, output scale, expected]. Used to prove the oracle, and the primitive, on
// values a reader can verify by eye, including exact ties and negative ties at mixed scales.
const HAND: readonly (readonly [string, string, number, string])[] = [
  ['1', '3', 2, '0.33'],
  ['2', '3', 2, '0.67'],
  ['-2', '3', 2, '-0.67'],
  ['0.005', '1', 2, '0.01'],
  ['-0.005', '1', 2, '-0.01'],
  ['1', '8', 2, '0.13'], // 0.125, exact tie
  ['-1', '8', 2, '-0.13'],
  ['1', '8', 3, '0.125'],
  ['5', '2', 0, '3'], // 2.5
  ['-5', '2', 0, '-3'],
  ['7', '2', 0, '4'], // 3.5
  ['0.3', '0.6', 0, '1'], // 0.5, numerator and denominator at the same scale
  ['-0.3', '0.6', 0, '-1'],
  ['1.5', '0.3', 0, '5'],
  ['1', '0.03', 1, '33.3'], // denominator scale larger than numerator scale
  ['100', '7', 4, '14.2857'],
  ['-100', '7', 4, '-14.2857'],
  ['0.001', '6', 2, '0.00'],
  ['0.03', '6', 2, '0.01'], // 0.005, exact tie with a non-trivial denominator
  ['-0.03', '6', 2, '-0.01'],
  ['0.0005', '0.1', 2, '0.01'], // 0.005 again, from numerator scale 4 and denominator scale 1
  ['-0.0005', '0.1', 2, '-0.01'],
  ['1', '1.00', 2, '1.00'], // denominator 1 written with trailing zeros
  ['12.345', '10', 2, '1.23'],
  ['12.355', '10', 2, '1.24'],
  ['-12.355', '10', 2, '-1.24'],
  ['0', '7', 2, '0.00'],
];

// ---------------------------------------------------------------------------------------------------------------
// Sample space for the oracle comparison: every numerator (both signs) x every denominator x output scales 0..6, plus a
// deterministic pseudo-random set with wide digit counts and independent numerator/denominator scales.

const NUMERATORS = [
  '0', '0.00', '1', '3', '0.015', '0.005', '0.014999', '0.375', '1.005', '2.675', '99.995', '7.10', '0.001', '0.0049', '0.0051',
  '2.5', '0.5', '9007199254740993', '123456789012345678901234567890.123456789',
];
const DENOMINATORS = [
  '1', '1.00', '3', '7', '6', '12', '0.3', '0.03', '0.6', '4', '8', '0.125', '10', '100', '0.1', '1.5', '1000000007', '3.000', '0.0007',
];

function* matrix(): Generator<[Decimal, Decimal, number]> {
  for (const n of NUMERATORS) {
    for (const sign of ['', '-']) {
      for (const den of DENOMINATORS) {
        for (let scale = 0; scale <= 6; scale += 1) yield [d(sign + n), d(den), scale];
      }
    }
  }
}

function* pseudoRandom(count: number): Generator<[Decimal, Decimal, number]> {
  let state = 0x9e3779b97f4a7c15n;
  const next = (): bigint => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    state &= (1n << 64n) - 1n;
    return state;
  };
  const digits = (length: bigint): bigint => {
    let value = 0n;
    for (let i = 0n; i < length; i += 1n) value = value * 10n + (next() % 10n);
    return value;
  };
  for (let i = 0; i < count; i += 1) {
    const units = digits(next() % 40n + 1n) * (next() % 2n === 0n ? 1n : -1n);
    const denominatorUnits = digits(next() % 25n + 1n) + 1n; // strictly positive
    yield [
      { units, scale: Number(next() % 13n) },
      { units: denominatorUnits, scale: Number(next() % 9n) },
      Number(next() % 9n),
    ];
  }
}

const RANDOM_COUNT = 3000;

// ---------------------------------------------------------------------------------------------------------------
// Check categories. Each takes an implementation and returns how many assertions failed, so the very same checks run
// against the real primitive (must be 0) and against each deliberately wrong mutant (must be > 0). Preconditions are a
// separate category: every mutant keeps the real guards, so a mutant can only be killed by arithmetic, never by a throw.

function checkHand(impl: Quotient): number {
  return HAND.filter(([n, den, s, expected]) => fmt(impl(d(n), d(den), s)) !== expected).length;
}

// Adversarial exact vectors (V01..V05, V23), expressed as the numerator quantity x price (exact product) over the base quantity.
const VECTORS: readonly (readonly [string, Decimal, Decimal, string])[] = [
  ['V01 terminating: 3 x 1 / 4', multiply(d('3'), d('1')), d('4'), '0.75'],
  ['V02 recurring cancels: 3 x 1 / 3', multiply(d('3'), d('1')), d('3'), '1.00'],
  ['V03 observable third: 1 x 1 / 3', multiply(d('1'), d('1')), d('3'), '0.33'],
  ['V04 positive exact half-cent: .015 x 1 / 3', multiply(d('0.015'), d('1')), d('3'), '0.01'],
  ['V05 negative exact half-cent: -.015 x 1 / 3', negate(multiply(d('0.015'), d('1'))), d('3'), '-0.01'],
  ['V23 below the tie: 1 x .014999 / 3', multiply(d('1'), d('0.014999')), d('3'), '0.00'],
];

function checkVector(impl: Quotient, label: string): number {
  const found = VECTORS.find(([name]) => name.startsWith(label));
  assert.ok(found, label);
  const [, n, den, expected] = found;
  return fmt(impl(n, den, 2)) === expected ? 0 : 1;
}

// Two exact constructions of a value just below a half-unit tie that a finite intermediate precision rounds onto the tie.
// Neither is a list of magic scales: each is a function of a free parameter, and the lemma below says why it works.
//
// Family 1, absolute precision m (m >= s + 1), output scale s, divisor D = 3:
//   N = 15 * 10^-(s+1) - 10^-(m+s), so N / 3 = T - e with the tie T = 5 * 10^-(s+1) and the gap e = 10^-(m+s) / 3 > 0.
//   Exact HALF_UP at s sees a value strictly below the tie and returns 0 (0.00 for s = 2).
//   Rounding first at m digits: T is a whole multiple of 10^-m (because m >= s + 1) and e < 10^-m / 2 (because 10^-s / 3 < 1 / 2),
//   so the nearest multiple of 10^-m is exactly T. The second rounding at s then meets an exact tie and moves away from zero.
//   Hence the pre-round-at-m answer is +/-1 unit at scale s, while the exact answer is 0, for EVERY m >= s + 1.
//
// Family 2, large divisor (independent of the numerator's scale), s = 2, T = 0.005:
//   D = 10^j + 1 and N = (5 * 10^j + 4) / 1000, so N / D = T - 0.001 / D, a gap of about 10^-(j+3). Rounding first at any M with
//   3 <= M <= j + 2 digits lands exactly on T (M >= 3 so that T is a multiple of 10^-M); this also defeats a precision derived from
//   the operands' own scales, which family 1 cannot.
//
// Family 3, tightest gap for a divisor of t + 3 digits (s = 2): N = 10^t and D = 2 * 10^(t+2) + 1, so N / D = T - 0.005 / D, a gap of
//   exactly 1 / (200 * D), the smallest possible for a divisor that size. Rounding first at any M with 3 <= M <= t + 4 lands on T.
//   This defeats a precision derived from the divisor's digit count (a MathContext-style choice), which families 1 and 2 sit too far
//   from the tie to reach.
//
// Kill power is monotone: one instance with parameter p defeats every constant pre-round precision M between its lower bound and its
// upper bound (family 1: 3 <= M <= m + 2). The dense sweeps therefore also guard the generators against off-by-one slips; the
// ladder's largest instance already covers its whole interval.
//
// The executed sweeps below are finite samples of these families. The lemma is the general statement; running them is evidence about
// the parameters sampled (every constant precision 3..16386 for family 1) and is not a proof over all finite precisions: a constant
// precision beyond the largest instance survives, and no finite test can exclude that.
const nearTie = (m: number, sign: 1n | -1n = 1n, s = 2): Decimal => ({ units: sign * (15n * 10n ** BigInt(m - 1) - 1n), scale: m + s });
const largeDenominatorTie = (j: number, sign: 1n | -1n = 1n): { numerator: Decimal; denominator: Decimal } => ({
  numerator: { units: sign * (5n * 10n ** BigInt(j) + 4n), scale: 3 },
  denominator: { units: 10n ** BigInt(j) + 1n, scale: 0 },
});

const tightGapTie = (tExp: number, sign: 1n | -1n = 1n): { numerator: Decimal; denominator: Decimal } => ({
  numerator: { units: sign * 10n ** BigInt(tExp), scale: 0 },
  denominator: { units: 2n * 10n ** BigInt(tExp + 2) + 1n, scale: 0 },
});

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const LADDER = [512, 1024, 2048, 4096, 8192, 16384];
const NEAR_TIE_SWEEP = [...range(3, 320), ...LADDER];
const LARGE_DENOMINATOR_SWEEP = [...range(4, 160), 256, 512, 1024];
const TIGHT_GAP_SWEEP = [...range(1, 160), 256, 512, 1024];
function checkTightGapFamily(impl: Quotient): number {
  let failures = 0;
  for (const tExp of TIGHT_GAP_SWEEP) {
    for (const sign of [1n, -1n] as const) {
      const { numerator, denominator } = tightGapTie(tExp, sign);
      if (fmt(impl(numerator, denominator, 2)) !== '0.00') failures += 1;
    }
  }
  return failures;
}

// Scales used where a full sweep would be wasteful: the kill-map mutants and the symmetry spot checks.
const REPRESENTATIVE_SCALES = [3, 4, 6, 12, 30, 60, 100, 128, 256];

function checkNearTieFamily(impl: Quotient): number {
  let failures = 0;
  for (const m of NEAR_TIE_SWEEP) {
    for (const sign of [1n, -1n] as const) {
      if (fmt(impl(nearTie(m, sign), d('3'), 2)) !== '0.00') failures += 1;
    }
  }
  return failures;
}

function checkLargeDenominatorFamily(impl: Quotient): number {
  let failures = 0;
  for (const j of LARGE_DENOMINATOR_SWEEP) {
    for (const sign of [1n, -1n] as const) {
      const { numerator, denominator } = largeDenominatorTie(j, sign);
      if (fmt(impl(numerator, denominator, 2)) !== '0.00') failures += 1;
    }
  }
  return failures;
}

// Fixed, hand-written vectors with more than 30 significant digits around the same half-cent tie (N / 3 = 0.005 exactly
// for the middle row). Below the tie -> 0.00, on it -> 0.01, above it -> 0.01.
const BIG: readonly (readonly [string, string])[] = [
  ['0.014999999999999999999999999999999999999999', '0.00'], // 0.015 - 1e-42, N / 3 = 0.005 - 3.3e-43
  ['0.015000000000000000000000000000000000000000', '0.01'], // 0.015 exactly
  ['0.015000000000000000000000000000000000000003', '0.01'], // 0.015 + 3e-42, N / 3 = 0.005 + 1e-42
  ['-0.014999999999999999999999999999999999999999', '0.00'],
  ['-0.015000000000000000000000000000000000000000', '-0.01'],
  ['-0.015000000000000000000000000000000000000003', '-0.01'],
];

function checkBigFixed(impl: Quotient): number {
  return BIG.filter(([n, expected]) => fmt(impl(d(n), d('3'), 2)) !== expected).length;
}

function checkOracle(impl: Quotient, cases: Iterable<[Decimal, Decimal, number]>): number {
  let failures = 0;
  for (const [n, den, s] of cases) if (!same(impl(n, den, s), oracle(n, den, s))) failures += 1;
  return failures;
}

function checkSymmetry(impl: Quotient): number {
  let failures = 0;
  for (const [n, den, s] of matrix()) {
    if (!same(impl(negate(n), den, s), negate(impl(n, den, s)))) failures += 1;
  }
  for (const m of REPRESENTATIVE_SCALES) {
    if (!same(impl(negate(nearTie(m)), d('3'), 2), negate(impl(nearTie(m), d('3'), 2)))) failures += 1;
  }
  return failures;
}

// The units of a result that rounds to zero must be 0n at the requested scale, whatever the sign of the input.
const ZERO_CASES: readonly (readonly [string, string, number, string])[] = [
  ['-0.001', '3', 2, '0.00'],
  ['0.001', '3', 2, '0.00'],
  ['-0.004', '1', 2, '0.00'],
  ['-0.00499', '1', 2, '0.00'],
  ['-1', '1000', 2, '0.00'],
  ['-0.4', '1', 0, '0'],
  ['-0.0001', '7', 3, '0.000'],
  ['0', '7', 2, '0.00'],
  ['-0.00', '7', 2, '0.00'],
];

function checkZero(impl: Quotient): number {
  let failures = 0;
  for (const [n, den, s, expected] of ZERO_CASES) {
    const result = impl(d(n), d(den), s);
    if (result.units !== 0n || result.scale !== s || fmt(result) !== expected || fmt(result).includes('-')) failures += 1;
  }
  return failures;
}

const real: Quotient = roundQuotientHalfUp;

// ---------------------------------------------------------------------------------------------------------------
// The oracle itself, before it is used to judge anything.

test('oracle: agrees with every hand-worked case (it is not trusted before this)', () => {
  for (const [n, den, s, expected] of HAND) {
    assert.equal(fmt(oracle(d(n), d(den), s)), expected, `${n} / ${den} at scale ${s}`);
  }
  for (const [, n, den, expected] of VECTORS) assert.equal(fmt(oracle(n, den, 2)), expected);
  for (const [n, expected] of BIG) assert.equal(fmt(oracle(d(n), d('3'), 2)), expected, n);
});

test('oracle: sign symmetry holds by construction of its distance rule, including exact ties', () => {
  for (const [n, den, s] of matrix()) {
    assert.ok(same(oracle(negate(n), den, s), negate(oracle(n, den, s))));
  }
});

// ---------------------------------------------------------------------------------------------------------------
// A. Equivalence to the existing rounding. roundHalfUp now shares the private rounding step with the primitive, so this
// proves consistency of the two entry points, not independent correctness; correctness is B-E and the oracle.

test('A: denominator 1 equals roundHalfUp, for every spelling of one', () => {
  const samples = [
    '0', '0.00', '0.001', '0.004', '0.005', '0.0049', '0.0051', '0.015', '0.025', '0.5', '1', '1.5', '1.0049', '1.005', '1.0051',
    '2.675', '7', '7.10', '99.995', '100', '0.385', '9007199254740993', '123456789012345678901234567890.123456789',
  ];
  for (const one of ['1', '1.0', '1.00', '1.000000']) {
    for (const sample of samples) {
      for (const sign of ['', '-']) {
        for (let scale = 0; scale <= 6; scale += 1) {
          const x = d(sign + sample);
          assert.ok(same(roundQuotientHalfUp(x, d(one), scale), roundHalfUp(x, scale)), `${sign}${sample} / ${one} at ${scale}`);
        }
      }
    }
  }
});

test('A: powers-of-ten denominators give the hand-worked rounding of the shifted value', () => {
  const cases: [string, string, number, string][] = [
    ['12.345', '10', 2, '1.23'],
    ['12.355', '10', 2, '1.24'],
    ['-12.355', '10', 2, '-1.24'],
    ['1.005', '0.1', 2, '10.05'],
    ['0.5', '100', 2, '0.01'], // 0.005
    ['-0.5', '100', 2, '-0.01'],
    ['0.49', '100', 2, '0.00'], // 0.0049
    ['25', '1000', 2, '0.03'], // 0.025
    ['-25', '1000', 2, '-0.03'],
    ['1234.5678', '100', 3, '12.346'],
    ['7', '0.01', 0, '700'],
    ['7', '0.01', 2, '700.00'],
  ];
  for (const [n, den, s, expected] of cases) assert.equal(fmt(roundQuotientHalfUp(d(n), d(den), s)), expected, `${n} / ${den}`);
});

// ---------------------------------------------------------------------------------------------------------------
// B. Adversarial exact vectors. Each value is exact: no finite intermediate quotient scale is part of the contract.

test('B: the hand-worked cases hold', () => {
  assert.equal(checkHand(real), 0);
});

for (const [name, n, den, expected] of VECTORS) {
  test(`B: ${name} -> ${expected}`, () => {
    assert.equal(fmt(roundQuotientHalfUp(n, den, 2)), expected);
  });
}

test('B: results are exact at the requested scale and carry that scale', () => {
  assert.deepEqual(roundQuotientHalfUp(d('3'), d('4'), 2), { units: 75n, scale: 2 });
  assert.deepEqual(roundQuotientHalfUp(d('3'), d('4'), 0), { units: 1n, scale: 0 });
  assert.deepEqual(roundQuotientHalfUp(d('3'), d('4'), 1), { units: 8n, scale: 1 });
  assert.deepEqual(roundQuotientHalfUp(d('3'), d('4'), 5), { units: 75000n, scale: 5 });
});

test('B: the >30-digit literals are exactly the half-cent neighbours they claim to be', () => {
  const half = 15n * 10n ** 39n; // 0.015 at scale 42
  const expected = [half - 1n, half, half + 3n, -(half - 1n), -half, -(half + 3n)];
  BIG.forEach(([n], i) => assert.deepEqual(d(n), { units: expected[i], scale: 42 }, n));
});

test('B: just below a tie never rounds up, however many digits separate it from the tie', () => {
  for (const [n, expected] of BIG) assert.equal(fmt(roundQuotientHalfUp(d(n), d('3'), 2)), expected, n);
  for (const m of REPRESENTATIVE_SCALES) {
    assert.equal(fmt(roundQuotientHalfUp(nearTie(m), d('3'), 2)), '0.00', `m=${m}`);
    assert.equal(fmt(roundQuotientHalfUp(nearTie(m, -1n), d('3'), 2)), '0.00', `m=-${m}`);
  }
});

test('B: agreement with the independent oracle over the stated sample space', () => {
  assert.equal(checkOracle(real, matrix()), 0);
  assert.equal(checkOracle(real, pseudoRandom(RANDOM_COUNT)), 0);
  assert.equal([...matrix()].length, NUMERATORS.length * 2 * DENOMINATORS.length * 7); // 5,054 cases, not an empty loop
});

// ---------------------------------------------------------------------------------------------------------------
// C. Signed invariants.

test('C: R(-x) = -R(x) over the matrix and around zero', () => {
  assert.equal(checkSymmetry(real), 0);
  for (let units = 0n; units <= 12n; units += 1n) {
    const x: Decimal = { units, scale: 3 };
    for (const den of ['1', '3', '7', '0.5']) {
      for (let s = 0; s <= 4; s += 1) {
        assert.ok(same(roundQuotientHalfUp(negate(x), d(den), s), negate(roundQuotientHalfUp(x, d(den), s))), `${units} / ${den} at ${s}`);
      }
    }
  }
});

test('C: ties go away from zero for both signs, near-ties stay on their own side', () => {
  assert.equal(fmt(roundQuotientHalfUp(d('1.005'), d('1'), 2)), '1.01');
  assert.equal(fmt(roundQuotientHalfUp(d('-1.005'), d('1'), 2)), '-1.01');
  assert.equal(fmt(roundQuotientHalfUp(d('1.004999'), d('1'), 2)), '1.00');
  assert.equal(fmt(roundQuotientHalfUp(d('-1.004999'), d('1'), 2)), '-1.00');
  assert.equal(fmt(roundQuotientHalfUp(d('1.005001'), d('1'), 2)), '1.01');
  assert.equal(fmt(roundQuotientHalfUp(d('-1.005001'), d('1'), 2)), '-1.01');
  assert.equal(fmt(roundQuotientHalfUp(d('-3'), d('2'), 0)), '-2'); // -1.5 -> -2, not -1
});

// ---------------------------------------------------------------------------------------------------------------
// D. Canonical zero.

test('D: a quotient that rounds to zero is canonical zero, never -0 or -0.00', () => {
  assert.equal(checkZero(real), 0);
  for (const [n, den, s] of ZERO_CASES) {
    const result = roundQuotientHalfUp(d(n), d(den), s);
    assert.equal(result.units, 0n);
    assert.ok(!fmt(result).startsWith('-'), `${n} / ${den}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// E. Preconditions: caller errors throw, they are never normalised away.

const preconditionFailures = (impl: Quotient): number => {
  let failures = 0;
  const expectThrow = (run: () => unknown): void => {
    try {
      run();
      failures += 1;
    } catch (error) {
      if (!(error instanceof RangeError)) failures += 1;
    }
  };
  expectThrow(() => impl(d('1'), d('0'), 2));
  expectThrow(() => impl(d('1'), d('0.00'), 2));
  expectThrow(() => impl(d('0'), d('0'), 2));
  expectThrow(() => impl(d('1'), d('-1'), 2));
  expectThrow(() => impl(d('-1'), d('-3'), 2)); // would be a valid positive quotient if the sign were normalised
  expectThrow(() => impl(d('1'), d('-0.001'), 2));
  expectThrow(() => impl(d('1'), d('3'), -1));
  expectThrow(() => impl(d('1'), d('3'), 0.5));
  expectThrow(() => impl(d('1'), d('0.1'), 0.9999999999999999)); // 1 + 0.9999999999999999 rounds to 2 before any BigInt() sees it
  return failures;
};

test('E: zero and negative denominators and a negative output scale throw RangeError', () => {
  assert.equal(preconditionFailures(real), 0);
  assert.throws(() => roundQuotientHalfUp(d('1'), d('0'), 2), RangeError);
  assert.throws(() => roundQuotientHalfUp(d('-1'), d('-3'), 2), RangeError);
});

test('E: outputScale must be a non-negative integer, checked explicitly rather than by BigInt() coercion', () => {
  const one = d('1');
  const tenth = d('0.1'); // denominator scale 1: the case where a near-integer outputScale used to be added to it first
  const bad = [-1, -0.5, 0.5, 2.5, 1.0000000000000002, 0.9999999999999999, 1.9999999999999998, NaN, Infinity, -Infinity];
  for (const scale of bad) assert.throws(() => roundQuotientHalfUp(one, tenth, scale), RangeError, `scale ${scale}`);
  for (const scale of bad) assert.throws(() => roundQuotientHalfUp(one, d('3'), scale), RangeError, `scale ${scale}, denominator scale 0`);
  for (const scale of [0, 1, 2, 7]) {
    assert.deepEqual(roundQuotientHalfUp(one, tenth, scale), { units: 10n * 10n ** BigInt(scale), scale });
  }
  assert.ok(Object.is(roundQuotientHalfUp(one, tenth, -0).scale, 0), 'a negative-zero scale is normalised to 0');
});

// ---------------------------------------------------------------------------------------------------------------
// Mutation evidence. Each mutant is a deliberately wrong quotient, local to this file, with the real guards. The same
// checks that pass for the primitive must fail for it. Which checks kill which mutant is printed as a test diagnostic and
// the contrast between the fixed vectors and the near-tie family is pinned below.

const pow10 = (n: number): bigint => 10n ** BigInt(n);

// The exact integer ratio the mutants round: numerator.units * 10^(d.scale + s) over d.units * 10^n.scale.
function ratio(n: Decimal, den: Decimal, s: number): { p: bigint; q: bigint } {
  return { p: n.units * pow10(den.scale + s), q: den.units * pow10(n.scale) };
}

function guarded(den: Decimal, s: number): void {
  if (den.units <= 0n) throw new RangeError('denominator');
  if (s % 1 !== 0 || s < 0) throw new RangeError('scale');
}

// Correct rounding of an integer ratio, used only inside mutants that need a correct sub-step.
function correct(p: bigint, q: bigint): bigint {
  const negative = p < 0n;
  const m = magnitudeOf(p);
  const r = (m % q) * 2n >= q ? m / q + 1n : m / q;
  return negative ? -r : r;
}

const mutant = (round: (p: bigint, q: bigint) => bigint): Quotient => (n, den, s) => {
  guarded(den, s);
  const { p, q } = ratio(n, den, s);
  return { units: round(p, q), scale: s };
};

const preRounded =
  (m: number): Quotient =>
  (n, den, s) => {
    guarded(den, s);
    const units = correct(n.units * pow10(den.scale + m), den.units * pow10(n.scale)); // the intermediate quotient, at scale m
    // second rounding at s, written with the test-local rounder so the mutant does not lean on production's roundHalfUp
    return { units: m >= s ? correct(units, pow10(m - s)) : units * pow10(s - m), scale: s };
  };

// Pre-rounds at a precision derived from the operands' own scales instead of a constant.
const preRoundedRelative =
  (extra: number): Quotient =>
  (n, den, s) => (guarded(den, s), preRounded(n.scale + den.scale + s + extra)(n, den, s));

// Pre-rounds at a precision derived from the divisor's digit count, offset by a constant (a MathContext-style choice).
// Offset 0 is provably exact (the gap to a tie is at least 1 / (2 * 10^s * D)); a negative offset is not.
const preRoundedByDivisorDigits =
  (offset: number): Quotient =>
  (n, den, s) => (guarded(den, s), preRounded(Math.max(s, n.scale + s + den.units.toString().length + offset))(n, den, s));

const MUTANTS: readonly (readonly [string, Quotient])[] = [
  ...REPRESENTATIVE_SCALES.map((m): [string, Quotient] => [`quotient pre-rounded at scale ${m}`, preRounded(m)]),
  ['quotient pre-rounded at operand scales + 10', preRoundedRelative(10)],
  ['quotient pre-rounded at operand scales + 50', preRoundedRelative(50)],
  ['quotient pre-rounded at divisor digits - 1', preRoundedByDivisorDigits(-1)],
  ['quotient pre-rounded at divisor digits - 2', preRoundedByDivisorDigits(-2)],
  ['truncation instead of HALF_UP', mutant((p, q) => (p < 0n ? -(-p / q) : p / q))],
  ['tie test > instead of >=', mutant((p, q) => {
    const m = magnitudeOf(p);
    const r = (m % q) * 2n > q ? m / q + 1n : m / q;
    return p < 0n ? -r : r;
  })],
  ['negative ties toward +infinity', mutant((p, q) => {
    const m = magnitudeOf(p);
    const twice = (m % q) * 2n;
    const up = p < 0n ? twice > q : twice >= q;
    const r = up ? m / q + 1n : m / q;
    return p < 0n ? -r : r;
  })],
  ['sign dropped', mutant((p, q) => magnitudeOf(correct(p, q)))],
  ['sign inverted', mutant((p, q) => -correct(p, q))],
  ['numerator scale ignored', (n, den, s) => (guarded(den, s), { units: correct(n.units * pow10(den.scale + s), den.units), scale: s })],
  ['denominator scale ignored', (n, den, s) => (guarded(den, s), { units: correct(n.units * pow10(s), den.units * pow10(n.scale)), scale: s })],
  ['result scale not set to the output scale', (n, den, s) => {
    guarded(den, s);
    const { p, q } = ratio(n, den, s);
    return { units: correct(p, q), scale: n.scale };
  }],
];

type Category = readonly [string, (impl: Quotient) => number];

const CATEGORIES: readonly Category[] = [
  ['hand cases', (impl) => checkHand(impl)],
  ['V01', (impl) => checkVector(impl, 'V01')],
  ['V02', (impl) => checkVector(impl, 'V02')],
  ['V03', (impl) => checkVector(impl, 'V03')],
  ['V04', (impl) => checkVector(impl, 'V04')],
  ['V05', (impl) => checkVector(impl, 'V05')],
  ['V23', (impl) => checkVector(impl, 'V23')],
  ['near-tie family', checkNearTieFamily],
  ['large-denominator family', checkLargeDenominatorFamily],
  ['tight-gap family', checkTightGapFamily],
  ['fixed >30-digit vectors', checkBigFixed],
  ['oracle matrix', (impl) => checkOracle(impl, matrix())],
  ['oracle pseudo-random', (impl) => checkOracle(impl, pseudoRandom(RANDOM_COUNT))],
  ['symmetry', checkSymmetry],
  ['canonical zero', checkZero],
];

const killedBy = (impl: Quotient): string[] => CATEGORIES.filter(([, run]) => run(impl) > 0).map(([name]) => name);

let killMap: Map<string, string[]> | undefined;
const kills = (): Map<string, string[]> => (killMap ??= new Map(MUTANTS.map(([name, impl]) => [name, killedBy(impl)])));

test('mutation: the real primitive survives no check and every mutant keeps the real guards', (t) => {
  assert.deepEqual(killedBy(real), []);
  for (const [name, impl] of MUTANTS) {
    assert.equal(preconditionFailures(impl), 0, `${name} must not be killable by its guards`);
    t.diagnostic(`${name}: killed by [${(kills().get(name) ?? []).join(', ')}]`);
  }
});

test('mutation: every mutant is killed by arithmetic checks', () => {
  for (const [name, found] of kills()) assert.ok(found.length > 0, `${name} survived`);
});

test('mutation: a finite intermediate scale is not the contract, at any scale', () => {
  const found = (name: string): string[] => kills().get(name) ?? [];
  const absolute = (m: number): string[] => found(`quotient pre-rounded at scale ${m}`);
  // The parametric near-tie family reaches every representative intermediate scale, including the reviewer's 100 and 128/256.
  for (const m of REPRESENTATIVE_SCALES) assert.ok(absolute(m).includes('near-tie family'), `scale ${m}`);
  // The named vector V23 is blind beyond the shallow scales, and the fixed vectors (42 digits) beyond their own length:
  // a fixed vector always has a finite reach, which is why the families are generated.
  for (const m of [3, 4, 6]) assert.ok(absolute(m).includes('V23'), `V23 must kill scale ${m}`);
  for (const m of [12, 30, 60, 100, 128, 256]) assert.ok(!absolute(m).includes('V23'), `V23 must not reach scale ${m}`);
  for (const m of [3, 4, 6, 12, 30]) assert.ok(absolute(m).includes('fixed >30-digit vectors'), `fixed vectors must kill scale ${m}`);
  for (const m of [60, 100, 128, 256]) assert.ok(!absolute(m).includes('fixed >30-digit vectors'), `fixed vectors must not reach scale ${m}`);
  // A precision derived from the operands' own scales survives family 1 and is killed only by the large-denominator family.
  for (const extra of [10, 50]) {
    const relative = found(`quotient pre-rounded at operand scales + ${extra}`);
    assert.ok(!relative.includes('near-tie family'), `+${extra} must survive family 1`);
    assert.ok(relative.includes('large-denominator family'), `+${extra} must fall to family 2`);
  }
  // A precision derived from the divisor's digit count is reached only by the tight-gap family among the generated ones.
  for (const offset of [1, 2]) {
    const digits = found(`quotient pre-rounded at divisor digits - ${offset}`);
    assert.ok(digits.includes('tight-gap family'), `-${offset} must fall to family 3`);
    assert.ok(!digits.includes('near-tie family') && !digits.includes('large-denominator family'), `-${offset} must survive families 1 and 2`);
  }
});

// The families, asserted directly (no kill-map): for every sampled parameter the exact answer is zero and a pre-round at
// that parameter produces one full unit. These tests execute the lemma above on many parameters, they do not prove it.
test('mutation: family 1 — pre-rounding at m lands exactly on the tie and flips the answer, for every sampled m and several s', () => {
  const three = d('3');
  let sampled = 0;
  for (const s of [0, 1, 2, 5, 9]) {
    const scales = s === 2 ? NEAR_TIE_SWEEP : [...range(s + 1, s + 40), 128, 1024, 4096];
    for (const m of scales) {
      for (const sign of [1n, -1n] as const) {
        const n = nearTie(m, sign, s);
        assert.equal(roundQuotientHalfUp(n, three, s).units, 0n, `production, s=${s} m=${m}`);
        assert.equal(oracleUnits(n, three, s), 0n, `oracle, s=${s} m=${m}`);
        // the lemma's middle step: the exact quotient rounded at m digits is exactly the tie 5 * 10^-(s+1)
        assert.equal(correct(n.units * pow10(m), three.units * pow10(n.scale)), sign * 5n * pow10(m - s - 1), `tie, s=${s} m=${m}`);
        assert.equal(preRounded(m)(n, three, s).units, sign, `pre-rounded flips, s=${s} m=${m}`);
        sampled += 1;
      }
    }
  }
  assert.equal(sampled, 2 * (NEAR_TIE_SWEEP.length + 4 * (40 + 3)), 'every planned (m, s, sign) triple ran'); // 992
});

test('mutation: family 2 — a large divisor defeats any pre-round at m <= j + 2, including precisions derived from the operand scales', () => {
  for (const j of LARGE_DENOMINATOR_SWEEP) {
    for (const sign of [1n, -1n] as const) {
      const { numerator, denominator } = largeDenominatorTie(j, sign);
      assert.equal(roundQuotientHalfUp(numerator, denominator, 2).units, 0n, `production, j=${j}`);
      assert.equal(oracleUnits(numerator, denominator, 2), 0n, `oracle, j=${j}`);
      assert.equal(preRounded(j + 2)(numerator, denominator, 2).units, sign, `absolute m=${j + 2}, j=${j}`);
      if (j >= 53) {
        for (const extra of [10, 50]) assert.equal(preRoundedRelative(extra)(numerator, denominator, 2).units, sign, `+${extra}, j=${j}`);
      }
    }
  }
});

test('mutation: family 3 — the tightest gap for a divisor of t + 3 digits defeats pre-rounding at any 3 <= M <= t + 4', () => {
  for (const tExp of TIGHT_GAP_SWEEP) {
    for (const sign of [1n, -1n] as const) {
      const { numerator, denominator } = tightGapTie(tExp, sign);
      assert.equal(roundQuotientHalfUp(numerator, denominator, 2).units, 0n, `production, t=${tExp}`);
      assert.equal(oracleUnits(numerator, denominator, 2), 0n, `oracle, t=${tExp}`);
      assert.equal(denominator.units.toString().length, tExp + 3, `divisor digits, t=${tExp}`);
      for (const m of new Set([3, tExp + 4, tExp + 3])) {
        assert.equal(preRounded(m)(numerator, denominator, 2).units, sign, `absolute m=${m}, t=${tExp}`);
      }
      assert.equal(preRoundedByDivisorDigits(-1)(numerator, denominator, 2).units, sign, `digits-1, t=${tExp}`);
      assert.equal(preRoundedByDivisorDigits(-2)(numerator, denominator, 2).units, sign, `digits-2, t=${tExp}`);
    }
  }
});

test('mutation: specific mutants fall to the specific invariants they violate', () => {
  const found = (name: string): string[] => kills().get(name) ?? [];
  assert.ok(found('truncation instead of HALF_UP').includes('V04')); // V01 is exact (.75), so only the ties expose truncation
  assert.ok(found('tie test > instead of >=').includes('V04'));
  assert.ok(found('negative ties toward +infinity').includes('V05'));
  assert.ok(found('negative ties toward +infinity').includes('symmetry'));
  assert.ok(found('sign dropped').includes('V05'));
  assert.ok(found('sign inverted').includes('V01'));
});

// ---------------------------------------------------------------------------------------------------------------
// Selector-driven finite-precision mutants. A wrong implementation chooses an intermediate precision M "from the shape of the
// operands", rounds the exact quotient at M, then rounds again at s. The selector is the variable under test. This harness is
// bounded on purpose:
//
//   Taxonomy (what is covered)   Inputs to a selector: a, b = scales of numerator and denominator; dN, dD = digit counts of the
//                                numerator and denominator coefficients; s = output scale; small constants; sums, differences
//                                (a - b) and max/min of these, with or without a floor such as s + 2.
//                                F1 constant M (including a constant number of significant digits, e.g. 16 or 34)
//                                F2 M = s + c
//                                F3 M from the operand scales
//                                F4 M from the coefficient digit counts, including a SIGNIFICANT-DIGIT precision P turned into a
//                                   scale, M = P - (position of the quotient's leading digit) = P - (dN - a) + (dD - b), which is how
//                                   MathContext-style precisions behave
//                                F5 mixed max/additive combinations of the above (the three formulas an independent reviewer showed to
//                                   pass the older fixed-scale tests are F5 entries)
//   Stopping rule (what is not)  A surviving mutant matters only if it is in F1-F5 AND yields a wrong result. Contrived functions
//                                (hashes, tables keyed to tested inputs, huge constants added to escape a sweep, formulas built
//                                after seeing the corpus) are outside the taxonomy; no exhaustive completeness is claimed, and
//                                this is mutation-based assurance, not a proof over all functions M = f(input). The corpus below is
//                                one fixed set of inputs, independent of any selector; a selector merely picks which input serves
//                                as its witness.
//
// Four sources of inputs, all with expected values that do not come from production:
//
// (1) Tight ties, built so the exact answer is 0 by construction. For output scale s let T = 5 * 10^-(s+1), Du = 2 * 10^k + 1,
//     Q = Du * 10^e and K = floor((Q - 1) / (2 * 10^s)). Then 2 * 10^s * K < Q, so K / Q is the largest value of that form strictly
//     below T and the exact HALF_UP answer at s is 0. Write r = Q - 2 * 10^s * K (1 <= r <= 2 * 10^s), so the gap is
//     T - K/Q = r / (2 * 10^s * Q). A pre-round at M >= s + 1 lands exactly on T (a multiple of 10^-M) and flips the answer to one
//     unit whenever half a unit of 10^-M exceeds the gap, which is guaranteed when 10^M < Q / 2. The same rational value is then
//     RESPELLED: trailing zeros of K are compacted (z), numerator or denominator coefficients are padded with trailing zeros (i, j),
//     and both scales are shifted equally (bx). The value never changes; the digit counts and scales a selector sees do.
//       numerator   = K / 10^z * 10^i       at scale a = b + (e + i - z - j)
//       denominator = Du * 10^j             at scale b = max(0, z + j - e - i) + bx
// (2) Ties of SMALL divisors at wide output scales. A divisor Du coprime to 10 (3, 201, 99991, ...) has an inverse u modulo 2 * 10^s
//     (found with the extended Euclidean algorithm, no production code involved), and N = (u * Du - 1) / (2 * 10^s) is then an integer
//     with N / Du = u / (2 * 10^s) - 1 / (2 * 10^s * Du): a value one lattice step below the tie u / (2 * 10^s) (u is odd), so the
//     exact answer at s is (u - 1) / 2 units. The gap 1 / (2 * 10^s * Du) is far below half a unit of 10^-(s+2) as soon as Du has three
//     digits, yet both coefficients have only about as many digits as Du. Family (1) cannot reach this: there the tie lies at the
//     tiny first tie T and a small Du would give K = 0. Taking the inverse modulo 2 * 10^(s+g) instead moves the tie up to about
//     10^g (a LARGE quotient) and lets the numerator be spelled without g trailing zeros, which then live in b - a: a quotient of
//     many digits written with few coefficient digits and a large scale difference, which defeats precisions that look at neither.
//     The same tie is also written with those g zeros spelled out in the coefficient (many digits, small scales).
// (3) Wide-gap ties of ARBITRARY small divisors. If e >= s + 1 then Q = Du * 10^e is a multiple of 2 * 10^s for every Du, so
//     K = Q / (2 * 10^s) - 1 gives K / Q = T - 1/Q exactly: a gap of 1/(Du * 10^e) however small Du is, while the numerator is
//     spelled at a scale e larger than the denominator's. A precision tied to the digit counts of the coefficients (which are about
//     dD and e - s + dD) falls short of the gap exponent dD + e - 1 once e - s is large. Exact answer 0, as in (1).
// (4) Ordinary shapes: small and mid-size coefficients with many scale combinations (including b much larger than a, and trailing
//     zeros), whose expected value is the independent gcd/distance oracle. Tight ties only reach selectors that choose a precision that
//     is too SMALL relative to a very tight gap; these shapes reach selectors that go wrong on everyday double rounding (for example a
//     precision that collapses when b - a is large).
//
// A provably exact selector (M >= a + s + dD: half a unit of 10^-M is then strictly smaller than the least possible distance
// 1 / (2 * 10^s * Du * 10^a) from any non-tie to a tie) must NOT be found wrong: it is the negative control that shows the search
// is not simply flagging every mutant.

type SelectorContext = { readonly a: number; readonly b: number; readonly dN: number; readonly dD: number; readonly s: number };
type Selector = (c: SelectorContext) => number;
type Family = 'F1' | 'F2' | 'F3' | 'F4' | 'F5';
// wrong: must be killed by the search; exact: provably never wrong, must survive; open: outcome recorded, nothing claimed.
type Expectation = 'wrong' | 'exact' | 'open';

const digitsOf = (x: bigint): number => magnitudeOf(x).toString().length;
const contextOf = (n: Decimal, den: Decimal, s: number): SelectorContext => ({ a: n.scale, b: den.scale, dN: digitsOf(n.units), dD: digitsOf(den.units), s });
// A scale is never negative. A precision below the output scale is NOT clamped: rounding at fewer digits than the result needs and
// then padding is a real, realistic bug (a significant-digit precision can collapse for a large quotient).
const selectorMutant =
  (select: Selector): Quotient =>
  (n, den, s) => (guarded(den, s), preRounded(Math.max(0, select(contextOf(n, den, s))))(n, den, s));

const atLeast = (s: number, m: number): number => Math.max(s + 2, m); // the reviewer's floor: at least s + 2 digits
// Precision of P significant digits as a scale: the quotient's leading digit sits at about (dN - a) - (dD - b).
const significant = (x: SelectorContext, p: number): number => p - (x.dN - x.a) + (x.dD - x.b);

type SelectorEntry = { family: Family; name: string; expectation: Expectation; select: Selector };
const SELECTORS: readonly SelectorEntry[] = [
  ...[3, 6, 30, 60, 100, 128, 256].map((m): SelectorEntry => ({ family: 'F1', name: `M = ${m}`, expectation: 'wrong', select: () => m })),
  ...[1, 2, 10, 50].map((c): SelectorEntry => ({ family: 'F2', name: `M = s + ${c}`, expectation: 'wrong', select: (x) => x.s + c })),
  ...[10, 50].flatMap((c): SelectorEntry[] => [
    { family: 'F3', name: `M = max(s+2, a + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, x.a + c) },
    { family: 'F3', name: `M = max(s+2, b + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, x.b + c) },
    { family: 'F3', name: `M = max(s+2, max(a,b) + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, Math.max(x.a, x.b) + c) },
    { family: 'F3', name: `M = max(s+2, min(a,b) + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, Math.min(x.a, x.b) + c) },
    { family: 'F3', name: `M = max(s+2, a + b + s + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, x.a + x.b + x.s + c) },
    { family: 'F3', name: `M = max(s+2, a - b + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, x.a - x.b + c) },
    { family: 'F4', name: `M = max(s+2, dN + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, x.dN + c) },
    { family: 'F4', name: `M = max(s+2, dD + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, x.dD + c) },
    { family: 'F4', name: `M = max(s+2, max(dN,dD) + ${c})`, expectation: 'wrong', select: (x) => atLeast(x.s, Math.max(x.dN, x.dD) + c) },
  ]),
  // Significant-digit precisions, MathContext style (DECIMAL32/64/128 are 7, 16 and 34 digits), with and without a floor.
  ...[7, 16, 34].map((p): SelectorEntry => ({ family: 'F1', name: `M = ${p} significant digits`, expectation: 'wrong', select: (x) => significant(x, p) })),
  ...[7, 16, 34].map((p): SelectorEntry => ({ family: 'F1', name: `M = max(s+2, ${p} significant digits)`, expectation: 'wrong', select: (x) => atLeast(x.s, significant(x, p)) })),
  { family: 'F4', name: 'M = P = dN + dD significant digits', expectation: 'wrong', select: (x) => significant(x, x.dN + x.dD) },
  ...[0, 2, 10, 50].map((c): SelectorEntry => ({ family: 'F4', name: `M = max(s+2, dN + dD + ${c} significant digits)`, expectation: 'wrong', select: (x) => atLeast(x.s, significant(x, x.dN + x.dD + c)) })),
  { family: 'F4', name: 'M = max(s+2, max(dN,dD) + 10 significant digits)', expectation: 'wrong', select: (x) => atLeast(x.s, significant(x, Math.max(x.dN, x.dD) + 10)) },
  // F4 with the output scale added: no counterexample is known and none is claimed to be impossible (expectation open).
  ...[0, 10].map((c): SelectorEntry => ({ family: 'F4', name: `M = dN + dD + s + ${c}`, expectation: 'open', select: (x) => x.dN + x.dD + x.s + c })),
  // F5: the three formulas of the independent re-review, then further max/additive combinations.
  { family: 'F5', name: 'reviewer A: M = max(s+2, dN + 50)', expectation: 'wrong', select: (x) => atLeast(x.s, x.dN + 50) },
  { family: 'F5', name: 'reviewer B: M = max(s+2, max(a,b,dD) + 10)', expectation: 'wrong', select: (x) => atLeast(x.s, Math.max(x.a, x.b, x.dD) + 10) },
  { family: 'F5', name: 'reviewer C: M = max(s+2, max(a,b,dN,dD) + 10)', expectation: 'wrong', select: (x) => atLeast(x.s, Math.max(x.a, x.b, x.dN, x.dD) + 10) },
  { family: 'F5', name: 'M = max(s+2, max(a,b) + dD + 10)', expectation: 'wrong', select: (x) => atLeast(x.s, Math.max(x.a, x.b) + x.dD + 10) },
  { family: 'F5', name: 'M = max(s+2, a + dD + 10)', expectation: 'wrong', select: (x) => atLeast(x.s, x.a + x.dD + 10) },
  { family: 'F5', name: 'M = max(s+2, a - b + 2*dD)', expectation: 'wrong', select: (x) => atLeast(x.s, x.a - x.b + 2 * x.dD) },
  // Listed as open before the search ran; the search then found a counterexample (output scale 20), so it is recorded as wrong.
  { family: 'F5', name: 'M = max(s+2, a + b + dN + dD + 10)', expectation: 'wrong', select: (x) => atLeast(x.s, x.a + x.b + x.dN + x.dD + 10) },
  // Negative controls, provably exact: M >= a + s + dD (see above).
  { family: 'F5', name: 'control: M = a + s + dD', expectation: 'exact', select: (x) => x.a + x.s + x.dD },
  { family: 'F5', name: 'control: M = a + s + dD + 7', expectation: 'exact', select: (x) => x.a + x.s + x.dD + 7 },
];

type Spelling = { readonly s: number; readonly k: number; readonly e: number; readonly zFull: boolean; readonly i: number; readonly j: number; readonly bx: number; readonly du?: bigint };
type Candidate = {
  readonly source: 'tie' | 'ordinary' | 'inverse';
  readonly label: string;
  readonly s: number;
  readonly sign: 1n | -1n;
  readonly numerator: Decimal;
  readonly denominator: Decimal;
  readonly expected: bigint; // exact units at scale s, NOT taken from production
};

function trailingZeros(x: bigint): number {
  const text = x.toString();
  return text.length - text.replace(/0+$/, '').length;
}

function tieCandidate(sp: Spelling, sign: 1n | -1n): Candidate {
  const du = sp.du ?? 2n * pow10(sp.k) + 1n;
  const q = du * pow10(sp.e);
  const kUnits = (q - 1n) / (2n * pow10(sp.s)); // largest K with K / Q strictly below the tie
  const z = sp.zFull ? trailingZeros(kUnits) : 0;
  const a0 = sp.e + sp.i - z - sp.j;
  const b = Math.max(0, -a0) + sp.bx;
  return {
    source: 'tie',
    label: `tie s=${sp.s} ${sp.du === undefined ? `k=${sp.k}` : `D=${sp.du}`} e=${sp.e} z=${sp.zFull ? 'full' : 0} i=${sp.i} j=${sp.j} bx=${sp.bx} sign=${sign}`,
    s: sp.s,
    sign,
    numerator: { units: sign * (kUnits / pow10(z)) * pow10(sp.i), scale: b + a0 },
    denominator: { units: du * pow10(sp.j), scale: b },
    expected: 0n, // K/Q is strictly below T = 0.5 * 10^-s, so the exact answer is zero
  };
}

function modInverse(a: bigint, modulus: bigint): bigint {
  let [r0, r1, t0, t1] = [modulus, ((a % modulus) + modulus) % modulus, 0n, 1n];
  while (r1 !== 0n) {
    const quotient = r0 / r1;
    [r0, r1] = [r1, r0 - quotient * r1];
    [t0, t1] = [t1, t0 - quotient * t1];
  }
  assert.equal(r0, 1n, 'the divisor must be coprime to the modulus');
  return ((t0 % modulus) + modulus) % modulus;
}

// `i` pads the numerator coefficient with trailing zeros (pass g + i to write the g zeros out instead of leaving them to b - a).
function inverseTieCandidate(s: number, du: bigint, g: number, i: number, j: number, bx: number, sign: 1n | -1n): Candidate {
  // Modulus 2 * 10^(s+g): then Nu = (u * Du - 1) / (2 * 10^(s+g)) is an integer and N' = Nu * 10^g = (u * Du - 1) / (2 * 10^s), so
  // N' / Du = u / (2 * 10^s) - 1 / (2 * 10^s * Du) with u odd and below 2 * 10^(s+g): a tie up to about 10^g away from zero (a large
  // quotient) whose numerator coefficient Nu is spelled WITHOUT its g trailing zeros, the missing factor living in b - a = g + j - i.
  const u = modInverse(du, 2n * pow10(s + g)); // odd, because du is odd and the modulus is even
  const nUnits = (u * du - 1n) / (2n * pow10(s + g));
  const delta = g + j - i;
  const a = bx + Math.max(0, -delta);
  return {
    source: 'inverse',
    label: `inverse s=${s} D=${du} g=${g} i=${i} j=${j} bx=${bx} sign=${sign}`,
    s,
    sign,
    numerator: { units: sign * nUnits * pow10(i), scale: a },
    denominator: { units: du * pow10(j), scale: a + delta },
    expected: sign * ((u - 1n) / 2n), // N'/Du sits one lattice step below the tie u/(2*10^s)
  };
}

// Deterministic tight-tie grid, ordered by the size of the gap (k + e) so the cheapest counterexample is found first.
const GRID = {
  s: [0, 2, 6, 20, 100],
  k: [0, 1, 4, 12, 30, 60, 120, 250, 520, 1050],
  e: [0, 2, 5, 25, 70, 160],
  pad: [0, 9],
  bx: [0, 3, 70],
};
// Ordinary shapes. Coefficients with trailing zeros (1000, 20) are the same value as a shorter spelling at another scale.
const WIDE = {
  s: [0, 2, 6, 20, 100],
  divisors: [3n, 7n, 201n, 99991n, 766717n, 1000003n],
  extraScale: [1, 4, 13, 30, 70], // e = s + extraScale, so e >= s + 1
  pad: [0, 9],
  bx: [0, 70],
};
const INVERSE = {
  s: [0, 2, 6, 20, 100],
  divisors: [3n, 7n, 9n, 13n, 27n, 201n, 339n, 2863n, 99991n, 1000003n],
  compaction: [0, 5, 30, 70], // g: how many trailing zeros of the numerator are carried by b - a instead of by coefficient digits
  pad: [0, 9],
  bx: [0, 3, 70],
  spreadBx: [0, 70],
};
const ORDINARY = {
  numerators: [1n, 4n, 7n, 15n, 1000n, 123457n, 5000000001n, 99999999999999999999n],
  numeratorScales: [0, 2, 5, 40],
  denominators: [1n, 3n, 7n, 13n, 20n, 201n, 339n, 2863n, 99991n, 1000003n],
  denominatorScales: [0, 1, 3, 13, 30, 70],
  outputScales: [0, 2, 4, 7],
  // A wide output scale is where a precision that ignores s collapses (M < s), so a representative subset runs at s = 20 and 100.
  wideOutputScales: [20, 100],
  wideNumerators: [1n, 15n, 123457n, 5000000001n],
  wideNumeratorScales: [0, 5, 40],
  wideDenominators: [1n, 3n, 201n, 99991n],
  wideDenominatorScales: [0, 3, 30, 70],
};

let gridCache: Candidate[] | undefined;
function candidates(): Candidate[] {
  if (gridCache !== undefined) return gridCache;
  const specs: Spelling[] = [];
  for (const s of GRID.s) {
    for (const k of GRID.k.filter((x) => x >= s)) {
      for (const e of GRID.e) for (const zFull of [false, true]) for (const i of GRID.pad) for (const j of GRID.pad) for (const bx of GRID.bx) {
        specs.push({ s, k, e, zFull, i, j, bx });
      }
    }
  }
  specs.sort((x, y) => x.k + x.e - (y.k + y.e) || x.s - y.s);
  const ties = specs.flatMap((sp) => ([1n, -1n] as const).map((sign) => tieCandidate(sp, sign)));

  const ordinary: Candidate[] = [];
  for (const s of ORDINARY.outputScales) for (const du of ORDINARY.denominators) for (const b of ORDINARY.denominatorScales) {
    for (const nu of ORDINARY.numerators) for (const a of ORDINARY.numeratorScales) for (const sign of [1n, -1n] as const) {
      const numerator = { units: sign * nu, scale: a };
      const denominator = { units: du, scale: b };
      ordinary.push({
        source: 'ordinary', label: `ordinary N=${sign * nu}@${a} D=${du}@${b} s=${s}`, s, sign, numerator, denominator,
        expected: oracleUnits(numerator, denominator, s),
      });
    }
  }
  for (const s of ORDINARY.wideOutputScales) for (const du of ORDINARY.wideDenominators) for (const b of ORDINARY.wideDenominatorScales) {
    for (const nu of ORDINARY.wideNumerators) for (const a of ORDINARY.wideNumeratorScales) for (const sign of [1n, -1n] as const) {
      const numerator = { units: sign * nu, scale: a };
      const denominator = { units: du, scale: b };
      ordinary.push({
        source: 'ordinary', label: `ordinary N=${sign * nu}@${a} D=${du}@${b} s=${s}`, s, sign, numerator, denominator,
        expected: oracleUnits(numerator, denominator, s),
      });
    }
  }
  const wide: Candidate[] = [];
  for (const s of WIDE.s) for (const du of WIDE.divisors) for (const extra of WIDE.extraScale) {
    for (const i of WIDE.pad) for (const j of WIDE.pad) for (const bx of WIDE.bx) {
      for (const sign of [1n, -1n] as const) wide.push(tieCandidate({ s, k: 0, e: s + extra, zFull: false, i, j, bx, du }, sign));
    }
  }
  const inverse: Candidate[] = [];
  for (const s of INVERSE.s) for (const du of INVERSE.divisors) for (const g of INVERSE.compaction) for (const i of INVERSE.pad) for (const j of INVERSE.pad) for (const bx of INVERSE.bx) {
    for (const sign of [1n, -1n] as const) inverse.push(inverseTieCandidate(s, du, g, i, j, bx, sign));
  }
  // The same large-quotient ties with the numerator's g zeros written out: many coefficient digits, small scales (a subset).
  for (const s of INVERSE.s) for (const du of INVERSE.divisors) for (const g of INVERSE.compaction) for (const bx of INVERSE.spreadBx) {
    for (const sign of [1n, -1n] as const) inverse.push(inverseTieCandidate(s, du, g, g, 0, bx, sign));
  }
  // cheapest shapes first inside the ordinary source
  ordinary.sort((x, y) => (x.numerator.units.toString().length + x.denominator.units.toString().length + x.numerator.scale + x.denominator.scale)
    - (y.numerator.units.toString().length + y.denominator.units.toString().length + y.numerator.scale + y.denominator.scale));
  gridCache = [...ordinary, ...inverse, ...wide, ...ties]; // small numbers first: most selectors fall to them long before a huge tie input is needed
  return gridCache;
}

const describe = (c: Candidate, m: number, units: bigint): string =>
  `${c.label} -> a=${c.numerator.scale} b=${c.denominator.scale} dN=${digitsOf(c.numerator.units)} dD=${digitsOf(c.denominator.units)} M=${m}, mutant units ${units} (exact ${c.expected})`;

function findCounterexample(select: Selector, maxOutputScale = Infinity): { candidate: Candidate; m: number; units: bigint } | undefined {
  const mutant = selectorMutant(select);
  for (const c of candidates()) {
    if (c.s > maxOutputScale) continue;
    const units = mutant(c.numerator, c.denominator, c.s).units;
    if (units !== c.expected) return { candidate: c, m: Math.max(0, select(contextOf(c.numerator, c.denominator, c.s))), units };
  }
  return undefined;
}

test('selector harness: production returns the exact expected answer on every input of both sources, and agrees with the independent oracle', () => {
  const grid = candidates();
  assert.ok(grid.filter((c) => c.source === 'tie').length > 10000, 'tight-tie inputs (first-tie and wide-gap)');
  assert.ok(grid.filter((c) => c.source === 'ordinary').length > 10000, 'ordinary inputs');
  assert.equal(grid.filter((c) => c.source === 'inverse').length, INVERSE.s.length * INVERSE.divisors.length * INVERSE.compaction.length * (INVERSE.pad.length ** 2 * INVERSE.bx.length + INVERSE.spreadBx.length) * 2, 'small-divisor tie inputs');
  grid.forEach((c, index) => {
    assert.equal(roundQuotientHalfUp(c.numerator, c.denominator, c.s).units, c.expected, `production: ${c.label}`);
    // tight ties: expected 0 is by construction, so the oracle is also run on every 17th; small-divisor ties are all checked against it;
    // ordinary inputs take their expected value from it
    if (c.source === 'tie' && index % 17 === 0) assert.equal(oracleUnits(c.numerator, c.denominator, c.s), 0n, `oracle: ${c.label}`);
    if (c.source === 'inverse') assert.equal(oracleUnits(c.numerator, c.denominator, c.s), c.expected, `oracle: ${c.label}`);
  });
});

test('selector harness: respelling keeps the rational value while the digit counts and scales a selector sees change', () => {
  const base = { s: 2, k: 61, e: 0 };
  const spellings = [false, true].flatMap((zFull) => [0, 9].flatMap((i) => [0, 9].flatMap((j) => [0, 3, 70].map((bx) => tieCandidate({ ...base, zFull, i, j, bx }, 1n)))));
  const cross = (c: Candidate): bigint[] => [c.numerator.units * pow10(c.denominator.scale), c.denominator.units * pow10(c.numerator.scale)];
  const [n0, d0] = cross(spellings[0]);
  for (const c of spellings) {
    const [n, d] = cross(c);
    assert.equal(n * d0, n0 * d, 'cross-multiplication: the same rational value');
  }
  const seen = new Set(spellings.map((c) => `${digitsOf(c.numerator.units)}/${digitsOf(c.denominator.units)}/${c.numerator.scale}/${c.denominator.scale}`));
  assert.ok(seen.size >= 12, `distinct (dN, dD, a, b) tuples: ${seen.size}`);
  // the compact spelling of reviewer A: numerator units 1 at scale 2, denominator 2*10^61+1 at scale 61
  const reviewerA = tieCandidate({ ...base, zFull: true, i: 0, j: 0, bx: 2 }, 1n);
  assert.deepEqual(reviewerA.numerator, { units: 1n, scale: 2 });
  assert.deepEqual(reviewerA.denominator, { units: 2n * pow10(61) + 1n, scale: 61 });
  const [rn, rd] = cross(reviewerA);
  assert.equal(rn * d0, n0 * rd, 'the reviewer A spelling is the same rational value as every other spelling');
  // The same value, two spellings, one selector: M = max(s+2, dN + 50) is wrong on the compact spelling and right on the
  // uncompacted one. Its answer depends on representation size, not on the value, which is the blind spot in question.
  const digitsPlus50 = selectorMutant((x) => atLeast(x.s, x.dN + 50));
  const same0 = { s: 0, k: 60, e: 0, i: 0, j: 0, bx: 0 };
  const compacted = tieCandidate({ ...same0, zFull: true }, 1n);
  const spelledOut = tieCandidate({ ...same0, zFull: false }, 1n);
  const [cn, cd] = cross(compacted);
  const [sn, sd] = cross(spelledOut);
  assert.equal(cn * sd, sn * cd, 'compacted and uncompacted spellings are the same rational value');
  assert.equal(digitsPlus50(compacted.numerator, compacted.denominator, 0).units, 1n);
  assert.equal(digitsPlus50(spelledOut.numerator, spelledOut.denominator, 0).units, 0n);
});

test('selector harness: every wrong-by-design selector in F1-F5 is killed by an adversarial input; provably exact selectors survive', (t) => {
  const byFamily = new Map<Family, number>();
  const monetary: string[] = [];
  for (const { family, name, expectation, select } of SELECTORS) {
    const found = findCounterexample(select);
    if (expectation === 'wrong') {
      assert.ok(found !== undefined, `${family} ${name} survived the whole grid`);
      const { candidate, m, units } = found;
      assert.notEqual(units, candidate.expected, `${family} ${name}: the finite-precision mutant is wrong`);
      if (candidate.source === 'tie') assert.equal(units, candidate.sign, `${family} ${name}: a tie flip is exactly one unit with the input's sign`);
      assert.equal(roundQuotientHalfUp(candidate.numerator, candidate.denominator, candidate.s).units, candidate.expected, `${name}: production`);
      assert.equal(oracleUnits(candidate.numerator, candidate.denominator, candidate.s), candidate.expected, `${name}: independent oracle`);
      const mirrored = { units: -candidate.numerator.units, scale: candidate.numerator.scale };
      assert.equal(selectorMutant(select)(mirrored, candidate.denominator, candidate.s).units, -units, `${name}: the sign mirror is wrong by the opposite amount`);
      assert.equal(roundQuotientHalfUp(mirrored, candidate.denominator, candidate.s).units, -candidate.expected, `${name}: production on the mirror`);
      byFamily.set(family, (byFamily.get(family) ?? 0) + 1);
      const money = findCounterexample(select, 2);
      if (money !== undefined) monetary.push(`${family} ${name}`);
      t.diagnostic(`${family} ${name}: ${describe(candidate, m, units)}${money === undefined ? '; NOT killed at s <= 2' : '; also killed at s <= 2'}`);
    } else if (expectation === 'exact') {
      assert.equal(found, undefined, `${family} ${name} is provably exact but the search reported ${found === undefined ? '' : describe(found.candidate, found.m, found.units)}`);
    } else {
      t.diagnostic(`${family} ${name} (open): ${found === undefined ? 'no counterexample in the grid, nothing claimed' : describe(found.candidate, found.m, found.units)}`);
    }
  }
  for (const family of ['F1', 'F2', 'F3', 'F4', 'F5'] as const) assert.ok((byFamily.get(family) ?? 0) >= 3, `${family} has adversarial evidence`);
  // The search is not leaning on exotic output scales: reviewer formulas A and B are already wrong at the monetary scale s <= 2.
  for (const name of ['reviewer A: M = max(s+2, dN + 50)', 'reviewer B: M = max(s+2, max(a,b,dD) + 10)']) {
    assert.ok(monetary.includes(`F5 ${name}`), `${name} must also be killed at s <= 2`);
  }
  t.diagnostic(`${monetary.length} of ${SELECTORS.filter((x) => x.expectation === 'wrong').length} wrong-by-design selectors are already killed at s <= 2`);
});

test('selector harness: the independent-review survivors and the significant-digit precision, written out in full, are wrong on their stated inputs', () => {
  const a = selectorMutant((x) => atLeast(x.s, x.dN + 50));
  const b = selectorMutant((x) => atLeast(x.s, Math.max(x.a, x.b, x.dD) + 10));
  const c = selectorMutant((x) => atLeast(x.s, Math.max(x.a, x.b, x.dN, x.dD) + 10));
  const significantDigits = selectorMutant((x) => atLeast(x.s, significant(x, x.dN + x.dD)));
  const cases: [string, Quotient, Decimal, Decimal, number][] = [
    // A: 0.01 / (2 + 10^-61) at scale 2; exact 0.005 - 1/(200 * (2*10^61 + 1)), i.e. 0.00
    ['A', a, { units: 1n, scale: 2 }, { units: 2n * pow10(61) + 1n, scale: 61 }, 2],
    // B: denominator units 2*10^50 + 1 at scale 0, numerator scale 50, units D*10^50/200 - 1
    ['B', b, { units: (2n * pow10(50) + 1n) * pow10(50) / 200n - 1n, scale: 50 }, { units: 2n * pow10(50) + 1n, scale: 0 }, 2],
    // C: output scale 100, denominator units 2*10^100 + 1, numerator scale 102, units 10^102 + 49
    ['C', c, { units: pow10(102) + 49n, scale: 102 }, { units: 2n * pow10(100) + 1n, scale: 0 }, 100],
  ];
  for (const [name, mutant, n, den, s] of cases) {
    for (const sign of [1n, -1n] as const) {
      const signed = { units: sign * n.units, scale: n.scale };
      assert.equal(roundQuotientHalfUp(signed, den, s).units, 0n, `${name}: production`);
      assert.equal(oracleUnits(signed, den, s), 0n, `${name}: independent oracle`);
      assert.equal(mutant(signed, den, s).units, sign, `${name}: the finite-precision mutant is off by one unit`);
    }
  }
  assert.equal(fmt(a({ units: 1n, scale: 2 }, { units: 2n * pow10(61) + 1n, scale: 61 }, 2)), '0.01'); // against the exact 0.00
  // Significant-digit precision P = dN + dD (a MathContext-style choice) on an everyday input: 1 / 3.39 = 0.29498525..., exact 0.29.
  const one = { units: 1n, scale: 0 };
  const divisor = { units: 339n, scale: 2 };
  assert.equal(fmt(roundQuotientHalfUp(one, divisor, 2)), '0.29');
  assert.equal(fmt(oracle(one, divisor, 2)), '0.29');
  assert.equal(fmt(significantDigits(one, divisor, 2)), '0.30');
  assert.equal(fmt(significantDigits(negate(one), divisor, 2)), '-0.30');
});

// ---------------------------------------------------------------------------------------------------------------
// Architectural evidence only: the same primitive expresses both candidate line-completion boundaries, so a later choice
// between them lives above the kernel. These evaluators are illustrative test code. They choose no boundary, are used by
// nothing in production, and the primitive is not changed to serve either.
//   whole  (W): net = round( q*p/b + adjustment )              one rounding of the whole expression
//   staged (S): net = round( q*p/b ) + adjustment              round the extended price first, then adjust

const CENT = 2;
const whole = (q: Decimal, p: Decimal, b: Decimal, adjustment: Decimal): Decimal =>
  roundQuotientHalfUp(add(multiply(q, p), multiply(adjustment, b)), b, CENT);
const staged = (q: Decimal, p: Decimal, b: Decimal, adjustment: Decimal): Decimal =>
  add(roundQuotientHalfUp(multiply(q, p), b, CENT), adjustment);

test('W and S are both written over the one primitive and agree where the boundary does not matter', () => {
  // q=3.015, p=1, b=3, allowance .01: the extended price is 1.005 and the adjusted value .995
  assert.equal(fmt(whole(d('3.015'), d('1'), d('3'), d('-0.01'))), '1.00');
  assert.equal(fmt(staged(d('3.015'), d('1'), d('3'), d('-0.01'))), '1.00');
});

test('W and S differ exactly where an exact half-cent is crossed (q=.015, p=1, b=3 and its mirror)', () => {
  // extended price exactly .005; an allowance of .01 takes the adjusted value to -.005
  assert.equal(fmt(whole(d('0.015'), d('1'), d('3'), d('-0.01'))), '-0.01');
  assert.equal(fmt(staged(d('0.015'), d('1'), d('3'), d('-0.01'))), '0.00');
  // the mirror: extended price -.005; a charge of .01 takes the adjusted value to +.005
  assert.equal(fmt(whole(d('-0.015'), d('1'), d('3'), d('0.01'))), '0.01');
  assert.equal(fmt(staged(d('-0.015'), d('1'), d('3'), d('0.01'))), '0.00');
});

test('W and S evaluators agree with the independent oracle on those inputs', () => {
  const adjusted = (q: string, adjustment: string): Decimal => add(multiply(d(q), d('1')), multiply(d(adjustment), d('3')));
  assert.ok(same(whole(d('0.015'), d('1'), d('3'), d('-0.01')), oracle(adjusted('0.015', '-0.01'), d('3'), CENT)));
  assert.ok(same(whole(d('-0.015'), d('1'), d('3'), d('0.01')), oracle(adjusted('-0.015', '0.01'), d('3'), CENT)));
  assert.ok(same(add(oracle(multiply(d('0.015'), d('1')), d('3'), CENT), d('-0.01')), staged(d('0.015'), d('1'), d('3'), d('-0.01'))));
});
