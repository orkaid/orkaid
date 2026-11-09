import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildDocumentInput, buildMonetaryInput, checkForm, countByKind, exportXml, fieldValues, fileNameFor, previewTotals, sectionOf, toDiagnosticItems,
} from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState, emptyLine, REQUIRED_FIELD_IDS, type FormState } from '../../src/components/tools/xrechnung/form-state.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { formatLocalizedDecimal } from '../../src/lib/domain/xrechnung/number-notation.ts';

// The adapter owns no rule: every expectation here is about what it sends to the domain and how it presents the answer.

const IBAN = 'DE79000000001234567890'; // the valid IBAN used by the domain's own payment tests

function validState(): FormState {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'RE-2026-0001', issueDate: '05.11.2026', deliveryDate: '01.11.2026', buyerReference: 'BR-4711',
    'seller.name': 'Muster GmbH', 'seller.address.street': 'Musterstraße 1', 'seller.address.postCode': '10115', 'seller.address.city': 'Berlin',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@muster.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 30 1234567', 'seller.contact.email': 'erika@muster.example',
    'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel AG', 'buyer.address.street': 'Beispielweg 2', 'buyer.address.postCode': '80331', 'buyer.address.city': 'München',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'einkauf@beispiel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': IBAN, 'payment.dueDate': '05.12.2026',
  });
  state.lines = [
    { name: 'Beratung', unitCode: 'HUR', quantity: '10', unitPrice: '95', vatRate: '19' },
    { name: 'Handbuch', unitCode: 'C62', quantity: '2', unitPrice: '12,50', vatRate: '7' },
  ];
  return state;
}

const items = (state: FormState) => {
  const result = checkForm(state);
  return result.ok ? assert.fail('expected diagnostics') : result.items;
};

test('every field marked required is answered `missing_field` by the domain when empty, so the asterisks cannot drift', () => {
  const found = items(emptyFormState()).filter((item) => item.code === 'missing_field').map((item) => item.path);
  for (const id of REQUIRED_FIELD_IDS) assert.ok(found.includes(id), `${id} should be reported missing_field`);
  // ...and nothing the form calls optional is demanded as a field of its own.
  const optional = ['seller.vatId', 'seller.taxRegistrationId', 'seller.legalRegistrationId', 'seller.sellerIdentifiers[0]', 'buyer.vatId',
    'payment.means.account.name', 'payment.means.account.bic', 'payment.dueDate', 'payment.termsText', 'notes[0].text'];
  for (const id of optional) assert.ok(!found.includes(id), `${id} must not be reported as a required field`);
});

test('group rules are reported at section level and mapped to the first field of the group', () => {
  const byCode = new Map(items(emptyFormState()).map((item) => [item.code, item]));
  assert.equal(byCode.get('missing_seller_tax_identifier')?.fieldId, 'seller.vatId');
  assert.equal(byCode.get('missing_seller_identification')?.fieldId, 'seller.vatId');
  assert.equal(byCode.get('missing_seller_identification')?.kind, 'missing');
});

test('a monetary field left empty is shown as missing although the domain answers invalid_decimal / unsupported_vat_rate', () => {
  const all = items(emptyFormState());
  const q = all.find((item) => item.path === 'lines[0].quantity');
  const r = all.find((item) => item.path === 'lines[0].vat.rate');
  assert.equal(q?.code, 'invalid_decimal');
  assert.equal(q?.kind, 'missing');
  assert.equal(r?.code, 'unsupported_vat_rate');
  assert.equal(r?.kind, 'missing');
});

test('a filled but malformed value is invalid, never missing, and is never trimmed or repaired', () => {
  const state = validState();
  state.fields['seller.name'] = ' Muster GmbH'; // leading space: the domain refuses, the UI must not silently fix it
  state.fields['seller.vatId'] = 'DE12';
  state.fields['payment.means.account.id.value'] = 'DE00 0000';
  state.lines[0].unitPrice = '1,5x';
  const byPath = new Map(items(state).map((item) => [item.path, item]));
  assert.deepEqual([byPath.get('seller.name')?.code, byPath.get('seller.name')?.kind], ['invalid_text', 'invalid']);
  assert.deepEqual([byPath.get('seller.vatId')?.code, byPath.get('seller.vatId')?.kind], ['invalid_vat_id', 'invalid']);
  assert.deepEqual([byPath.get('payment.means.account.id.value')?.code, byPath.get('payment.means.account.id.value')?.kind], ['invalid_iban', 'invalid']);
  assert.equal(byPath.get('lines[0].unitPrice')?.kind, 'invalid');
  assert.equal(buildDocumentInput(state).seller && (buildDocumentInput(state).seller as Record<string, unknown>).name, ' Muster GmbH');
});

test('empty optional fields are omitted from the domain input, never sent as empty text', () => {
  const input = buildDocumentInput(validState());
  const seller = input.seller as Record<string, unknown>;
  const account = ((input.payment as Record<string, unknown>).means as Record<string, unknown>).account as Record<string, unknown>;
  for (const key of ['taxRegistrationId', 'legalRegistrationId', 'sellerIdentifiers']) assert.ok(!(key in seller), key);
  assert.ok(!('bic' in account) && !('name' in account));
  assert.ok(!('notes' in input));
  assert.ok(!('termsText' in (input.payment as Record<string, unknown>)));
  assert.equal(input.documentTypeCode, '380');
  assert.equal(input.currency, 'EUR');
});

