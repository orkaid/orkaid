import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, PROVISIONAL_MAX_TEXT_LENGTH, type CommercialInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select } from '../support/xml.ts';

// Payment means 30 with BT-84/85/86. Expectations come from the pinned KoSIT configuration 2026-08-31, not from the code
// under test: SeMoX CIUS model (BG-17 0..n under BG-16 with BT-84 1..1, BT-85 0..1 text, BT-86 0..1 identifier; UBL
// cac:PayeeFinancialAccount/cbc:ID, /cbc:Name, /cac:FinancialInstitutionBranch/cbc:ID; CII PayeePartyCreditorFinancialAccount/
// IBANID ("Use IBANID if applicable, ProprietaryID else"), /AccountName, and PayeeSpecifiedCreditorFinancialInstitution/
// BICID ("Use for credit transfer")), the UBL 2.1 and CII D16B XSD sequences, BR-DE-23 (codes 30 and 58 are credit
// transfers), BR-CL-16 (UNTDID 4461). PROFILE: one account, IBAN identifier only, BT-86 a BIC.

const IBAN = 'DE79000000001234567890';
const minimal = () => loadFixtureInput('m-payment-means-30');
const full = () => loadFixtureInput('n-payment-means-30-account-details');

function built(input: JsonObject): CommercialInvoice {
  const result = buildInvoice(input);
  const invoice = result.ok ? result.value : assert.fail(`expected success: ${JSON.stringify(result.errors)}`);
  assert.ok(invoice.documentTypeCode === '380');
  return invoice;
}

function rejected(input: JsonObject): readonly string[] {
  const result = buildInvoice(input);
  return result.ok ? assert.fail('expected rejection') : result.errors.map((e) => `${e.code}@${e.path}`);
}

