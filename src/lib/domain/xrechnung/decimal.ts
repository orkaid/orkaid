// Exact signed decimal arithmetic on scaled bigint integers (value = units / 10^scale); units carries the sign.
// Nothing here touches binary floating-point: decimals enter as strings and stay integers.
// The kernel is signed, the public input boundary is not: parseDecimal still rejects a leading minus, so signed
// values can only be built inside the domain (negate, subtract), never from invoice input.

export type Decimal = { readonly units: bigint; readonly scale: number };

export type DecimalErrorCode = 'invalid_decimal' | 'negative_amount' | 'input_length_guard';

export type ParseResult =
  | { readonly ok: true; readonly value: Decimal }
  | { readonly ok: false; readonly code: DecimalErrorCode };

// Provisional protective guardrail against pathological input, NOT a product rule. It bounds the raw input text
// (grouping separators included) at every parsing boundary for resource protection only. It is not a precision or
// magnitude policy and is no evidence of what precision or magnitude is supported: the semantic quantity and
// unit-price limits are profile rules in invoice.ts, applied after parsing. Do not rely on this value.
export const PROVISIONAL_INPUT_LENGTH_GUARD = 128;

const DECIMAL_PATTERN = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

export function parseDecimal(input: unknown): ParseResult {
  if (typeof input !== 'string') return { ok: false, code: 'invalid_decimal' };
  if (input.length > PROVISIONAL_INPUT_LENGTH_GUARD) return { ok: false, code: 'input_length_guard' };

  const match = DECIMAL_PATTERN.exec(input);
  if (!match) return { ok: false, code: 'invalid_decimal' };

  const [, sign, integerDigits = '', fractionDigits = ''] = match;
  if (sign === '-') return { ok: false, code: 'negative_amount' };

  return { ok: true, value: { units: BigInt(integerDigits + fractionDigits), scale: fractionDigits.length } };
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescaleUp(a, scale) + rescaleUp(b, scale), scale };
}

export function negate(value: Decimal): Decimal {
  return { units: -value.units, scale: value.scale };
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescaleUp(a, scale) - rescaleUp(b, scale), scale };
}

/** Absolute magnitude, scale kept. A two-sided bound check is compare(abs(x), limit). */
export function abs(value: Decimal): Decimal {
  return value.units < 0n ? negate(value) : value;
}

// HALF_UP, ties away from zero (accepted Orkaid policy for signed values): an exact half moves to the larger magnitude, so
// R(-x) = -R(x), and positive values round as before. Not claimed as an EN 16931 or XRechnung rule.
export function roundHalfUp(value: Decimal, scale: number): Decimal {
  if (value.scale <= scale) return { units: rescaleUp(value, scale), scale };

  return { units: roundedIntegerQuotient(value.units, 10n ** BigInt(value.scale - scale)), scale };
}

/**
 * numerator / denominator rounded once to `outputScale` fractional digits, with the same signed HALF_UP rule as
 * roundHalfUp. The exact quotient is never materialised at any intermediate scale: the operands are brought to a
 * common integer ratio and rounded in a single step, so the result does not depend on any internal precision.
 * The denominator must be strictly positive and the output scale a non-negative integer; violating either is a
 * programming error in the caller and throws.
 */
export function roundQuotientHalfUp(numerator: Decimal, denominator: Decimal, outputScale: number): Decimal {
  if (denominator.units <= 0n) throw new RangeError('quotient denominator must be strictly positive');
  // `% 1` rejects NaN, Infinity and any fractional scale; it must not be left to BigInt(), because adding a scale that is
  // a hair below an integer to another scale can round to a whole number first.
  if (outputScale % 1 !== 0 || outputScale < 0) throw new RangeError('quotient output scale must be a non-negative integer');

  // (n.units / 10^n.scale) / (d.units / 10^d.scale) * 10^outputScale, as one integer ratio.
  const units = roundedIntegerQuotient(
    numerator.units * 10n ** BigInt(denominator.scale + outputScale),
    denominator.units * 10n ** BigInt(numerator.scale),
  );
  return { units, scale: outputScale + 0 }; // + 0 turns a negative-zero scale into plain 0
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const left = rescaleUp(a, scale);
  const right = rescaleUp(b, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Fractional digits that carry value: trailing fractional zeros do not count (1.2300 -> 2). The value is not changed. */
export function effectiveFractionDigits(value: Decimal): number {
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return scale;
}

// Zero has no sign (bigint has no -0), so a negative value that rounds to zero formats as "0.00", never "-0.00".
export function formatDecimal(value: Decimal): string {
  const sign = value.units < 0n ? '-' : '';
  const magnitude = (value.units < 0n ? -value.units : value.units).toString();
  if (value.scale === 0) return sign + magnitude;
  const digits = magnitude.padStart(value.scale + 1, '0');
  return `${sign}${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
}

// The one signed tie rule: round numerator / divisor (divisor > 0) to a whole number, an exact half moving to the larger
// magnitude. Zero stays 0n (bigint has no negative zero).
function roundedIntegerQuotient(numerator: bigint, divisor: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / divisor;
  const rounded = (magnitude % divisor) * 2n >= divisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function rescaleUp(value: Decimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}
