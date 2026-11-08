// Input format of the invoice workspace for the German profile, identical on the German and the English route:
// decimals with a comma ("125,50"), dates as TT.MM.JJJJ ("07.11.2026"). Text is converted by grammar and digit shuffling
// only: no floating point, no Date object, no locale API, so the result cannot depend on the browser or the time zone.
// The converters check the shape, not the meaning: the domain still decides what a valid amount or calendar date is
// (precision, magnitude, leap years), on the canonical strings produced here.

const DECIMAL = /^(-?[0-9]+)(?:,([0-9]+))?$/;
const DATE = /^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$/;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

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
 * `2026-11-07`, the value a native date control reports, -> `07.11.2026`, the text the field shows. Digits only, no Date object.
 * Undefined for anything that is not exactly that shape (the empty string included, which means "cleared").
 */
export function germanDateFromIso(iso: string): string | undefined {
  const match = ISO_DATE.exec(iso);
  if (match === null) return undefined;
  const [, year = '', month = '', day = ''] = match;
  return `${day}.${month}.${year}`;
}

/** The years TT.MM.JJJJ can express. The native control gets this range; browsers otherwise accept extended years (`20260-11-07`). */
export const NATIVE_DATE_MIN = '0001-01-01';
export const NATIVE_DATE_MAX = '9999-12-31';

/**
 * The field text for a value the native control reported: cleared -> empty, a representable date -> TT.MM.JJJJ, anything else
 * (an extended year) -> as reported. It is never swapped for the previous value, so the field and the control cannot show
 * different dates: the unrepresentable text goes through `dateInput` as `UNPARSABLE` and the domain reports `invalid_date`.
 */
export function textFromNativeDate(iso: string): string {
  return iso === '' ? '' : (germanDateFromIso(iso) ?? iso);
}

/** The date to preselect in the native control: the typed text when it has the German shape, else nothing. Reads only. */
export function isoForPicker(text: string): string {
  return canonicalDate(text) ?? '';
}

/**
 * What the domain input carries for text the user typed in a decimal or date field. A value that does not fit the format
 * is not repaired and not passed on as typed (`12.50` or `2026-11-05` would be valid canonical text and silently accepted):
 * it becomes a marker no domain grammar accepts, so the domain reports `invalid_decimal` / `invalid_date` on that field.
 */
export const UNPARSABLE = '?';

export const decimalInput = (text: string): string => canonicalDecimal(text) ?? UNPARSABLE;
export const dateInput = (text: string): string => canonicalDate(text) ?? UNPARSABLE;
