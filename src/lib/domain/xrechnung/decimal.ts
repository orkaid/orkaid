// Exact non-negative decimal arithmetic on scaled bigint integers (value = units / 10^scale).
// Nothing here touches binary floating-point: decimals enter as strings and stay integers.

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

// HALF_UP on non-negative values: an exact half is rounded up.
export function roundHalfUp(value: Decimal, scale: number): Decimal {
  if (value.scale <= scale) return { units: rescaleUp(value, scale), scale };

  const divisor = 10n ** BigInt(value.scale - scale);
  const quotient = value.units / divisor;
  const remainder = value.units % divisor;
  return { units: remainder * 2n >= divisor ? quotient + 1n : quotient, scale };
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

export function formatDecimal(value: Decimal): string {
  if (value.scale === 0) return value.units.toString();
  const digits = value.units.toString().padStart(value.scale + 1, '0');
  return `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
}

function rescaleUp(value: Decimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}
