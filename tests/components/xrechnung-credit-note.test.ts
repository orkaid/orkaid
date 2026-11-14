import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { navigationTarget, placementOf } from '../../src/components/tools/xrechnung/diagnostic-placement.ts';
import {
  buildDocumentInput, buildMonetaryInput, checkForm, exportXml, fieldValues, previewTotals,
} from '../../src/components/tools/xrechnung/form-adapter.ts';
import {
  CLEARING_CONFIRMATION_ID, CREDIT_TRANSFER_FIELD_IDS, emptyFormState, PRECEDING_INVOICE_FIELD_IDS, REQUIRED_FIELD_IDS, REQUIRED_FIELD_IDS_381,
  selectDocumentType, type FormState,
} from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, errorMessages, labelFor, scopeLists } from '../../src/i18n/xrechnung.ts';
import { helpEntries } from '../../src/i18n/xrechnung-help.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';

// Credit note 381 in the Rechnungsblatt (MDR-49). The adapter owns no rule: these tests are about what it sends to the frozen
// domain for each document type, and how the answer is placed. Every value is fictional.

const locales = ['de', 'en'] as const;
const IBAN = 'DE79000000001234567890';

function invoiceState(): FormState {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'GS-2026-0001', issueDate: '14.11.2026', deliveryDate: '01.11.2026', buyerReference: 'BR-4711',
    'seller.name': 'Muster GmbH', 'seller.address.street': 'Musterstraße 1', 'seller.address.postCode': '10115', 'seller.address.city': 'Berlin',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@muster.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 30 1234567', 'seller.contact.email': 'erika@muster.example',
    'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel AG', 'buyer.address.street': 'Beispielweg 2', 'buyer.address.postCode': '80331', 'buyer.address.city': 'München',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'einkauf@beispiel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': IBAN, 'payment.means.account.name': 'Muster GmbH', 'payment.means.account.bic': 'COBADEFFXXX',
    'payment.dueDate': '05.12.2026',
  });
  state.lines = [
    { name: 'Beratung', unitCode: 'HUR', quantity: '10', unitPrice: '95', vatRate: '19' },
    { name: 'Handbuch', unitCode: 'C62', quantity: '2', unitPrice: '12,50', vatRate: '7' },
  ];
  return state;
}

function creditNoteState(confirmed = true): FormState {
  const state = invoiceState();
  selectDocumentType(state, '381');
  state.fields['precedingInvoice.number'] = 'RE-2026-0042';
  state.clearingConfirmed = confirmed;
  return state;
}

const payment = (input: Record<string, unknown>) => input.payment as Record<string, unknown>;

test('a fresh form is an invoice 380 with no clearing confirmation; nothing about a credit note is preselected', () => {
  const state = emptyFormState();
  assert.equal(state.documentType, '380');
  assert.equal(state.clearingConfirmed, false);
  for (const id of PRECEDING_INVOICE_FIELD_IDS) assert.equal(state.fields[id], '');
});

test('a 380 never sends BG-3 or a settlement, whatever was typed for a credit note before switching back', () => {
  const state = invoiceState();
  selectDocumentType(state, '381');
  state.fields['precedingInvoice.number'] = 'RE-2026-0042';
  state.fields['precedingInvoice.issueDate'] = '01.10.2026';
  state.clearingConfirmed = true;
  selectDocumentType(state, '380');
  state.clearingConfirmed = true; // even a confirmation set by other means is not read on a 380
  const input = buildDocumentInput(state);
  assert.equal(input.documentTypeCode, '380');
  assert.ok(!('precedingInvoice' in input));
  assert.ok(!('settlement' in payment(input)));
  assert.deepEqual(input, buildDocumentInput(invoiceState()));
  assert.equal(buildMonetaryInput(state).documentTypeCode, '380');
  assert.ok(checkForm(state).ok);
});

