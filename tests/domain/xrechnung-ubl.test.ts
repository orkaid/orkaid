import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { EXPECTED, FIXTURE_NAMES, loadFixtureInput, withValue, type FixtureName, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select, textAt, type XmlNode } from '../support/xml.ts';

// The UBL 2.1 serializer. Element paths and cardinalities below come from the official SeMoX CIUS model (binding
// ubl-inv) and the UBL 2.1 XSD sequences in the KoSIT configuration 2026-08-31; expected amounts come from the hand
// worked values in tests/support/fixtures.ts. Neither is produced by the code under test.

function invoiceFor(input: JsonObject, options?: Parameters<typeof buildInvoice>[1]): Invoice {
  const result = buildInvoice(input, options);
  return result.ok ? result.value : assert.fail(`fixture did not build: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
}

function xmlFor(input: JsonObject, options?: Parameters<typeof buildInvoice>[1]): string {
  const result = serializeUblInvoice(invoiceFor(input, options));
  return result.ok ? result.xml : assert.fail('serialization failed');
}

const tree = (name: FixtureName) => parseXml(xmlFor(loadFixtureInput(name)));

// ------------------------------------------------------------------------------------------- amounts

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: every amount in the XML equals the independently worked value`, () => {
    const root = tree(name);
    const expected = EXPECTED[name];

    assert.deepEqual(select(root, 'cac:InvoiceLine').map((l) => textAt(l, 'cbc:LineExtensionAmount')), expected.lineNets); // BT-131
    assert.deepEqual(
      select(root, 'cac:TaxTotal/cac:TaxSubtotal').map((s) => ({
        rate: textAt(s, 'cac:TaxCategory/cbc:Percent'),
        taxable: textAt(s, 'cbc:TaxableAmount'), // BT-116
        tax: textAt(s, 'cbc:TaxAmount'), // BT-117
      })),
      expected.breakdown,
    );
    assert.equal(textAt(root, 'cac:TaxTotal/cbc:TaxAmount'), expected.totalVat); // BT-110
    assert.equal(textAt(root, 'cac:LegalMonetaryTotal/cbc:LineExtensionAmount'), expected.sumOfLineNets); // BT-106
    assert.equal(textAt(root, 'cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount'), expected.sumOfLineNets); // BT-109
    assert.equal(textAt(root, 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount'), expected.gross); // BT-112
    assert.equal(textAt(root, 'cac:LegalMonetaryTotal/cbc:PayableAmount'), expected.gross); // BT-115
  });
}

test('ten lines of EUR 0.03 at 19%: taxable 0.30, VAT 0.06 (not 0.10), gross 0.36', () => {
  const root = tree('b-ten-lines');
  assert.equal(select(root, 'cac:InvoiceLine').length, 10);
  assert.equal(textAt(root, 'cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount'), '0.30');
  assert.equal(textAt(root, 'cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount'), '0.06');
  assert.equal(textAt(root, 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount'), '0.36');
});

test('rounded line net: the line net is rounded, the price and quantity keep the typed precision', () => {
  const lines = select(tree('c-rounded-line-net'), 'cac:InvoiceLine');
  assert.deepEqual(lines.map((l) => textAt(l, 'cbc:InvoicedQuantity')), ['3', '2.5']);
  assert.deepEqual(lines.map((l) => textAt(l, 'cac:Price/cbc:PriceAmount')), ['0.335', '1.999']);
  assert.deepEqual(lines.map((l) => textAt(l, 'cbc:LineExtensionAmount')), ['1.01', '5.00']); // 1.005 and 4.9975, HALF_UP
});

test('mixed rates: one breakdown per rate, in a fixed order, each rate written as 19 or 7', () => {
  const root = tree('d-mixed-rates');
  assert.deepEqual(select(root, 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent').map((p) => p.text), ['19', '7']);
  assert.deepEqual(select(root, 'cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent').map((p) => p.text), ['19', '7']);
});

test('amounts follow the BR-DEC rule: monetary values carry exactly two decimals, in the invoice currency', () => {
  for (const name of FIXTURE_NAMES) {
    const root = tree(name);
    const amounts = [
      ...select(root, 'cac:InvoiceLine/cbc:LineExtensionAmount'),
      ...select(root, 'cac:TaxTotal/cbc:TaxAmount'),
      ...select(root, 'cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount'),
      ...select(root, 'cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount'),
      ...select(root, 'cac:LegalMonetaryTotal/cbc:LineExtensionAmount'),
      ...select(root, 'cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount'),
      ...select(root, 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount'),
      ...select(root, 'cac:LegalMonetaryTotal/cbc:PayableAmount'),
    ];
    assert.ok(amounts.length >= 8, name);
    for (const amount of amounts) {
      assert.match(amount.text, /^[0-9]+\.[0-9]{2}$/, `${name} ${amount.name}`);
      assert.equal(amount.attributes.currencyID, 'EUR', `${name} ${amount.name}`);
    }
    for (const price of select(root, 'cac:InvoiceLine/cac:Price/cbc:PriceAmount')) assert.equal(price.attributes.currencyID, 'EUR');
  }
});

// ------------------------------------------------------------------------------------------- field bindings

test('every business field is written at its BT binding (fixture A)', () => {
  const root = tree('a-simple');
  const bindings: [string, string, string][] = [
    ['BT-24', 'cbc:CustomizationID', 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'],
    ['BT-23', 'cbc:ProfileID', 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'],
    ['BT-1', 'cbc:ID', 'RE-2026-0001'],
    ['BT-2', 'cbc:IssueDate', '2026-09-24'],
    ['BT-9', 'cbc:DueDate', '2026-10-24'],
    ['BT-3', 'cbc:InvoiceTypeCode', '380'],
    ['BT-5', 'cbc:DocumentCurrencyCode', 'EUR'],
    ['BT-10', 'cbc:BuyerReference', 'PO-2026-0815'],
    ['BT-27', 'cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName', 'Beispiel Beratung GmbH'],
    ['BT-31', 'cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID', 'DE123456789'],
    ['BT-31 scheme', 'cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID', 'VAT'],
    ['BT-34', 'cac:AccountingSupplierParty/cac:Party/cbc:EndpointID', 'rechnung@example.com'],
    ['BT-35', 'cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:StreetName', 'Musterstraße 1'],
    ['BT-37', 'cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CityName', 'Berlin'],
    ['BT-38', 'cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:PostalZone', '10115'],
    ['BT-40', 'cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode', 'DE'],
    ['BT-41', 'cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Name', 'Erika Muster'],
    ['BT-42', 'cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone', '+49 30 1234567'],
    ['BT-43', 'cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail', 'erika.muster@example.com'],
    ['BT-44', 'cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName', 'Beispiel Handel AG'],
    ['BT-49', 'cac:AccountingCustomerParty/cac:Party/cbc:EndpointID', 'einkauf@example.org'],
    ['BT-50', 'cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName', 'Beispielweg 2'],
    ['BT-52', 'cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName', 'Hamburg'],
    ['BT-53', 'cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone', '20095'],
    ['BT-55', 'cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode', 'DE'],
    ['BT-72', 'cac:Delivery/cbc:ActualDeliveryDate', '2026-09-20'],
    ['BT-81', 'cac:PaymentMeans/cbc:PaymentMeansCode', '58'],
    ['BT-84', 'cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID', 'DE79000000001234567890'],
    ['BT-118', 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:ID', 'S'],
    ['BT-118 scheme', 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:ID', 'VAT'],
  ];
  for (const [term, path, value] of bindings) assert.equal(textAt(root, path), value, `${term} at ${path}`);

  assert.equal(one(root, 'cac:AccountingSupplierParty/cac:Party/cbc:EndpointID').attributes.schemeID, 'EM'); // BT-34 scheme
  assert.equal(one(root, 'cac:AccountingCustomerParty/cac:Party/cbc:EndpointID').attributes.schemeID, 'EM'); // BT-49 scheme

  const lines = select(root, 'cac:InvoiceLine');
  assert.deepEqual(lines.map((l) => textAt(l, 'cbc:ID')), ['1', '2']); // BT-126
  assert.deepEqual(lines.map((l) => textAt(l, 'cbc:InvoicedQuantity')), ['2', '1.5']); // BT-129
  assert.deepEqual(lines.map((l) => one(l, 'cbc:InvoicedQuantity').attributes.unitCode), ['C62', 'HUR']); // BT-130
  assert.deepEqual(lines.map((l) => textAt(l, 'cac:Price/cbc:PriceAmount')), ['49.90', '80.00']); // BT-146
  assert.deepEqual(lines.map((l) => textAt(l, 'cac:Item/cbc:Name')), ['Beratungsleistung', 'Workshop']); // BT-153
  assert.deepEqual(lines.map((l) => textAt(l, 'cac:Item/cac:ClassifiedTaxCategory/cbc:ID')), ['S', 'S']); // BT-151
  assert.deepEqual(lines.map((l) => textAt(l, 'cac:Item/cac:ClassifiedTaxCategory/cac:TaxScheme/cbc:ID')), ['VAT', 'VAT']);
});

// ------------------------------------------------------------------------------------------- structure

// Child element order per the UBL 2.1 XSD sequences (UBL-Invoice-2.1.xsd, UBL-CommonAggregateComponents-2.1.xsd).
const ORDER: Record<string, string[]> = {
  'Invoice': ['cbc:CustomizationID', 'cbc:ProfileID', 'cbc:ID', 'cbc:IssueDate', 'cbc:DueDate', 'cbc:InvoiceTypeCode', 'cbc:DocumentCurrencyCode', 'cbc:BuyerReference', 'cac:AccountingSupplierParty', 'cac:AccountingCustomerParty', 'cac:Delivery', 'cac:PaymentMeans', 'cac:TaxTotal', 'cac:LegalMonetaryTotal', 'cac:InvoiceLine'],
  'cac:AccountingSupplierParty': ['cac:Party'],
  'cac:AccountingCustomerParty': ['cac:Party'],
  'cac:PostalAddress': ['cbc:StreetName', 'cbc:CityName', 'cbc:PostalZone', 'cac:Country'],
  'cac:PartyTaxScheme': ['cbc:CompanyID', 'cac:TaxScheme'],
  'cac:PartyLegalEntity': ['cbc:RegistrationName'],
  'cac:Contact': ['cbc:Name', 'cbc:Telephone', 'cbc:ElectronicMail'],
  'cac:Delivery': ['cbc:ActualDeliveryDate'],
  'cac:PaymentMeans': ['cbc:PaymentMeansCode', 'cac:PayeeFinancialAccount'],
  'cac:TaxTotal': ['cbc:TaxAmount', 'cac:TaxSubtotal'],
  'cac:TaxSubtotal': ['cbc:TaxableAmount', 'cbc:TaxAmount', 'cac:TaxCategory'],
  'cac:TaxCategory': ['cbc:ID', 'cbc:Percent', 'cac:TaxScheme'],
  'cac:ClassifiedTaxCategory': ['cbc:ID', 'cbc:Percent', 'cac:TaxScheme'],
  'cac:LegalMonetaryTotal': ['cbc:LineExtensionAmount', 'cbc:TaxExclusiveAmount', 'cbc:TaxInclusiveAmount', 'cbc:PayableAmount'],
  'cac:InvoiceLine': ['cbc:ID', 'cbc:InvoicedQuantity', 'cbc:LineExtensionAmount', 'cac:Item', 'cac:Price'],
  'cac:Item': ['cbc:Name', 'cac:ClassifiedTaxCategory'],
  'cac:Price': ['cbc:PriceAmount'],
  'cac:Party(supplier)': ['cbc:EndpointID', 'cac:PostalAddress', 'cac:PartyTaxScheme', 'cac:PartyLegalEntity', 'cac:Contact'],
  'cac:Party(customer)': ['cbc:EndpointID', 'cac:PostalAddress', 'cac:PartyLegalEntity'],
};

// The set of distinct child names, in first-appearance order, must equal the XSD order for that element (a name may
// repeat, e.g. InvoiceLine or TaxSubtotal, but only consecutively).
function distinctInOrder(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (out.at(-1) === name) continue;
    assert.ok(!out.includes(name), `${name} reappears after another element`);
    out.push(name);
  }
  return out;
}

function checkOrder(node: XmlNode, key: string): void {
  const expected = ORDER[key];
  if (expected === undefined) return;
  assert.deepEqual(distinctInOrder(childNames(node)), expected, `child order of ${key}`);
}

test('element order follows the UBL 2.1 XSD sequences at every level', () => {
  const walk = (node: XmlNode, parent?: XmlNode): void => {
    // The two Party elements have different children, so the parent tells which sequence applies.
    const key = node.name === 'cac:Party' ? `cac:Party(${parent?.name === 'cac:AccountingSupplierParty' ? 'supplier' : 'customer'})` : node.name;
    checkOrder(node, key);
    for (const child of node.children) walk(child, node);
  };
  for (const name of FIXTURE_NAMES) walk(tree(name));
});

test('the document is UBL 2.1 Invoice with the three namespaces bound to the official URNs', () => {
  const xml = xmlFor(loadFixtureInput('a-simple'));
  const root = parseXml(xml);
  assert.equal(root.name, 'Invoice');
  assert.deepEqual(root.attributes, {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice '));
});

test('output is deterministic: identical on repeated calls, LF only, one trailing newline, no BOM', () => {
  for (const name of FIXTURE_NAMES) {
    const input = loadFixtureInput(name);
    const first = xmlFor(input);
    for (let i = 0; i < 5; i++) assert.equal(xmlFor(structuredClone(input)), first);
    assert.equal(first.includes('\r'), false);
    assert.equal(first.startsWith('﻿'), false);
    assert.ok(first.endsWith('</Invoice>\n') && !first.endsWith('\n\n'));
    assert.equal(/[ \t]+\n/.test(first), false, 'no trailing whitespace');
  }
});

test('the notation used to read the input does not matter, and serializing the same invoice again gives the same XML', () => {
  const canonical = loadFixtureInput('a-simple');
  const german = withValue(
    withValue(withValue(canonical, 'lines.0.unitPrice', '49,90'), 'lines.1.quantity', '1,5'),
    'lines.1.unitPrice',
    '80,00',
  );
  assert.equal(xmlFor(german, { notation: 'de' }), xmlFor(canonical));
  const invoice = invoiceFor(canonical);
  const copyBefore = structuredClone(invoice);
  const first = serializeUblInvoice(invoice);
  const second = serializeUblInvoice(invoice);
  assert.deepEqual(first, second);
  assert.deepEqual(invoice, copyBefore, 'serializing leaves the invoice as it was');
});

test('the typed scale of quantity and unit price is written as typed, without grouping or exponent', () => {
  const input = withValue(loadFixtureInput('a-simple'), 'lines', [
    { name: 'x', unitCode: 'C62', quantity: '2.50', unitPrice: '1234567.890', vatCategory: 'S', vatRate: '19.00' },
  ]);
  const line = one(parseXml(xmlFor(input)), 'cac:InvoiceLine');
  assert.equal(textAt(line, 'cbc:InvoicedQuantity'), '2.50');
  assert.equal(textAt(line, 'cac:Price/cbc:PriceAmount'), '1234567.890');
  assert.equal(textAt(line, 'cac:Item/cac:ClassifiedTaxCategory/cbc:Percent'), '19');
});

// ------------------------------------------------------------------------------------------- escaping

test('markup characters and quotes in text are escaped and round-trip; non-ASCII stays UTF-8', () => {
  const name = 'Müller & Söhne <GmbH> "Q" \'s\' Preis in € 😀';
  const input = withValue(withValue(loadFixtureInput('a-simple'), 'buyer.name', name), 'lines.0.name', `<b>${name}</b>`);
  const xml = xmlFor(input);
  assert.ok(xml.includes('Müller &amp; Söhne &lt;GmbH&gt;'), 'ampersand and angle brackets are escaped in text');
  assert.equal(xml.includes('<b>'), false, 'no markup leaks from input text');
  assert.ok(xml.includes('€ 😀'), 'non-ASCII characters are written as themselves');
  const root = parseXml(xml);
  assert.equal(textAt(root, 'cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName'), name);
  assert.equal(select(root, 'cac:InvoiceLine/cac:Item/cbc:Name')[0]?.text, `<b>${name}</b>`);
});

// ------------------------------------------------------------------------------------------- runtime protection

test('an invoice that buildInvoice did not produce cannot be serialized, however it was made', () => {
  const genuine = invoiceFor(loadFixtureInput('a-simple'));
  const fabricated: unknown[] = [
    { ...genuine },
    structuredClone(genuine),
    Object.create(genuine),
    JSON.parse(JSON.stringify({ ...genuine, lines: [], totals: {} })),
    {},
    null,
    undefined,
    'text',
    42,
    [],
  ];
  for (const candidate of fabricated) {
    const result = serializeUblInvoice(candidate as Invoice);
    assert.deepEqual(result, { ok: false, errors: [{ code: 'unvalidated_invoice', path: '' }] });
    assert.equal('xml' in result, false);
  }
  assert.equal(serializeUblInvoice(genuine).ok, true);
});

// ------------------------------------------------------------------------------------------- golden files

// tests/fixtures/xrechnung/golden/*.xml are the exact bytes that the local KoSIT run validated (npm run test:kosit,
// which also requires them to equal the generated XML). They pin the output against unintended change. They are a
// regression guard, not the oracle for amounts: the oracle is the independently worked values checked above.
for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: the generated XML equals the committed golden file byte for byte`, () => {
    assert.equal(xmlFor(loadFixtureInput(name)), readFileSync(`tests/fixtures/xrechnung/golden/${name}.xml`, 'utf8'));
  });
}
