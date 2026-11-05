import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, paymentTermsText, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, SKONTO_FIXTURE_NAMES, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { one, parseXml, select } from '../support/xml.ts';

// Structured Skonto on a 380 (MDR-39). The expected BT-20 strings are written by hand from XRechnung 3.0.2 sections 11.1, 12.6
// and 13.2 and the BR-DE-18 rule of Schematron 2.6.0 (fixed baseline: tools/kosit/kosit-manifest.json), never from the code
// under test. The tier count, day range, ordering, percent range, the refusal of BASISBETRAG and the refusal on a 381 are Orkaid
// PROFILE restrictions: the pinned validator accepts several of those documents, so these tests are their only evidence.

const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
const invoice380 = () => loadFixtureInput('a-simple');
const creditNote = () => loadFixtureInput('t-credit-note-full-reversal');
const withSkonto = (skonto: unknown, base: JsonObject = invoice380()) => withValue(base, 'payment.skonto', skonto);
const skontoOnly = (skonto: unknown) => withSkonto(skonto, withoutValue(invoice380(), 'payment.dueDate'));
const tier = (days: unknown = 14, percent: unknown = '2.00') => ({ days, percent });

function built(input: unknown, options?: Parameters<typeof buildInvoice>[1]): Invoice {
  const result = buildInvoice(input, options);
  return result.ok ? result.value : assert.fail(`expected success: ${show(result)}`);
}

function rejected(input: unknown, options?: Parameters<typeof buildInvoice>[1]): readonly string[] {
  const result = buildInvoice(input, options);
  return result.ok ? assert.fail('expected rejection') : result.errors.map((e) => `${e.code}@${e.path}`);
}

const ublXml = (invoice: Invoice) => {
  const result = serializeUblInvoice(invoice);
  return result.ok ? result.xml : assert.fail('ubl');
};
const ciiXml = (invoice: Invoice) => {
  const result = serializeCiiInvoice(invoice);
  return result.ok ? result.xml : assert.fail('cii');
};
const SETTLEMENT = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement';
const ublBt20 = (invoice: Invoice) => select(parseXml(ublXml(invoice)), 'cac:PaymentTerms/cbc:Note').map((n) => n.text);
const ciiBt20 = (invoice: Invoice) => select(parseXml(ciiXml(invoice)), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms/ram:Description`).map((n) => n.text);
const golden = (file: string) => readFileSync(new URL(`../fixtures/xrechnung/golden/${file}`, import.meta.url), 'utf8');

function assertBt20(invoice: Invoice, expected: string): void {
  assert.deepEqual(ublBt20(invoice), [expected]);
  assert.deepEqual(ciiBt20(invoice), [expected]);
}

// ------------------------------------------------------------------------------------------------ BT-20 output

test('one tier alone: BT-20 is the exact BR-DE-18 line with its mandatory final LF, in both syntaxes', () => {
  assertBt20(built(skontoOnly([tier()])), '#SKONTO#TAGE=14#PROZENT=2.00#\n');
});

test('several tiers: every line in input order and every line followed by LF', () => {
  assertBt20(built(skontoOnly([tier(14, '2.25'), tier(28, '1.00')])), '#SKONTO#TAGE=14#PROZENT=2.25#\n#SKONTO#TAGE=28#PROZENT=1.00#\n');
});

test('free text only before the tiers, joined by exactly one LF', () => {
  const input = withValue(withSkonto([tier(7, '3.00'), tier(14, '2.00')]), 'payment.termsText', 'Zahlbar in 30 Tagen.\nDanke & Gruß.');
  assertBt20(built(input), 'Zahlbar in 30 Tagen.\nDanke & Gruß.\n#SKONTO#TAGE=7#PROZENT=3.00#\n#SKONTO#TAGE=14#PROZENT=2.00#\n');
  assert.ok(ublXml(built(input)).includes('<cbc:Note>Zahlbar in 30 Tagen.\nDanke &amp; Gruß.\n#SKONTO#TAGE=7#PROZENT=3.00#\n#SKONTO#TAGE=14#PROZENT=2.00#\n</cbc:Note>'));
  assert.ok(ciiXml(built(input)).includes('<ram:Description>Zahlbar in 30 Tagen.\nDanke &amp; Gruß.\n#SKONTO#TAGE=7#PROZENT=3.00#\n#SKONTO#TAGE=14#PROZENT=2.00#\n</ram:Description>'));
});

test('with no tiers BT-20 is exactly the free text, or absent', () => {
  const text = 'Zahlbar in 30 Tagen.\nDanke.';
  assertBt20(built(withValue(invoice380(), 'payment.termsText', text)), text);
  const noTerms = built(invoice380());
  assert.deepEqual(ublBt20(noTerms), []);
  assert.deepEqual(ciiBt20(noTerms), []);
});

test('exactly one BT-20 element per document, also with the maximum of ten tiers', () => {
  const ten = Array.from({ length: 10 }, (_, index) => tier(index + 1, '1.00'));
  const invoice = built(withSkonto(ten));
  assert.equal(select(parseXml(ublXml(invoice)), 'cac:PaymentTerms').length, 1);
  assert.equal(select(parseXml(ciiXml(invoice)), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms`).length, 1);
  assert.equal(ublBt20(invoice).length, 1);
  assert.equal(ciiBt20(invoice).length, 1);
  assert.equal(ublBt20(invoice)[0]?.split('\n').length, 11);
});

