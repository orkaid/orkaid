import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { KLEINUNTERNEHMER_EXEMPTION_TEXT } from '../../src/lib/domain/xrechnung/invoice.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select, textAt } from '../support/xml.ts';

// Kleinunternehmer treatment (section 19 UStG), XRechnung 3.0.2 section 13.3. Expectations come from the pinned
// KoSIT configuration 2026-08-31 (BR-E-01..10, BR-CO-26, BR-DE-16, the SeMoX CIUS bindings) and the section's own
// text, not from the code under test. The literal wording is repeated here on purpose: a changed constant must fail.

const TEXT = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG';
const ku = () => loadFixtureInput('e-kleinunternehmer');
const standard = () => loadFixtureInput('a-simple');
const kuVat = { treatment: 'kleinunternehmer', category: 'E', rate: '0' };

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

// ------------------------------------------------------------------------------------------- semantic model

test('the wording is the XRechnung 3.0.2 section 13.3 text, held once', () => {
  assert.equal(KLEINUNTERNEHMER_EXEMPTION_TEXT, TEXT);
});

test('a Kleinunternehmer invoice: category E, rate 0, real taxable base, VAT exactly zero, BT-120 beside the key', () => {
  const invoice = built(ku());
  assert.deepEqual(invoice.lines.map((l) => l.vat), [kuVat, kuVat]);
  assert.equal(invoice.totals.vatBreakdown.length, 1);
  const bucket = invoice.totals.vatBreakdown[0];
  assert.ok(bucket !== undefined && bucket.treatment === 'kleinunternehmer');
  assert.deepEqual([bucket.treatment, bucket.category, bucket.rate, bucket.exemptionReason], ['kleinunternehmer', 'E', '0', TEXT]);
  assert.deepEqual([bucket.taxableAmount, bucket.taxAmount], [{ units: 21980n, scale: 2 }, { units: 0n, scale: 2 }]);
  assert.equal(invoice.seller.additionalLegalInformation, TEXT); // BT-33
});

test('standard invoices carry no BT-33 and no exemption reason', () => {
  const invoice = built(standard());
  assert.equal(invoice.seller.additionalLegalInformation, undefined);
  assert.equal('exemptionReason' in (invoice.totals.vatBreakdown[0] ?? {}), false);
});

test('several lines aggregate into one bucket at the real base; the rate may be written 0 or 0.00', () => {
  const invoice = built(withValue(ku(), 'lines', [
    { name: 'a', unitCode: 'C62', quantity: '3', unitPrice: '0.335', vat: { ...kuVat, rate: '0.00' } }, // 1.005 -> 1.01
    { name: 'b', unitCode: 'C62', quantity: '2.5', unitPrice: '1.999', vat: kuVat }, // 4.9975 -> 5.00
    { name: 'c', unitCode: 'C62', quantity: '1', unitPrice: '12.34', vat: kuVat },
  ]));
  assert.deepEqual(invoice.totals.vatBreakdown.map((b) => [b.taxableAmount, b.taxAmount]), [[{ units: 1835n, scale: 2 }, { units: 0n, scale: 2 }]]);
  assert.deepEqual(invoice.lines.map((l) => l.vat.rate), ['0', '0', '0']); // normalized
});

test('German notation: rate 0,00 is accepted for the treatment and normalized to 0', () => {
  const input = withValue(ku(), 'lines', [{ name: 'a', unitCode: 'C62', quantity: '2', unitPrice: '49,90', vat: { ...kuVat, rate: '0,00' } }]);
  const result = buildInvoice(input, { notation: 'de' });
  assert.ok(result.ok);
  assert.equal(result.value.lines[0]?.vat.rate, '0');
});

// ------------------------------------------------------------------------------------------- negative controls

