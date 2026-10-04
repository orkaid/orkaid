import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { PROVISIONAL_MAX_REPORTED_ERRORS, REVERSE_CHARGE_TEXT } from '../../src/lib/domain/xrechnung/invoice.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select, textAt } from '../support/xml.ts';

// Reverse charge (§ 13b UStG, category AE). Expectations come from the pinned KoSIT configuration 2026-08-31
// (BR-AE-01..10, BR-CO-26, BR-DE-16, the SeMoX CIUS bindings) and § 14a Abs. 5 UStG, not from the code under test. The
// statutory wording is repeated here on purpose: a changed constant must fail.

const TEXT = 'Steuerschuldnerschaft des Leistungsempfängers';
const rc1 = () => loadFixtureInput('g-reverse-charge-vat-ids'); // seller BT-31, buyer BT-48
const rc2 = () => loadFixtureInput('h-reverse-charge-registration-ids'); // seller BT-30 + BT-32, buyer BT-47
const standard = () => loadFixtureInput('a-simple');
const rcVat = { treatment: 'reverse-charge', category: 'AE', rate: '0' };

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

test('the wording is the § 14a Abs. 5 UStG phrase, held once', () => {
  assert.equal(REVERSE_CHARGE_TEXT, TEXT);
});

test('RC-1 and RC-2: category AE, rate 0, real taxable base, VAT exactly zero, BT-120 beside the key', () => {
  for (const input of [rc1(), rc2()]) {
    const invoice = built(input);
    assert.ok(invoice.lines.every((l) => l.vat.treatment === 'reverse-charge' && l.vat.category === 'AE' && l.vat.rate === '0'));
    assert.equal(invoice.totals.vatBreakdown.length, 1);
    const bucket = invoice.totals.vatBreakdown[0];
    assert.ok(bucket !== undefined && bucket.treatment === 'reverse-charge');
    assert.deepEqual([bucket.category, bucket.rate, bucket.exemptionReason], ['AE', '0', TEXT]);
    assert.equal(bucket.taxAmount.units, 0n);
    assert.equal(invoice.totals.totalVat.units, 0n);
  }
});

test('aggregation: BT-116 is the exact sum of the rounded line nets (1.01 + 5.00 + 12.34), BT-117 is zero', () => {
  const bucket = built(rc1()).totals.vatBreakdown[0];
  assert.ok(bucket !== undefined);
  assert.deepEqual([bucket.taxableAmount, bucket.taxAmount], [{ units: 1835n, scale: 2 }, { units: 0n, scale: 2 }]);
});

test('the rate may be written 0 or 0.00 and is normalized; German notation 0,00 works too', () => {
  const lines = [{ name: 'a', unitCode: 'C62', quantity: '2', unitPrice: '49.90', vat: { ...rcVat, rate: '0.00' } }];
  assert.equal(built(withValue(rc1(), 'lines', lines)).lines[0]?.vat.rate, '0');
  const de = buildInvoice(withValue(rc1(), 'lines', [{ ...lines[0], unitPrice: '49,90', vat: { ...rcVat, rate: '0,00' } }]), { notation: 'de' });
  assert.ok(de.ok);
  assert.equal(de.value.lines[0]?.vat.rate, '0');
});

test('reverse-charge invoices carry no BT-33 and no caller-supplied BT-120', () => {
  assert.equal(built(rc1()).seller.additionalLegalInformation, undefined);
  assert.deepEqual(rejected(withValue(rc1(), 'lines.0.vat.exemptionReason', 'x')), ['unknown_field@lines[0].vat.exemptionReason']);
});

test('the buyer slots are distinct: BT-48 is never converted into BT-47 or the reverse', () => {
  const one48 = built(rc1()).buyer;
  assert.deepEqual([one48.vatId, one48.legalRegistrationId], ['DE987654321', undefined]);
  const one47 = built(rc2()).buyer;
  assert.deepEqual([one47.vatId, one47.legalRegistrationId], [undefined, 'HRB 654321']);
});

// ------------------------------------------------------------------------------------------- negative controls

test('an AE line with a non-zero rate, another category, or a wrong treatment is refused', () => {
  const line = (vat: object) => withValue(rc1(), 'lines.0.vat', vat);
  assert.deepEqual(rejected(line({ ...rcVat, rate: '19' })), ['unsupported_vat_rate@lines[0].vat.rate']);
  assert.deepEqual(rejected(line({ ...rcVat, rate: '0,0' })), ['unsupported_vat_rate@lines[0].vat.rate']); // canonical notation
  assert.deepEqual(rejected(line({ ...rcVat, category: 'S' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ ...rcVat, category: 'E' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ ...rcVat, category: 'K' })), ['unsupported_vat_category@lines[0].vat.category']);
});

