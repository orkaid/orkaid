import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { PROVISIONAL_MAX_TEXT_LENGTH, buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, parseXml, select, textAt, type XmlNode } from '../support/xml.ts';

// Project, contract and purchase order references BT-11, BT-12, BT-13 (MDR-36): independent optional business facts,
// each 0..1, plain text, on a 380 and on a 381. BT-10 is a separate fact and is unchanged. Element paths come from the
// SeMoX CIUS model (bindings ubl-inv, ubl-cn, cii) and the XSD sequences of the KoSIT configuration 2026-08-31. The
// project reference of a UBL credit note is the one binding the XRechnung model leaves open: it is written as an
// AdditionalDocumentReference with DocumentTypeCode 50, an explicit Orkaid choice that follows the OpenPeppol BIS Billing
// documentation, not a requirement of XRechnung itself.

const invoiceInput = () => loadFixtureInput('x-references-all-three');
const creditNoteInput = () => loadFixtureInput('y-credit-note-references-all-three');
const golden = (file: string) => readFileSync(new URL(`../fixtures/xrechnung/golden/${file}`, import.meta.url), 'utf8');
const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));

function built(input: JsonObject) {
  const result = buildInvoice(input);
  assert.equal(result.ok, true, show(result));
  return result.ok ? result.value : assert.fail('unreachable');
}
const pairs = (input: unknown) => {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected failure');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
};
const ubl = (input: JsonObject): XmlNode => {
  const result = serializeUblInvoice(built(input));
  return parseXml(result.ok ? result.xml : assert.fail('serialization failed'));
};
const cii = (input: JsonObject): XmlNode => {
  const result = serializeCiiInvoice(built(input));
  return parseXml(result.ok ? result.xml : assert.fail('serialization failed'));
};

const FIELDS = ['projectReference', 'contractReference', 'orderReference'] as const;

// ------------------------------------------------------------------------------------------- the semantic fields

test('BT-11, BT-12 and BT-13 are carried as independent optional facts on a 380 and on a 381', () => {
  for (const input of [invoiceInput(), creditNoteInput()]) {
    const invoice = built(input);
    assert.equal(invoice.projectReference, 'PRJ-2026-77');
    assert.equal(invoice.contractReference, 'VT-2026/12');
    assert.equal(invoice.orderReference, 'PO-4711');
    assert.equal(invoice.buyerReference, 'PO-2026-0815'); // BT-10 is a different fact and keeps its own value
  }
});

test('each reference works alone, and an absent reference leaves no key on the validated document', () => {
  for (const kept of FIELDS) {
    let input = invoiceInput();
    for (const other of FIELDS.filter((f) => f !== kept)) input = withoutValue(input, other);
    const invoice = built(input);
    for (const field of FIELDS) assert.equal(field in invoice, field === kept, `${field} with only ${kept}`);
  }
  const none = built(FIELDS.reduce((input, field) => withoutValue(input, field), invoiceInput()));
  for (const field of FIELDS) assert.equal(field in none, false);
});

test('no reference is derived from, defaulted to or checked against another field, and BT-10 stays required', () => {
  const invoice = built(withValue(invoiceInput(), 'orderReference', 'PO-2026-0815')); // same text as BT-10: allowed, not merged
  assert.equal(invoice.orderReference, invoice.buyerReference);
  assert.deepEqual(pairs(withoutValue(invoiceInput(), 'buyerReference')), ['missing_field@buyerReference']);
});

test('an invalid reference is rejected with a diagnostic at its own path', () => {
  for (const field of FIELDS) {
    assert.deepEqual(pairs(withValue(invoiceInput(), field, '')), [`empty_text@${field}`]);
    assert.deepEqual(pairs(withValue(invoiceInput(), field, '  ')), [`empty_text@${field}`]);
    assert.deepEqual(pairs(withValue(invoiceInput(), field, ' PRJ-1')), [`invalid_text@${field}`]);
    assert.deepEqual(pairs(withValue(invoiceInput(), field, 'PRJ\n1')), [`invalid_text@${field}`]);
    assert.deepEqual(pairs(withValue(invoiceInput(), field, 'x'.repeat(PROVISIONAL_MAX_TEXT_LENGTH + 1))), [`text_too_long@${field}`]);
    assert.deepEqual(pairs(withValue(invoiceInput(), field, 7)), [`invalid_type@${field}`]);
    assert.deepEqual(pairs(withValue(invoiceInput(), field, null)), [`invalid_type@${field}`]);
    assert.equal(buildInvoice(withValue(invoiceInput(), field, 'x'.repeat(PROVISIONAL_MAX_TEXT_LENGTH))).ok, true);
  }
});

