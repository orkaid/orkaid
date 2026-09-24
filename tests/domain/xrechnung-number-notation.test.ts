import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDecimal, PROVISIONAL_INPUT_LENGTH_GUARD } from '../../src/lib/domain/xrechnung/decimal.ts';
import {
  formatLocalizedDecimal,
  formatXmlDecimal,
  parseDecimalInput,
  type NumberNotation,
} from '../../src/lib/domain/xrechnung/number-notation.ts';

// Separators follow Unicode CLDR: de = decimal "," / group "."; en = decimal "." / group ",".
// Expected strings are written by hand, not produced by the code under test.

// JSON.stringify cannot serialize bigint fixtures; describe any input safely for assertion messages.
function show(input: unknown): string {
  return typeof input === 'bigint' ? `${input}n` : typeof input === 'string' ? JSON.stringify(input.slice(0, 40)) : String(input);
}

function canonicalOf(input: unknown, notation: NumberNotation): string {
  const result = parseDecimalInput(input, notation);
  assert.equal(result.ok, true, `expected ${show(input)} to parse as ${notation}`);
  return result.ok ? formatDecimal(result.value) : assert.fail('unreachable');
}

function rejection(input: unknown, notation: NumberNotation) {
  const result = parseDecimalInput(input, notation);
  assert.equal(result.ok, false, `expected ${show(input)} to be rejected as ${notation}`);
  return result.ok ? assert.fail('unreachable') : result.code;
}

// ---------------------------------------------------------------- A. localized input -> exact canonical value

test('German input: grouped, ungrouped and comma-decimal forms parse to the same canonical values', () => {
  assert.equal(canonicalOf('1.234,56', 'de'), '1234.56');
  assert.equal(canonicalOf('1234,56', 'de'), '1234.56');
  assert.equal(canonicalOf('1,5', 'de'), '1.5');
  assert.equal(canonicalOf('0,03', 'de'), '0.03');
  assert.equal(canonicalOf('1.234,50', 'de'), '1234.50'); // trailing zero (scale) is kept
  assert.equal(canonicalOf('1.000.000', 'de'), '1000000');
  assert.equal(canonicalOf('999', 'de'), '999');
});

test('English input: grouped, ungrouped and point-decimal forms parse to the same canonical values', () => {
  assert.equal(canonicalOf('1,234.56', 'en'), '1234.56');
  assert.equal(canonicalOf('1234.56', 'en'), '1234.56');
  assert.equal(canonicalOf('1.5', 'en'), '1.5');
  assert.equal(canonicalOf('0.03', 'en'), '0.03');
  assert.equal(canonicalOf('1,234.50', 'en'), '1234.50');
  assert.equal(canonicalOf('1,000,000', 'en'), '1000000');
  assert.equal(canonicalOf('999', 'en'), '999');
});

test('the same digits mean different numbers per locale (no cross-locale guessing)', () => {
  // Locale rules decide: "." groups in de and "," groups in en; a single 3-digit group is a thousands group.
  assert.equal(canonicalOf('1.234', 'de'), '1234');
  assert.equal(canonicalOf('1,234', 'de'), '1.234');
  assert.equal(canonicalOf('1,234', 'en'), '1234');
  assert.equal(canonicalOf('1.234', 'en'), '1.234');
});

test('canonical input is locale independent: point decimal, no grouping', () => {
  assert.equal(canonicalOf('1234.56', 'canonical'), '1234.56');
  assert.equal(canonicalOf('0.03', 'canonical'), '0.03');
  assert.equal(canonicalOf('7', 'canonical'), '7');
});

test('large exact values survive localized parsing without loss', () => {
  assert.equal(canonicalOf('12.345.678.901.234.567.890,123456789', 'de'), '12345678901234567890.123456789');
  assert.equal(canonicalOf('12,345,678,901,234,567,890.123456789', 'en'), '12345678901234567890.123456789');
  assert.equal(canonicalOf('9007199254740993,1', 'de'), '9007199254740993.1'); // 2^53 + 1 digits stay exact
});

// ---------------------------------------------------------------- malformed grouping / mixed separators

