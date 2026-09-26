// Number notations at the domain boundary. Three distinct things must not be mixed up:
//   A. localized user input/display: de "1.234,56", en "1,234.56";
//   B. the locale-independent canonical decimal "1234.56" (what the arithmetic engine works on);
//   C. the XML decimal lexical form, also "1234.56".
// Localized text is parsed by grammar into exact digits; it never passes through Number or parseFloat, and a
// separator is never guessed or globally replaced. Text that does not fit the chosen notation is rejected (MDR-14).

import {
  formatDecimal,
  parseDecimal,
  PROVISIONAL_INPUT_LENGTH_GUARD,
  type Decimal,
  type ParseResult,
} from './decimal.ts';

export type NumberLocale = 'de' | 'en';
export type NumberNotation = 'canonical' | NumberLocale;

// Symbols and grouping (groups of three, pattern #,##0.###) per Unicode CLDR: de "," decimal and "." group;
// en "." decimal and "," group.
const SYMBOLS = {
  de: { decimal: ',', group: '.' },
  en: { decimal: '.', group: ',' },
} as const;

// sign, integer part (ungrouped digits, or a first group of 1-3 non-zero-led digits followed by exact 3-digit groups),
// optional fraction. Anything else - a 1-digit group, mixed separators, a dangling separator - does not match.
function localizedPattern(locale: NumberLocale): RegExp {
  const literal = (symbol: string) => (symbol === '.' ? '\\.' : symbol);
  const { decimal, group } = SYMBOLS[locale];
  return new RegExp(`^(-?)([0-9]+|[1-9][0-9]{0,2}(?:${literal(group)}[0-9]{3})+)(?:${literal(decimal)}([0-9]+))?$`);
}

const PATTERNS = { de: localizedPattern('de'), en: localizedPattern('en') } as const;

export function parseDecimalInput(input: unknown, notation: NumberNotation): ParseResult {
  if (notation === 'canonical') return parseDecimal(input);
  // The notation is chosen by the caller, not typed by a user: an unknown one is a programming error, not input.
  if (notation !== 'de' && notation !== 'en') throw new RangeError(`unknown number notation: ${String(notation)}`);

  if (typeof input !== 'string') return { ok: false, code: 'invalid_decimal' };
  if (input.length > PROVISIONAL_INPUT_LENGTH_GUARD) return { ok: false, code: 'input_length_guard' };

  const match = PATTERNS[notation].exec(input);
  if (!match) return { ok: false, code: 'invalid_decimal' };

  const [, sign = '', integer = '', fraction] = match;
  const digits = integer.replaceAll(SYMBOLS[notation].group, '');
  // Re-enter through the canonical parser so sign handling and the guard stay in one place.
  return parseDecimal(`${sign}${digits}${fraction === undefined ? '' : `.${fraction}`}`);
}

/** Localized display of an exact value: thousands grouping and the locale's decimal separator, scale kept. */
export function formatLocalizedDecimal(value: Decimal, locale: NumberLocale): string {
  const [integer = '', fraction] = formatDecimal(value).split('.');
  const { decimal, group } = SYMBOLS[locale];

  const groups: string[] = [];
  for (let end = integer.length; end > 0; end -= 3) groups.unshift(integer.slice(Math.max(0, end - 3), end));
  const grouped = groups.join(group);
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}

/**
 * XML decimal lexical form for serialization: "." decimal, no grouping, sign, or exponent, scale kept (so "0.30").
 * That is a valid xs:decimal lexical representation; it is not the XSD canonical form, which would drop the
 * trailing zero. Kept separate from display formatting so serializers never depend on a locale.
 */
export function formatXmlDecimal(value: Decimal): string {
  return formatDecimal(value);
}