test('a repeated reference is rejected: there is never more than one project, contract or order reference', () => {
  for (const field of FIELDS) {
    assert.deepEqual(pairs(withValue(invoiceInput(), field, ['PRJ-1', 'PRJ-2'])), [`invalid_type@${field}`]);
    assert.deepEqual(pairs(withValue(creditNoteInput(), field, ['PRJ-1'])), [`invalid_type@${field}`]);
  }
});

test('the references are frozen into the validated document and independent of later changes to the input', () => {
  const input = invoiceInput();
  const invoice = built(input);
  input.projectReference = 'CHANGED';
  assert.equal(invoice.projectReference, 'PRJ-2026-77');
});

// ------------------------------------------------------------------------------------------- UBL Invoice

test('UBL Invoice: OrderReference, ContractDocumentReference and ProjectReference in XSD order, each with only an ID', () => {
  const root = ubl(invoiceInput());
  assert.equal(textAt(root, 'cac:OrderReference/cbc:ID'), 'PO-4711'); // BT-13
  assert.equal(textAt(root, 'cac:ContractDocumentReference/cbc:ID'), 'VT-2026/12'); // BT-12
  assert.equal(textAt(root, 'cac:ProjectReference/cbc:ID'), 'PRJ-2026-77'); // BT-11
  for (const name of ['cac:OrderReference', 'cac:ContractDocumentReference', 'cac:ProjectReference']) {
    assert.deepEqual(childNames(select(root, name)[0] as XmlNode), ['cbc:ID']);
    assert.equal(select(root, name).length, 1);
  }
  assert.equal(textAt(root, 'cbc:BuyerReference'), 'PO-2026-0815'); // BT-10 unchanged
  // UBL-Invoice-2.1.xsd: BuyerReference, OrderReference, ContractDocumentReference, ProjectReference, AccountingSupplierParty.
  const names = childNames(root);
  const at = (name: string) => names.indexOf(name);
  assert.ok(at('cbc:BuyerReference') < at('cac:OrderReference') && at('cac:OrderReference') < at('cac:ContractDocumentReference'));
  assert.ok(at('cac:ContractDocumentReference') < at('cac:ProjectReference') && at('cac:ProjectReference') < at('cac:AccountingSupplierParty'));
  assert.equal(select(root, 'cac:AdditionalDocumentReference').length, 0);
});

// ------------------------------------------------------------------------------------------- UBL CreditNote

test('UBL CreditNote: BT-12 and BT-13 as for an Invoice, in the CreditNote sequence after BillingReference', () => {
  const root = ubl(creditNoteInput());
  assert.equal(root.name, 'CreditNote');
  assert.equal(textAt(root, 'cac:OrderReference/cbc:ID'), 'PO-4711');
  assert.equal(textAt(root, 'cac:ContractDocumentReference/cbc:ID'), 'VT-2026/12');
  // UBL-CreditNote-2.1.xsd: BuyerReference, OrderReference, BillingReference, ContractDocumentReference, AdditionalDocumentReference.
  const names = childNames(root);
  const at = (name: string) => names.indexOf(name);
  assert.ok(at('cbc:BuyerReference') < at('cac:OrderReference') && at('cac:OrderReference') < at('cac:BillingReference'));
  assert.ok(at('cac:BillingReference') < at('cac:ContractDocumentReference') && at('cac:ContractDocumentReference') < at('cac:AdditionalDocumentReference'));
  assert.ok(at('cac:AdditionalDocumentReference') < at('cac:AccountingSupplierParty'));
  assert.equal(select(root, 'cac:ProjectReference').length, 0); // a CreditNote has no ProjectReference element
});

