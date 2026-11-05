import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Synthetic fixtures for the implemented profile. All identities, addresses, numbers and accounts are invented
// (example.com / example.org addresses, the official test-suite dummy IBAN). Expected amounts are worked out by
// hand, never produced by the code under test.

export const FIXTURE_NAMES = ['a-simple', 'b-ten-lines', 'c-rounded-line-net', 'd-mixed-rates', 'e-kleinunternehmer', 'f-kleinunternehmer-lines', 'g-reverse-charge-vat-ids', 'h-reverse-charge-registration-ids', 'i-invoice-note', 'j-invoice-notes-multiline', 'k-payment-terms-only', 'l-payment-due-date-and-terms', 'm-payment-means-30', 'n-payment-means-30-account-details', 'o-eas-0204-seller-0088-buyer', 'p-eas-0088-seller-0204-buyer', 'q-seller-bt29-bt32', 'r-numeric-precision-boundary', 's-standard-and-reverse-charge'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

// Credit note 381 fixtures (MDR-35). Kept apart from FIXTURE_NAMES: that list is the 380 set whose goldens and
// shared tests stay byte-identical.
export const CREDIT_NOTE_FIXTURE_NAMES = ['t-credit-note-full-reversal', 'u-credit-note-partial-standard-and-reverse-charge', 'v-credit-note-kleinunternehmer', 'w-credit-note-reverse-charge', 'y-credit-note-references-all-three'] as const;
export type CreditNoteFixtureName = (typeof CREDIT_NOTE_FIXTURE_NAMES)[number];

export type JsonObject = { [key: string]: unknown };

// Project, contract and purchase order references BT-11, BT-12, BT-13 on a 380 (MDR-36); the 381 counterpart is
// 'y-credit-note-references-all-three' in CREDIT_NOTE_FIXTURE_NAMES. Both carry the amounts of a-simple / t-credit-note-full-reversal.
export const REFERENCE_FIXTURE_NAMES = ['x-references-all-three'] as const;
export type ReferenceFixtureName = (typeof REFERENCE_FIXTURE_NAMES)[number];

// Invoicing period BG-14 instead of BT-72 (MDR-37), with the amounts of their base fixtures: za = x-references-all-three
// (380, a calendar month, BT-11/12/13), zb = a-simple (380, a single leap day), zc = y-credit-note-references-all-three (381,
// a calendar month, BT-11/12/13), zd = t-credit-note-full-reversal (381, a single day). Only BT-72 was replaced by BG-14.
export const PERIOD_FIXTURE_NAMES = ['za-period-month-references', 'zb-period-single-day-leap'] as const;
export const CREDIT_NOTE_PERIOD_FIXTURE_NAMES = ['zc-credit-note-period-month-references', 'zd-credit-note-period-single-day'] as const;
export type PeriodFixtureName = (typeof PERIOD_FIXTURE_NAMES)[number] | (typeof CREDIT_NOTE_PERIOD_FIXTURE_NAMES)[number];

// Leitweg-ID as BT-10 (MDR-38), built with `buyerReferencePolicy: 'leitweg-id'`; the amounts of their base fixtures, only BT-10
// replaced: ze = a-simple (380, the official example, uppercase Fein), zf = t-credit-note-full-reversal (381, lowercase Fein).
export const LEITWEG_FIXTURE_NAMES = ['ze-leitweg-id-invoice', 'zf-leitweg-id-credit-note'] as const;
export type LeitwegFixtureName = (typeof LEITWEG_FIXTURE_NAMES)[number];

// Structured Skonto (MDR-39) on a 380, with the amounts of a-simple: zg = one tier, neither BT-9 nor free text; zh = three
// tiers after multiline free text, with BT-9.
export const SKONTO_FIXTURE_NAMES = ['zg-skonto-single-tier', 'zh-skonto-tiers-terms-due-date'] as const;
export type SkontoFixtureName = (typeof SKONTO_FIXTURE_NAMES)[number];

export function loadFixtureInput(name: FixtureName | CreditNoteFixtureName | ReferenceFixtureName | PeriodFixtureName | LeitwegFixtureName | SkontoFixtureName): JsonObject {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, `../fixtures/xrechnung/${name}.json`), 'utf8')) as JsonObject;
}

