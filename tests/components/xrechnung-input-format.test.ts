import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDocumentInput, buildMonetaryInput, checkForm, exportXml, previewTotals } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { canonicalDate, canonicalDecimal, germanDateFromIso, isoForPicker } from '../../src/components/tools/xrechnung/input-format.ts';
import { emptyFormState, type FormState } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, fill, labelFor } from '../../src/i18n/xrechnung.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { formatDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';

// Input format policy: German entry on both routes (decimal comma, TT.MM.JJJJ), canonical values inside the domain.

function validState(): FormState {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'RE-2026-0003', issueDate: '05.11.2026', deliveryDate: '01.11.2026', buyerReference: 'BR-4711',
    'seller.name': 'Muster GmbH', 'seller.address.street': 'Musterstraße 1', 'seller.address.postCode': '10115', 'seller.address.city': 'Berlin',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@muster.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 30 1234567', 'seller.contact.email': 'erika@muster.example',
    'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel AG', 'buyer.address.street': 'Beispielweg 2', 'buyer.address.postCode': '80331', 'buyer.address.city': 'München',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'einkauf@beispiel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE79000000001234567890', 'payment.dueDate': '05.12.2026',
  });
  state.lines = [{ name: 'Beratung', unitCode: 'HUR', quantity: '2,5', unitPrice: '125,50', vatRate: '19' }];
  return state;
}

const problemFor = (state: FormState, path: string) => {
  const result = checkForm(state);
  return result.ok ? undefined : result.items.find((item) => item.path === path);
};

test('German decimals map exactly to canonical strings, keeping every typed fractional digit', () => {
  const cases: [string, string][] = [
    ['125,50', '125.50'], ['0,75', '0.75'], ['0,1234', '0.1234'], ['0,000001', '0.000001'], ['12', '12'], ['007,50', '007.50'],
    ['1234567,890', '1234567.890'], ['0,10', '0.10'],
  ];
  for (const [typed, canonical] of cases) assert.equal(canonicalDecimal(typed), canonical, typed);
  assert.equal(canonicalDecimal('-3,5'), '-3.5'); // sign kept so the domain answers negative_amount, not "invalid number"
});

test('malformed or ambiguous decimals are rejected, never guessed', () => {
  const bad = ['', ' ', ' 12,50', '12,50 ', '12.50', '1.234,50', '1,234.50', '1.234', '1,2,3', '12,5,0', ',5', '5,', '1 234', '12,5x', '+1', '1e3', '0x10', '١٢', '12,５0', '--1', '1,-5'];
  for (const text of bad) assert.equal(canonicalDecimal(text), undefined, JSON.stringify(text));
});

test('an ambiguous value is an error on its field and never turns into a different number', () => {
  for (const typed of ['1.234', '12.50', '1.234,50']) {
    const state = validState();
    state.lines[0].unitPrice = typed;
    const found = problemFor(state, 'lines[0].unitPrice');
    assert.equal(found?.code, 'invalid_decimal', typed);
    assert.equal(found?.kind, 'invalid', typed);
    assert.equal(state.lines[0].unitPrice, typed); // the field text is left as typed
    assert.equal(previewTotals(state).ok, false); // no figure from a misread price
    assert.equal(exportXml(state, 'ubl').ok, false);
  }
  const state = validState();
  state.lines[0].quantity = '-2';
  assert.equal(problemFor(state, 'lines[0].quantity')?.code, 'negative_amount');
});

test('the domain precision limits still apply to what the user typed', () => {
  const state = validState();
  state.lines[0].unitPrice = '1,1234567'; // seven fractional digits
  assert.equal(problemFor(state, 'lines[0].unitPrice')?.code, 'fraction_digits_limit');
  state.lines[0].unitPrice = '1,123400'; // trailing zeros are not counted
  assert.equal(problemFor(state, 'lines[0].unitPrice'), undefined);
  state.lines[0].unitPrice = '1000000000';
  assert.equal(problemFor(state, 'lines[0].unitPrice')?.code, 'magnitude_limit');
});