test('UBL CreditNote: the project reference is one AdditionalDocumentReference with only ID and DocumentTypeCode 50', () => {
  const root = ubl(creditNoteInput());
  const documents = select(root, 'cac:AdditionalDocumentReference');
  assert.equal(documents.length, 1);
  assert.deepEqual(childNames(documents[0] as XmlNode), ['cbc:ID', 'cbc:DocumentTypeCode']);
  assert.equal(textAt(documents[0] as XmlNode, 'cbc:ID'), 'PRJ-2026-77');
  assert.equal(textAt(documents[0] as XmlNode, 'cbc:DocumentTypeCode'), '50');
  // It is distinguishable from a BG-24 supporting document, which carries no type code (OpenPeppol BIS Billing): the
  // project reference is exactly the AdditionalDocumentReference selected by DocumentTypeCode 50, and none is left without a code.
  const projects = documents.filter((d) => select(d, 'cbc:DocumentTypeCode').some((c) => c.text === '50'));
  assert.deepEqual(projects.map((d) => textAt(d, 'cbc:ID')), ['PRJ-2026-77']);
  assert.equal(documents.filter((d) => select(d, 'cbc:DocumentTypeCode').length === 0).length, 0);
  assert.equal(select(root, 'cac:Attachment').length + select(root, 'cbc:DocumentDescription').length, 0); // no BG-24
});

test('a credit note without a project reference writes no AdditionalDocumentReference', () => {
  const root = ubl(withoutValue(creditNoteInput(), 'projectReference'));
  assert.equal(select(root, 'cac:AdditionalDocumentReference').length, 0);
});

// ------------------------------------------------------------------------------------------- CII

test('CII: the three references in XSD order after the buyer, for a 380 and for a 381 alike', () => {
  for (const input of [invoiceInput(), creditNoteInput()]) {
    const root = cii(input);
    const agreement = select(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement')[0] as XmlNode;
    assert.deepEqual(childNames(agreement), ['ram:BuyerReference', 'ram:SellerTradeParty', 'ram:BuyerTradeParty', 'ram:BuyerOrderReferencedDocument', 'ram:ContractReferencedDocument', 'ram:SpecifiedProcuringProject']);
    assert.equal(textAt(agreement, 'ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID'), 'PO-4711'); // BT-13
    assert.equal(textAt(agreement, 'ram:ContractReferencedDocument/ram:IssuerAssignedID'), 'VT-2026/12'); // BT-12
    assert.deepEqual(childNames(select(agreement, 'ram:SpecifiedProcuringProject')[0] as XmlNode), ['ram:ID', 'ram:Name']);
    assert.equal(textAt(agreement, 'ram:SpecifiedProcuringProject/ram:ID'), 'PRJ-2026-77'); // BT-11
    assert.equal(textAt(agreement, 'ram:SpecifiedProcuringProject/ram:Name'), 'Project reference');
    assert.equal(textAt(agreement, 'ram:BuyerReference'), 'PO-2026-0815'); // BT-10 unchanged
  }
});

test('CII: an absent reference writes no element', () => {
  const root = cii(FIELDS.reduce((input, field) => withoutValue(input, field), invoiceInput()));
  const agreement = select(root, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement')[0] as XmlNode;
  assert.deepEqual(childNames(agreement), ['ram:BuyerReference', 'ram:SellerTradeParty', 'ram:BuyerTradeParty']);
});

test('UBL and CII carry the same three values for each document', () => {
  for (const input of [invoiceInput(), creditNoteInput()]) {
    const u = ubl(input);
    const c = cii(input);
    const fromUbl = [
      textAt(u, 'cac:OrderReference/cbc:ID'),
      textAt(u, 'cac:ContractDocumentReference/cbc:ID'),
      u.name === 'CreditNote' ? textAt(u, 'cac:AdditionalDocumentReference/cbc:ID') : textAt(u, 'cac:ProjectReference/cbc:ID'),
    ];
    const fromCii = [
      textAt(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID'),
      textAt(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:ContractReferencedDocument/ram:IssuerAssignedID'),
      textAt(c, 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SpecifiedProcuringProject/ram:ID'),
    ];
    assert.deepEqual(fromUbl, ['PO-4711', 'VT-2026/12', 'PRJ-2026-77']);
    assert.deepEqual(fromCii, fromUbl);
  }
});

test('the committed golden files equal the generated documents', () => {
  const documents: [string, JsonObject][] = [['x-references-all-three', invoiceInput()], ['y-credit-note-references-all-three', creditNoteInput()]];
  for (const [name, input] of documents) {
    const invoice = built(input);
    const u = serializeUblInvoice(invoice);
    const c = serializeCiiInvoice(invoice);
    assert.equal(u.ok && u.xml, golden(`${name}.xml`));
    assert.equal(c.ok && c.xml, golden(`${name}.cii.xml`));
  }
});