test('one pure function builds BT-20 for both serializers, and only it knows the line format', () => {
  const invoice = built(withValue(withSkonto([tier()]), 'payment.termsText', 'Text'));
  assert.equal(paymentTermsText(invoice.payment), 'Text\n#SKONTO#TAGE=14#PROZENT=2.00#\n');
  assert.equal(paymentTermsText({}), undefined);
  for (const file of ['ubl.ts', 'cii.ts']) {
    const source = readFileSync(new URL(`../../src/lib/domain/xrechnung/${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes('paymentTermsText('), file);
    assert.equal(/SKONTO|termsText/.test(source), false, file);
  }
});

// ------------------------------------------------------------------------------------------------ percent and notation

test('percent is held as an exact decimal and written with exactly two fractional digits, whatever scale was typed', () => {
  const cases: [string, string, bigint][] = [['2', '2.00', 200n], ['2.5', '2.50', 250n], ['2.25', '2.25', 225n], ['2.2500', '2.25', 225n], ['0.01', '0.01', 1n], ['100', '100.00', 10000n], ['100.000', '100.00', 10000n], ['002.50', '2.50', 250n]];
  for (const [typed, written, units] of cases) {
    const invoice = built(skontoOnly([tier(14, typed)]));
    assert.ok(invoice.documentTypeCode === '380');
    assert.deepEqual(invoice.payment.skonto?.[0], { days: 14, percent: { units, scale: 2 } }, typed);
    assertBt20(invoice, `#SKONTO#TAGE=14#PROZENT=${written}#\n`);
  }
});

test('notation: the percent reads the notation of the call, with the same grammar as every amount', () => {
  const expected = '#SKONTO#TAGE=14#PROZENT=2.25#\n';
  const german = withValue(withValue(skontoOnly([tier(14, '2,25')]), 'lines.0.unitPrice', '49,90'), 'lines.1.unitPrice', '80,00');
  const germanLines = withValue(german, 'lines.1.quantity', '1,5');
  assertBt20(built(germanLines, { notation: 'de' }), expected);
  assertBt20(built(skontoOnly([tier(14, '2.25')]), { notation: 'en' }), expected);
  assertBt20(built(skontoOnly([tier(14, '2.25')])), expected);
  assertBt20(built(skontoOnly([tier(14, '2.25')]), { notation: 'canonical' }), expected);
  assert.deepEqual(rejected(skontoOnly([tier(14, '2,25')])), ['invalid_decimal@payment.skonto[0].percent']);
  assert.deepEqual(rejected(skontoOnly([tier(14, '2,25')]), { notation: 'en' }), ['invalid_decimal@payment.skonto[0].percent']);
  // A grouped value is one thousand in English notation, so it is out of range rather than misread as 1.000.
  assert.deepEqual(rejected(skontoOnly([tier(14, '1,000')]), { notation: 'en' }), ['unsupported_skonto_percent@payment.skonto[0].percent']);
});

test('an unknown notation stays a programming error', () => {
  assert.throws(() => buildInvoice(skontoOnly([tier()]), { notation: 'fr' as 'de' }), RangeError);
});

test('percent boundaries: above 0 and at most 100, at most two effective fractional digits', () => {
  for (const ok of ['0.01', '100', '100.00', '100.000', '99.99']) assert.equal(buildInvoice(skontoOnly([tier(14, ok)])).ok, true, ok);
  for (const value of ['0', '0.00', '0.000', '100.01', '101', '1000']) {
    assert.deepEqual(rejected(skontoOnly([tier(14, value)])), ['unsupported_skonto_percent@payment.skonto[0].percent'], value);
  }
  for (const value of ['0.001', '2.255', '100.001', '2.2501']) {
    assert.deepEqual(rejected(skontoOnly([tier(14, value)])), ['fraction_digits_limit@payment.skonto[0].percent'], value);
  }
});

test('percent text and shape reuse the established diagnostics', () => {
  for (const value of ['', 'abc', ' 2.00', '2.00 ', '+2', '1e1', '2,5', '٢']) {
    assert.deepEqual(rejected(skontoOnly([tier(14, value)])), ['invalid_decimal@payment.skonto[0].percent'], JSON.stringify(value));
  }
  assert.deepEqual(rejected(skontoOnly([tier(14, '-2.00')])), ['negative_amount@payment.skonto[0].percent']);
  assert.deepEqual(rejected(skontoOnly([tier(14, '1'.repeat(129))])), ['input_length_guard@payment.skonto[0].percent']);
  for (const value of [2, 2.5, true, null, {}, []]) {
    assert.deepEqual(rejected(skontoOnly([tier(14, value)])), ['invalid_type@payment.skonto[0].percent'], show(value));
  }
  assert.deepEqual(rejected(skontoOnly([{ days: 14 }])), ['missing_field@payment.skonto[0].percent']);
});

// ------------------------------------------------------------------------------------------------ days, order, count

test('days: an integer from 1 to 365, checked without any conversion', () => {
  for (const days of [1, 14, 365]) assertBt20(built(skontoOnly([tier(days)])), `#SKONTO#TAGE=${days}#PROZENT=2.00#\n`);
  for (const days of [0, -0, -1, 366, 1.5, 0.5, 364.9999, Number.NaN, Infinity, -Infinity, 2 ** 53, Number.MAX_VALUE, Number.MIN_VALUE]) {
    assert.deepEqual(rejected(skontoOnly([tier(days)])), ['unsupported_skonto_days@payment.skonto[0].days'], String(days));
  }
  for (const days of ['14', '', true, null, {}, [], 14n]) {
    assert.deepEqual(rejected(skontoOnly([tier(days)])), ['invalid_type@payment.skonto[0].days'], typeof days);
  }
  assert.deepEqual(rejected(skontoOnly([{ percent: '2.00' }])), ['missing_field@payment.skonto[0].days']);
});

test('order: strictly ascending days; never sorted, merged or repaired', () => {
  assert.deepEqual(rejected(skontoOnly([tier(14), tier(14)])), ['unsupported_skonto_tier_order@payment.skonto[1].days']);
  assert.deepEqual(rejected(skontoOnly([tier(30), tier(14)])), ['unsupported_skonto_tier_order@payment.skonto[1].days']);
  assert.deepEqual(rejected(skontoOnly([tier(30), tier(14), tier(20), tier(31)])), ['unsupported_skonto_tier_order@payment.skonto[1].days', 'unsupported_skonto_tier_order@payment.skonto[2].days']);
  assert.deepEqual(rejected(skontoOnly([tier(14), tier(0), tier(14)])), ['unsupported_skonto_days@payment.skonto[1].days', 'unsupported_skonto_tier_order@payment.skonto[2].days']);
});

test('count: one to ten tiers; a longer list is refused without scanning its elements', () => {
  const list = (length: number) => Array.from({ length }, (_, index) => tier(index + 1));
  assert.equal(buildInvoice(skontoOnly(list(1))).ok, true);
  assert.equal(buildInvoice(skontoOnly(list(10))).ok, true);
  assert.deepEqual(rejected(skontoOnly([])), ['unsupported_skonto_tier_count@payment.skonto']);
  assert.deepEqual(rejected(skontoOnly(list(11))), ['unsupported_skonto_tier_count@payment.skonto']);
  assert.deepEqual(rejected(skontoOnly(new Array(4_000_000_000))), ['unsupported_skonto_tier_count@payment.skonto']);
});

test('shape: a list of objects; holes, unknown fields and a base amount are refused at their own paths', () => {
  for (const value of ['x', 5, true, null, {}, { 0: tier(), length: 1 }]) {
    assert.deepEqual(rejected(skontoOnly(value)), ['invalid_type@payment.skonto'], show(value));
  }
  for (const value of ['x', 5, null, []]) {
    assert.deepEqual(rejected(skontoOnly([value])), ['invalid_type@payment.skonto[0]'], show(value));
  }
  assert.deepEqual(rejected(skontoOnly([tier(1), , tier(3)])), ['missing_field@payment.skonto[1]']);
  assert.deepEqual(rejected(skontoOnly([{ ...tier(), baseAmount: '100.00' }])), ['unsupported_skonto_base_amount@payment.skonto[0].baseAmount']);
  assert.deepEqual(rejected(skontoOnly([{ ...tier(), BASISBETRAG: '100.00' }])), ['unknown_field@payment.skonto[0].BASISBETRAG']);
  assert.deepEqual(rejected(skontoOnly([{ ...tier(), amount: '1.00' }])), ['unknown_field@payment.skonto[0].amount']);
});

test('the error codes never call a profile limit legally invalid', () => {
  const codes = [
    ...rejected(skontoOnly([])), ...rejected(skontoOnly([tier(0)])), ...rejected(skontoOnly([tier(2), tier(1)])), ...rejected(skontoOnly([tier(14, '0')])),
    ...rejected(skontoOnly([{ ...tier(), baseAmount: '1.00' }])), ...rejected(withSkonto([tier()], creditNote())),
  ];
  assert.deepEqual(codes.map((code) => code.split('@')[0]), [
    'unsupported_skonto_tier_count', 'unsupported_skonto_days', 'unsupported_skonto_tier_order', 'unsupported_skonto_percent', 'unsupported_skonto_base_amount', 'unsupported_skonto_on_credit_note',
  ]);
});

// ------------------------------------------------------------------------------------------------ free text

test('free text keeps every rule, including the refusal of `#`, next to a tier list', () => {
  const cases: [unknown, string][] = [
    ['Rechnung #12', 'unsupported_hash_in_payment_terms'], ['#SKONTO#TAGE=14#PROZENT=2.00#\n', 'invalid_text'], ['#SKONTO#TAGE=14#PROZENT=2.00#', 'unsupported_hash_in_payment_terms'],
    ['', 'empty_text'], ['x\n', 'invalid_text'], [' x', 'invalid_text'], ['a\rb', 'invalid_text'], [5, 'invalid_type'],
  ];
  for (const [text, code] of cases) {
    assert.deepEqual(rejected(withValue(withSkonto([tier()]), 'payment.termsText', text)), [`${code}@payment.termsText`], show(text));
    assert.deepEqual(rejected(withValue(invoice380(), 'payment.termsText', text)), [`${code}@payment.termsText`], show(text));
  }
});

test('free text and tiers stay separate in the validated document', () => {
  const invoice = built(withValue(withSkonto([tier()]), 'payment.termsText', 'Text'));
  assert.ok(invoice.documentTypeCode === '380');
  assert.equal(invoice.payment.termsText, 'Text');
  assert.deepEqual(Object.keys(invoice.payment.skonto?.[0] ?? {}), ['days', 'percent']);
});

// ------------------------------------------------------------------------------------------------ BT-9 and BR-CO-25

test('BR-CO-25: a tier list alone counts as BT-20 for a positive amount due, and no BT-9 is derived', () => {
  assert.deepEqual(rejected(withoutValue(invoice380(), 'payment.dueDate')), ['missing_payment_due_information@payment']);
  const invoice = built(skontoOnly([tier()]));
  assert.ok(invoice.documentTypeCode === '380');
  assert.equal('dueDate' in invoice.payment, false);
  assert.equal('termsText' in invoice.payment, false);
  assert.equal(select(parseXml(ublXml(invoice)), 'cbc:DueDate').length, 0);
  assert.equal(select(parseXml(ciiXml(invoice)), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime`).length, 0);
});

test('BR-CO-25: a supplied but refused tier list is reported by its own diagnostic, not also as missing', () => {
  assert.deepEqual(rejected(skontoOnly([])), ['unsupported_skonto_tier_count@payment.skonto']);
  assert.deepEqual(rejected(skontoOnly('x')), ['invalid_type@payment.skonto']);
  assert.deepEqual(rejected(skontoOnly([tier(0)])), ['unsupported_skonto_days@payment.skonto[0].days']);
});

test('BT-9 is independent: the same value with or without tiers, and never compared with a tier', () => {
  const plain = built(invoice380());
  const later = built(withSkonto([tier(365)]));
  const parsedDue = (invoice: Invoice) => one(parseXml(ublXml(invoice)), 'cbc:DueDate').text;
  assert.equal(parsedDue(later), parsedDue(plain));
  assert.equal(select(parseXml(ciiXml(later)), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString`)[0]?.text, '20261024');
  assert.deepEqual(childNamesOf(ciiXml(later)), ['ram:Description', 'ram:DueDateDateTime']);
});

function childNamesOf(cii: string): string[] {
  return one(parseXml(cii), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms`).children.map((child) => child.name);
}

test('an amount due of zero may carry tiers too; a malformed date is still reported alone', () => {
  const zero = withValue(skontoOnly([tier()]), 'lines', [{ ...(invoice380().lines as JsonObject[])[0], quantity: '0.001', unitPrice: '0.40' }]);
  assert.equal(built(zero).totals.amountDue.units, 0n);
  assert.deepEqual(rejected(withValue(withSkonto([tier()]), 'payment.dueDate', '2026-02-30')), ['invalid_date@payment.dueDate']);
});

// ------------------------------------------------------------------------------------------------ credit note 381

test('381: any supplied tier list is refused once, as a profile restriction, whatever it holds', () => {
  for (const value of [[tier()], [], 'x', [tier(0)], [{ ...tier(), baseAmount: '1.00' }], null]) {
    assert.deepEqual(rejected(withSkonto(value, creditNote())), ['unsupported_skonto_on_credit_note@payment.skonto'], show(value));
  }
});

test('381: the payment contract is otherwise unchanged', () => {
  const invoice = built(creditNote());
  assert.ok(invoice.documentTypeCode === '381');
  assert.equal('skonto' in invoice.payment, false);
  assert.equal(ublXml(invoice), golden('t-credit-note-full-reversal.xml'));
  assert.equal(ciiXml(invoice), golden('t-credit-note-full-reversal.cii.xml'));
  assert.deepEqual(rejected(withValue(withSkonto([tier()], creditNote()), 'payment.settlement.kind', 'refund-transfer')), ['unsupported_skonto_on_credit_note@payment.skonto', 'unsupported_credit_note_refund_transfer@payment.settlement.kind']);
});

// ------------------------------------------------------------------------------------------------ no monetary effect

const withoutBt20 = (xml: string) => xml.replace(/ *<cac:PaymentTerms>[\s\S]*?<\/cac:PaymentTerms>\n/, '').replace(/ *<ram:SpecifiedTradePaymentTerms>[\s\S]*?<\/ram:SpecifiedTradePaymentTerms>\n/, '');

test('no monetary effect: identical totals and lines, and XML that differs only in BT-20', () => {
  for (const name of ['a-simple', 'c-rounded-line-net', 'd-mixed-rates', 'e-kleinunternehmer', 'g-reverse-charge-vat-ids', 's-standard-and-reverse-charge'] as const) {
    const base = loadFixtureInput(name);
    const plain = built(base);
    const discounted = built(withSkonto([tier(7, '100'), tier(14, '3.00')], base));
    assert.equal(show(discounted.totals), show(plain.totals), name);
    assert.equal(show(discounted.lines), show(plain.lines), name);
    assert.equal(withoutBt20(ublXml(discounted)), withoutBt20(ublXml(plain)), name);
    // CII keeps the payment-terms container for BT-9, so only the Description line differs there.
    assert.equal(ciiXml(discounted).replace(/ *<ram:Description>#SKONTO[\s\S]*?<\/ram:Description>\n/, ''), ciiXml(plain), name);
  }
});

test('the validated document holds no Skonto amount, discounted amount, base or date', () => {
  const invoice = built(withSkonto([tier(14, '2.00')]));
  assert.ok(invoice.documentTypeCode === '380');
  assert.deepEqual(invoice.payment.skonto, [{ days: 14, percent: { units: 200n, scale: 2 } }]);
  assert.equal(Object.isFrozen(invoice.payment.skonto), true);
  assert.equal(Object.isFrozen(invoice.payment.skonto?.[0]), true);
  assert.equal(Object.isFrozen(invoice.payment.skonto?.[0]?.percent), true);
  // 261.56 is BT-115 of a-simple, worked by hand in tests/support/fixtures.ts; 2% of it (5.2312) appears nowhere.
  for (const xml of [ublXml(invoice), ciiXml(invoice)]) {
    assert.ok(xml.includes('261.56'));
    assert.equal(/5\.23|256\.33/.test(xml), false);
  }
});

test('the validated tiers are independent of later changes to the caller input', () => {
  const input = withSkonto([tier(14, '2.00')]);
  const invoice = built(input);
  ((input.payment as JsonObject).skonto as JsonObject[])[0]!.days = 99;
  assert.ok(invoice.documentTypeCode === '380');
  assert.equal(invoice.payment.skonto?.[0]?.days, 14);
});

// ------------------------------------------------------------------------------------------------ input ownership

const LIB = (file: string) => new URL(`../../src/lib/domain/xrechnung/${file}`, import.meta.url).href;
// Each case runs in a child process: it mutates a prototype, which must never reach the test runner. Pollution stays writable
// (a non-writable index on Object.prototype breaks Array push for the wrong reason) and is removed before any output.
function inChild(body: string, input: unknown): { [key: string]: unknown } {
  const script = `
import { buildInvoice, paymentTermsText } from ${JSON.stringify(LIB('document.ts'))};
import { serializeUblInvoice } from ${JSON.stringify(LIB('ubl.ts'))};
import { serializeCiiInvoice } from ${JSON.stringify(LIB('cii.ts'))};
const input = JSON.parse(process.env.SKONTO_INPUT);
const outcome = (result) => (result.ok ? { ok: true, payment: JSON.stringify(result.value.payment, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) } : { ok: false, errors: result.errors.map((e) => e.code + '@' + e.path) });
let report;
${body}
console.log(JSON.stringify(report));
`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, SKONTO_INPUT: JSON.stringify(input) } });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as { [key: string]: unknown };
}

test('an inherited skonto on Object.prototype is never a supplied tier list, on a 380 or a 381', () => {
  const body = `
Object.prototype.skonto = [{ days: 14, percent: '2.00' }];
try { report = outcome(buildInvoice(input)); } finally { delete Object.prototype.skonto; }`;
  assert.deepEqual(inChild(body, withoutValue(invoice380(), 'payment.dueDate')), { ok: false, errors: ['missing_payment_due_information@payment'] });
  assert.equal(inChild(body, creditNote()).ok, true);
});

test('inherited days, percent and baseAmount are not tier fields', () => {
  const report = inChild(`
Object.prototype.days = 14; Object.prototype.percent = '2.00'; Object.prototype.baseAmount = '1.00';
try { report = { empty: outcome(buildInvoice(input)) }; } finally { delete Object.prototype.days; delete Object.prototype.percent; delete Object.prototype.baseAmount; }`, skontoOnly([{}]));
  assert.deepEqual(report.empty, { ok: false, errors: ['missing_field@payment.skonto[0].days', 'missing_field@payment.skonto[0].percent'] });
});

test('an element inherited from Array.prototype does not fill a hole', () => {
  const report = inChild(`
const skonto = new Array(2); skonto[0] = { days: 7, percent: '3.00' }; input.payment.skonto = skonto;
Array.prototype[1] = { days: 14, percent: '2.00' };
try { report = outcome(buildInvoice(input)); } finally { delete Array.prototype[1]; }`, skontoOnly([]));
  assert.deepEqual(report, { ok: false, errors: ['missing_field@payment.skonto[1]'] });
});

test('an inherited notation does not re-read the percent', () => {
  const report = inChild(`
Object.prototype.notation = 'de';
try { report = outcome(buildInvoice(input)); } finally { delete Object.prototype.notation; }`, skontoOnly([tier(14, '2,25')]));
  assert.deepEqual(report, { ok: false, errors: ['invalid_decimal@payment.skonto[0].percent'] });
});

test('after validation: a value planted on Object.prototype never reaches BT-20', () => {
  const report = inChild(`
const built = buildInvoice(input); if (!built.ok) throw new Error('no build');
const clean = [serializeUblInvoice(built.value).xml, serializeCiiInvoice(built.value).xml];
Object.prototype.skonto = [{ days: 1, percent: { units: 1n, scale: 2 } }]; Object.prototype.termsText = 'PLANTED';
let polluted, text;
try { polluted = [serializeUblInvoice(built.value).xml, serializeCiiInvoice(built.value).xml]; text = paymentTermsText(built.value.payment); } finally { delete Object.prototype.skonto; delete Object.prototype.termsText; }
report = { same: JSON.stringify(polluted) === JSON.stringify(clean), text: text ?? null };`, invoice380());
  assert.deepEqual(report, { same: true, text: null });
});

test('own accessors anywhere in the tier list are reported and never executed', () => {
  const body = (path: readonly (string | number)[]) => `
const counts = { ran: 0 }; const keys = ${JSON.stringify(path)};
let holder = input; for (const key of keys.slice(0, -1)) holder = holder[key];
delete holder[keys.at(-1)];
Object.defineProperty(holder, keys.at(-1), { enumerable: true, configurable: true, get() { counts.ran += 1; return 14; } });
report = { ...outcome(buildInvoice(input)), ran: counts.ran };`;
  const cases: [string, (string | number)[], string][] = [
    ['skonto', ['payment', 'skonto'], 'payment.skonto'],
    ['tier', ['payment', 'skonto', 0], 'payment.skonto[0]'],
    ['days', ['payment', 'skonto', 0, 'days'], 'payment.skonto[0].days'],
    ['percent', ['payment', 'skonto', 0, 'percent'], 'payment.skonto[0].percent'],
    ['baseAmount', ['payment', 'skonto', 0, 'baseAmount'], 'payment.skonto[0].baseAmount'],
  ];
  for (const [name, path, reported] of cases) {
    assert.deepEqual(inChild(body(path), skontoOnly([tier()])), { ok: false, errors: [`invalid_type@${reported}`], ran: 0 }, name);
  }
});

test('an accessor is still told apart from data when Object.prototype.value is planted (IR38-03)', () => {
  for (const [field, reported] of [['days', 'payment.skonto[0].days'], ['percent', 'payment.skonto[0].percent']] as const) {
    for (const planted of [`{ value: 7, writable: true, configurable: true }`, `{ get() { counts.inherited += 1; throw new Error('inherited getter ran'); }, configurable: true }`]) {
      const report = inChild(`
const counts = { own: 0, inherited: 0 }; const holder = input.payment.skonto[0];
delete holder.${field};
Object.defineProperty(holder, '${field}', { enumerable: true, configurable: true, get() { counts.own += 1; return 14; } });
Object.defineProperty(Object.prototype, 'value', ${planted});
try { report = { ...outcome(buildInvoice(input)), ...counts }; } finally { delete Object.prototype.value; }`, skontoOnly([tier()]));
      assert.deepEqual(report, { ok: false, errors: [`invalid_type@${reported}`], own: 0, inherited: 0 }, `${field} ${planted}`);
    }
  }
});

test('hostile containers cannot make buildInvoice throw', () => {
  const throwing = new Proxy([], { getOwnPropertyDescriptor() { throw new Error('trap'); }, ownKeys() { throw new Error('trap'); } });
  assert.deepEqual(rejected(skontoOnly(throwing)), ['invalid_type@']);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(rejected(skontoOnly([revoked.proxy])), ['invalid_type@']);
  assert.deepEqual(rejected(skontoOnly([tier(new Number(14))])), ['invalid_type@payment.skonto[0].days']);
  assert.deepEqual(rejected(skontoOnly([tier(14, new String('2.00'))])), ['invalid_type@payment.skonto[0].percent']);
  const cycle: JsonObject = { days: 14, percent: '2.00' };
  cycle.percent = cycle;
  assert.deepEqual(rejected(skontoOnly([cycle])), ['invalid_type@payment.skonto[0].percent']);
});

test('the notation of a call is read once, so the amounts and the percent cannot disagree', () => {
  let reads = 0;
  const options = { get notation() { reads += 1; return (reads === 1 ? 'canonical' : 'de') as 'canonical' | 'de'; } };
  const invoice = built(skontoOnly([tier(14, '2.25')]), options);
  assert.equal(reads, 1);
  assertBt20(invoice, '#SKONTO#TAGE=14#PROZENT=2.25#\n');
});

// ------------------------------------------------------------------------------------------------ goldens

test('the Skonto goldens equal the generated documents byte for byte and carry the expected BT-20', () => {
  const expected: Record<(typeof SKONTO_FIXTURE_NAMES)[number], string> = {
    'zg-skonto-single-tier': '#SKONTO#TAGE=14#PROZENT=2.00#\n',
    'zh-skonto-tiers-terms-due-date': 'Zahlbar innerhalb von 30 Tagen ohne Abzug.\nBitte Rechnungsnummer & Kundennummer angeben.\n#SKONTO#TAGE=7#PROZENT=3.00#\n#SKONTO#TAGE=14#PROZENT=2.25#\n#SKONTO#TAGE=28#PROZENT=1.00#\n',
  };
  for (const name of SKONTO_FIXTURE_NAMES) {
    const invoice = built(loadFixtureInput(name));
    assert.equal(ublXml(invoice), golden(`${name}.xml`), name);
    assert.equal(ciiXml(invoice), golden(`${name}.cii.xml`), name);
    assertBt20(invoice, expected[name]);
  }
});

test('the Skonto fixtures keep the worked amounts of a-simple', () => {
  for (const name of SKONTO_FIXTURE_NAMES) {
    const { totals } = built(loadFixtureInput(name));
    assert.deepEqual(totals.amountDue, { units: 26156n, scale: 2 }, name);
    assert.deepEqual(totals.totalVat, { units: 4176n, scale: 2 }, name);
    assert.deepEqual(totals.sumOfLineNetAmounts, { units: 21980n, scale: 2 }, name);
  }
});
