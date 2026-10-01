import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Synthetic fixtures for the implemented profile. All identities, addresses, numbers and accounts are invented
// (example.com / example.org addresses, the official test-suite dummy IBAN). Expected amounts are worked out by
// hand, never produced by the code under test.

export const FIXTURE_NAMES = ['a-simple', 'b-ten-lines', 'c-rounded-line-net', 'd-mixed-rates', 'e-kleinunternehmer', 'f-kleinunternehmer-lines', 'g-reverse-charge-vat-ids', 'h-reverse-charge-registration-ids', 'i-invoice-note', 'j-invoice-notes-multiline', 'k-payment-terms-only', 'l-payment-due-date-and-terms'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export type JsonObject = { [key: string]: unknown };

export function loadFixtureInput(name: FixtureName): JsonObject {
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
};