test('typed German values give the same totals as the canonical values given to the domain directly', () => {
  const state = validState();
  const preview = previewTotals(state);
  assert.ok(preview.ok);
  const direct = buildInvoice({ ...buildDocumentInput(state), lines: [{ name: 'Beratung', unitCode: 'HUR', quantity: '2.5', unitPrice: '125.50', vat: { treatment: 'standard', category: 'S', rate: '19' } }] });
  assert.ok(direct.ok);
  assert.deepEqual(preview.totals, direct.value.totals);
  assert.equal(formatDecimal(preview.totals.totalWithoutVat), '313.75'); // 2.5 x 125.50
  const checked = checkForm(state);
  assert.ok(checked.ok);
  assert.deepEqual(checked.invoice.totals, preview.totals);
});

test('check, preview and both exports receive the identical canonical values', () => {
  const state = validState();
  const line = (buildDocumentInput(state).lines as Record<string, unknown>[])[0];
  const monetary = (buildMonetaryInput(state).lines as Record<string, unknown>[])[0];
  assert.equal(line.quantity, '2.5');
  assert.equal(line.unitPrice, '125.50');
  assert.equal(monetary.quantity, line.quantity);
  assert.equal(monetary.unitPrice, line.unitPrice);
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(state, format);
    assert.ok(out.ok, format);
    assert.match(out.xml, /125\.50/);
    assert.doesNotMatch(out.xml, /125,50/);
    assert.match(out.xml, /313\.75/);
  }
});

test('German dates map to ISO by digits only: 07.11.2026 becomes 2026-11-07', () => {
  assert.equal(canonicalDate('07.11.2026'), '2026-11-07');
  assert.equal(canonicalDate('31.12.2026'), '2026-12-31');
  assert.equal(canonicalDate('01.01.2000'), '2000-01-01');
  const input = buildDocumentInput(validState());
  assert.equal(input.issueDate, '2026-11-05');
  assert.equal(input.deliveryDate, '2026-11-01');
  assert.equal((input.payment as Record<string, unknown>).dueDate, '2026-12-05');
});

test('only TT.MM.JJJJ is accepted; no other order, separator or width is reinterpreted', () => {
  const bad = ['', '7.11.2026', '07.1.2026', '07.11.26', '07/11/2026', '07-11-2026', '2026-11-07', '11.07.20266', '07.11.2026 ', ' 07.11.2026', '07 11 2026', '٠٧.١١.٢٠٢٦', '07.11.２０２６'];
  for (const text of bad) assert.equal(canonicalDate(text), undefined, JSON.stringify(text));
  // An ISO string typed into the field is an error with an actionable message, not a silently accepted value.
  const state = validState();
  state.fields.issueDate = '2026-11-05';
  const found = problemFor(state, 'issueDate');
  assert.deepEqual([found?.code, found?.kind, found?.fieldId], ['invalid_date', 'invalid', 'issueDate']);
  assert.equal(state.fields.issueDate, '2026-11-05');
});

test('real calendar dates only, leap years included; an invalid date never becomes another valid date', () => {
  const dateProblem = (text: string) => {
    const state = validState();
    state.fields.issueDate = text;
    return problemFor(state, 'issueDate')?.code;
  };
  assert.equal(dateProblem('29.02.2024'), undefined);
  assert.equal(dateProblem('29.02.2000'), undefined); // divisible by 400
  assert.equal(dateProblem('29.02.2026'), 'invalid_date');
  assert.equal(dateProblem('29.02.1900'), 'invalid_date'); // divisible by 100, not by 400
  assert.equal(dateProblem('31.04.2026'), 'invalid_date');
  assert.equal(dateProblem('31.02.2026'), 'invalid_date');
  assert.equal(dateProblem('00.11.2026'), 'invalid_date');
  assert.equal(dateProblem('15.13.2026'), 'invalid_date');
  assert.equal(dateProblem('15.00.2026'), 'invalid_date');
  assert.equal(dateProblem('32.01.2026'), 'invalid_date');
  const state = validState();
  state.fields.issueDate = '31.02.2026';
  assert.equal((buildDocumentInput(state) as Record<string, unknown>).issueDate, '2026-02-31'); // handed on as typed, digit for digit...
  assert.equal(checkForm(state).ok, false); // ...and refused by the domain; it is never rolled over to 3 March
});

