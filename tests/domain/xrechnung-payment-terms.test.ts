import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select } from '../support/xml.ts';

// BT-9 (payment due date) and BT-20 (payment terms), plus BR-CO-25. Expectations come from the pinned KoSIT
// configuration 2026-08-31, not from the code under test: SeMoX CIUS model (BT-9 0..1, datatype en16931-date; BT-20 0..1,
// datatype "text" = line breaks allowed, no length limit, "Der unstrukturierte Text darf dabei keine # enthalten";
// UBL /Invoice/cbc:DueDate and /Invoice/cac:PaymentTerms/cbc:Note; CII .../ram:SpecifiedTradePaymentTerms/
// ram:DueDateDateTime/udt:DateTimeString[@format='102'] and .../ram:SpecifiedTradePaymentTerms/ram:Description), the UBL
// 2.1 and CII D16B XSD sequences, and BR-CO-25 ("Im Falle eines positiven Zahlbetrags BT-115 muss entweder ... BT-9
// oder ... BT-20 vorhanden sein"), which the pinned Schematron does not implement.
// PROFILE: no `#` in BT-20 (structured Skonto, BR-DE-18, is not in M1); multiline policy and length limit as BT-22.

const base = () => loadFixtureInput('a-simple');
const DUE = '2026-10-24';
const withPayment = (change: (payment: JsonObject) => void): JsonObject => {
  const input = base();
  change(input.payment as JsonObject);
  return input;
};
const dueOnly = () => base();
const termsOnly = (termsText: unknown) => withPayment((p) => { delete p.dueDate; p.termsText = termsText; });
const both = (termsText: unknown) => withPayment((p) => { p.termsText = termsText; });
const neither = () => withoutValue(base(), 'payment.dueDate');

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  return result.ok ? result.value : assert.fail(`expected success: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
}

function rejected(input: JsonObject): readonly string[] {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected rejection');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
}

const ublRoot = (invoice: Invoice) => {
  const r = serializeUblInvoice(invoice);
  return r.ok ? parseXml(r.xml) : assert.fail('ubl');
};
const ciiRoot = (invoice: Invoice) => {
  const r = serializeCiiInvoice(invoice);
  return r.ok ? parseXml(r.xml) : assert.fail('cii');
};
const SETTLEMENT = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement';
const ublTerms = (invoice: Invoice) => select(ublRoot(invoice), 'cac:PaymentTerms/cbc:Note').map((n) => n.text);
const ublDue = (invoice: Invoice) => select(ublRoot(invoice), 'cbc:DueDate').map((n) => n.text);
const ciiTerms = (invoice: Invoice) => select(ciiRoot(invoice), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms/ram:Description`).map((n) => n.text);
const ciiDue = (invoice: Invoice) =>
  select(ciiRoot(invoice), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString`).map((n) => `${n.attributes.format}:${n.text}`);

// ------------------------------------------------------------------------------------------------ positive

test('P1 dueDate only: BT-9 in domain, UBL cbc:DueDate and CII DueDateDateTime (format 102); no BT-20 anywhere', () => {
  const invoice = built(dueOnly());
  assert.equal(invoice.payment.dueDate, DUE);
  assert.equal('termsText' in invoice.payment, false);
  assert.deepEqual(ublDue(invoice), [DUE]);
  assert.equal(select(ublRoot(invoice), 'cac:PaymentTerms').length, 0);
  assert.deepEqual(ciiDue(invoice), ['102:20261024']);
  assert.deepEqual(ciiTerms(invoice), []);
});

test('P2 termsText only: BT-20 in domain, UBL PaymentTerms/Note and CII Description; no BT-9 anywhere', () => {
  const text = 'Zahlbar innerhalb von 30 Tagen ohne Abzug.';
  const invoice = built(termsOnly(text));
  assert.equal(invoice.payment.termsText, text);
  assert.equal('dueDate' in invoice.payment, false);
  assert.deepEqual(ublDue(invoice), []);
  assert.deepEqual(ublTerms(invoice), [text]);
  assert.deepEqual(ciiDue(invoice), []);
  assert.deepEqual(ciiTerms(invoice), [text]);
  // CII: one payment-terms container holding only the description.
  const terms = select(ciiRoot(invoice), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms`);
  assert.equal(terms.length, 1);
  assert.deepEqual(childNames(terms[0]!), ['ram:Description']);
});