const ublMeans = (invoice: Invoice) => {
  const r = serializeUblInvoice(invoice);
  return one(r.ok ? parseXml(r.xml) : assert.fail('ubl'), 'cac:PaymentMeans');
};
const ciiMeans = (invoice: Invoice) => {
  const r = serializeCiiInvoice(invoice);
  const root = r.ok ? parseXml(r.xml) : assert.fail('cii');
  return one(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans');
};

test('PM30-1 code 30 with only an IBAN: BT-81 30, BT-84 as UBL cbc:ID and CII IBANID, no BT-85 or BT-86', () => {
  const invoice = built(minimal());
  assert.deepEqual(invoice.payment.means, { kind: 'credit-transfer', code: '30', account: { id: { scheme: 'IBAN', value: IBAN } } });
  const ubl = ublMeans(invoice);
  assert.deepEqual(childNames(ubl), ['cbc:PaymentMeansCode', 'cac:PayeeFinancialAccount']);
  assert.equal(one(ubl, 'cbc:PaymentMeansCode').text, '30');
  assert.deepEqual(childNames(one(ubl, 'cac:PayeeFinancialAccount')), ['cbc:ID']);
  assert.equal(one(ubl, 'cac:PayeeFinancialAccount/cbc:ID').text, IBAN);
  const cii = ciiMeans(invoice);
  assert.deepEqual(childNames(cii), ['ram:TypeCode', 'ram:PayeePartyCreditorFinancialAccount']);
  assert.equal(one(cii, 'ram:TypeCode').text, '30');
  assert.deepEqual(childNames(one(cii, 'ram:PayeePartyCreditorFinancialAccount')), ['ram:IBANID']);
  assert.equal(one(cii, 'ram:PayeePartyCreditorFinancialAccount/ram:IBANID').text, IBAN);
});

test('PM30-2 code 30 with BT-85 and BT-86: exact UBL and CII paths in XSD order, no ProprietaryID, no Debtor path', () => {
  const invoice = built(full());
  assert.deepEqual(invoice.payment.means.account, { id: { scheme: 'IBAN', value: IBAN }, name: 'Beispiel Beratung GmbH', bic: 'MUSTDEFFXXX' });
  const ubl = ublMeans(invoice);
  assert.deepEqual(childNames(one(ubl, 'cac:PayeeFinancialAccount')), ['cbc:ID', 'cbc:Name', 'cac:FinancialInstitutionBranch']);
  assert.equal(one(ubl, 'cac:PayeeFinancialAccount/cbc:Name').text, 'Beispiel Beratung GmbH');
  assert.deepEqual(childNames(one(ubl, 'cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch')), ['cbc:ID']);
  assert.equal(one(ubl, 'cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID').text, 'MUSTDEFFXXX');
  const cii = ciiMeans(invoice);
  assert.deepEqual(childNames(cii), ['ram:TypeCode', 'ram:PayeePartyCreditorFinancialAccount', 'ram:PayeeSpecifiedCreditorFinancialInstitution']);
  assert.deepEqual(childNames(one(cii, 'ram:PayeePartyCreditorFinancialAccount')), ['ram:IBANID', 'ram:AccountName']);
  assert.equal(one(cii, 'ram:PayeePartyCreditorFinancialAccount/ram:AccountName').text, 'Beispiel Beratung GmbH');
  assert.deepEqual(childNames(one(cii, 'ram:PayeeSpecifiedCreditorFinancialInstitution')), ['ram:BICID']);
  assert.equal(one(cii, 'ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID').text, 'MUSTDEFFXXX');
});

test('BT-85 and BT-86 are independent and also serialize with code 58', () => {
  const nameOnly = built(withoutValue(full(), 'payment.means.account.bic'));
  assert.deepEqual(childNames(ciiMeans(nameOnly)), ['ram:TypeCode', 'ram:PayeePartyCreditorFinancialAccount']);
  const bicOnly = built(withValue(withoutValue(full(), 'payment.means.account.name'), 'payment.means.code', '58'));
  assert.equal(bicOnly.payment.means.code, '58');
  assert.deepEqual(childNames(one(ublMeans(bicOnly), 'cac:PayeeFinancialAccount')), ['cbc:ID', 'cac:FinancialInstitutionBranch']);
  assert.deepEqual(childNames(one(ciiMeans(bicOnly), 'ram:PayeePartyCreditorFinancialAccount')), ['ram:IBANID']);
  assert.equal(select(ciiMeans(bicOnly), 'ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID').length, 1);
});

test('payment means: codes outside 30/58, a missing account or identifier, and a non-IBAN scheme are rejected', () => {
  for (const code of ['31', '42', '59', '1', '030', ' 30']) assert.deepEqual(rejected(withValue(minimal(), 'payment.means.code', code)), ['unsupported_payment_means@payment.means.code'], code);
  assert.deepEqual(rejected(withoutValue(minimal(), 'payment.means.account')), ['missing_field@payment.means.account']);
  assert.deepEqual(rejected(withoutValue(minimal(), 'payment.means.account.id')), ['missing_field@payment.means.account.id']);
  assert.deepEqual(rejected(withValue(minimal(), 'payment.means.account.id.scheme', 'PROPRIETARY')), ['unsupported_payment_account_scheme@payment.means.account.id.scheme']);
  assert.deepEqual(rejected(withValue(minimal(), 'payment.means.account.id.value', 'DE79000000001234567891')), ['invalid_iban@payment.means.account.id.value']);
  assert.deepEqual(rejected(withValue(minimal(), 'payment.means.account', [{ id: { scheme: 'IBAN', value: IBAN } }])), ['invalid_type@payment.means.account']);
  for (const field of ['surplus', 'proprietaryId', 'accounts']) {
    assert.deepEqual(rejected(withValue(minimal(), `payment.means.account.${field}`, 'x')), [`unknown_field@payment.means.account.${field}`], field);
  }
});

test('BT-85 is single-line text; BT-86 is a BIC (ISO 9362, 8 or 11 characters)', () => {
  const name = (value: unknown) => rejected(withValue(full(), 'payment.means.account.name', value));
  assert.deepEqual(name(''), ['empty_text@payment.means.account.name']);
  assert.deepEqual(name('   '), ['empty_text@payment.means.account.name']);
  assert.deepEqual(name('Zeile 1\nZeile 2'), ['invalid_text@payment.means.account.name']);
  assert.deepEqual(name('x'.repeat(PROVISIONAL_MAX_TEXT_LENGTH + 1)), ['text_too_long@payment.means.account.name']);
  assert.deepEqual(name(42), ['invalid_type@payment.means.account.name']);
  assert.equal(buildInvoice(withValue(full(), 'payment.means.account.name', 'Müller & Söhne <Konto>')).ok, true);

  for (const bic of ['MUSTDEFF', 'MUSTDEFFXXX', 'MUSTDE12AB3']) assert.equal(buildInvoice(withValue(full(), 'payment.means.account.bic', bic)).ok, true, bic);
  for (const bic of ['mustdeffxxx', 'MUSTDEF', 'MUSTDEFFXX', 'MUSTDEFFXXXX', 'MUS1DEFFXXX', 'MUSTD3FFXXX', 'MUSTDEFF XXX']) {
    assert.deepEqual(rejected(withValue(full(), 'payment.means.account.bic', bic)), ['invalid_bic@payment.means.account.bic'], bic);
  }
  assert.deepEqual(rejected(withValue(full(), 'payment.means.account.bic', '')), ['empty_text@payment.means.account.bic']);
});

test('the validated account is frozen and independent of later changes to the caller input', () => {
  const input = full();
  const invoice = built(input);
  ((input.payment as JsonObject).means as { account: JsonObject }).account.bic = 'CHANGED1';
  assert.equal(invoice.payment.means.account.bic, 'MUSTDEFFXXX');
  assert.ok(Object.isFrozen(invoice.payment.means.account));
});