test('a valid form builds, exports both syntaxes and rejects the same form once it is edited', () => {
  const state = validState();
  const checked = checkForm(state);
  assert.ok(checked.ok);
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(state, format);
    assert.ok(out.ok, `${format} should export`);
    assert.match(out.xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.equal(out.fileName, `RE-2026-0001-${format}.xml`);
  }
  assert.match((exportXml(state, 'ubl') as { xml: string }).xml, /<Invoice /);
  assert.match((exportXml(state, 'cii') as { xml: string }).xml, /CrossIndustryInvoice/);
  state.fields.buyerReference = '';
  const stale = exportXml(state, 'ubl');
  assert.equal(stale.ok, false); // export always re-validates the current form
});

test('preview totals equal the totals of the successful build for the same typed (German) input', () => {
  const state = validState();
  const built = buildInvoice(buildDocumentInput(state));
  assert.ok(built.ok);
  const preview = previewTotals(state);
  assert.ok(preview.ok);
  assert.deepEqual(preview.totals, built.value.totals);
  // The canonical point notation is not an accepted way to type a price: it is refused instead of being read.
  const dotted = validState();
  dotted.lines[1].unitPrice = '12.50';
  assert.equal(previewTotals(dotted).ok, false);
});

test('the preview carries only the monetary subset and is unavailable while a line is incomplete', () => {
  const state = validState();
  for (const line of (buildMonetaryInput(state).lines as Record<string, unknown>[])) assert.deepEqual(Object.keys(line).sort(), ['quantity', 'unitPrice', 'vat']);
  state.lines.push(emptyLine());
  assert.equal(previewTotals(state).ok, false); // never a partial figure
});

test('totals are displayed in German notation on both routes, without changing the amount', () => {
  const state = validState();
  const preview = previewTotals(state);
  assert.ok(preview.ok);
  assert.equal(formatLocalizedDecimal(preview.totals.totalWithoutVat, 'de'), '975,00');
  assert.equal(formatLocalizedDecimal({ units: 123456789n, scale: 2 }, 'de'), '1.234.567,89');
  for (const file of ['SummaryRail.svelte', 'LinesEditor.svelte', 'XRechnungWorkspace.svelte']) {
    const source = readFileSync(new URL(`../../src/components/tools/xrechnung/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /formatLocalizedDecimal\([^)]*locale\)/, file);
    assert.match(source, /formatLocalizedDecimal\([^)]*'de'\)/, file);
  }
});

test('line diagnostics use the index of the line as typed, including after the first line', () => {
  const state = validState();
  state.lines[1].quantity = '';
  state.lines[1].unitCode = 'XXX';
  const byPath = new Map(items(state).map((item) => [item.path, item]));
  assert.equal(byPath.get('lines[1].quantity')?.kind, 'missing');
  assert.equal(byPath.get('lines[1].unitCode')?.code, 'unsupported_unit_code');
  assert.ok(Object.keys(fieldValues(state)).includes('lines[1].vat.rate'));
});

// Slice 3 (MDR-44, no line treatment preselected): the rate is no longer repeated; the unit still is.
test('a new line repeats only the unit the user already chose, never the VAT rate', () => {
  assert.deepEqual(emptyLine({ name: 'a', unitCode: 'HUR', quantity: '3', unitPrice: '4', vatRate: '7' }), { name: '', unitCode: 'HUR', quantity: '', unitPrice: '', vatRate: '' });
  assert.deepEqual(emptyLine(), { name: '', unitCode: '', quantity: '', unitPrice: '', vatRate: '' });
});

test('counts and the truncation marker', () => {
  const counts = countByKind(items(emptyFormState()));
  assert.ok(counts.missing > 20);
  assert.equal(counts.internal, 0);
  assert.deepEqual(toDiagnosticItems([{ code: 'error_list_truncated', path: 'lines[100]' }], {}), []);
});

test('file names are reduced to safe characters, never hidden, with a fallback', () => {
  assert.equal(fileNameFor('RE/2026 0001', 'ubl'), 'RE_2026_0001-ubl.xml');
  assert.equal(fileNameFor('..\\evil', 'cii'), '_evil-cii.xml');
  assert.equal(fileNameFor('', 'ubl'), 'xrechnung-ubl.xml');
  assert.equal(fileNameFor('äöü', 'ubl'), '___-ubl.xml');
});

test('notes are sent as one structured note only when text is present', () => {
  const state = validState();
  state.fields['notes[0].text'] = 'Zahlbar ohne Abzug.';
  assert.deepEqual(buildDocumentInput(state).notes, [{ text: 'Zahlbar ohne Abzug.' }]);
  assert.ok(checkForm(state).ok);
});

test('sections follow the form: the buyer reference belongs to the invoice details, not to the buyer', () => {
  assert.equal(sectionOf('buyerReference'), 'document');
  assert.equal(sectionOf('buyer.name'), 'buyer');
  assert.equal(sectionOf('buyer'), 'buyer');
  assert.equal(sectionOf('seller.contact.email'), 'seller');
  assert.equal(sectionOf('lines[2].quantity'), 'lines');
  assert.equal(sectionOf('payment.means.code'), 'payment');
  assert.equal(sectionOf('notes[0].text'), 'notes');
  assert.equal(sectionOf(''), 'general');
  const byPath = new Map(items(emptyFormState()).map((item) => [item.path, item.section]));
  assert.equal(byPath.get('buyerReference'), 'document');
});