test('a 381 sends BT-3 381, exactly one BG-3 and a clearing, and never a payment means or any credit-transfer field', () => {
  const input = buildDocumentInput(creditNoteState());
  assert.equal(input.documentTypeCode, '381');
  assert.deepEqual(input.precedingInvoice, { number: 'RE-2026-0042' });
  assert.deepEqual(payment(input), { dueDate: '2026-12-05', settlement: { kind: 'clearing', reciprocalObligationConfirmed: true } });
  assert.ok(!JSON.stringify(input).includes(IBAN));
  assert.ok(!JSON.stringify(input).includes('COBADEFFXXX'));
  assert.equal(buildMonetaryInput(creditNoteState()).documentTypeCode, '381');
});

test('BT-26 is sent only when entered, canonical; BT-25 is required and BT-26 is not', () => {
  const state = creditNoteState();
  state.fields['precedingInvoice.issueDate'] = '01.10.2026';
  assert.deepEqual(buildDocumentInput(state).precedingInvoice, { number: 'RE-2026-0042', issueDate: '2026-10-01' });
  assert.ok(checkForm(state).ok);
  state.fields['precedingInvoice.issueDate'] = '';
  assert.ok(checkForm(state).ok, 'BT-26 is optional');
  state.fields['precedingInvoice.number'] = '';
  const result = checkForm(state);
  assert.ok(!result.ok);
  const item = result.items.find((entry) => entry.path === 'precedingInvoice.number');
  assert.equal(item?.code, 'missing_field');
  assert.equal(item?.kind, 'missing');
  assert.deepEqual(placementOf(item!), { at: 'field', id: 'precedingInvoice.number' });
  assert.equal(navigationTarget(item!), 'precedingInvoice.number');
});

test('every field marked required on a 381 is answered missing_field when empty; the credit-transfer fields are not demanded', () => {
  const state = emptyFormState();
  selectDocumentType(state, '381');
  const result = checkForm(state);
  assert.ok(!result.ok);
  const missing = result.items.filter((item) => item.code === 'missing_field').map((item) => item.path);
  for (const id of REQUIRED_FIELD_IDS_381) assert.ok(missing.includes(id), `${id} should be reported missing_field`);
  for (const id of [...CREDIT_TRANSFER_FIELD_IDS, 'precedingInvoice.issueDate']) assert.ok(!result.items.some((item) => item.path === id), `${id} must not be reported`);
  assert.ok(!REQUIRED_FIELD_IDS.includes('precedingInvoice.number'));
});