test('German input rejects malformed grouping and foreign or mixed separators', () => {
  const malformed = [
    '1.5', // "." is a group separator in de and 1 digit is not a group
    '1,234.56', // English format
    '1.234.56', // last group has 2 digits
    '1.23.456', // inner group has 2 digits
    '12.34',
    '1..234',
    '.234',
    '1.2345', // 4-digit group
    '1234.567,89', // grouping starts after 4 digits
    '1.234,', // dangling decimal separator
    ',5', // no integer digits
    '1,,5',
    '1,5,5', // two decimal separators
    '1 234,56', // space
    '1 234,56', // no-break space
    "1'234,56", // apostrophe
    '0.123', // leading-zero group
    '01.234',
    '1e3',
    '',
    'abc',
  ];
  for (const input of malformed) assert.equal(rejection(input, 'de'), 'invalid_decimal', `de: ${JSON.stringify(input)}`);
});

test('English input rejects malformed grouping and foreign or mixed separators', () => {
  const malformed = [
    '1,5', // "," is a group separator in en and 1 digit is not a group
    '1.234,56', // German format
    '1,234,56',
    '1,23,456',
    '12,34',
    '1,,234',
    ',234',
    '1,2345',
    '1234,567.89',
    '1,234.', // dangling decimal separator
    '.5',
    '1.5.5',
    '1 234.56',
    '0,123',
    '1e3',
    '',
    'abc',
  ];
  for (const input of malformed) assert.equal(rejection(input, 'en'), 'invalid_decimal', `en: ${JSON.stringify(input)}`);
});

test('canonical input rejects any localized or grouped form', () => {
  for (const input of ['1,5', '1.234,56', '1,234.56', '1 234.56', '.5', '5.', '+1', '1e3']) {
    assert.equal(rejection(input, 'canonical'), 'invalid_decimal', `canonical: ${JSON.stringify(input)}`);
  }
});

test('non-string input is rejected in every notation (no Number conversion)', () => {
  for (const notation of ['canonical', 'de', 'en'] as const) {
    for (const input of [1.5, 10, 10n, null, undefined, {}, ['1']]) {
      assert.equal(rejection(input, notation), 'invalid_decimal', `${notation}: ${String(input)}`);
    }
  }
});

test('negative amounts are rejected with their own code once the format is valid', () => {
  assert.equal(rejection('-1,5', 'de'), 'negative_amount');
  assert.equal(rejection('-1.234,56', 'de'), 'negative_amount');
  assert.equal(rejection('-1.5', 'en'), 'negative_amount');
  assert.equal(rejection('-1,234.56', 'en'), 'negative_amount');
  assert.equal(rejection('-1.5', 'canonical'), 'negative_amount');
  assert.equal(rejection('-0', 'canonical'), 'negative_amount');
  // A malformed negative is reported as malformed: the meaning cannot be established.
  assert.equal(rejection('-1,5', 'en'), 'invalid_decimal');
});

// ---------------------------------------------------------------- provisional guard, applied at every input boundary

test('the provisional length guard applies coherently in canonical and localized notations', () => {
  const guard = PROVISIONAL_INPUT_LENGTH_GUARD;
  for (const notation of ['canonical', 'de', 'en'] as const) {
    assert.equal(rejection('1'.repeat(guard + 1), notation), 'input_length_guard', notation);
    assert.equal(rejection('9'.repeat(10_000), notation), 'input_length_guard', notation);
    // exactly at the guard: still parsed, so the guard is a protective bound and not a decimal-places rule
    assert.equal(canonicalOf('1'.repeat(guard), notation).length, guard, notation);
  }
});

test('the guard is not a precision policy: many-digit values below it parse exactly', () => {
  const digits = '1234567890'.repeat(9); // 90 digits
  assert.equal(canonicalOf(`${digits},5`, 'de'), `${digits}.5`);
  assert.equal(canonicalOf(`${digits}.5`, 'en'), `${digits}.5`);
  assert.equal(canonicalOf(`0.${digits}`, 'canonical'), `0.${digits}`);
});