test('every date field uses the same format, including BT-72 and both BG-14 boundaries; exclusivity is intact', () => {
  const state = validState();
  state.supplyMode = 'period';
  state.fields['invoicingPeriod.startDate'] = '01.10.2026';
  state.fields['invoicingPeriod.endDate'] = '31.10.2026';
  let input = buildDocumentInput(state);
  assert.deepEqual(input.invoicingPeriod, { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.ok(!('deliveryDate' in input));
  assert.ok(checkForm(state).ok);
  state.fields['invoicingPeriod.endDate'] = '30.09.2026';
  assert.equal(problemFor(state, 'invoicingPeriod.endDate')?.code, 'invalid_invoicing_period');
  state.fields['invoicingPeriod.endDate'] = '2026-10-31'; // ISO is not the entry format, also not here
  assert.equal(problemFor(state, 'invoicingPeriod.endDate')?.code, 'invalid_date');
  state.supplyMode = 'date';
  input = buildDocumentInput(state);
  assert.ok(!('invoicingPeriod' in input));
  assert.equal(input.deliveryDate, '2026-11-01');
  state.fields.deliveryDate = '01.11.26';
  assert.equal(problemFor(state, 'deliveryDate')?.code, 'invalid_date');
  state.fields.deliveryDate = '01.11.2026';
  state.fields['payment.dueDate'] = '5.12.2026';
  assert.equal(problemFor(state, 'payment.dueDate')?.code, 'invalid_date');
});

test('an empty field is still missing, an incomplete one is invalid, and the text is left as typed', () => {
  const state = validState();
  state.fields.issueDate = '';
  assert.deepEqual([problemFor(state, 'issueDate')?.code, problemFor(state, 'issueDate')?.kind], ['missing_field', 'missing']);
  state.fields.issueDate = '05.11.20';
  assert.deepEqual([problemFor(state, 'issueDate')?.kind, state.fields.issueDate], ['invalid', '05.11.20']);
});

test('the messages are specific, localized, and show the German format on both routes', () => {
  const date = { de: describeError('invalid_date', 'issueDate', 'de'), en: describeError('invalid_date', 'issueDate', 'en') };
  assert.match(date.de, /TT\.MM\.JJJJ/);
  assert.match(date.de, /07\.11\.2026/);
  assert.match(date.en, /DD\.MM\.YYYY/);
  assert.match(date.en, /07\.11\.2026/);
  const number = { de: describeError('invalid_decimal', 'lines[0].unitPrice', 'de'), en: describeError('invalid_decimal', 'lines[0].unitPrice', 'en') };
  assert.match(number.de, /Komma/);
  assert.match(number.de, /12,50/);
  assert.match(number.en, /comma/i);
  assert.match(number.en, /12,50/);
  assert.match(number.de, /Tausendertrennzeichen/); // names what is not accepted
  assert.match(number.en, /thousands separator/);
  assert.doesNotMatch(number.en, /point as/i);
});

test('the conversion module uses no floating-point or timezone-dependent API', () => {
  const source = readFileSync(new URL('../../src/components/tools/xrechnung/input-format.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/\bNumber\(/, /parseFloat/, /parseInt/, /new Date/, /Date\./, /Intl\./, /toLocale/, /\bMath\./]) assert.doesNotMatch(source, forbidden, String(forbidden));
});

// ---- calendar selection: the native control reports ISO, the field shows and keeps TT.MM.JJJJ

test('a date chosen in the calendar is shown in German format and reaches the domain as the same ISO value', () => {
  assert.equal(germanDateFromIso('2026-11-07'), '07.11.2026');
  assert.equal(germanDateFromIso('2024-02-29'), '29.02.2024');
  for (const bad of ['', '2026-1-7', '07.11.2026', '2026-11-07 ', '12026-11-07', '٢٠٢٦-١١-٠٧']) assert.equal(germanDateFromIso(bad), undefined, JSON.stringify(bad));
  // The round trip is exact for every date a calendar can report, and canonicalDate undoes germanDateFromIso.
  for (const iso of ['2000-01-01', '2024-02-29', '2026-11-07', '2026-12-31', '9999-12-31']) assert.equal(canonicalDate(germanDateFromIso(iso) ?? ''), iso);
});

test('manual entry and calendar selection produce identical domain values on every date field', () => {
  const picked = validState();
  const typed = validState();
  const chosen = { issueDate: '2026-11-05', deliveryDate: '2026-11-01', 'payment.dueDate': '2026-12-05' } as const;
  for (const [id, iso] of Object.entries(chosen)) {
    (picked.fields as Record<string, string>)[id] = germanDateFromIso(iso) ?? '';
    (typed.fields as Record<string, string>)[id] = id === 'issueDate' ? '05.11.2026' : id === 'deliveryDate' ? '01.11.2026' : '05.12.2026';
  }
  assert.deepEqual(buildDocumentInput(picked), buildDocumentInput(typed));
  for (const state of [picked, typed]) {
    state.supplyMode = 'period';
    state.fields['invoicingPeriod.startDate'] = germanDateFromIso('2026-10-01') ?? '';
    state.fields['invoicingPeriod.endDate'] = germanDateFromIso('2026-10-31') ?? '';
  }
  assert.deepEqual(buildDocumentInput(picked), buildDocumentInput(typed));
  assert.deepEqual(buildDocumentInput(picked).invoicingPeriod, { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.ok(checkForm(picked).ok);
});

test('opening the picker preselects only a well-formed typed date and never rewrites malformed text', () => {
  assert.equal(isoForPicker('07.11.2026'), '2026-11-07');
  for (const text of ['', '7.11.2026', '07/11/2026', '2026-11-07', 'garbage', '07.11.26']) assert.equal(isoForPicker(text), '', JSON.stringify(text));
  const state = validState();
  state.fields.issueDate = '31.02.2026';
  assert.equal(isoForPicker(state.fields.issueDate) === '', false); // shape is fine; the native control drops what it cannot show
  assert.equal(state.fields.issueDate, '31.02.2026'); // opening reads, it does not write
  state.fields.issueDate = 'garbage';
  isoForPicker(state.fields.issueDate);
  assert.equal(state.fields.issueDate, 'garbage');
});

test('clearing in the calendar empties the field, which is then reported as missing', () => {
  const state = validState();
  state.fields.issueDate = '';
  const found = problemFor(state, 'issueDate');
  assert.deepEqual([found?.code, found?.kind], ['missing_field', 'missing']);
});

test('calendar-chosen leap days and reversed periods behave exactly like typed ones', () => {
  const state = validState();
  state.fields.issueDate = germanDateFromIso('2024-02-29') ?? '';
  assert.equal(problemFor(state, 'issueDate'), undefined);
  state.supplyMode = 'period';
  state.fields['invoicingPeriod.startDate'] = germanDateFromIso('2026-10-31') ?? '';
  state.fields['invoicingPeriod.endDate'] = germanDateFromIso('2026-10-01') ?? '';
  const order = problemFor(state, 'invoicingPeriod.endDate');
  assert.deepEqual([order?.code, order?.fieldId], ['invalid_invoicing_period', 'invoicingPeriod.endDate']);
  state.supplyMode = 'date';
  assert.ok(!('invoicingPeriod' in buildDocumentInput(state)));
});

test('all five date fields get the calendar from the one shared field component, with distinct translated button names', () => {
  const field = readFileSync(new URL('../../src/components/tools/xrechnung/Field.svelte', import.meta.url), 'utf8');
  assert.match(field, /germanDateFromIso/);
  assert.match(field, /showPicker/);
  const workspace = readFileSync(new URL('../../src/components/tools/xrechnung/XRechnungWorkspace.svelte', import.meta.url), 'utf8');
  const dateFields = [...workspace.matchAll(/<Field id="([^"]+)"[^>]*kind="date"/g)].map((match) => match[1]);
  assert.deepEqual(dateFields.sort(), ['deliveryDate', 'invoicingPeriod.endDate', 'invoicingPeriod.startDate', 'issueDate', 'payment.dueDate']);
  for (const locale of ['de', 'en'] as const) {
    const names = dateFields.map((id) => fill(copy['date.calendar'][locale], { field: labelFor(id ?? '', locale) }));
    assert.equal(new Set(names).size, 5, locale);
    for (const name of names) assert.doesNotMatch(name, /[{}]/);
    assert.notEqual(copy['date.calendar'].de, copy['date.calendar'].en);
  }
});