test('clearing cannot be bypassed: unconfirmed, the domain refuses and export is blocked; confirmed, code 97 is written without BG-17', () => {
  const unconfirmed = creditNoteState(false);
  assert.deepEqual(payment(buildDocumentInput(unconfirmed)).settlement, { kind: 'clearing' });
  const result = checkForm(unconfirmed);
  assert.ok(!result.ok);
  assert.equal(result.items.length, 1);
  const item = result.items[0]!;
  assert.equal(item.code, 'missing_clearing_confirmation');
  assert.equal(item.path, CLEARING_CONFIRMATION_ID);
  assert.equal(item.kind, 'missing');
  assert.deepEqual(placementOf(item), { at: 'field', id: CLEARING_CONFIRMATION_ID });
  assert.equal(navigationTarget(item), CLEARING_CONFIRMATION_ID);
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(unconfirmed, format);
    assert.ok(!out.ok && out.reason === 'invalid', format);
  }
  const ubl = exportXml(creditNoteState(), 'ubl');
  const cii = exportXml(creditNoteState(), 'cii');
  assert.ok(ubl.ok && cii.ok);
  assert.match(ubl.xml, /^<CreditNote /m);
  assert.match(ubl.xml, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.match(ubl.xml, /<cbc:PaymentMeansCode>97<\/cbc:PaymentMeansCode>/);
  assert.match(ubl.xml, /<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>RE-2026-0042<\/cbc:ID>/);
  assert.doesNotMatch(ubl.xml, /PayeeFinancialAccount|DE79000000001234567890/);
  assert.match(cii.xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.match(cii.xml, /<ram:TypeCode>97<\/ram:TypeCode>/);
  assert.match(cii.xml, /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>RE-2026-0042<\/ram:IssuerAssignedID>/);
  assert.doesNotMatch(cii.xml, /PayeePartyCreditorFinancialAccount|DE79000000001234567890/);
});

test('every change of document type withdraws the confirmation, in both directions; selecting the same type changes nothing', () => {
  const state = creditNoteState(true);
  selectDocumentType(state, '381');
  assert.equal(state.clearingConfirmed, true, 'no change, nothing withdrawn');
  selectDocumentType(state, '380');
  assert.equal(state.clearingConfirmed, false);
  state.clearingConfirmed = true;
  selectDocumentType(state, '381');
  assert.equal(state.clearingConfirmed, false);
  assert.ok(!checkForm(state).ok, 'a returned 381 must be confirmed again');
});

test('values of the inactive type stay in the form, never reach the domain, and return with their type', () => {
  const state = creditNoteState();
  state.fields['precedingInvoice.issueDate'] = '01.10.2026';
  const typedBg3 = { ...state.fields };
  selectDocumentType(state, '380');
  const values380 = fieldValues(state);
  for (const id of PRECEDING_INVOICE_FIELD_IDS) assert.ok(!(id in values380), `${id} inactive on a 380`);
  assert.ok(!(CLEARING_CONFIRMATION_ID in values380));
  assert.equal(values380['payment.means.account.id.value'], IBAN);
  assert.deepEqual(state.fields, typedBg3, 'nothing typed is cleared');
  selectDocumentType(state, '381');
  const values381 = fieldValues(state);
  for (const id of CREDIT_TRANSFER_FIELD_IDS) assert.ok(!(id in values381), `${id} inactive on a 381`);
  assert.equal(values381['precedingInvoice.number'], 'RE-2026-0042');
  assert.equal(values381[CLEARING_CONFIRMATION_ID], '');
  state.clearingConfirmed = true;
  assert.equal(fieldValues(state)[CLEARING_CONFIRMATION_ID], 'confirmed');
  assert.deepEqual(buildDocumentInput(state).precedingInvoice, { number: 'RE-2026-0042', issueDate: '2026-10-01' });
});

test('a 381 is calculated exactly like a 380 with the same lines: the totals are the domain values, positive', () => {
  const invoice = previewTotals(invoiceState());
  const credit = previewTotals(creditNoteState());
  assert.ok(invoice.ok && credit.ok);
  assert.deepEqual(credit.totals, invoice.totals);
  const built = checkForm(creditNoteState());
  assert.ok(built.ok);
  assert.deepEqual(built.invoice.totals, credit.totals);
});

test('the 380 exports are unaffected by anything typed for a credit note', () => {
  const plain = invoiceState();
  const visited = invoiceState();
  selectDocumentType(visited, '381');
  visited.fields['precedingInvoice.number'] = 'RE-2026-0042';
  visited.fields['precedingInvoice.issueDate'] = '01.10.2026';
  visited.clearingConfirmed = true;
  selectDocumentType(visited, '380');
  for (const format of ['ubl', 'cii'] as const) {
    const a = exportXml(plain, format);
    const b = exportXml(visited, format);
    assert.ok(a.ok && b.ok);
    assert.equal(b.xml, a.xml, format);
    assert.equal(b.fileName, a.fileName);
  }
});

test('the configurations the interface never sends stay refused by the domain (refund, payment means, clearing on a 380)', () => {
  const base = buildDocumentInput(creditNoteState());
  const withMeans = { ...base, payment: { ...payment(base), means: payment(buildDocumentInput(invoiceState())).means } };
  const codes = (input: Record<string, unknown>) => { const r = buildInvoice(input); return r.ok ? [] : r.errors.map((e) => e.code); };
  assert.ok(codes(withMeans).includes('unsupported_credit_note_payment_means'));
  assert.ok(codes({ ...base, payment: { ...payment(base), settlement: { kind: 'refund-transfer' } } }).includes('unsupported_credit_note_refund_transfer'));
  assert.ok(codes({ ...base, payment: { ...payment(base), settlement: { kind: 'other' } } }).includes('unsupported_credit_note_settlement'));
  const invoice = buildDocumentInput(invoiceState());
  assert.ok(codes({ ...invoice, payment: { ...payment(invoice), settlement: { kind: 'clearing', reciprocalObligationConfirmed: true } } }).includes('unsupported_settlement_on_invoice'));
  assert.ok(codes({ ...invoice, precedingInvoice: { number: 'RE-1' } }).includes('unsupported_preceding_invoice_reference'));
});

test('the labels, the confirmation and its diagnostic exist in both languages; a credit note names its own number and date', () => {
  for (const locale of locales) {
    assert.equal(labelFor('invoiceNumber', locale, '381'), copy['f.cnNumber'][locale]);
    assert.equal(labelFor('issueDate', locale, '381'), copy['f.cnIssueDate'][locale]);
    assert.equal(labelFor('invoiceNumber', locale), copy['f.invoiceNumber'][locale]);
    for (const id of [...PRECEDING_INVOICE_FIELD_IDS, CLEARING_CONFIRMATION_ID]) assert.notEqual(labelFor(id, locale), id, `${id} (${locale})`);
    assert.doesNotMatch(errorMessages.missing_clearing_confirmation[locale], /Außerhalb des unterstützten|Outside what this tool supports/);
    assert.match(describeError('missing_clearing_confirmation', CLEARING_CONFIRMATION_ID, locale), locale === 'de' ? /Rechnung \(380\)/ : /Invoice \(380\)/);
  }
  assert.equal(copy['doctype.380'].de, 'Rechnung (380)');
  assert.equal(copy['doctype.381'].de, 'Kaufmännische Gutschrift (381)');
  assert.equal(copy['doctype.380'].en, 'Invoice (380)');
  assert.equal(copy['doctype.381'].en, 'Credit note (381)');
});

test('scope note: 381 is available with its limits; 384, 389 and the refund stay outside the profile', () => {
  for (const locale of locales) {
    const now = scopeLists.now[locale].join(' | ');
    assert.match(now, /381/);
    assert.match(now, locale === 'de' ? /bestätigter Verrechnung \(Code 97\)/ : /confirmed clearing \(code 97\)/);
    const out = scopeLists.out[locale].join(' | ');
    assert.match(out, /384/);
    assert.match(out, /389/);
    assert.match(out, locale === 'de' ? /Erstattung einer Gutschrift per Überweisung/ : /refunding a credit note by credit transfer/);
    assert.doesNotMatch(scopeLists.core[locale].join(' | '), /381/);
  }
});

// The interface presents a 381 as a commercial credit note only: never as a correction, Storno, refund or recipient acceptance.
const CN_KEYS = ['doctype.legend', 'doctype.380', 'doctype.381', 'doctype.hint', 'doctype.to381', 'doctype.to380', 'sec.cnDocument', 'sheet.cnTitle', 'sheet.cnMeta',
  'grp.preceding', 'grp.precedingHint', 'precedingDateHint', 'grp.supplyHintCn', 'grp.clearing', 'grp.clearingHint', 'clearing.confirm', 'clearing.note',
  'f.cnNumber', 'f.cnIssueDate', 'f.precedingNumber', 'f.precedingDate', 'f.clearingConfirmation'] as const;
const CLAIM = /Storno|storniert|Korrektur|correction|corrected|cancel|Aufhebung|akzeptiert|angenommen|accepted|Erstattung|refund|Steuerberichtigung|tax adjustment/i;
const NEGATED = /\bnicht\b|\bnot\b|\bkein|\bno\b/i;

test('the claim detector rejects a claim and accepts a negated mention (so the scan below can fail)', () => {
  const ok = (text: string) => text.split(/(?<=[.;])\s+/).every((sentence) => !CLAIM.test(sentence) || NEGATED.test(sentence));
  assert.equal(ok('Die Gutschrift storniert die Rechnung.'), false);
  assert.equal(ok('A refund by credit transfer is not supported.'), true);
});

test('no credit note string presents a 381 as a correction, Storno, refund or recipient acceptance; a refund appears only negated', () => {
  const ok = (text: string) => text.split(/(?<=[.;])\s+/).every((sentence) => !CLAIM.test(sentence) || NEGATED.test(sentence));
  for (const key of CN_KEYS) for (const locale of locales) assert.ok(ok(copy[key][locale]), `${key} (${locale}): ${copy[key][locale]}`);
  for (const locale of locales) {
    assert.ok(ok(errorMessages.missing_clearing_confirmation[locale]));
    const cnLine = scopeLists.now[locale].find((line) => line.includes('381'));
    assert.ok(cnLine !== undefined && !CLAIM.test(cnLine), cnLine);
    for (const id of ['precedingInvoice', 'clearing'] as const) {
      const help = helpEntries[id][locale];
      for (const text of [help.short, help.enter, ...(help.profile ?? [])]) assert.ok(ok(text), `${id} (${locale}): ${text}`);
    }
  }
});

test('the BT-25 requirement is stated as an Orkaid profile restriction, and the original invoice is never claimed to be checked', () => {
  for (const locale of locales) {
    assert.match(copy['grp.precedingHint'][locale], locale === 'de' ? /Profil dieses Werkzeugs[^.]*nicht als allgemeine Anforderung von EN 16931/ : /this tool’s profile, not as a general requirement of EN 16931/);
    assert.match(copy['grp.precedingHint'][locale], locale === 'de' ? /ruft die Rechnung nicht ab und prüft weder/ : /does not retrieve the invoice and checks neither/);
    assert.match(helpEntries.precedingInvoice[locale].profile?.[0] ?? '', locale === 'de' ? /keine allgemeine Anforderung von EN 16931/ : /not a general requirement of EN 16931/);
    assert.match(copy['clearing.note'][locale], locale === 'de' ? /prüft sie nicht/ : /does not check it/);
  }
});

// Source-level guards for the workspace (the browser harness checks the rendered behaviour).
const workspace = readFileSync(new URL('../../src/components/tools/xrechnung/XRechnungWorkspace.svelte', import.meta.url), 'utf8');

test('the document type is a native radio group with a legend, changed only through selectDocumentType', () => {
  assert.match(workspace, /<fieldset class="doctype"[^>]*>\s*<legend>\{copy\['doctype\.legend'\]\[locale\]\}<\/legend>/);
  assert.match(workspace, /<input id=\{`documentType\.\$\{type\}`\} type="radio" name="documentType" value=\{type\} checked=\{form\.documentType === type\} onchange=\{\(\) => changeType\(type\)\} \/>/);
  assert.doesNotMatch(workspace, /bind:group=\{form\.documentType\}/, 'bind:group would bypass the confirmation reset');
  assert.match(workspace, /function changeType\(type: DocumentType\): void \{[\s\S]*?selectDocumentType\(form, type\);[\s\S]*?delete touched\[CLEARING_CONFIRMATION_ID\];[\s\S]*?announcement = /);
  assert.equal((workspace.match(/documentType = /g) ?? []).length, 0, 'no other assignment of the document type');
});

test('on a 381 the credit-transfer fields are not rendered and the confirmation is an unticked native checkbox', () => {
  const payment = /\{#snippet bodyPayment\(\)\}([\s\S]*?)\{\/snippet\}/.exec(workspace)?.[1] ?? '';
  const [cn, invoice] = payment.split('{:else}');
  assert.ok(cn && invoice);
  assert.doesNotMatch(cn, /payment\.means/);
  assert.match(cn, /<input id=\{CLEARING_CONFIRMATION_ID\} type="checkbox" bind:checked=\{form\.clearingConfirmed\}/);
  assert.doesNotMatch(cn, /checked=\{true\}/);
  assert.match(invoice, /payment\.means\.code/);
  const document = /\{#snippet bodyDocument\(\)\}([\s\S]*?)\{\/snippet\}/.exec(workspace)?.[1] ?? '';
  assert.match(document, /\{#if creditNote\}[\s\S]*?precedingInvoice\.number[\s\S]*?precedingInvoice\.issueDate[\s\S]*?\{\/if\}/);
  // BG-3 follows the document identification fields.
  assert.ok(document.indexOf("'issueDate'") < document.indexOf("'precedingInvoice.number'"));
  assert.ok(document.indexOf("'precedingInvoice.number'") < document.indexOf('grp.supply'));
});