test('category AE cannot be constructed through another treatment, and E and AE stay distinct', () => {
  const line = (vat: object) => withValue(rc1(), 'lines.0.vat', vat);
  assert.deepEqual(rejected(line({ treatment: 'standard', category: 'AE', rate: '0' })), [
    'unsupported_vat_category@lines[0].vat.category',
    'unsupported_vat_rate@lines[0].vat.rate',
  ]);
  assert.deepEqual(rejected(line({ treatment: 'kleinunternehmer', category: 'AE', rate: '0' })), ['unsupported_vat_category@lines[0].vat.category']);
  assert.deepEqual(rejected(line({ treatment: 'standard', category: 'S', rate: '0' })), ['unsupported_vat_rate@lines[0].vat.rate']); // no generic 0% mode
});

test('mixed reverse-charge with standard or with Kleinunternehmer lines is refused by the M1 profile', () => {
  const withStandard = withValue(rc1(), 'lines.1.vat', { treatment: 'standard', category: 'S', rate: '19' });
  assert.deepEqual(rejected(withStandard), ['unsupported_mixed_vat_treatments@lines']);
  const withKu = withValue(rc1(), 'lines.1.vat', { treatment: 'kleinunternehmer', category: 'E', rate: '0' });
  assert.deepEqual(rejected(withKu), ['unsupported_mixed_vat_treatments@lines']);
});

test('BR-AE-02 seller side: BT-31 or BT-32 is still required, reported separately from BR-CO-26', () => {
  // RC-2 has BT-30 (BR-CO-26) and BT-32; dropping BT-32 leaves BR-CO-26 satisfied but no seller tax identifier.
  assert.deepEqual(rejected(withoutValue(rc2(), 'seller.taxRegistrationId')), ['missing_seller_tax_identifier@seller']);
  // RC-1 has only BT-31; dropping it fails both independent rules.
  assert.deepEqual(rejected(withoutValue(rc1(), 'seller.vatId')), ['missing_seller_identification@seller', 'missing_seller_tax_identifier@seller']);
});

test('BT-32 alone satisfies the AE seller rule but still not BR-CO-26', () => {
  assert.deepEqual(rejected(withoutValue(rc2(), 'seller.legalRegistrationId')), ['missing_seller_identification@seller']);
});

test('BR-AE-02 buyer side: at least one of BT-47 or BT-48, and either alone is enough', () => {
  assert.deepEqual(rejected(withoutValue(rc1(), 'buyer.vatId')), ['missing_buyer_identifier@buyer']);
  assert.deepEqual(rejected(withoutValue(rc2(), 'buyer.legalRegistrationId')), ['missing_buyer_identifier@buyer']);
  assert.equal(built(rc1()).buyer.vatId, 'DE987654321');
  assert.equal(built(rc2()).buyer.legalRegistrationId, 'HRB 654321');
  assert.equal(built(withValue(rc1(), 'buyer.legalRegistrationId', 'HRB 1')).buyer.legalRegistrationId, 'HRB 1'); // both may be given
});

test('presence and validity are separate: a malformed BT-48 or BT-47 is invalid, never also missing', () => {
  assert.deepEqual(rejected(withValue(rc1(), 'buyer.vatId', 'FR12345678901')), ['invalid_vat_id@buyer.vatId']); // M1 PROFILE: DE + 9 digits
  assert.deepEqual(rejected(withValue(rc1(), 'buyer.vatId', 'DE12345')), ['invalid_vat_id@buyer.vatId']);
  assert.deepEqual(rejected(withValue(rc2(), 'buyer.legalRegistrationId', '')), ['empty_text@buyer.legalRegistrationId']);
  assert.deepEqual(rejected(withValue(rc2(), 'buyer.legalRegistrationId', ' HRB 1')), ['invalid_text@buyer.legalRegistrationId']);
});

test('the AE buyer rule is reported even when a line is wrong for another reason', () => {
  const input = withoutValue(withValue(rc1(), 'lines.0.vat.rate', '19'), 'buyer.vatId');
  assert.deepEqual(rejected(input), ['missing_buyer_identifier@buyer', 'unsupported_vat_rate@lines[0].vat.rate']);
});