test('a Kleinunternehmer line with a non-zero rate, another category, or a wrong treatment is refused', () => {
  const line = (vat: object) => withValue(ku(), 'lines.0.vat', vat);
  assert.deepEqual(rejected(line({ ...kuVat, rate: '19' })), ['unsupported_vat_rate@lines[0].vat.rate']);
  assert.deepEqual(rejected(line({ ...kuVat, rate: '0,0' })), ['unsupported_vat_rate@lines[0].vat.rate']); // canonical notation
  assert.deepEqual(rejected(line({ ...kuVat, category: 'S' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ ...kuVat, category: 'Z' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ ...kuVat, category: 'O' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ ...kuVat, category: 'AE' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ treatment: 'standard', category: 'E', rate: '0' })), [
    'unsupported_vat_category@lines[0].vat.category',
    'unsupported_vat_rate@lines[0].vat.rate',
  ]);
  assert.deepEqual(rejected(line({ treatment: 'standard', category: 'S', rate: '0' })), ['unsupported_vat_rate@lines[0].vat.rate']); // no generic 0% mode
  assert.deepEqual(rejected(line({ ...kuVat, rate: '-0.5' })), ['unsupported_vat_rate@lines[0].vat.rate']);
});

test('mixed standard and Kleinunternehmer lines are refused by the M1 profile, not by the semantic model', () => {
  const mixed = withValue(ku(), 'lines.1.vat', { treatment: 'standard', category: 'S', rate: '19' });
  assert.deepEqual(rejected(mixed), ['unsupported_mixed_vat_treatments@lines']);
});

test('BR-E-02 / BR-DE-16: a Kleinunternehmer seller still needs BT-31 or BT-32', () => {
  // e-kleinunternehmer has BT-30 (BR-CO-26) and BT-32; dropping BT-32 leaves BR-CO-26 satisfied but no tax identifier.
  assert.deepEqual(rejected(withoutValue(ku(), 'seller.taxRegistrationId')), ['missing_seller_tax_identifier@seller']);
});

test('BR-CO-26 stays independent: BT-32 alone does not identify the seller, and the two failures are separate', () => {
  const onlyBt32 = withoutValue(ku(), 'seller.legalRegistrationId');
  assert.deepEqual(rejected(onlyBt32), ['missing_seller_identification@seller']);
  const none = withoutValue(onlyBt32, 'seller.taxRegistrationId');
  assert.deepEqual(rejected(none), ['missing_seller_identification@seller', 'missing_seller_tax_identifier@seller']);
});

test('BT-31 alone satisfies both rules for a Kleinunternehmer; the absence of standard-only BT-31 does not reject BT-30 plus BT-32', () => {
  const vatOnly = withValue(withoutValue(withoutValue(ku(), 'seller.legalRegistrationId'), 'seller.taxRegistrationId'), 'seller.vatId', 'DE123456789');
  assert.equal(built(vatOnly).seller.vatId, 'DE123456789');
  assert.equal(built(ku()).seller.vatId, undefined); // BT-30 + BT-32 is a complete, valid branch
});

test('BT-33 and BT-120 cannot be supplied by the caller', () => {
  assert.deepEqual(rejected(withValue(ku(), 'seller.additionalLegalInformation', 'x')), ['unknown_field@seller.additionalLegalInformation']);
  assert.deepEqual(rejected(withValue(ku(), 'lines.0.vat.exemptionReason', 'x')), ['unknown_field@lines[0].vat.exemptionReason']);
});

// ------------------------------------------------------------------------------------------- UBL binding

