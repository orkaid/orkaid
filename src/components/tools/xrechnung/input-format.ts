// Input format of the invoice workspace for the German profile, identical on the German and the English route:
// decimals with a comma ("125,50"), dates as TT.MM.JJJJ ("07.11.2026"). Text is converted by grammar and digit shuffling
// only: no floating point, no Date object, no locale API, so the result cannot depend on the browser or the time zone.
// The converters check the shape, not the meaning: the domain still decides what a valid amount or calendar date is
// (precision, magnitude, leap years), on the canonical strings produced here.

const DECIMAL = /^(-?[0-9]+)(?:,([0-9]+))?$/;
const DATE = /^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$/;

/**
 * `125,50` -> `125.50`, scale kept as typed. A sign is carried through so the domain can answer `negative_amount`.
 * Undefined for anything else: a dot, a thousands separator, spaces, a dangling comma, other digits or letters.
 * Never trims and never guesses a separator.
 */
export function canonicalDecimal(text: string): string | undefined {
  const match = DECIMAL.exec(text);
  if (match === null) return undefined;
  const [, integer = '', fraction] = match;
  return fraction === undefined ? integer : `${integer}.${fraction}`;
}

/** `07.11.2026` -> `2026-11-07`. Shape only: `31.02.2026` is converted digit for digit and refused by the domain. */
export function canonicalDate(text: string): string | undefined {
  const match = DATE.exec(text);
  if (match === null) return undefined;
  const [, day = '', month = '', year = ''] = match;
  return `${year}-${month}-${day}`;
}

/**
 * What the domain input carries for text the user typed in a decimal or date field. A value that does not fit the format
 * is not repaired and not passed on as typed (`12.50` or `2026-11-05` would be valid canonical text and silently accepted):
 * it becomes a marker no domain grammar accepts, so the domain reports `invalid_decimal` / `invalid_date` on that field.
 */
export const UNPARSABLE = '?';

export const decimalInput = (text: string): string => canonicalDecimal(text) ?? UNPARSABLE;
export const dateInput = (text: string): string => canonicalDate(text) ?? UNPARSABLE;