// Copies of a fixture with one value replaced or removed, addressed by a dotted path such as 'seller.address.city'
// or 'lines.0.unitCode'. The original is never modified.
export function withValue(base: JsonObject, path: string, value: unknown): JsonObject {
  const copy = structuredClone(base);
  const keys = path.split('.');
  const last = keys.pop() as string;
  let target: any = copy; // test-only navigation over parsed JSON
  for (const key of keys) target = target[key];
  target[last] = value;
  return copy;
}

export function withoutValue(base: JsonObject, path: string): JsonObject {
  const copy = withValue(base, path, undefined);
  const keys = path.split('.');
  const last = keys.pop() as string;
  let target: any = copy; // test-only navigation over parsed JSON
  for (const key of keys) target = target[key];
  delete target[last];
  return copy;
}

export type ExpectedAmounts = {
  readonly lineNets: readonly string[]; // BT-131 per line
  readonly breakdown: readonly { readonly rate: '19' | '7' | '0'; readonly taxable: string; readonly tax: string }[]; // BT-116 / BT-117
  readonly sumOfLineNets: string; // BT-106 = BT-109
  readonly totalVat: string; // BT-110
  readonly gross: string; // BT-112 = BT-115
};

// A: 2 x 49.90 = 99.80; 1.5 x 80.00 = 120.00; 219.80 x 19% = 41.762 -> 41.76; 219.80 + 41.76 = 261.56.
// B: ten lines of 0.03; 0.30 x 19% = 0.057 -> 0.06 (summing per-line VAT would give 0.10); 0.30 + 0.06 = 0.36.
// C: 3 x 0.335 = 1.005 -> 1.01 (HALF_UP); 2.5 x 1.999 = 4.9975 -> 5.00; 6.01 x 19% = 1.1419 -> 1.14; 7.15.
// E (Kleinunternehmer): 2 x 49.90 = 99.80; 1.5 x 80.00 = 120.00; taxable 219.80, VAT 0.00 (no VAT is computed); gross 219.80.
// F (Kleinunternehmer): 3 x 0.335 = 1.005 -> 1.01; 2.5 x 1.999 = 4.9975 -> 5.00; 1 x 12.34; taxable 18.35, VAT 0.00.
// G (reverse charge, seller BT-31, buyer BT-48): same three lines as F under category AE: taxable 18.35, VAT 0.00.
// H (reverse charge, seller BT-30 + BT-32, buyer BT-47): same two lines as E under category AE: taxable 219.80, VAT 0.00.
// I, J (invoice notes, BT-22): the two lines of A, unchanged amounts; only the notes differ.
// K, L (BT-20 alone; BT-9 with multiline BT-20): the two lines of A, unchanged amounts; only the payment terms differ.
// M, N (payment means 30; N adds BT-85 and BT-86): the two lines of A, unchanged amounts; only the payment means differ.
// O, P (electronic-address schemes 0204 and 0088, each in both party roles), Q (seller BT-29 + BT-32, no BT-31): the
// two lines of A, unchanged amounts; only the electronic addresses or the seller identifiers differ.
// R (numeric precision boundary, 6 effective fractional digits): 1234.567891 x 0.123456 = 152.414813551296 -> 152.41;
// 2.500000 x 999999.999999 = 2499999.9999975 -> 2500000.00; 2500152.41 x 19% = 475028.9579 -> 475028.96; gross 2975181.37.
// S (standard + reverse charge in one invoice, after UStAE 13b.4 (2) example 1; the treatment is supplied, never
// classified): 1000 x 0.10 = 100.00 at S 19% -> 19.00; 2000 x 0.10 = 200.00 under AE, VAT 0.00; 300.00 + 19.00 = 319.00.
// D: 100.00 at 19% -> 19.00; 3 x 33.33 = 99.99 at 7% -> 6.9993 -> 7.00; 199.99 + 26.00 = 225.99.
export const EXPECTED: Record<FixtureName, ExpectedAmounts> = {
  'a-simple': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'b-ten-lines': {
    lineNets: Array.from({ length: 10 }, () => '0.03'),
    breakdown: [{ rate: '19', taxable: '0.30', tax: '0.06' }],
    sumOfLineNets: '0.30',
    totalVat: '0.06',
    gross: '0.36',
  },
  'c-rounded-line-net': {
    lineNets: ['1.01', '5.00'],
    breakdown: [{ rate: '19', taxable: '6.01', tax: '1.14' }],
    sumOfLineNets: '6.01',
    totalVat: '1.14',
    gross: '7.15',
  },
  'd-mixed-rates': {
    lineNets: ['100.00', '99.99'],
    breakdown: [
      { rate: '19', taxable: '100.00', tax: '19.00' },
      { rate: '7', taxable: '99.99', tax: '7.00' },
    ],
    sumOfLineNets: '199.99',
    totalVat: '26.00',
    gross: '225.99',
  },
  'e-kleinunternehmer': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '0', taxable: '219.80', tax: '0.00' }],
    sumOfLineNets: '219.80',
    totalVat: '0.00',
    gross: '219.80',
  },
  'f-kleinunternehmer-lines': {
    lineNets: ['1.01', '5.00', '12.34'],
    breakdown: [{ rate: '0', taxable: '18.35', tax: '0.00' }],
    sumOfLineNets: '18.35',
    totalVat: '0.00',
    gross: '18.35',
  },
  'g-reverse-charge-vat-ids': {
    lineNets: ['1.01', '5.00', '12.34'],
    breakdown: [{ rate: '0', taxable: '18.35', tax: '0.00' }],
    sumOfLineNets: '18.35',
    totalVat: '0.00',
    gross: '18.35',
  },
  'h-reverse-charge-registration-ids': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '0', taxable: '219.80', tax: '0.00' }],
    sumOfLineNets: '219.80',
    totalVat: '0.00',
    gross: '219.80',
  },
  'i-invoice-note': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'j-invoice-notes-multiline': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'k-payment-terms-only': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'l-payment-due-date-and-terms': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'm-payment-means-30': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'n-payment-means-30-account-details': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'o-eas-0204-seller-0088-buyer': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'p-eas-0088-seller-0204-buyer': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'q-seller-bt29-bt32': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'r-numeric-precision-boundary': {
    lineNets: ['152.41', '2500000.00'],
    breakdown: [{ rate: '19', taxable: '2500152.41', tax: '475028.96' }],
    sumOfLineNets: '2500152.41',
    totalVat: '475028.96',
    gross: '2975181.37',
  },
  's-standard-and-reverse-charge': {
    lineNets: ['100.00', '200.00'],
    breakdown: [
      { rate: '19', taxable: '100.00', tax: '19.00' },
      { rate: '0', taxable: '200.00', tax: '0.00' },
    ],
    sumOfLineNets: '300.00',
    totalVat: '19.00',
    gross: '319.00',
  },
};