test('the AE buyer rule reads only the lines the bounded scan reached (MDR-14)', () => {
  const noBuyerId = withoutValue(rc1(), 'buyer.vatId');
  const rcLine = (rc1().lines as JsonObject[])[0];
  const invalidLine = { ...rcLine, vat: { treatment: 'standard', category: 'S', rate: '19' }, quantity: 'x' };
  const invalidLines = () => Array.from({ length: PROVISIONAL_MAX_REPORTED_ERRORS + 100 }, () => invalidLine);
  const errors = (lines: unknown[]) => {
    const result = buildInvoice(withValue(noBuyerId, 'lines', lines));
    return result.ok ? assert.fail('expected rejection') : result;
  };

  const before = errors([rcLine, ...invalidLines()]);
  assert.equal(before.truncated, true);
  assert.ok(before.errors.some((e) => e.code === 'missing_buyer_identifier' && e.path === 'buyer'));

  const after = errors([...invalidLines(), rcLine]);
  assert.equal(after.truncated, true);
  assert.deepEqual(after.errors.at(-1), { code: 'error_list_truncated', path: `lines[${PROVISIONAL_MAX_REPORTED_ERRORS}]` });
  assert.equal(after.errors.some((e) => e.code === 'missing_buyer_identifier'), false);

  // A huge sparse list whose only line, far past the cutoff, is reverse charge: the hole at index 0 onward is reported
  // and the line itself is never reached.
  const sparse = new Array(4294967295);
  sparse[4294967294] = rcLine;
  const sparseResult = errors(sparse);
  assert.equal(sparseResult.truncated, true);
  assert.equal(sparseResult.errors.some((e) => e.code === 'missing_buyer_identifier'), false);
});

test('standard and Kleinunternehmer invoices are never forced to supply BT-47 or BT-48', () => {
  assert.equal(built(standard()).buyer.vatId, undefined);
  assert.equal(built(loadFixtureInput('e-kleinunternehmer')).buyer.legalRegistrationId, undefined);
});

test('no buyer tax number or other buyer field is invented', () => {
  assert.deepEqual(rejected(withValue(rc1(), 'buyer.taxRegistrationId', '12/345/67890')), ['unknown_field@buyer.taxRegistrationId']);
  assert.deepEqual(rejected(withValue(rc1(), 'buyer.identifiers', ['x'])), ['unknown_field@buyer.identifiers']);
});

// ------------------------------------------------------------------------------------------- UBL binding

