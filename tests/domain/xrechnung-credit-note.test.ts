import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { formatDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { CREDIT_NOTE_FIXTURE_NAMES, EXPECTED_CREDIT_NOTE, loadFixtureInput, withoutValue, withValue, type CreditNoteFixtureName, type JsonObject } from '../support/fixtures.ts';

// Credit note 381 (MDR-35): positive amounts, explicit document type, mandatory BG-3 (an Orkaid PROFILE restriction),
// payment only as an explicitly confirmed clearing (UNCL4461 code 97, no BG-17). Expected amounts are the hand-worked
// ones in tests/support/fixtures.ts; the golden XML files were checked by the pinned KoSIT validator (npm run test:kosit).

const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
const base = () => loadFixtureInput('t-credit-note-full-reversal');
const invoiceBase = () => loadFixtureInput('a-simple');
const golden = (file: string) => readFileSync(new URL(`../fixtures/xrechnung/golden/${file}`, import.meta.url), 'utf8');

const pairs = (input: unknown) => {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected failure');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
};

function built(name: CreditNoteFixtureName) {
  const result = buildInvoice(loadFixtureInput(name));
  assert.equal(result.ok, true, show(result));
  return result.ok ? result.value : assert.fail('unreachable');
}

// ------------------------------------------------------------------------------------------- the valid credit notes

for (const name of CREDIT_NOTE_FIXTURE_NAMES) {
  test(`credit note ${name}: builds as 381 with positive amounts equal to the independently worked values`, () => {
    const invoice = built(name);
    const expected = EXPECTED_CREDIT_NOTE[name];
    assert.equal(invoice.documentTypeCode, '381');
    assert.deepEqual(invoice.lines.map((l) => formatDecimal(l.netAmount)), expected.lineNets);
    assert.deepEqual(
      invoice.totals.vatBreakdown.map((b) => ({ rate: b.rate, taxable: formatDecimal(b.taxableAmount), tax: formatDecimal(b.taxAmount) })),
      expected.breakdown,
    );
    assert.equal(formatDecimal(invoice.totals.sumOfLineNetAmounts), expected.sumOfLineNets);
    assert.equal(formatDecimal(invoice.totals.totalVat), expected.totalVat);
    assert.equal(formatDecimal(invoice.totals.totalWithVat), expected.gross);
    assert.equal(formatDecimal(invoice.totals.amountDue), expected.gross);
  });
}

test('a credit note carries the preceding invoice reference and an explicit clearing, and no payment means', () => {
  const full = built('t-credit-note-full-reversal');
  assert.equal(full.documentTypeCode === '381' && full.precedingInvoice.number, 'RE-2026-0001');
  assert.equal(full.documentTypeCode === '381' && full.precedingInvoice.issueDate, '2026-09-24');
  assert.ok(full.documentTypeCode === '381');
  assert.deepEqual(full.payment.settlement, { kind: 'clearing' });
  assert.equal('means' in full.payment, false);

  const partial = built('u-credit-note-partial-standard-and-reverse-charge');
  assert.equal(partial.documentTypeCode === '381' && partial.precedingInvoice.issueDate, undefined); // BT-26 is optional
});

test('the same lines give the same amounts as the 380 they reverse: reversal is not a second calculation', () => {
  const credit = built('t-credit-note-full-reversal');
  const invoice = buildInvoice(invoiceBase());
  assert.equal(invoice.ok, true);
  const original = invoice.ok ? invoice.value : assert.fail('unreachable');
  assert.deepEqual(formatDecimal(credit.totals.totalWithVat), formatDecimal(original.totals.totalWithVat));
  assert.deepEqual(credit.lines.map((l) => formatDecimal(l.netAmount)), original.lines.map((l) => formatDecimal(l.netAmount)));
});

// ------------------------------------------------------------------------------------------- BG-3

test('a credit note without a preceding invoice reference is rejected (PROFILE restriction)', () => {
  assert.deepEqual(pairs(withoutValue(base(), 'precedingInvoice')), ['missing_field@precedingInvoice']);
});

test('the preceding invoice reference needs BT-25; BT-26 is optional but, when given, a calendar date', () => {
  assert.deepEqual(pairs(withoutValue(base(), 'precedingInvoice.number')), ['missing_field@precedingInvoice.number']);
  assert.deepEqual(pairs(withValue(base(), 'precedingInvoice.issueDate', '2026-02-30')), ['invalid_date@precedingInvoice.issueDate']);
  assert.deepEqual(pairs(withValue(base(), 'precedingInvoice.extra', 'x')), ['unknown_field@precedingInvoice.extra']);
  assert.equal(buildInvoice(withoutValue(base(), 'precedingInvoice.issueDate')).ok, true);
});

test('an ordinary invoice 380 with a preceding invoice reference is rejected, not silently accepted', () => {
  assert.deepEqual(pairs(withValue(invoiceBase(), 'precedingInvoice', { number: 'RE-1' })), ['unsupported_preceding_invoice_reference@precedingInvoice']);
});

// ------------------------------------------------------------------------------------------- payment

test('a 381 without a settlement is rejected: nothing defaults to clearing', () => {
  assert.deepEqual(pairs(withoutValue(base(), 'payment.settlement')), ['missing_field@payment.settlement']);
});

test('clearing needs the caller to confirm the reciprocal obligation, exactly true', () => {
  for (const confirmation of [false, 'true', 1, null]) {
    assert.deepEqual(pairs(withValue(base(), 'payment.settlement.reciprocalObligationConfirmed', confirmation)), ['missing_clearing_confirmation@payment.settlement.reciprocalObligationConfirmed']);
  }
  assert.deepEqual(pairs(withoutValue(base(), 'payment.settlement.reciprocalObligationConfirmed')), ['missing_clearing_confirmation@payment.settlement.reciprocalObligationConfirmed']);
});

test('refund by transfer is rejected explicitly and never turned into clearing', () => {
  assert.deepEqual(pairs(withValue(base(), 'payment.settlement', { kind: 'refund-transfer' })), ['unsupported_credit_note_refund_transfer@payment.settlement.kind']);
});

test('any other settlement kind is unsupported', () => {
  for (const kind of ['direct-debit', 'card', '97', 'Clearing']) {
    assert.deepEqual(pairs(withValue(base(), 'payment.settlement', { kind, reciprocalObligationConfirmed: true })), ['unsupported_credit_note_settlement@payment.settlement.kind']);
  }
  assert.deepEqual(pairs(withValue(base(), 'payment.settlement', { reciprocalObligationConfirmed: true })), ['missing_field@payment.settlement.kind']);
  assert.deepEqual(pairs(withValue(base(), 'payment.settlement', 'clearing')), ['invalid_type@payment.settlement']);
});

test('a 381 never reuses 380-style payment means, whatever account they name', () => {
  const means = { kind: 'credit-transfer', code: '58', account: { id: { scheme: 'IBAN', value: 'DE79000000001234567890' } } };
  assert.deepEqual(pairs(withValue(base(), 'payment.means', means)), ['unsupported_credit_note_payment_means@payment.means']);
});

test('an ordinary invoice cannot select a settlement; its payment means stay required', () => {
  const settlement = { kind: 'clearing', reciprocalObligationConfirmed: true };
  assert.deepEqual(pairs(withValue(invoiceBase(), 'payment.settlement', settlement)), ['unsupported_settlement_on_invoice@payment.settlement']);
  assert.deepEqual(pairs(withoutValue(invoiceBase(), 'payment.means')), ['missing_field@payment.means']);
});

test('BR-CO-25 applies to a 381 with a positive amount due: BT-9 or BT-20 is needed', () => {
  const noTerms = withoutValue(withoutValue(base(), 'payment.termsText'), 'payment.dueDate');
  assert.deepEqual(pairs(noTerms), ['missing_payment_due_information@payment']);
});

// ------------------------------------------------------------------------------------------- serialization

test('UBL: a credit note is a CreditNote document with its own type code, lines and BT-9 position', () => {
  const xml = serializeUblInvoice(built('u-credit-note-partial-standard-and-reverse-charge'));
  assert.equal(xml.ok, true);
  const text = xml.ok ? xml.xml : '';
  assert.match(text, /<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/);
  assert.match(text, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.doesNotMatch(text, /InvoiceTypeCode|<Invoice|<cac:InvoiceLine|InvoicedQuantity/);
  assert.equal((text.match(/<cac:CreditNoteLine>/g) ?? []).length, 2);
  assert.match(text, /<cbc:CreditedQuantity unitCode="KGM">500<\/cbc:CreditedQuantity>/);
  assert.doesNotMatch(text, /^ {2}<cbc:DueDate>/m); // no DueDate in a CreditNote (XSD); BT-9 is in PaymentMeans
  assert.match(text, /<cbc:PaymentMeansCode>97<\/cbc:PaymentMeansCode>\n {4}<cbc:PaymentDueDate>2026-10-24<\/cbc:PaymentDueDate>\n {2}<\/cac:PaymentMeans>/);
  assert.doesNotMatch(text, /PayeeFinancialAccount/);
  assert.match(text, /<cac:BillingReference>\n {4}<cac:InvoiceDocumentReference>\n {6}<cbc:ID>RE-2026-0301<\/cbc:ID>\n {4}<\/cac:InvoiceDocumentReference>\n {2}<\/cac:BillingReference>/);
  assert.ok(text.indexOf('<cbc:BuyerReference>') < text.indexOf('<cac:BillingReference>') && text.indexOf('<cac:BillingReference>') < text.indexOf('<cac:AccountingSupplierParty>'));
});

test('UBL: BT-26 is written when given', () => {
  const xml = serializeUblInvoice(built('t-credit-note-full-reversal'));
  assert.match(xml.ok ? xml.xml : '', /<cbc:ID>RE-2026-0001<\/cbc:ID>\n {6}<cbc:IssueDate>2026-09-24<\/cbc:IssueDate>/);
});

test('CII: a credit note is the same document with TypeCode 381, clearing code 97 and the referenced invoice', () => {
  const xml = serializeCiiInvoice(built('t-credit-note-full-reversal'));
  assert.equal(xml.ok, true);
  const text = xml.ok ? xml.xml : '';
  assert.match(text, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.match(text, /<ram:SpecifiedTradeSettlementPaymentMeans>\n {8}<ram:TypeCode>97<\/ram:TypeCode>\n {6}<\/ram:SpecifiedTradeSettlementPaymentMeans>/);
  assert.doesNotMatch(text, /IBANID|PayeePartyCreditorFinancialAccount/);
  assert.match(text, /<ram:InvoiceReferencedDocument>\n {8}<ram:IssuerAssignedID>RE-2026-0001<\/ram:IssuerAssignedID>\n {8}<ram:FormattedIssueDateTime>\n {10}<qdt:DateTimeString format="102">20260924<\/qdt:DateTimeString>/);
  assert.match(text, /xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"/);
  // InvoiceReferencedDocument follows the monetary summation within the header settlement (CII D16B).
  assert.ok(text.indexOf('</ram:SpecifiedTradeSettlementHeaderMonetarySummation>') < text.indexOf('<ram:InvoiceReferencedDocument>'));
});

test('CII: an ordinary invoice declares no qdt namespace and no referenced invoice', () => {
  const invoice = buildInvoice(invoiceBase());
  const xml = invoice.ok ? serializeCiiInvoice(invoice.value) : assert.fail('unreachable');
  assert.doesNotMatch(xml.ok ? xml.xml : '', /qdt|InvoiceReferencedDocument/);
});

test('both syntaxes carry the same amounts for each credit note', () => {
  for (const name of CREDIT_NOTE_FIXTURE_NAMES) {
    const invoice = built(name);
    const expected = EXPECTED_CREDIT_NOTE[name];
    const ubl = serializeUblInvoice(invoice);
    const cii = serializeCiiInvoice(invoice);
    const u = ubl.ok ? ubl.xml : '';
    const c = cii.ok ? cii.xml : '';
    assert.match(u, new RegExp(`<cbc:PayableAmount currencyID="EUR">${expected.gross}<`));
    assert.match(c, new RegExp(`<ram:DuePayableAmount>${expected.gross}<`));
    assert.match(u, new RegExp(`<cbc:LineExtensionAmount currencyID="EUR">${expected.sumOfLineNets}<`));
    assert.match(c, new RegExp(`<ram:LineTotalAmount>${expected.sumOfLineNets}<`));
    for (const net of expected.lineNets) {
      assert.ok(u.includes(`>${net}</cbc:LineExtensionAmount>`) && c.includes(`<ram:LineTotalAmount>${net}</ram:LineTotalAmount>`));
    }
  }
});

test('the committed golden files equal the generated documents', () => {
  for (const name of CREDIT_NOTE_FIXTURE_NAMES) {
    const invoice = built(name);
    const ubl = serializeUblInvoice(invoice);
    const cii = serializeCiiInvoice(invoice);
    assert.equal(ubl.ok && ubl.xml, golden(`${name}.xml`));
    assert.equal(cii.ok && cii.xml, golden(`${name}.cii.xml`));
  }
});

test('an unvalidated look-alike credit note is still refused by both serializers', () => {
  const copy = structuredClone(built('t-credit-note-full-reversal'));
  assert.deepEqual(serializeUblInvoice(copy), { ok: false, errors: [{ code: 'unvalidated_invoice', path: '' }] });
  assert.deepEqual(serializeCiiInvoice(copy), { ok: false, errors: [{ code: 'unvalidated_invoice', path: '' }] });
});

test('the other supported treatments build as credit notes too (Kleinunternehmer and reverse charge)', () => {
  for (const fixture of ['e-kleinunternehmer', 'h-reverse-charge-registration-ids'] as const) {
    const input: JsonObject = { ...loadFixtureInput(fixture), documentTypeCode: '381', precedingInvoice: { number: 'RE-1' }, payment: { dueDate: '2026-10-24', settlement: { kind: 'clearing', reciprocalObligationConfirmed: true } } };
    const result = buildInvoice(input);
    assert.equal(result.ok, true, show(result));
  }
});

// ------------------------------------------------------------------------------------------- hostile and odd input

test('unexpected keys and odd shapes in the credit note readers fail explicitly', () => {
  assert.deepEqual(pairs(withValue(base(), 'payment.settlement.account', 'DE79000000001234567890')), ['unknown_field@payment.settlement.account']);
  const proto = JSON.parse('{"kind":"clearing","reciprocalObligationConfirmed":true,"__proto__":{"x":1}}') as JsonObject;
  assert.deepEqual(pairs(withValue(base(), 'payment.settlement', proto)), ['unknown_field@payment.settlement.__proto__']);
  assert.deepEqual(pairs(withValue(base(), 'payment', [])), ['invalid_type@payment']);
  assert.deepEqual(pairs(withValue(base(), 'payment', null)), ['invalid_type@payment']);
  assert.deepEqual(pairs(withValue(base(), 'precedingInvoice', 'RE-2026-0001')), ['invalid_type@precedingInvoice']);
});

test('payment means are refused on a 381 even when null, and a settlement on a 380 even when null', () => {
  assert.deepEqual(pairs(withValue(base(), 'payment.means', null)), ['unsupported_credit_note_payment_means@payment.means']);
  assert.deepEqual(pairs(withValue(invoiceBase(), 'payment.settlement', null)), ['unsupported_settlement_on_invoice@payment.settlement']);
});

test('a getter in the credit note input is reported, never executed', () => {
  let reads = 0;
  const settlement = { kind: 'clearing', get reciprocalObligationConfirmed() { reads++; return true; } };
  assert.deepEqual(pairs(withValue(base(), 'payment.settlement', settlement)), ['invalid_type@payment.settlement.reciprocalObligationConfirmed']);
  assert.equal(reads, 0);
});

test('a BT-3 that is neither 380 nor 381 is reported once, without noise about references or settlements', () => {
  for (const code of [381, undefined, '384']) {
    assert.deepEqual(pairs({ ...base(), documentTypeCode: code }).filter((p) => p.startsWith('unsupported_document_type') || p.includes('precedingInvoice') || p.includes('settlement')), ['unsupported_document_type@documentTypeCode']);
  }
});

test('the validated credit note is frozen all the way down', () => {
  const invoice = built('t-credit-note-full-reversal');
  assert.ok(invoice.documentTypeCode === '381');
  assert.ok(Object.isFrozen(invoice.precedingInvoice) && Object.isFrozen(invoice.payment) && Object.isFrozen(invoice.payment.settlement));
});

test('the Kleinunternehmer and reverse-charge credit notes serialize in both syntaxes with their BT-120', () => {
  for (const name of ['v-credit-note-kleinunternehmer', 'w-credit-note-reverse-charge'] as const) {
    const invoice = built(name);
    const ubl = serializeUblInvoice(invoice);
    const cii = serializeCiiInvoice(invoice);
    assert.match(ubl.ok ? ubl.xml : '', /<CreditNote /);
    assert.match(ubl.ok ? ubl.xml : '', /<cbc:TaxExemptionReason>/);
    assert.match(cii.ok ? cii.xml : '', /<ram:ExemptionReason>/);
    assert.match(cii.ok ? cii.xml : '', /<ram:TypeCode>97<\/ram:TypeCode>/);
  }
});
