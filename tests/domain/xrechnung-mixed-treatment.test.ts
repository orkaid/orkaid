import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { formatDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { one, parseXml, select, textAt } from '../support/xml.ts';

// Standard VAT (S) and reverse charge (AE) in one domestic invoice. The admissible scenario is UStAE 13b.4 (2) example 1
// (an ordinary supply and a separately delivered recipient-liable supply, billed together); the caller supplies each
// line's treatment and Orkaid never decides whether § 13b applies. Expected amounts are worked by hand; the § 14a Abs. 5
// wording is repeated on purpose. Every other combination stays outside the profile.

const TEXT = 'Steuerschuldnerschaft des Leistungsempfängers';
const mixed = () => loadFixtureInput('s-standard-and-reverse-charge'); // S19 100.00 + AE 200.00
const s19 = { treatment: 'standard', category: 'S', rate: '19' };
const s7 = { treatment: 'standard', category: 'S', rate: '7' };
const ae = { treatment: 'reverse-charge', category: 'AE', rate: '0' };
const ku = { treatment: 'kleinunternehmer', category: 'E', rate: '0' };

const line = (name: string, quantity: string, unitPrice: string, vat: object) => ({ name, unitCode: 'KGM', quantity, unitPrice, vat });
const withLines = (lines: object[]) => withValue(mixed(), 'lines', lines);

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  return result.ok ? result.value : assert.fail(`expected success: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
}

function rejected(input: JsonObject): readonly string[] {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected rejection');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
}

// [treatment, category, rate, BT-116, BT-117, BT-120] per bucket, then [BT-109, BT-110, BT-112, BT-115].
const money = (invoice: Invoice) => ({
  buckets: invoice.totals.vatBreakdown.map((b) => [b.treatment, b.category, b.rate, formatDecimal(b.taxableAmount), formatDecimal(b.taxAmount), 'exemptionReason' in b ? b.exemptionReason : undefined]),
  totals: [invoice.totals.totalWithoutVat, invoice.totals.totalVat, invoice.totals.totalWithVat, invoice.totals.amountDue].map(formatDecimal),
});

const xml = (invoice: Invoice) => {
  const u = serializeUblInvoice(invoice);
  const c = serializeCiiInvoice(invoice);
  return u.ok && c.ok ? { ubl: u.xml, cii: c.xml } : assert.fail('serialization failed');
};

// The same semantic values read back from each syntax: line category/rate/net, and per breakdown category, rate,
// BT-116, BT-117, BT-120 and BT-121, then the document totals.
function ublProjection(text: string) {
  const root = parseXml(text);
  return {
    lines: select(root, 'cac:InvoiceLine').map((l) => [textAt(l, 'cac:Item/cac:ClassifiedTaxCategory/cbc:ID'), textAt(l, 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent'), textAt(l, 'cbc:LineExtensionAmount')]),
    buckets: select(root, 'cac:TaxTotal/cac:TaxSubtotal').map((s) => [
      textAt(s, 'cac:TaxCategory/cbc:ID'),
      textAt(s, 'cac:TaxCategory/cbc:Percent'),
      textAt(s, 'cbc:TaxableAmount'),
      textAt(s, 'cbc:TaxAmount'),
      select(s, 'cac:TaxCategory/cbc:TaxExemptionReason')[0]?.text,
      select(s, 'cac:TaxCategory/cbc:TaxExemptionReasonCode').length,
    ]),
    totals: [
      textAt(root, 'cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount'),
      textAt(root, 'cac:TaxTotal/cbc:TaxAmount'),
      textAt(root, 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount'),
      textAt(root, 'cac:LegalMonetaryTotal/cbc:PayableAmount'),
    ],
  };
}

function ciiProjection(text: string) {
  const transaction = one(parseXml(text), 'rsm:SupplyChainTradeTransaction');
  const settlement = one(transaction, 'ram:ApplicableHeaderTradeSettlement');
  const summation = one(settlement, 'ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  return {
    lines: select(transaction, 'ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement').map((s) => [
      textAt(s, 'ram:ApplicableTradeTax/ram:CategoryCode'),
      textAt(s, 'ram:ApplicableTradeTax/ram:RateApplicablePercent'),
      textAt(s, 'ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount'),
    ]),
    buckets: select(settlement, 'ram:ApplicableTradeTax').map((t) => [
      textAt(t, 'ram:CategoryCode'),
      textAt(t, 'ram:RateApplicablePercent'),
      textAt(t, 'ram:BasisAmount'),
      textAt(t, 'ram:CalculatedAmount'),
      select(t, 'ram:ExemptionReason')[0]?.text,
      select(t, 'ram:ExemptionReasonCode').length,
    ]),
    totals: [textAt(summation, 'ram:TaxBasisTotalAmount'), textAt(summation, 'ram:TaxTotalAmount'), textAt(summation, 'ram:GrandTotalAmount'), textAt(summation, 'ram:DuePayableAmount')],
  };
}

// ------------------------------------------------------------------------------------------- semantic model

test('P1 S19 + AE: two buckets with their own treatment, AE VAT exactly zero, payable 319.00 without recipient tax', () => {
  const invoice = built(mixed());
  assert.deepEqual(invoice.lines.map((l) => [l.vat.treatment, l.vat.category, l.vat.rate, formatDecimal(l.netAmount)]), [
    ['standard', 'S', '19', '100.00'],
    ['reverse-charge', 'AE', '0', '200.00'],
  ]);
  assert.deepEqual(money(invoice), {
    buckets: [
      ['standard', 'S', '19', '100.00', '19.00', undefined],
      ['reverse-charge', 'AE', '0', '200.00', '0.00', TEXT],
    ],
    totals: ['300.00', '19.00', '319.00', '319.00'],
  });
  assert.equal(invoice.seller.additionalLegalInformation, undefined); // no BT-33 outside Kleinunternehmer
});

test('S7 + AE: 100.00 at 7% -> 7.00 and AE 200.00 -> 0.00; payable 307.00', () => {
  const invoice = built(withLines([line('a', '1000', '0.10', s7), line('b', '2000', '0.10', ae)]));
  assert.deepEqual(money(invoice), {
    buckets: [
      ['standard', 'S', '7', '100.00', '7.00', undefined],
      ['reverse-charge', 'AE', '0', '200.00', '0.00', TEXT],
    ],
    totals: ['300.00', '7.00', '307.00', '307.00'],
  });
});

test('S19 + S7 + AE: one bucket per standard rate plus one AE bucket, whatever the line order; payable 372.50', () => {
  // AE first and S7 before S19 in the input: the buckets keep the fixed order S19, S7, AE; the lines keep input order.
  const invoice = built(withLines([line('a', '2000', '0.10', ae), line('b', '500', '0.10', s7), line('c', '1000', '0.10', s19)]));
  assert.deepEqual(invoice.lines.map((l) => l.vat.category), ['AE', 'S', 'S']);
  assert.deepEqual(money(invoice), {
    buckets: [
      ['standard', 'S', '19', '100.00', '19.00', undefined],
      ['standard', 'S', '7', '50.00', '3.50', undefined],
      ['reverse-charge', 'AE', '0', '200.00', '0.00', TEXT],
    ],
    totals: ['350.00', '22.50', '372.50', '372.50'],
  });
});

test('several AE lines still form exactly one AE bucket (BR-AE-01), beside the standard bucket', () => {
  const invoice = built(withLines([line('a', '1000', '0.10', s19), line('b', '1500', '0.10', ae), line('c', '500', '0.10', ae)]));
  assert.deepEqual(money(invoice).buckets, [
    ['standard', 'S', '19', '100.00', '19.00', undefined],
    ['reverse-charge', 'AE', '0', '200.00', '0.00', TEXT],
  ]);
});

// ------------------------------------------------------------------------------------------- negative controls

test('Kleinunternehmer combined with standard, with reverse charge, or with both stays outside the profile', () => {
  for (const vats of [[ku, s19], [ku, ae], [s19, ae, ku]]) {
    const input = withLines(vats.map((vat, i) => line(`l${i}`, '1', '1.00', vat)));
    assert.deepEqual(rejected(input), ['unsupported_mixed_vat_treatments@lines'], JSON.stringify(vats));
  }
});

test('the AE identifier rules still apply when standard lines are present', () => {
  assert.deepEqual(rejected(withoutValue(mixed(), 'buyer.vatId')), ['missing_buyer_identifier@buyer']); // BR-AE-02 buyer
  assert.deepEqual(rejected(withoutValue(mixed(), 'seller.vatId')), ['missing_seller_identification@seller', 'missing_seller_tax_identifier@seller']);
  // Without the AE line the same input needs no buyer identifier.
  assert.equal(built(withValue(withoutValue(mixed(), 'buyer.vatId'), 'lines.1.vat', s19)).buyer.vatId, undefined);
});

test('a contradictory AE line in a mixed invoice is refused, never re-read as standard or zero-rated', () => {
  assert.deepEqual(rejected(withValue(mixed(), 'lines.1.vat', { ...ae, rate: '19' })), ['unsupported_vat_rate@lines[1].vat.rate']);
  assert.deepEqual(rejected(withValue(mixed(), 'lines.1.vat', { ...ae, category: 'S' })), ['unsupported_vat_category@lines[1].vat.category']);
  assert.deepEqual(rejected(withValue(mixed(), 'lines.1.vat', { ...s19, rate: '0' })), ['unsupported_vat_rate@lines[1].vat.rate']); // no AE inferred from 0 %
  assert.deepEqual(rejected(withValue(mixed(), 'lines.1.vat.exemptionReason', 'x')), ['unknown_field@lines[1].vat.exemptionReason']);
});

// ------------------------------------------------------------------------------------------- UBL / CII projection

test('UBL and CII project the same lines, buckets, BT-120 and totals; S has no reason, AE has BT-120 and no BT-121', () => {
  const expected = {
    lines: [['S', '19', '100.00'], ['AE', '0', '200.00']],
    buckets: [['S', '19', '100.00', '19.00', undefined, 0], ['AE', '0', '200.00', '0.00', TEXT, 0]],
    totals: ['300.00', '19.00', '319.00', '319.00'],
  };
  const { ubl, cii } = xml(built(mixed()));
  assert.deepEqual(ublProjection(ubl), expected);
  assert.deepEqual(ciiProjection(cii), expected);
});

test('S19 + S7 + AE: UBL and CII project identical buckets and totals', () => {
  const { ubl, cii } = xml(built(withLines([line('a', '1000', '0.10', s19), line('b', '500', '0.10', s7), line('c', '2000', '0.10', ae)])));
  const u = ublProjection(ubl);
  assert.deepEqual(u, ciiProjection(cii));
  assert.deepEqual(u.buckets.map((b) => b.slice(0, 4)), [['S', '19', '100.00', '19.00'], ['S', '7', '50.00', '3.50'], ['AE', '0', '200.00', '0.00']]);
});

test('the CII golden of the mixed fixture is the generated document, byte for byte', () => {
  assert.equal(xml(built(mixed())).cii, readFileSync('tests/fixtures/xrechnung/golden/s-standard-and-reverse-charge.cii.xml', 'utf8'));
});