test('UBL: category AE, rate 0 on lines and breakdown; BT-120 in TaxCategory; no BT-121, no BT-33', () => {
  const root = ublRoot(built(rc2()));
  for (const line of select(root, 'cac:InvoiceLine')) {
    assert.equal(textAt(line, 'cac:Item/cac:ClassifiedTaxCategory/cbc:ID'), 'AE');
    assert.equal(textAt(line, 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent'), '0');
  }
  const subtotal = one(root, 'cac:TaxTotal/cac:TaxSubtotal');
  assert.equal(textAt(subtotal, 'cbc:TaxableAmount'), '219.80'); // BT-116
  assert.equal(textAt(subtotal, 'cbc:TaxAmount'), '0.00'); // BT-117
  assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:ID'), 'AE');
  assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:Percent'), '0');
  assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:TaxExemptionReason'), TEXT); // BT-120
  assert.equal(select(subtotal, 'cac:TaxCategory/cbc:TaxExemptionReasonCode').length, 0); // BT-121 omitted
  assert.equal(select(root, 'cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyLegalForm').length, 0);
  assert.equal(textAt(root, 'cac:TaxTotal/cbc:TaxAmount'), '0.00'); // BT-110
});

test('UBL buyer: BT-48 in PartyTaxScheme with scheme VAT, BT-47 in PartyLegalEntity/CompanyID, in UBL order', () => {
  const buyer48 = one(ublRoot(built(rc1())), 'cac:AccountingCustomerParty/cac:Party');
  assert.equal(textAt(buyer48, 'cac:PartyTaxScheme/cbc:CompanyID'), 'DE987654321');
  assert.equal(textAt(buyer48, 'cac:PartyTaxScheme/cac:TaxScheme/cbc:ID'), 'VAT');
  assert.equal(select(buyer48, 'cac:PartyLegalEntity/cbc:CompanyID').length, 0);
  assert.deepEqual(childNames(buyer48), ['cbc:EndpointID', 'cac:PostalAddress', 'cac:PartyTaxScheme', 'cac:PartyLegalEntity']);

  const buyer47 = one(ublRoot(built(rc2())), 'cac:AccountingCustomerParty/cac:Party');
  assert.equal(textAt(buyer47, 'cac:PartyLegalEntity/cbc:CompanyID'), 'HRB 654321');
  assert.equal(select(buyer47, 'cac:PartyTaxScheme').length, 0);
});

// ------------------------------------------------------------------------------------------- CII binding

test('CII: category AE, rate 0 on lines and breakdown; BT-120 in ApplicableTradeTax; no BT-121', () => {
  const root = ciiRoot(built(rc2()));
  const transaction = one(root, 'rsm:SupplyChainTradeTransaction');
  for (const line of select(transaction, 'ram:IncludedSupplyChainTradeLineItem')) {
    const tax = one(line, 'ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax');
    assert.equal(textAt(tax, 'ram:CategoryCode'), 'AE');
    assert.equal(textAt(tax, 'ram:RateApplicablePercent'), '0');
  }
  const tax = one(transaction, 'ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax');
  assert.equal(textAt(tax, 'ram:BasisAmount'), '219.80'); // BT-116
  assert.equal(textAt(tax, 'ram:CalculatedAmount'), '0.00'); // BT-117
  assert.equal(textAt(tax, 'ram:CategoryCode'), 'AE');
  assert.equal(textAt(tax, 'ram:RateApplicablePercent'), '0');
  assert.equal(textAt(tax, 'ram:ExemptionReason'), TEXT); // BT-120
  assert.equal(select(tax, 'ram:ExemptionReasonCode').length, 0); // BT-121 omitted
  assert.deepEqual(childNames(tax), ['ram:CalculatedAmount', 'ram:TypeCode', 'ram:ExemptionReason', 'ram:BasisAmount', 'ram:CategoryCode', 'ram:RateApplicablePercent']);
});

test('CII buyer: BT-48 in SpecifiedTaxRegistration with schemeID VA, BT-47 in SpecifiedLegalOrganization, in D16B order', () => {
  const agreement = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty';
  const buyer48 = one(ciiRoot(built(rc1())), agreement);
  assert.equal(textAt(buyer48, 'ram:SpecifiedTaxRegistration/ram:ID'), 'DE987654321');
  assert.equal(one(buyer48, 'ram:SpecifiedTaxRegistration/ram:ID').attributes.schemeID, 'VA');
  assert.equal(select(buyer48, 'ram:SpecifiedLegalOrganization').length, 0);
  assert.deepEqual(childNames(buyer48), ['ram:Name', 'ram:PostalTradeAddress', 'ram:URIUniversalCommunication', 'ram:SpecifiedTaxRegistration']);

  const buyer47 = one(ciiRoot(built(rc2())), agreement);
  assert.equal(textAt(buyer47, 'ram:SpecifiedLegalOrganization/ram:ID'), 'HRB 654321');
  assert.equal(select(buyer47, 'ram:SpecifiedTaxRegistration').length, 0);
  assert.deepEqual(childNames(buyer47), ['ram:Name', 'ram:SpecifiedLegalOrganization', 'ram:PostalTradeAddress', 'ram:URIUniversalCommunication']);
});

test('both syntaxes carry the same semantic values for both reverse-charge fixtures', () => {
  for (const input of [rc1(), rc2()]) {
    const invoice = built(input);
    const u = ublRoot(invoice);
    const c = ciiRoot(invoice);
    const subtotal = one(u, 'cac:TaxTotal/cac:TaxSubtotal');
    const tax = one(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax');
    assert.equal(textAt(subtotal, 'cbc:TaxableAmount'), textAt(tax, 'ram:BasisAmount'));
    assert.equal(textAt(subtotal, 'cbc:TaxAmount'), textAt(tax, 'ram:CalculatedAmount'));
    assert.equal(textAt(subtotal, 'cac:TaxCategory/cbc:TaxExemptionReason'), textAt(tax, 'ram:ExemptionReason'));
    const ublBuyer = one(u, 'cac:AccountingCustomerParty/cac:Party');
    const ciiBuyer = one(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty');
    assert.equal(select(ublBuyer, 'cac:PartyTaxScheme/cbc:CompanyID')[0]?.text, select(ciiBuyer, 'ram:SpecifiedTaxRegistration/ram:ID')[0]?.text);
    assert.equal(select(ublBuyer, 'cac:PartyLegalEntity/cbc:CompanyID')[0]?.text, select(ciiBuyer, 'ram:SpecifiedLegalOrganization/ram:ID')[0]?.text);
  }
});

test('standard output carries none of the reverse-charge elements in either syntax', () => {
  const invoice = built(standard());
  const u = serializeUblInvoice(invoice);
  const c = serializeCiiInvoice(invoice);
  assert.ok(u.ok && c.ok);
  for (const fragment of ['TaxExemptionReason', 'ram:ExemptionReason', '>AE<', TEXT, 'SpecifiedLegalOrganization']) {
    assert.equal(u.xml.includes(fragment) || c.xml.includes(fragment), false, fragment);
  }
  assert.equal(u.xml.split('PartyTaxScheme>').length - 1, 2); // only the seller's (open and close tag)
});
