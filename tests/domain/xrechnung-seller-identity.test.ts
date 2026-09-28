import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select, textAt } from '../support/xml.ts';

// MDR-21: seller identification (BR-CO-26: BT-29 and/or BT-30 and/or BT-31) and the standard-treatment seller
// tax-identifier rule (BT-31 and/or BT-32) are two independent invariants, never merged. These are the smallest
// fixtures that exercise each branch and their independence; they are constructed from a-simple.json inline. The
// preregistration MANIFEST.json and the frozen CII experiment oracle/protocol files are unchanged; the experiment's
// input fixtures were only mechanically migrated to the treatment-based VAT contract (DP-0), and their expected
// money/projection behaviour stays protected by the frozen oracle.

const base = () => loadFixtureInput('a-simple');
const noVatId = () => withoutValue(base(), 'seller.vatId');

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  return result.ok ? result.value : assert.fail(`expected success: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
}

function rejected(input: JsonObject): readonly string[] {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected rejection');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
}

// ------------------------------------------------------------------------------------------- S-ID-31: BT-31 alone

test('S-ID-31: seller identification through BT-31 alone remains valid (existing baseline, unchanged)', () => {
  const invoice = built(base());
  assert.deepEqual(invoice.seller.sellerIdentifiers, []);
  assert.equal(invoice.seller.legalRegistrationId, undefined);
  assert.equal(invoice.seller.vatId, 'DE123456789');
  assert.equal(invoice.seller.taxRegistrationId, undefined);
});

// ------------------------------------------------------------------------------------------- S-ID-29: BT-29 + BT-32

const sId29Input = (): JsonObject =>
  withValue(withValue(noVatId(), 'seller.sellerIdentifiers', ['Kreditor-4711']), 'seller.taxRegistrationId', '201/113/40208');

test('S-ID-29: BT-29 alone satisfies BR-CO-26, BT-32 satisfies the tax-identifier rule, domain accepts', () => {
  const invoice = built(sId29Input());
  assert.deepEqual(invoice.seller.sellerIdentifiers, [{ value: 'Kreditor-4711' }]);
  assert.equal(invoice.seller.legalRegistrationId, undefined);
  assert.equal(invoice.seller.vatId, undefined);
  assert.equal(invoice.seller.taxRegistrationId, '201/113/40208');
});

test('S-ID-29: UBL carries PartyIdentification (BT-29) and a non-VAT PartyTaxScheme (BT-32), no VAT scheme', () => {
  const xml = serializeUblInvoice(built(sId29Input()));
  assert.ok(xml.ok);
  const supplier = one(parseXml(xml.ok ? xml.xml : ''), 'cac:AccountingSupplierParty/cac:Party');
  assert.deepEqual(select(supplier, 'cac:PartyIdentification/cbc:ID').map((n) => n.text), ['Kreditor-4711']);
  const schemes = select(supplier, 'cac:PartyTaxScheme');
  assert.equal(schemes.length, 1, 'exactly one PartyTaxScheme: BT-32 only, no BT-31');
  assert.equal(textAt(schemes[0] as (typeof schemes)[number], 'cbc:CompanyID'), '201/113/40208');
  assert.equal(textAt(schemes[0] as (typeof schemes)[number], 'cac:TaxScheme/cbc:ID'), 'FC');
  assert.deepEqual(childNames(supplier), ['cbc:EndpointID', 'cac:PartyIdentification', 'cac:PostalAddress', 'cac:PartyTaxScheme', 'cac:PartyLegalEntity', 'cac:Contact']);
});

test('S-ID-29: CII carries ram:ID (BT-29) and a schemeID=FC SpecifiedTaxRegistration (BT-32), no VA scheme', () => {
  const xml = serializeCiiInvoice(built(sId29Input()));
  assert.ok(xml.ok);
  const supplier = one(parseXml(xml.ok ? xml.xml : ''), 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty');
  assert.deepEqual(select(supplier, 'ram:ID').map((n) => n.text), ['Kreditor-4711']);
  const registrations = select(supplier, 'ram:SpecifiedTaxRegistration');
  assert.equal(registrations.length, 1, 'exactly one SpecifiedTaxRegistration: BT-32 only, no BT-31');
  assert.equal(one(registrations[0] as (typeof registrations)[number], 'ram:ID').attributes.schemeID, 'FC');
  assert.equal(textAt(registrations[0] as (typeof registrations)[number], 'ram:ID'), '201/113/40208');
});

// ------------------------------------------------------------------------------------------- S-ID-30: BT-30 + BT-32

const sId30Input = (): JsonObject =>
  withValue(withValue(noVatId(), 'seller.legalRegistrationId', 'HRB 12345'), 'seller.taxRegistrationId', '201/113/40208');

test('S-ID-30: BT-30 alone satisfies BR-CO-26, BT-32 satisfies the tax-identifier rule, domain accepts', () => {
  const invoice = built(sId30Input());
  assert.deepEqual(invoice.seller.sellerIdentifiers, []);
  assert.equal(invoice.seller.legalRegistrationId, 'HRB 12345');
  assert.equal(invoice.seller.vatId, undefined);
  assert.equal(invoice.seller.taxRegistrationId, '201/113/40208');
});

test('S-ID-30: UBL PartyLegalEntity carries CompanyID (BT-30) after RegistrationName; PartyTaxScheme carries BT-32', () => {
  const xml = serializeUblInvoice(built(sId30Input()));
  assert.ok(xml.ok);
  const supplier = one(parseXml(xml.ok ? xml.xml : ''), 'cac:AccountingSupplierParty/cac:Party');
  assert.deepEqual(select(supplier, 'cac:PartyIdentification'), [], 'no BT-29 in this scenario');
  const legalEntity = one(supplier, 'cac:PartyLegalEntity');
  assert.deepEqual(childNames(legalEntity), ['cbc:RegistrationName', 'cbc:CompanyID']);
  assert.equal(textAt(legalEntity, 'cbc:CompanyID'), 'HRB 12345');
  assert.equal(textAt(supplier, 'cac:PartyTaxScheme/cbc:CompanyID'), '201/113/40208');
  assert.equal(textAt(supplier, 'cac:PartyTaxScheme/cac:TaxScheme/cbc:ID'), 'FC');
});

test('S-ID-30: CII SpecifiedLegalOrganization carries BT-30; SpecifiedTaxRegistration carries BT-32 (schemeID=FC)', () => {
  const xml = serializeCiiInvoice(built(sId30Input()));
  assert.ok(xml.ok);
  const supplier = one(parseXml(xml.ok ? xml.xml : ''), 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty');
  assert.deepEqual(select(supplier, 'ram:ID'), [], 'no BT-29 in this scenario');
  assert.equal(textAt(supplier, 'ram:SpecifiedLegalOrganization/ram:ID'), 'HRB 12345');
  const registration = one(supplier, 'ram:SpecifiedTaxRegistration');
  assert.equal(one(registration, 'ram:ID').attributes.schemeID, 'FC');
  assert.equal(textAt(registration, 'ram:ID'), '201/113/40208');
});

// ------------------------------------------------------------------------------------------- negative: independence of the two invariants

test('negative S-ID-32-ONLY: BT-32 alone fails BR-CO-26 specifically, and only that rule', () => {
  assert.deepEqual(rejected(withValue(noVatId(), 'seller.taxRegistrationId', '201/113/40208')), ['missing_seller_identification@seller']);
});

test('negative separation: BT-29 without BT-31/BT-32 satisfies BR-CO-26 but fails the tax-identifier rule specifically', () => {
  assert.deepEqual(rejected(withValue(noVatId(), 'seller.sellerIdentifiers', ['Kreditor-4711'])), ['missing_seller_tax_identifier@seller']);
});

test('when neither rule is satisfied, both independent diagnostics are reported together', () => {
  assert.deepEqual(rejected(noVatId()), ['missing_seller_identification@seller', 'missing_seller_tax_identifier@seller']);
});

// ------------------------------------------------------------------------------------------- BT-29 cardinality

test('BT-29 preserves cardinality: two values validate and serialize in both syntaxes, in caller order', () => {
  const input = withValue(sId29Input(), 'seller.sellerIdentifiers', ['Kreditor-4711', 'Lieferant-0099']);
  const invoice = built(input);
  assert.deepEqual(invoice.seller.sellerIdentifiers, [{ value: 'Kreditor-4711' }, { value: 'Lieferant-0099' }]);

  const ubl = serializeUblInvoice(invoice);
  assert.ok(ubl.ok);
  const uSupplier = one(parseXml(ubl.ok ? ubl.xml : ''), 'cac:AccountingSupplierParty/cac:Party');
  assert.deepEqual(select(uSupplier, 'cac:PartyIdentification/cbc:ID').map((n) => n.text), ['Kreditor-4711', 'Lieferant-0099']);

  const cii = serializeCiiInvoice(invoice);
  assert.ok(cii.ok);
  const cSupplier = one(parseXml(cii.ok ? cii.xml : ''), 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty');
  assert.deepEqual(select(cSupplier, 'ram:ID').map((n) => n.text), ['Kreditor-4711', 'Lieferant-0099']);
});

// ------------------------------------------------------------------------------------------- no invented identifier

test('no invented identifier: BT-29 output equals caller input verbatim', () => {
  const input = sId29Input();
  const invoice = built(input);
  assert.deepEqual(invoice.seller.sellerIdentifiers.map((i) => i.value), (input.seller as JsonObject).sellerIdentifiers);
});

test('no invented identifier: BT-32 alone never produces a BT-29 value, and vice versa', () => {
  const withTax = built(withValue(base(), 'seller.taxRegistrationId', '201/113/40208'));
  assert.deepEqual(withTax.seller.sellerIdentifiers, []);
  const withBt29 = built(sId29Input());
  assert.equal(withBt29.seller.taxRegistrationId, '201/113/40208', 'unchanged: the caller supplied it directly, not derived');
});

// ------------------------------------------------------------------------------------------- input validation

test('sellerIdentifiers must be an array; a non-array value is rejected as invalid_type', () => {
  assert.deepEqual(rejected(withValue(base(), 'seller.sellerIdentifiers', 'not-an-array')), ['invalid_type@seller.sellerIdentifiers']);
});

test('a blank sellerIdentifiers entry is rejected at its own index', () => {
  assert.deepEqual(rejected(withValue(base(), 'seller.sellerIdentifiers', ['ok', '', '  '])), [
    'empty_text@seller.sellerIdentifiers[1]',
    'empty_text@seller.sellerIdentifiers[2]',
  ]);
});

// ------------------------------------------------------------------------------------------- absent vs. supplied-but-invalid

test('presence is not validity: a supplied-but-malformed BT-31 is not "missing" for either rule', () => {
  assert.deepEqual(rejected(withValue(base(), 'seller.vatId', 'DE12')), ['invalid_vat_id@seller.vatId']);
});

test('presence is not validity: an invalid BT-29 value is not a missing BR-CO-26 identification', () => {
  // With BT-32 supplied the tax-identifier rule holds, so only the BT-29 value error remains.
  const withTaxId = withValue(noVatId(), 'seller.taxRegistrationId', '201/113/40208');
  assert.deepEqual(rejected(withValue(withTaxId, 'seller.sellerIdentifiers', [''])), ['empty_text@seller.sellerIdentifiers[0]']);
  assert.deepEqual(rejected(withValue(withTaxId, 'seller.sellerIdentifiers', 'x')), ['invalid_type@seller.sellerIdentifiers']);
  // Without BT-31/BT-32 the separate tax-identifier rule still fails on its own, and only it.
  assert.deepEqual(rejected(withValue(noVatId(), 'seller.sellerIdentifiers', [''])), ['empty_text@seller.sellerIdentifiers[0]', 'missing_seller_tax_identifier@seller']);
});

test('presence is not validity: an empty BT-32 is not a missing tax identifier', () => {
  const withBt30 = withValue(noVatId(), 'seller.legalRegistrationId', 'HRB 12345');
  assert.deepEqual(rejected(withValue(withBt30, 'seller.taxRegistrationId', '')), ['empty_text@seller.taxRegistrationId']);
});

test('an empty BT-29 array supplies nothing: both rules report missing', () => {
  assert.deepEqual(rejected(withValue(noVatId(), 'seller.sellerIdentifiers', [])), ['missing_seller_identification@seller', 'missing_seller_tax_identifier@seller']);
});