test('the guard is measured on the raw localized text, so grouping separators count', () => {
  const grouped = '1' + '.000'.repeat(Math.ceil(PROVISIONAL_INPUT_LENGTH_GUARD / 4)); // longer than the guard
  assert.ok(grouped.length > PROVISIONAL_INPUT_LENGTH_GUARD);
  assert.equal(rejection(grouped, 'de'), 'input_length_guard');
});

// ---------------------------------------------------------------- A. localized display

test('German display groups thousands with "." and uses "," as decimal separator', () => {
  const cases: Array<[canonical: string, de: string]> = [
    ['1234.56', '1.234,56'],
    ['0.30', '0,30'],
    ['0.00', '0,00'],
    ['1000', '1.000'],
    ['999', '999'],
    ['999.5', '999,5'],
    ['100', '100'],
    ['0', '0'],
    ['1234567.891', '1.234.567,891'],
    ['12345678901234567890.123456789', '12.345.678.901.234.567.890,123456789'],
  ];
  for (const [canonical, expected] of cases) {
    assert.equal(formatLocalizedDecimal(parseCanonical(canonical), 'de'), expected, canonical);
  }
});

test('English display groups thousands with "," and uses "." as decimal separator', () => {
  const cases: Array<[canonical: string, en: string]> = [
    ['1234.56', '1,234.56'],
    ['0.30', '0.30'],
    ['0.00', '0.00'],
    ['1000', '1,000'],
    ['999', '999'],
    ['999.5', '999.5'],
    ['1234567.891', '1,234,567.891'],
    ['12345678901234567890.123456789', '12,345,678,901,234,567,890.123456789'],
  ];
  for (const [canonical, expected] of cases) {
    assert.equal(formatLocalizedDecimal(parseCanonical(canonical), 'en'), expected, canonical);
  }
});

test('localized display parses back to the identical canonical value (round trip)', () => {
  const values = ['0', '0.03', '0.30', '5.50', '999', '1000', '1234.56', '1234567.891', '12345678901234567890.123456789'];
  for (const locale of ['de', 'en'] as const) {
    for (const canonical of values) {
      const shown = formatLocalizedDecimal(parseCanonical(canonical), locale);
      assert.equal(canonicalOf(shown, locale), canonical, `${locale}: ${shown}`);
    }
  }
});

// ---------------------------------------------------------------- B/C. canonical and XML decimal formatting

test('canonical formatting is locale independent: "." decimal, no grouping, scale kept', () => {
  assert.equal(formatDecimal(parseCanonical('1234.56')), '1234.56');
  assert.equal(formatDecimal(parseCanonical('0.30')), '0.30');
  assert.equal(formatDecimal(parseCanonical('1000')), '1000');
});

test('XML decimal formatting is a valid xs:decimal lexical form: "." decimal, no grouping, no sign, no exponent', () => {
  const cases: Array<[canonical: string, xml: string]> = [
    ['1234.56', '1234.56'],
    ['0.30', '0.30'], // fixed two decimals kept (a valid lexical form; not the XSD canonical form "0.3")
    ['1000', '1000'],
    ['0', '0'],
    ['12345678901234567890.123456789', '12345678901234567890.123456789'],
  ];
  for (const [canonical, expected] of cases) {
    const xml = formatXmlDecimal(parseCanonical(canonical));
    assert.equal(xml, expected, canonical);
    assert.match(xml, /^[0-9]+(\.[0-9]+)?$/);
  }
});

test('XML formatting never depends on the display locale', () => {
  const value = parseCanonical('1234567.5');
  assert.equal(formatXmlDecimal(value), '1234567.5');
  assert.notEqual(formatLocalizedDecimal(value, 'de'), formatXmlDecimal(value));
  assert.notEqual(formatLocalizedDecimal(value, 'en'), formatXmlDecimal(value));
});

function parseCanonical(input: string) {
  const result = parseDecimalInput(input, 'canonical');
  assert.equal(result.ok, true, `fixture ${input} must parse`);
  return result.ok ? result.value : assert.fail('unreachable');
}