test('UBL: category E, rate 0 on lines and breakdown; BT-120 in TaxCategory; BT-33 in PartyLegalEntity; no BT-121', () => {
  const root = ublRoot(built(ku()));
  for (const line of select(root, 'cac:InvoiceLine')) {
    assert.equal(textAt(line, 'cac:Item/cac:ClassifiedTaxCategory/cbc:ID'), 'E');
    assert.equal(textAt(line, 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent'), '0');
  }
  const subtotal = one(root, 'cac:TaxTotal/cac:TaxSubtotal');
  assert.equal(textAt(subtotal, 'cbc:TaxableAmount'), '219.80'); // BT-116, the real base
  assert.equal(textAt(subtotal, 'cbc:TaxAmount'), '0.00'); // BT-117
  assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:ID'), 'E');
  assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:Percent'), '0');
  assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:TaxExemptionReason'), TEXT); // BT-120
  assert.equal(select(subtotal, 'cac:TaxCategory/cbc:TaxExemptionReasonCode').length, 0); // BT-121 omitted
  assert.equal(textAt(root, 'cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyLegalForm'), TEXT); // BT-33
  assert.equal(textAt(root, 'cac:TaxTotal/cbc:TaxAmount'), '0.00'); // BT-110
});

// ------------------------------------------------------------------------------------------- CII binding

test('CII: category E, rate 0 on lines and breakdown; BT-120 in ApplicableTradeTax; BT-33 in Description; no BT-121', () => {
  const root = ciiRoot(built(ku()));
  const transaction = one(root, 'rsm:SupplyChainTradeTransaction');
  for (const line of select(transaction, 'ram:IncludedSupplyChainTradeLineItem')) {
    const tax = one(line, 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax');
    assert.equal(textAt(tax, 'ram:CategoryCode'), 'E');
    assert.equal(textAt(tax, 'ram:RateApplicablePercent'), '0');
  }
  const tax = one(transaction, 'ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax');
  assert.equal(textAt(tax, 'ram:BasisAmount'), '219.80'); // BT-116
  assert.equal(textAt(tax, 'ram:CalculatedAmount'), '0.00'); // BT-117
  assert.equal(textAt(tax, 'ram:CategoryCode'), 'E');
  assert.equal(textAt(tax, 'ram:RateApplicablePercent'), '0');
  assert.equal(textAt(tax, 'ram:ExemptionReason'), TEXT); // BT-120
  assert.equal(select(tax, 'ram:ExemptionReasonCode').length, 0); // BT-121 omitted
  // D16B TradeTaxType sequence: CalculatedAmount, TypeCode, ExemptionReason, BasisAmount, CategoryCode, RateApplicablePercent.
  assert.deepEqual(childNames(tax), ['ram:CalculatedAmount', 'ram:TypeCode', 'ram:ExemptionReason', 'ram:BasisAmount', 'ram:CategoryCode', 'ram:RateApplicablePercent']);
  const seller = one(transaction, 'ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty');
  assert.equal(textAt(seller, 'ram:Description'), TEXT); // BT-33
  // D16B TradePartyType sequence: ID, Name, Description, SpecifiedLegalOrganization, DefinedTradeContact, ...
  assert.deepEqual(childNames(seller).slice(0, 3), ['ram:Name', 'ram:Description', 'ram:SpecifiedLegalOrganization']);
});

test('both syntaxes carry the same semantic values for the Kleinunternehmer fixtures', () => {
  for (const name of ['e-kleinunternehmer', 'f-kleinunternehmer-lines'] as const) {
    const invoice = built(loadFixtureInput(name));
    const u = ublRoot(invoice);
    const c = ciiRoot(invoice);
    const subtotal = one(u, 'cac:TaxTotal/cac:TaxSubtotal');
    const tax = one(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax');
    assert.equal(textAt(subtotal, 'cbc:TaxableAmount'), textAt(tax, 'ram:BasisAmount'));
    assert.equal(textAt(subtotal, 'cbc:TaxAmount'), textAt(tax, 'ram:CalculatedAmount'));
    assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:TaxExemptionReason'), textAt(tax, 'ram:ExemptionReason'));
    assert.equal(
      textAt(u, 'cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyLegalForm'),
      textAt(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Description'),
    );
  }
});

test('standard output carries none of the Kleinunternehmer elements in either syntax', () => {
  const invoice = built(standard());
  const u = serializeUblInvoice(invoice);
  const c = serializeCiiInvoice(invoice);
  assert.ok(u.ok && c.ok);
  for (const fragment of ['TaxExemptionReason', 'CompanyLegalForm', 'ExemptionReason', 'ram:Description', TEXT]) {
    assert.equal(u.xml.includes(fragment) || c.xml.includes(fragment), false, fragment);
  }
});
