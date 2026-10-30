import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { CREDIT_NOTE_PERIOD_FIXTURE_NAMES, PERIOD_FIXTURE_NAMES, loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, parseXml, select, textAt, type XmlNode } from '../support/xml.ts';

// Invoicing period BG-14 (BT-73, BT-74) as the alternative to the actual delivery date BT-72 (MDR-37), on a 380 and on a 381.
// PROFILE (Orkaid first release, not an EN 16931 / XRechnung rule): exactly one of BT-72 and BG-14, and a period always has
// both boundaries. EXTERNAL: BR-29, the end is not before the start. Element paths and positions come from the SeMoX CIUS
// model and the UBL 2.1 / CII D16B XSD sequences of the KoSIT configuration 2026-08-31.

const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
const golden = (file: string) => readFileSync(new URL(`../fixtures/xrechnung/golden/${file}`, import.meta.url), 'utf8');

// Same document on both kinds: the BT-72 fixture each period fixture was derived from, and its period counterpart.
const KINDS = [
  { kind: '380', withDelivery: () => loadFixtureInput('a-simple'), withPeriod: () => loadFixtureInput('zb-period-single-day-leap') },
  { kind: '381', withDelivery: () => loadFixtureInput('t-credit-note-full-reversal'), withPeriod: () => loadFixtureInput('zd-credit-note-period-single-day') },
] as const;
const ALL_PERIOD_FIXTURES = [...PERIOD_FIXTURE_NAMES, ...CREDIT_NOTE_PERIOD_FIXTURE_NAMES];

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  assert.equal(result.ok, true, show(result));
  return result.ok ? result.value : assert.fail('unreachable');
}
const pairs = (input: unknown): string[] => {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected failure');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
};
const period = (input: JsonObject, value: unknown) => withValue(withoutValue(input, 'deliveryDate'), 'invoicingPeriod', value);
const ublXml = (invoice: Invoice) => {
  const result = serializeUblInvoice(invoice);
  return result.ok ? result.xml : assert.fail('serialization failed');
};
const ciiXml = (invoice: Invoice) => {
  const result = serializeCiiInvoice(invoice);
  return result.ok ? result.xml : assert.fail('serialization failed');
};
const settlementOf = (root: XmlNode) => select(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement')[0] as XmlNode;
const deliveryOf = (root: XmlNode) => select(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery');

// ------------------------------------------------------------------------------------------- domain: presence

test('a period-only document builds on a 380 and on a 381 and carries BG-14 without BT-72', () => {
  for (const { kind, withPeriod } of KINDS) {
    const invoice = built(withPeriod());
    assert.equal(invoice.documentTypeCode, kind);
    assert.equal(Object.hasOwn(invoice, 'deliveryDate'), false, kind);
    assert.deepEqual(invoice.invoicingPeriod, kind === '380' ? { startDate: '2024-02-29', endDate: '2024-02-29' } : { startDate: '2026-09-20', endDate: '2026-09-20' });
    assert.ok(Object.isFrozen(invoice.invoicingPeriod));
  }
  for (const name of ALL_PERIOD_FIXTURES) built(loadFixtureInput(name));
});

test('a BT-72-only document is unchanged and carries no BG-14', () => {
  for (const { kind, withDelivery } of KINDS) {
    const invoice = built(withDelivery());
    assert.equal(invoice.deliveryDate, '2026-09-20', kind);
    assert.equal(Object.hasOwn(invoice, 'invoicingPeriod'), false, kind);
  }
});

test('both BT-72 and BG-14 are refused as outside the profile, on a 380 and on a 381', () => {
  for (const { kind, withDelivery } of KINDS) {
    const both = withValue(withDelivery(), 'invoicingPeriod', { startDate: '2026-09-01', endDate: '2026-09-30' });
    assert.deepEqual(pairs(both), ['unsupported_delivery_date_with_invoicing_period@invoicingPeriod'], kind);
    // Each value is still validated on its own: the caller learns everything that is wrong at once.
    assert.deepEqual(pairs(withValue(both, 'deliveryDate', '2026-02-30')), ['invalid_date@deliveryDate', 'unsupported_delivery_date_with_invoicing_period@invoicingPeriod'], kind);
  }
});

test('neither BT-72 nor BG-14 keeps the existing missing-field diagnostic for deliveryDate', () => {
  for (const { kind, withDelivery } of KINDS) assert.deepEqual(pairs(withoutValue(withDelivery(), 'deliveryDate')), ['missing_field@deliveryDate'], kind);
});

// ------------------------------------------------------------------------------------------- domain: completeness and types

test('a period needs both boundaries: a missing one is reported at its own path, an empty object reports both', () => {
  for (const { kind, withPeriod } of KINDS) {
    assert.deepEqual(pairs(withoutValue(withPeriod(), 'invoicingPeriod.startDate')), ['missing_field@invoicingPeriod.startDate'], kind);
    assert.deepEqual(pairs(withoutValue(withPeriod(), 'invoicingPeriod.endDate')), ['missing_field@invoicingPeriod.endDate'], kind);
    assert.deepEqual(pairs(period(withPeriod(), {})), ['missing_field@invoicingPeriod.startDate', 'missing_field@invoicingPeriod.endDate'], kind);
  }
});

test('a period of the wrong type, with wrongly typed boundaries or with unknown fields is refused specifically', () => {
  for (const { kind, withPeriod } of KINDS) {
    for (const value of ['2026-09-01/2026-09-30', 7, null, true, [], [{ startDate: '2026-09-01', endDate: '2026-09-30' }]]) {
      assert.deepEqual(pairs(period(withPeriod(), value)), ['invalid_type@invoicingPeriod'], `${kind} ${show(value)}`);
    }
    for (const value of [20260901, null, true, {}, ['2026-09-01']]) {
      assert.deepEqual(pairs(withValue(withPeriod(), 'invoicingPeriod.startDate', value)), ['invalid_type@invoicingPeriod.startDate'], `${kind} ${show(value)}`);
      assert.deepEqual(pairs(withValue(withPeriod(), 'invoicingPeriod.endDate', value)), ['invalid_type@invoicingPeriod.endDate'], `${kind} ${show(value)}`);
    }
    for (const field of ['description', 'startTime', 'duration', 'StartDate', '__proto__']) {
      const input = withPeriod();
      Object.defineProperty(input.invoicingPeriod, field, { value: '2026-09-01', enumerable: true });
      assert.deepEqual(pairs(input), [`unknown_field@invoicingPeriod.${field}`], `${kind} ${field}`);
    }
  }
});

// ------------------------------------------------------------------------------------------- domain: calendar and order

test('each boundary is a real YYYY-MM-DD calendar date; no time, zone or other notation is accepted', () => {
  const invalid = ['2026-02-30', '2100-02-29', '2023-02-29', '0000-01-01', '2026-13-01', '2026-00-10', '2026-04-31', '2026-9-1', '20260901', '2026-09-01T00:00:00', '2026-09-01Z', '2026-09-01+02:00', '01.09.2026', '+2026-09-01'];
  for (const { kind, withPeriod } of KINDS) {
    for (const value of invalid) {
      for (const boundary of ['startDate', 'endDate']) {
        // The other boundary is set far away, so the ordering rule is never what fails here.
        const other = boundary === 'startDate' ? { endDate: '9999-12-31' } : { startDate: '0001-01-01' };
        assert.deepEqual(pairs(period(withPeriod(), { [boundary]: value, ...other })), [`invalid_date@invoicingPeriod.${boundary}`], `${kind} ${boundary} ${value}`);
      }
    }
    for (const value of ['', '  ']) assert.deepEqual(pairs(withValue(withPeriod(), 'invoicingPeriod.startDate', value)), ['empty_text@invoicingPeriod.startDate'], kind);
    assert.deepEqual(pairs(withValue(withPeriod(), 'invoicingPeriod.endDate', ' 2024-02-29')), ['invalid_text@invoicingPeriod.endDate'], kind);
  }
});

test('leap days and equal boundaries are accepted, the order is checked and the dates are kept as supplied', () => {
  for (const { kind, withPeriod } of KINDS) {
    for (const [startDate, endDate] of [['2000-02-29', '2000-02-29'], ['2024-02-29', '2024-02-29'], ['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'], ['2026-09-01', '2026-09-30'], ['2025-12-31', '2026-01-01'], ['0001-01-01', '9999-12-31']]) {
      assert.deepEqual(built(period(withPeriod(), { startDate, endDate })).invoicingPeriod, { startDate, endDate }, `${kind} ${startDate}..${endDate}`);
    }
    for (const [startDate, endDate] of [['2024-02-29', '2024-02-28'], ['2024-03-01', '2024-02-29'], ['2026-09-30', '2026-09-01'], ['2026-01-01', '2025-12-31']]) {
      assert.deepEqual(pairs(period(withPeriod(), { startDate, endDate })), ['invalid_invoicing_period@invoicingPeriod.endDate'], `${kind} ${startDate}..${endDate}`);
    }
    // The order is only checked between two individually valid dates.
    assert.deepEqual(pairs(period(withPeriod(), { startDate: '2026-02-30', endDate: '2026-02-01' })), ['invalid_date@invoicingPeriod.startDate'], kind);
    assert.deepEqual(pairs(period(withPeriod(), { startDate: '2026-09-30' })), ['missing_field@invoicingPeriod.endDate'], kind);
  }
});

test('the period is never derived from, defaulted to or checked against another date', () => {
  for (const { kind, withPeriod } of KINDS) {
    // Far before the issue date (BT-2), after it, and unrelated to BT-26 on a 381: all accepted as supplied.
    for (const [startDate, endDate] of [['1999-01-01', '1999-01-31'], ['2030-01-01', '2030-12-31']]) {
      const invoice = built(period(withPeriod(), { startDate, endDate }));
      assert.deepEqual(invoice.invoicingPeriod, { startDate, endDate }, kind);
      assert.equal(Object.hasOwn(invoice, 'deliveryDate'), false, kind);
    }
  }
});

test('the 381 rules of MDR-35 still apply to a period-only credit note', () => {
  const base = () => loadFixtureInput('zd-credit-note-period-single-day');
  assert.deepEqual(pairs(withoutValue(base(), 'precedingInvoice')), ['missing_field@precedingInvoice']);
  assert.deepEqual(pairs(withoutValue(base(), 'payment.settlement.reciprocalObligationConfirmed')), ['missing_clearing_confirmation@payment.settlement.reciprocalObligationConfirmed']);
  assert.deepEqual(pairs(withValue(base(), 'lines.0.quantity', '-2')), pairs(withValue(loadFixtureInput('t-credit-note-full-reversal'), 'lines.0.quantity', '-2')));
});

// ------------------------------------------------------------------------------------------- domain: ownership

test('an inherited invoicingPeriod, deliveryDate, startDate or endDate is never read as caller input', () => {
  const prototype = Object.prototype as Record<string, unknown>;
  const plant = <T>(key: string, value: unknown, body: () => T): T => {
    assert.equal(Object.hasOwn(prototype, key), false, `Object.prototype.${key} already exists`);
    try {
      prototype[key] = value;
      return body();
    } finally {
      delete prototype[key];
    }
  };
  for (const { kind, withDelivery, withPeriod } of KINDS) {
    // BT-72 only: an inherited period is neither a second statement nor a value in the model.
    const delivery = plant('invoicingPeriod', { startDate: '2026-09-01', endDate: '2026-09-30' }, () => built(withDelivery()));
    assert.equal(Object.hasOwn(delivery, 'invoicingPeriod'), false, kind);
    // Period only: an inherited BT-72 is neither a conflict nor a value in the model.
    const periodOnly = plant('deliveryDate', '2026-09-20', () => built(withPeriod()));
    assert.equal(Object.hasOwn(periodOnly, 'deliveryDate'), false, kind);
    // Neither supplied: an inherited value does not fill the gap.
    assert.deepEqual(plant('invoicingPeriod', { startDate: '2026-09-01', endDate: '2026-09-30' }, () => pairs(withoutValue(withDelivery(), 'deliveryDate'))), ['missing_field@deliveryDate'], kind);
    assert.deepEqual(plant('deliveryDate', '2026-09-20', () => pairs(withoutValue(withDelivery(), 'deliveryDate'))), ['missing_field@deliveryDate'], kind);
    // A missing boundary is not filled from Object.prototype or from the period object's own prototype.
    for (const boundary of ['startDate', 'endDate']) {
      const missing = withoutValue(withPeriod(), `invoicingPeriod.${boundary}`);
      assert.deepEqual(plant(boundary, '2024-02-29', () => pairs(missing)), [`missing_field@invoicingPeriod.${boundary}`], `${kind} ${boundary}`);
      const own = withPeriod();
      own.invoicingPeriod = Object.assign(Object.create({ [boundary]: '2024-02-29' }), boundary === 'startDate' ? { endDate: '2024-02-29' } : { startDate: '2024-02-29' });
      assert.deepEqual(pairs(own), [`missing_field@invoicingPeriod.${boundary}`], `${kind} own-prototype ${boundary}`);
    }
    // A period object whose own prototype supplies both boundaries supplies none.
    const inherited = withoutValue(withPeriod(), 'invoicingPeriod');
    inherited.invoicingPeriod = Object.create({ startDate: '2024-02-29', endDate: '2024-02-29' });
    assert.deepEqual(pairs(inherited), ['missing_field@invoicingPeriod.startDate', 'missing_field@invoicingPeriod.endDate'], kind);
    // An accessor is reported and never executed.
    const accessor = withPeriod();
    let reads = 0;
    Object.defineProperty(accessor.invoicingPeriod, 'endDate', { enumerable: true, get: () => (reads++, '2024-02-29') });
    assert.deepEqual(pairs(accessor), ['invalid_type@invoicingPeriod.endDate'], kind);
    assert.equal(reads, 0);
  }
});

test('Object.prototype pollution after validation does not change which date the serializers write', () => {
  const prototype = Object.prototype as Record<string, unknown>;
  const keys = ['invoicingPeriod', 'deliveryDate', 'startDate', 'endDate'];
  for (const { kind, withDelivery, withPeriod } of KINDS) {
    const documents = [built(withDelivery()), built(withPeriod())];
    const expected = documents.map((invoice) => [ublXml(invoice), ciiXml(invoice)]);
    for (const key of keys) assert.equal(Object.hasOwn(prototype, key), false, `Object.prototype.${key} already exists`);
    try {
      prototype.invoicingPeriod = { startDate: '1999-01-01', endDate: '1999-01-31' };
      prototype.deliveryDate = '1999-01-15';
      prototype.startDate = '1999-01-01';
      prototype.endDate = '1999-01-31';
      const actual = documents.map((invoice) => [ublXml(invoice), ciiXml(invoice)]);
      assert.deepEqual(actual, expected, kind);
    } finally {
      for (const key of keys) delete prototype[key];
    }
  }
});

// ------------------------------------------------------------------------------------------- UBL

test('UBL: InvoicePeriod with StartDate and EndDate directly after BuyerReference, and no Delivery, on Invoice and CreditNote', () => {
  for (const name of ALL_PERIOD_FIXTURES) {
    const input = loadFixtureInput(name);
    const root = parseXml(ublXml(built(input)));
    const expected = input.invoicingPeriod as { startDate: string; endDate: string };
    assert.equal(root.name, name.includes('credit-note') ? 'CreditNote' : 'Invoice');
    const periods = select(root, 'cac:InvoicePeriod');
    assert.equal(periods.length, 1, name);
    assert.deepEqual(childNames(periods[0] as XmlNode), ['cbc:StartDate', 'cbc:EndDate'], name);
    assert.equal(textAt(root, 'cac:InvoicePeriod/cbc:StartDate'), expected.startDate); // BT-73
    assert.equal(textAt(root, 'cac:InvoicePeriod/cbc:EndDate'), expected.endDate); // BT-74
    assert.equal(select(root, 'cac:Delivery').length, 0, name); // BT-72 is not written
    // UBL-Invoice-2.1.xsd / UBL-CreditNote-2.1.xsd: BuyerReference, InvoicePeriod, (DiscrepancyResponse,) OrderReference,
    // BillingReference, ContractDocumentReference, ... AccountingSupplierParty.
    const names = childNames(root);
    assert.equal(names.indexOf('cac:InvoicePeriod'), names.indexOf('cbc:BuyerReference') + 1, name);
    const next = names[names.indexOf('cac:InvoicePeriod') + 1];
    assert.equal(next, input.orderReference !== undefined ? 'cac:OrderReference' : name.includes('credit-note') ? 'cac:BillingReference' : 'cac:AccountingSupplierParty', name);
  }
});

test('UBL: the period document differs from its BT-72 counterpart only by InvoicePeriod instead of Delivery', () => {
  for (const { kind, withDelivery } of KINDS) {
    const delivery = ublXml(built(withDelivery()));
    const periodOnly = ublXml(built(period(withDelivery(), { startDate: '2026-09-20', endDate: '2026-09-20' })));
    const expected = delivery
      .replace('  <cac:Delivery>\n    <cbc:ActualDeliveryDate>2026-09-20</cbc:ActualDeliveryDate>\n  </cac:Delivery>\n', '')
      .replace(/(  <cbc:BuyerReference>.*<\/cbc:BuyerReference>\n)/, '$1  <cac:InvoicePeriod>\n    <cbc:StartDate>2026-09-20</cbc:StartDate>\n    <cbc:EndDate>2026-09-20</cbc:EndDate>\n  </cac:InvoicePeriod>\n');
    assert.notEqual(expected, delivery);
    assert.equal(periodOnly, expected, kind);
  }
});

// ------------------------------------------------------------------------------------------- CII

test('CII: BillingSpecifiedPeriod after the VAT breakdown and before the payment terms, format 102, empty delivery', () => {
  for (const name of ALL_PERIOD_FIXTURES) {
    const input = loadFixtureInput(name);
    const root = parseXml(ciiXml(built(input)));
    const expected = input.invoicingPeriod as { startDate: string; endDate: string };
    const settlement = settlementOf(root);
    const periods = select(settlement, 'ram:BillingSpecifiedPeriod');
    assert.equal(periods.length, 1, name);
    const billing = periods[0] as XmlNode;
    assert.deepEqual(childNames(billing), ['ram:StartDateTime', 'ram:EndDateTime'], name);
    for (const [element, value] of [['ram:StartDateTime', expected.startDate], ['ram:EndDateTime', expected.endDate]] as const) {
      const strings = select(billing, `${element}/udt:DateTimeString`);
      assert.equal(strings.length, 1);
      assert.equal(strings[0]?.attributes.format, '102');
      assert.equal(strings[0]?.text, value.replaceAll('-', '')); // BT-73 / BT-74, no conversion
      assert.deepEqual(childNames(select(billing, element)[0] as XmlNode), ['udt:DateTimeString']);
    }
    // HeaderTradeSettlementType: ... SpecifiedTradeSettlementPaymentMeans, ApplicableTradeTax, BillingSpecifiedPeriod, ...,
    // SpecifiedTradePaymentTerms, SpecifiedTradeSettlementHeaderMonetarySummation.
    const names = childNames(settlement);
    const at = names.indexOf('ram:BillingSpecifiedPeriod');
    assert.equal(names[at - 1], 'ram:ApplicableTradeTax', name);
    assert.ok(!names.slice(0, at).includes('ram:SpecifiedTradePaymentTerms') && !names.slice(0, at).includes('ram:SpecifiedTradeSettlementHeaderMonetarySummation'), name);
    assert.equal(names[at + 1], names.includes('ram:SpecifiedTradePaymentTerms') ? 'ram:SpecifiedTradePaymentTerms' : 'ram:SpecifiedTradeSettlementHeaderMonetarySummation', name);
    // The XSD requires ApplicableHeaderTradeDelivery; with no BT-72 it is written with no content at all.
    const delivery = deliveryOf(root);
    assert.equal(delivery.length, 1, name);
    assert.deepEqual([delivery[0]?.children.length, delivery[0]?.text], [0, ''], name);
    assert.match(ciiXml(built(input)), /\n    <ram:ApplicableHeaderTradeDelivery><\/ram:ApplicableHeaderTradeDelivery>\n/);
    assert.equal(select(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent').length, 0);
  }
});

test('CII: a BT-72 document keeps its delivery event and has no BillingSpecifiedPeriod', () => {
  for (const { kind, withDelivery } of KINDS) {
    const root = parseXml(ciiXml(built(withDelivery())));
    assert.equal(select(settlementOf(root), 'ram:BillingSpecifiedPeriod').length, 0, kind);
    assert.equal(textAt(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString'), '20260920');
  }
});

// ------------------------------------------------------------------------------------------- semantic equivalence

test('UBL and CII carry the same BT-73 and BT-74, and neither carries BT-72, for each period document', () => {
  for (const name of ALL_PERIOD_FIXTURES) {
    const input = loadFixtureInput(name);
    const invoice = built(input);
    const u = parseXml(ublXml(invoice));
    const c = parseXml(ciiXml(invoice));
    const fromCii = (element: string) => {
      const digits = /^([0-9]{4})([0-9]{2})([0-9]{2})$/.exec(textAt(settlementOf(c), `ram:BillingSpecifiedPeriod/${element}/udt:DateTimeString`));
      return digits ? `${digits[1]}-${digits[2]}-${digits[3]}` : assert.fail(`${name}: ${element} is not 8 digits`);
    };
    const ubl = { 'BT-73': textAt(u, 'cac:InvoicePeriod/cbc:StartDate'), 'BT-74': textAt(u, 'cac:InvoicePeriod/cbc:EndDate'), 'BT-72': select(u, 'cac:Delivery/cbc:ActualDeliveryDate').length };
    const cii = { 'BT-73': fromCii('ram:StartDateTime'), 'BT-74': fromCii('ram:EndDateTime'), 'BT-72': select(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent').length };
    const expected = input.invoicingPeriod as { startDate: string; endDate: string };
    assert.deepEqual(ubl, { 'BT-73': expected.startDate, 'BT-74': expected.endDate, 'BT-72': 0 }, name);
    assert.deepEqual(cii, ubl, name);
  }
});

test('a period does not change any amount of its BT-72 counterpart', () => {
  for (const { kind, withDelivery } of KINDS) {
    const delivery = built(withDelivery());
    const periodOnly = built(period(withDelivery(), { startDate: '2026-09-01', endDate: '2026-09-30' }));
    assert.equal(show(periodOnly.totals), show(delivery.totals), kind);
    assert.equal(show(periodOnly.lines), show(delivery.lines), kind);
  }
});

// ------------------------------------------------------------------------------------------- goldens

test('the committed golden files equal the generated period documents', () => {
  for (const name of ALL_PERIOD_FIXTURES) {
    const invoice = built(loadFixtureInput(name));
    assert.equal(ublXml(invoice), golden(`${name}.xml`), name);
    assert.equal(ciiXml(invoice), golden(`${name}.cii.xml`), name);
  }
});