// Credit notes keep positive amounts (MDR-35); worked by hand, never from the code under test.
// T (full reversal of A, S 19%): 2 x 49.90 = 99.80; 1.5 x 80.00 = 120.00; 219.80 x 19% = 41.762 -> 41.76; 261.56.
// U (partial reversal of S: 500 of the 1000 S units and 1000 of the 2000 AE units): 500 x 0.10 = 50.00 at S 19% -> 9.50;
// 1000 x 0.10 = 100.00 under AE, VAT 0.00; 150.00 + 9.50 = 159.50.
// V (full reversal of E, Kleinunternehmer) and W (full reversal of H, reverse charge): the amounts of E and H.
export const EXPECTED_CREDIT_NOTE: Record<CreditNoteFixtureName, ExpectedAmounts> = {
  't-credit-note-full-reversal': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
  'u-credit-note-partial-standard-and-reverse-charge': {
    lineNets: ['50.00', '100.00'],
    breakdown: [
      { rate: '19', taxable: '50.00', tax: '9.50' },
      { rate: '0', taxable: '100.00', tax: '0.00' },
    ],
    sumOfLineNets: '150.00',
    totalVat: '9.50',
    gross: '159.50',
  },
  'v-credit-note-kleinunternehmer': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '0', taxable: '219.80', tax: '0.00' }],
    sumOfLineNets: '219.80',
    totalVat: '0.00',
    gross: '219.80',
  },
  'w-credit-note-reverse-charge': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '0', taxable: '219.80', tax: '0.00' }],
    sumOfLineNets: '219.80',
    totalVat: '0.00',
    gross: '219.80',
  },
  'y-credit-note-references-all-three': {
    lineNets: ['99.80', '120.00'],
    breakdown: [{ rate: '19', taxable: '219.80', tax: '41.76' }],
    sumOfLineNets: '219.80',
    totalVat: '41.76',
    gross: '261.56',
  },
};
