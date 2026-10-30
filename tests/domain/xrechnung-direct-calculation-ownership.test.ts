import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateInvoice, calculateInvoiceTotals } from '../../src/lib/domain/xrechnung/invoice.ts';

// IR-RR-01: the standalone calculation entry points use only caller-supplied facts. A field that is missing from the
// input never acquires a value from Object.prototype. Every pollution is removed in a finally block, also when an
// assertion fails.

type Obj = Record<string, unknown>;

const vat = (): Obj => ({ treatment: 'standard', category: 'S', rate: '19' });
const line = (): Obj => ({ quantity: '2', unitPrice: '1500', vat: vat() });
const input = (): Obj => ({ documentTypeCode: '380', currency: 'EUR', lines: [line()] });

const CALCULATIONS = [
  { api: 'calculateInvoiceTotals', run: (value: unknown) => calculateInvoiceTotals(value) },
  { api: 'calculateInvoice', run: (value: unknown) => calculateInvoice(value) },
] as const;

const summary = (result: { ok: boolean; errors?: readonly { code: string; path: string }[]; value?: unknown }) => {
  if (!result.ok) return (result.errors ?? []).map((e) => `${e.code}@${e.path}`);
  const totals = (result.value as { totals?: { totalWithVat: unknown } }).totals ?? (result.value as { totalWithVat: unknown });
  const { units, scale } = totals.totalWithVat as { units: bigint; scale: number };
  return [`${units}e-${scale}`];
};

function polluted<T>(key: string, value: unknown, body: () => T): T {
  const prototype = Object.prototype as Obj;
  assert.equal(Object.hasOwn(prototype, key), false, `Object.prototype.${key} already exists`);
  try {
    prototype[key] = value;
    return body();
  } finally {
    delete prototype[key];
  }
}

// Each case omits one field and pollutes Object.prototype with a valid-looking value for exactly that name.
const MISSING = [
  { field: 'documentTypeCode', inherited: '380', strip: (v: Obj) => { delete v.documentTypeCode; }, expected: ['unsupported_document_type@documentTypeCode'] },
  { field: 'currency', inherited: 'EUR', strip: (v: Obj) => { delete v.currency; }, expected: ['unsupported_currency@currency'] },
  { field: 'lines', inherited: [line()], strip: (v: Obj) => { delete v.lines; }, expected: ['invalid_type@lines'] },
  { field: 'quantity', inherited: '2', strip: (v: Obj) => { delete (v.lines as Obj[])[0]!.quantity; }, expected: ['invalid_decimal@lines[0].quantity'] },
  { field: 'unitPrice', inherited: '1500', strip: (v: Obj) => { delete (v.lines as Obj[])[0]!.unitPrice; }, expected: ['invalid_decimal@lines[0].unitPrice'] },
  {
    field: 'vat',
    inherited: vat(),
    strip: (v: Obj) => { delete (v.lines as Obj[])[0]!.vat; },
    expected: ['unsupported_vat_treatment@lines[0].vat.treatment', 'unsupported_vat_category@lines[0].vat.category', 'unsupported_vat_rate@lines[0].vat.rate'],
  },
  { field: 'treatment', inherited: 'standard', strip: (v: Obj) => { delete ((v.lines as Obj[])[0]!.vat as Obj).treatment; }, expected: ['unsupported_vat_treatment@lines[0].vat.treatment'] },
  { field: 'category', inherited: 'S', strip: (v: Obj) => { delete ((v.lines as Obj[])[0]!.vat as Obj).category; }, expected: ['unsupported_vat_category@lines[0].vat.category'] },
  { field: 'rate', inherited: '19', strip: (v: Obj) => { delete ((v.lines as Obj[])[0]!.vat as Obj).rate; }, expected: ['unsupported_vat_rate@lines[0].vat.rate'] },
] as const;

for (const { api, run } of CALCULATIONS) {
  test(`IR-RR-01 ${api}: a missing field is rejected, not filled from Object.prototype`, () => {
    for (const { field, inherited, strip, expected } of MISSING) {
      const value = input();
      strip(value);
      assert.deepEqual(summary(run(value)), expected, `${field}: baseline`);
      assert.deepEqual(polluted(field, inherited, () => summary(run(value))), expected, `${field}: filled from Object.prototype`);
    }
  });

  test(`IR-RR-01 ${api}: the reported reproduction (quantity 2, no unitPrice, prototype unitPrice 1500)`, () => {
    const value = input();
    delete (value.lines as Obj[])[0]!.unitPrice;
    const result = polluted('unitPrice', '1500', () => run(value));
    assert.equal(result.ok, false, 'EUR 3,570.00 calculated from an inherited unit price');
    assert.deepEqual(summary(result), ['invalid_decimal@lines[0].unitPrice']);
  });

  test(`IR-RR-01 ${api}: own values take precedence over contradicting inherited ones`, () => {
    // 2 x 1500.00 = 3000.00; 19 % = 570.00; total 3570.00 (independently calculated).
    const poisons: Obj = { documentTypeCode: '381', currency: 'USD', quantity: '9', unitPrice: '9999', treatment: 'reverse-charge', category: 'AE', rate: '7' };
    const keys = Object.keys(poisons);
    const prototype = Object.prototype as Obj;
    try {
      for (const key of keys) prototype[key] = poisons[key];
      assert.deepEqual(summary(run(input())), ['357000e-2']);
    } finally {
      for (const key of keys) delete prototype[key];
    }
  });

  test(`IR-RR-01 ${api}: a malformed own value stays rejected whatever is inherited`, () => {
    const value = input();
    (value.lines as Obj[])[0]!.unitPrice = 'abc';
    const expected = ['invalid_decimal@lines[0].unitPrice'];
    assert.deepEqual(summary(run(value)), expected);
    assert.deepEqual(polluted('unitPrice', '1500', () => summary(run(value))), expected);
  });

  test(`IR-RR-01 ${api}: an own undefined is still missing, not replaced by an inherited value`, () => {
    const value = input();
    (value.lines as Obj[])[0]!.unitPrice = undefined;
    const expected = ['invalid_decimal@lines[0].unitPrice'];
    assert.deepEqual(summary(run(value)), expected);
    assert.deepEqual(polluted('unitPrice', '1500', () => summary(run(value))), expected);
  });

  test(`IR-RR-01 ${api}: a complete ordinary input is unchanged by unrelated pollution`, () => {
    assert.deepEqual(polluted('unrelated', 'x', () => summary(run(input()))), ['357000e-2']);
  });
}