test('P3 both: each value once, in its own element, in XSD order', () => {
  const text = 'Zahlbar bis zum Fälligkeitsdatum.';
  const invoice = built(both(text));
  assert.deepEqual([invoice.payment.dueDate, invoice.payment.termsText], [DUE, text]);
  assert.deepEqual(ublDue(invoice), [DUE]);
  assert.deepEqual(ublTerms(invoice), [text]);
  assert.deepEqual(ciiDue(invoice), ['102:20261024']);
  assert.deepEqual(ciiTerms(invoice), [text]);
  // UBL 2.1 Invoice: ..., IssueDate, DueDate, InvoiceTypeCode, ..., PaymentMeans, PaymentTerms, ..., TaxTotal
  const ubl = childNames(ublRoot(invoice));
  assert.deepEqual(ubl.slice(ubl.indexOf('cbc:IssueDate'), ubl.indexOf('cbc:InvoiceTypeCode') + 1), ['cbc:IssueDate', 'cbc:DueDate', 'cbc:InvoiceTypeCode']);
  assert.deepEqual(ubl.slice(ubl.indexOf('cac:PaymentMeans'), ubl.indexOf('cac:TaxTotal') + 1), ['cac:PaymentMeans', 'cac:PaymentTerms', 'cac:TaxTotal']);
  assert.deepEqual(childNames(one(ublRoot(invoice), 'cac:PaymentTerms')), ['cbc:Note']);
  // CII D16B: TradePaymentTermsType is Description, then DueDateDateTime; HeaderTradeSettlement places it after
  // ApplicableTradeTax and before the monetary summation.
  const settlement = childNames(one(ciiRoot(invoice), SETTLEMENT));
  assert.deepEqual(settlement.slice(-2), ['ram:SpecifiedTradePaymentTerms', 'ram:SpecifiedTradeSettlementHeaderMonetarySummation']);
  assert.deepEqual(childNames(one(ciiRoot(invoice), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms`)), ['ram:Description', 'ram:DueDateDateTime']);
});

test('P4 multiline terms: LF kept exactly, one BT-20 value (not split into several elements), markup escaped', () => {
  const text = 'Zahlbar innerhalb von 30 Tagen.\nBitte Rechnungsnummer & Kundennummer <angeben>.\n\nVielen Dank.';
  const invoice = built(both(text));
  assert.equal(invoice.payment.termsText, text);
  assert.deepEqual(ublTerms(invoice), [text]);
  assert.deepEqual(ciiTerms(invoice), [text]);
  const ubl = serializeUblInvoice(invoice);
  assert.ok(ubl.ok && ubl.xml.includes('<cbc:Note>Zahlbar innerhalb von 30 Tagen.\nBitte Rechnungsnummer &amp; Kundennummer &lt;angeben&gt;.\n\nVielen Dank.</cbc:Note>'));
});

test('payment means 58 with an IBAN account is serialized exactly as before the envelope migration', () => {
  const invoice = built(base());
  assert.deepEqual(invoice.payment.means, { kind: 'credit-transfer', code: '58', account: { id: { scheme: 'IBAN', value: 'DE79000000001234567890' } } });
  const means = one(ublRoot(invoice), 'cac:PaymentMeans');
  assert.deepEqual(childNames(means), ['cbc:PaymentMeansCode', 'cac:PayeeFinancialAccount']);
  assert.equal(one(means, 'cbc:PaymentMeansCode').text, '58');
  assert.equal(one(means, 'cac:PayeeFinancialAccount/cbc:ID').text, 'DE79000000001234567890');
  const cii = one(ciiRoot(invoice), `${SETTLEMENT}/ram:SpecifiedTradeSettlementPaymentMeans`);
  assert.equal(one(cii, 'ram:TypeCode').text, '58');
  assert.equal(one(cii, 'ram:PayeePartyCreditorFinancialAccount/ram:IBANID').text, 'DE79000000001234567890');
});

test('the validated payment is frozen and independent of later changes to the caller input', () => {
  const input = both('Text');
  const invoice = built(input);
  (input.payment as JsonObject).termsText = 'changed';
  assert.equal(invoice.payment.termsText, 'Text');
  assert.ok(Object.isFrozen(invoice.payment) && Object.isFrozen(invoice.payment.means.account.id));
});

// ------------------------------------------------------------------------------------------------ BR-CO-25

test('BR-CO-25: a positive amount due with neither BT-9 nor BT-20 gives one diagnostic at payment', () => {
  assert.deepEqual(rejected(neither()), ['missing_payment_due_information@payment']);
});

test('BR-CO-25: either value alone satisfies it; a supplied but malformed value is reported only as malformed', () => {
  assert.equal(buildInvoice(dueOnly()).ok, true);
  assert.equal(buildInvoice(termsOnly('Sofort zahlbar.')).ok, true);
  assert.deepEqual(rejected(withValue(neither(), 'payment.dueDate', '2026-02-30')), ['invalid_date@payment.dueDate']);
  assert.deepEqual(rejected(termsOnly('')), ['empty_text@payment.termsText']);
  assert.deepEqual(rejected(termsOnly('Rechnung #1')), ['unsupported_hash_in_payment_terms@payment.termsText']);
});

test('BR-CO-25: depends on the computed BT-115; with an amount due of zero both may be absent', () => {
  // The current profile already admits a document whose lines round to 0.00 (a quantity of 0.001 at 0.40): no new
  // monetary scope is added for this test.
  const zero = withValue(neither(), 'lines', [{ ...(base().lines as JsonObject[])[0], quantity: '0.001', unitPrice: '0.40' }]);
  const invoice = built(zero);
  assert.equal(invoice.totals.amountDue.units, 0n);
  assert.deepEqual(invoice.payment, { means: invoice.payment.means });
  assert.equal(select(ublRoot(invoice), 'cbc:DueDate').length + select(ublRoot(invoice), 'cac:PaymentTerms').length, 0);
  assert.equal(select(ciiRoot(invoice), `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms`).length, 0);
  // One cent due is positive again.
  const cent = withValue(zero, 'lines.0.quantity', '0.025');
  assert.deepEqual(rejected(cent), ['missing_payment_due_information@payment']);
});

test('BR-CO-25 is not evaluated without a computed BT-115 or without a payment object', () => {
  assert.deepEqual(rejected(withValue(neither(), 'lines.0.unitPrice', 'abc')), ['invalid_decimal@lines[0].unitPrice']);
  assert.deepEqual(rejected(withoutValue(base(), 'payment')), ['missing_field@payment']);
});

// ------------------------------------------------------------------------------------------------ BT-20 text policy

test('BT-20: empty, whitespace-only, padded, CR, CRLF and other control characters are rejected, never repaired', () => {
  const cases: [string, string][] = [
    ['', 'empty_text'], [' \n ', 'empty_text'], [' x', 'invalid_text'], ['x\n', 'invalid_text'],
    ['a\rb', 'invalid_text'], ['a\r\nb', 'invalid_text'], ['a\tb', 'invalid_text'], ['a\u0007b', 'invalid_text'], ['a\u0085b', 'invalid_text'],
  ];
  for (const [text, code] of cases) assert.deepEqual(rejected(termsOnly(text)), [`${code}@payment.termsText`], JSON.stringify(text));
  assert.deepEqual(rejected(termsOnly(5)), ['invalid_type@payment.termsText']);
});

test('BT-20: `#` is rejected anywhere (structured Skonto, BR-DE-18, is outside M1); no Skonto syntax is parsed', () => {
  for (const text of ['#', 'Rechnung #12', '#SKONTO#TAGE=14#PROZENT=2.00#', 'Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#', 'a\n#b']) {
    assert.deepEqual(rejected(termsOnly(text)), ['unsupported_hash_in_payment_terms@payment.termsText'], JSON.stringify(text));
  }
});

test('BT-20: the shared multiline length limit applies exactly', () => {
  const atLimit = 'x'.repeat(PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH);
  assert.equal(built(termsOnly(atLimit)).payment.termsText, atLimit);
  assert.deepEqual(rejected(termsOnly(`${atLimit}x`)), ['text_too_long@payment.termsText']);
});

test('BT-9: a supplied due date must be a real calendar date; it is never derived from other data', () => {
  for (const date of ['2026-02-29', '2026-10-24T00:00:00', '24.10.2026']) {
    assert.deepEqual(rejected(withValue(base(), 'payment.dueDate', date)), ['invalid_date@payment.dueDate'], date);
  }
  assert.deepEqual(rejected(withValue(base(), 'payment.dueDate', 20261024)), ['invalid_type@payment.dueDate']);
  assert.equal(built(termsOnly('Zahlbar innerhalb von 14 Tagen.')).payment.dueDate, undefined);
});

// ------------------------------------------------------------------------------------------------ contract shape

test('the pre-envelope input shapes are rejected, with no aliases', () => {
  const legacyRoot = withValue(base(), 'paymentDueDate', DUE);
  assert.deepEqual(rejected(legacyRoot), ['unknown_field@paymentDueDate']);
  const flat = withValue(base(), 'payment', { meansCode: '58', iban: 'DE79000000001234567890' });
  // The flat shape also supplies neither BT-9 nor BT-20 in the current contract, so BR-CO-25 is reported too.
  assert.deepEqual(rejected(flat), ['unknown_field@payment.meansCode', 'unknown_field@payment.iban', 'missing_field@payment.means', 'missing_payment_due_information@payment']);
});

test('payment means: only credit transfer, code 58, IBAN account identifier; unknown fields rejected at every level', () => {
  assert.deepEqual(rejected(withValue(base(), 'payment.means.kind', 'direct-debit')), ['unsupported_payment_means@payment.means.kind']);
  assert.deepEqual(rejected(withValue(base(), 'payment.means.code', '30')), ['unsupported_payment_means@payment.means.code']);
  assert.deepEqual(rejected(withValue(base(), 'payment.means.account.id.scheme', 'PROPRIETARY')), ['unsupported_payment_account_scheme@payment.means.account.id.scheme']);
  assert.deepEqual(rejected(withValue(base(), 'payment.means.account.id.value', 'DE79000000001234567891')), ['invalid_iban@payment.means.account.id.value']);
  for (const path of ['payment.surplus', 'payment.means.surplus', 'payment.means.account.surplus', 'payment.means.account.id.surplus']) {
    assert.deepEqual(rejected(withValue(base(), path, 'x')), [`unknown_field@${path}`], path);
  }
  // BT-85 / BT-86 are not in this increment.
  assert.deepEqual(rejected(withValue(base(), 'payment.means.account.name', 'Beispiel')), ['unknown_field@payment.means.account.name']);
  assert.deepEqual(rejected(withValue(base(), 'payment.means.account.bic', 'COBADEFFXXX')), ['unknown_field@payment.means.account.bic']);
});
