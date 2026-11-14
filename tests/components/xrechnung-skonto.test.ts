import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { navigationTarget, placementOf } from '../../src/components/tools/xrechnung/diagnostic-placement.ts';
import { buildDocumentInput, checkForm, exportXml, fieldValues, type DiagnosticItem } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState, MAX_SKONTO_TIERS, selectDocumentType, type FormState, type SkontoTierForm } from '../../src/components/tools/xrechnung/form-state.ts';
import { dayCountInput, UNPARSABLE_DAYS } from '../../src/components/tools/xrechnung/input-format.ts';
import { copy, describeError, labelFor } from '../../src/i18n/xrechnung.ts';
import { helpEntries } from '../../src/i18n/xrechnung-help.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';

// Structured Skonto in the Rechnungsblatt payment block (invoice 380 only). The adapter owns no rule: these tests are about
// what it sends to the frozen domain and where the domain's answer is placed. Every value is fictional.

const locales = ['de', 'en'] as const;

function invoiceState(): FormState {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'RE-2026-0100', issueDate: '14.11.2026', deliveryDate: '01.11.2026', buyerReference: 'BR-4711',
    'seller.name': 'Muster GmbH', 'seller.address.street': 'Musterstraße 1', 'seller.address.postCode': '10115', 'seller.address.city': 'Berlin',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@muster.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 30 1234567', 'seller.contact.email': 'erika@muster.example',
    'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel AG', 'buyer.address.street': 'Beispielweg 2', 'buyer.address.postCode': '80331', 'buyer.address.city': 'München',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'einkauf@beispiel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE79000000001234567890',
    'payment.dueDate': '05.12.2026',
  });
  state.lines = [{ name: 'Beratung', unitCode: 'HUR', quantity: '10', unitPrice: '95', vatRate: '19' }];
  return state;
}
const withTiers = (state: FormState, tiers: SkontoTierForm[]): FormState => { state.skonto = tiers.map((tier) => ({ ...tier })); return state; };
const payment = (state: FormState) => buildDocumentInput(state).payment as Record<string, unknown>;
const items = (state: FormState): readonly DiagnosticItem[] => { const result = checkForm(state); return result.ok ? [] : result.items; };
const xml = (state: FormState, format: 'ubl' | 'cii') => { const out = exportXml(state, format); assert.ok(out.ok, JSON.stringify(out)); return out.xml; };

test('zero tiers: no payment.skonto at all (never an empty array), and the export is that of the form without Skonto', () => {
  const plain = invoiceState();
  assert.deepEqual(plain.skonto, []);
  assert.equal('skonto' in payment(plain), false);
  // Adding tiers and removing all of them again restores the identical input and the byte-identical export.
  const edited = withTiers(invoiceState(), [{ days: '14', percent: '2' }, { days: '30', percent: '1' }]);
  edited.skonto.splice(0, 2);
  assert.deepEqual(buildDocumentInput(edited), buildDocumentInput(plain));
  for (const format of ['ubl', 'cii'] as const) assert.equal(xml(edited, format), xml(plain, format));
});

test('valid tiers are sent in the order entered, days as integers and percent as canonical decimal text', () => {
  const state = withTiers(invoiceState(), [{ days: '14', percent: '2,5' }, { days: '30', percent: '1' }]);
  assert.deepEqual(payment(state).skonto, [{ days: 14, percent: '2.5' }, { days: 30, percent: '1' }]);
  assert.equal(checkForm(state).ok, true);
  const ten = withTiers(invoiceState(), Array.from({ length: MAX_SKONTO_TIERS }, (_, i) => ({ days: String((i + 1) * 7), percent: '1,25' })));
  const sent = payment(ten).skonto as { days: number; percent: string }[];
  assert.equal(sent.length, 10);
  assert.deepEqual(sent.map((tier) => tier.days), [7, 14, 21, 28, 35, 42, 49, 56, 63, 70]);
  assert.equal(checkForm(ten).ok, true);
  // BT-20 itself is written by the domain, from these tiers.
  assert.match(xml(state, 'ubl'), /#SKONTO#TAGE=14#PROZENT=2\.50#\n#SKONTO#TAGE=30#PROZENT=1\.00#\n/);
});

test('the interface allows ten tiers; an eleventh, should it reach the domain, is a group diagnostic placed at the Skonto group', () => {
  assert.equal(MAX_SKONTO_TIERS, 10);
  const eleven = withTiers(invoiceState(), Array.from({ length: 11 }, (_, i) => ({ days: String(i + 1), percent: '1' })));
  const found = items(eleven).find((item) => item.code === 'unsupported_skonto_tier_count');
  assert.ok(found);
  assert.equal(found.path, 'payment.skonto');
  assert.deepEqual(placementOf(found), { at: 'group', group: 'payment.skonto' });
  assert.equal(navigationTarget(found), 'payment.skonto[0].days');
});

// The second tier is varied; the first is valid (10 days, 2 %). Each case names the contract's code and path.
const CASES: readonly { name: string; tier: SkontoTierForm; code: string; field: 'days' | 'percent'; kind: 'missing' | 'invalid' }[] = [
  { name: 'empty Days', tier: { days: '', percent: '1' }, code: 'missing_field', field: 'days', kind: 'missing' },
  { name: 'empty Percent', tier: { days: '30', percent: '' }, code: 'missing_field', field: 'percent', kind: 'missing' },
  { name: 'duplicate days', tier: { days: '10', percent: '1' }, code: 'unsupported_skonto_tier_order', field: 'days', kind: 'invalid' },
  { name: 'decreasing days', tier: { days: '5', percent: '1' }, code: 'unsupported_skonto_tier_order', field: 'days', kind: 'invalid' },
  { name: 'days 0', tier: { days: '0', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'days 366', tier: { days: '366', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'fractional days', tier: { days: '14,5', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'alphabetic days', tier: { days: 'vierzehn', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'malformed days (sign)', tier: { days: '-14', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'malformed days (space)', tier: { days: ' 14', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'malformed days (exponent)', tier: { days: '1e2', percent: '1' }, code: 'unsupported_skonto_days', field: 'days', kind: 'invalid' },
  { name: 'percent 0', tier: { days: '30', percent: '0' }, code: 'unsupported_skonto_percent', field: 'percent', kind: 'invalid' },
  { name: 'percent above 100', tier: { days: '30', percent: '100,01' }, code: 'unsupported_skonto_percent', field: 'percent', kind: 'invalid' },
  { name: 'third fractional digit', tier: { days: '30', percent: '2,255' }, code: 'fraction_digits_limit', field: 'percent', kind: 'invalid' },
  { name: 'negative percent', tier: { days: '30', percent: '-1' }, code: 'negative_amount', field: 'percent', kind: 'invalid' },
  { name: 'decimal point', tier: { days: '30', percent: '2.5' }, code: 'invalid_decimal', field: 'percent', kind: 'invalid' },
];

for (const c of CASES) {
  test(`tier diagnostic, ${c.name}: the contract's code at the contract's path, placed and navigable at that tier's control`, () => {
    const state = withTiers(invoiceState(), [{ days: '10', percent: '2' }, c.tier]);
    const path = `payment.skonto[1].${c.field}`;
    const skontoItems = items(state).filter((item) => item.path.startsWith('payment.skonto'));
    assert.deepEqual(skontoItems.map((item) => [item.code, item.path]), [[c.code, path]]);
    const [item] = skontoItems;
    assert.ok(item);
    assert.equal(item.kind, c.kind);
    assert.deepEqual(placementOf(item), { at: 'field', id: path });
    assert.equal(navigationTarget(item), path);
    assert.equal(exportXml(state, 'ubl').ok, false);
    // The typed text is kept as typed.
    assert.equal(state.skonto[1]?.[c.field], c.tier[c.field]);
  });
}

test('an added, empty tier stays part of the input: both its fields are reported missing and export is blocked', () => {
  const state = withTiers(invoiceState(), [{ days: '', percent: '' }]);
  assert.deepEqual(payment(state).skonto, [{}]);
  assert.deepEqual(items(state).map((item) => [item.code, item.path, item.kind]), [
    ['missing_field', 'payment.skonto[0].days', 'missing'],
    ['missing_field', 'payment.skonto[0].percent', 'missing'],
  ]);
  assert.equal(exportXml(state, 'cii').ok, false);
});

test('tiers are never sorted, merged or repaired: a decreasing list is sent as entered', () => {
  const state = withTiers(invoiceState(), [{ days: '30', percent: '1' }, { days: '14', percent: '2' }]);
  assert.deepEqual(payment(state).skonto, [{ days: 30, percent: '1' }, { days: 14, percent: '2' }]);
  assert.deepEqual(state.skonto.map((tier) => tier.days), ['30', '14']);
});

test('the days conversion: only ASCII digits become a day count; everything else is one finite marker the domain refuses', () => {
  for (const [text, days] of [['1', 1], ['14', 14], ['365', 365], ['0', 0], ['007', 7], ['366', 366], ['999999999', 999999999]] as const) assert.equal(dayCountInput(text), days, text);
  for (const text of ['', ' ', '14 ', '1,5', '1.5', '-1', '+1', '1e2', '0x10', 'Infinity', 'NaN', '١٤', '1234567890', '9'.repeat(400)]) {
    const days = dayCountInput(text);
    assert.equal(days, UNPARSABLE_DAYS, JSON.stringify(text));
    assert.ok(Number.isFinite(days) && !Number.isInteger(days));
  }
  // The marker is proven to give unsupported_skonto_days in the frozen domain, at the field, and nothing else about the tier.
  const input = buildDocumentInput(withTiers(invoiceState(), [{ days: 'x', percent: '1' }]));
  assert.deepEqual((input.payment as Record<string, unknown>).skonto, [{ days: UNPARSABLE_DAYS, percent: '1' }]);
  const result = buildInvoice(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors.filter((error) => error.path.startsWith('payment.skonto')), [{ code: 'unsupported_skonto_days', path: 'payment.skonto[0].days' }]);
});

test('BR-CO-25: one valid tier alone satisfies it; with no BT-9, no free text and no tier the domain still reports it', () => {
  const alone = withTiers(invoiceState(), [{ days: '14', percent: '2' }]);
  alone.fields['payment.dueDate'] = '';
  assert.equal(checkForm(alone).ok, true);
  for (const format of ['ubl', 'cii'] as const) assert.match(xml(alone, format), /#SKONTO#TAGE=14#PROZENT=2\.00#/);
  const none = invoiceState();
  none.fields['payment.dueDate'] = '';
  assert.deepEqual(items(none).map((item) => [item.code, item.path]), [['missing_payment_due_information', 'payment']]);
  // Tiers with BT-9, with free text, and with both: valid, and the free text precedes the tier lines in BT-20.
  const both = withTiers(invoiceState(), [{ days: '10', percent: '3' }, { days: '20', percent: '1,5' }]);
  both.fields['payment.termsText'] = 'Zahlbar innerhalb von 30 Tagen.';
  assert.equal(checkForm(both).ok, true);
  assert.match(xml(both, 'ubl'), /Zahlbar innerhalb von 30 Tagen\.\n#SKONTO#TAGE=10#PROZENT=3\.00#\n#SKONTO#TAGE=20#PROZENT=1\.50#\n/);
  const textOnly = withTiers(invoiceState(), [{ days: '10', percent: '3' }]);
  textOnly.fields['payment.dueDate'] = '';
  textOnly.fields['payment.termsText'] = 'Netto 30 Tage.';
  assert.equal(checkForm(textOnly).ok, true);
});

test('credit note 381: tiers stay in the form but never reach its input, validation, navigation or export; they return on 380', () => {
  const tiers = [{ days: '14', percent: '2' }, { days: '7', percent: '0' }];
  const toCreditNote = (state: FormState): FormState => {
    selectDocumentType(state, '381');
    state.fields['precedingInvoice.number'] = 'RE-2026-0042';
    state.clearingConfirmed = true;
    return state;
  };
  const plain = toCreditNote(invoiceState());
  const state = toCreditNote(withTiers(invoiceState(), tiers));
  assert.equal('skonto' in payment(state), false);
  assert.deepEqual(buildDocumentInput(state), buildDocumentInput(plain));
  assert.equal(Object.keys(fieldValues(state)).some((key) => key.startsWith('payment.skonto')), false);
  assert.equal(checkForm(state).ok, true);
  for (const format of ['ubl', 'cii'] as const) assert.equal(xml(state, format), xml(plain, format));
  // Back to the invoice: the tiers are there as typed and are validated again (the second one is invalid).
  selectDocumentType(state, '380');
  assert.equal(state.clearingConfirmed, false);
  assert.deepEqual(state.skonto, tiers);
  assert.deepEqual(items(state).filter((item) => item.path.startsWith('payment.skonto')).map((item) => [item.code, item.path]), [
    ['unsupported_skonto_tier_order', 'payment.skonto[1].days'],
    ['unsupported_skonto_percent', 'payment.skonto[1].percent'],
  ]);
  // Every type change still withdraws the clearing confirmation.
  selectDocumentType(state, '381');
  assert.equal(state.clearingConfirmed, false);
});

test('labels name the tier and the field in both languages; the Skonto percentage names its own two-digit limit', () => {
  assert.equal(labelFor('payment.skonto[1].days', 'de'), 'Skontostufe 2: Tage');
  assert.equal(labelFor('payment.skonto[0].percent', 'de'), 'Skontostufe 1: Prozent');
  assert.equal(labelFor('payment.skonto[1].days', 'en'), 'Discount tier 2: Days');
  assert.equal(labelFor('payment.skonto[9].percent', 'en'), 'Discount tier 10: Percent');
  assert.equal(labelFor('payment.skonto', 'de'), 'Skonto (strukturiert)');
  assert.equal(labelFor('payment.skonto', 'en'), 'Early-payment discount (Skonto)');
  for (const locale of locales) {
    assert.match(describeError('fraction_digits_limit', 'payment.skonto[0].percent', locale), /\b2\b/);
    assert.match(describeError('fraction_digits_limit', 'lines[0].quantity', locale), /\b6\b/);
    assert.match(describeError('invalid_decimal', 'payment.skonto[0].percent', locale), /2,5/);
    for (const code of ['unsupported_skonto_days', 'unsupported_skonto_tier_order', 'unsupported_skonto_percent', 'unsupported_skonto_tier_count'] as const) {
      const text = describeError(code, 'payment.skonto[1].days', locale);
      assert.doesNotMatch(text, /Outside what|Außerhalb des unterstützten/, `${code} has its own text`);
      assert.match(text, locale === 'de' ? /Grenze dieses Werkzeugs/ : /limit of this tool/, `${code} is named a profile limit`);
    }
  }
  assert.equal(copy['skonto.tier'].en, 'Discount tier {n}');
});

test('the interface builds no BT-20 and calculates nothing: Skonto UI code has no Skonto syntax and no arithmetic API', () => {
  for (const file of ['SkontoEditor.svelte', 'XRechnungWorkspace.svelte', 'form-adapter.ts', 'form-state.ts']) {
    const source = readFileSync(new URL(`../../src/components/tools/xrechnung/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /#SKONTO|TAGE=|PROZENT=/, file);
  }
  const editor = readFileSync(new URL('../../src/components/tools/xrechnung/SkontoEditor.svelte', import.meta.url), 'utf8');
  for (const forbidden of [/\bNumber\(/, /parseFloat/, /parseInt/, /\bMath\./, /new Date/, /toFixed/]) assert.doesNotMatch(editor, forbidden, String(forbidden));
});

test('Skonto copy and help keep the claims bounded: no entitlement, no computed amount or date, no defined reference point', () => {
  const entry = helpEntries.skonto;
  for (const locale of locales) {
    const text = [copy['skonto.hint'][locale], copy['skonto.cnNote'][locale], ...(entry[locale].profile ?? []), ...(entry[locale].unverified ?? [])].join(' ');
    assert.match(text, locale === 'de' ? /berechnet keinen Skontobetrag/ : /calculates no discount amount/);
    assert.match((entry[locale].unverified ?? []).join(' '), locale === 'de' ? /nicht eindeutig fest/ : /does not unequivocally define/);
    assert.match((entry[locale].external ?? []).join(' '), /BT-115/);
    assert.match((entry[locale].profile ?? []).join(' '), locale === 'de' ? /prüft das Werkzeug nicht/ : /not checked by the tool/);
    assert.doesNotMatch(text, /Anspruch besteht|garantiert|entitled to|guarantee|akzeptiert|recipient accepts/i);
  }
});

// ---- remediation after the independent review (SK-NB-03, SK-NB-04, SK-OBS-01); the rendered checks are in the browser harness

test('the Skonto help words its common mistakes for the Percent field: two digits, the percent example; other help keeps six', () => {
  const drawer = readFileSync(new URL('../../src/components/tools/xrechnung/HelpDrawer.svelte', import.meta.url), 'utf8');
  // What the drawer renders for each mistake: the entry's mistakes field, else its jump field.
  assert.match(drawer, /describeError\(code, entry\.mistakesFieldId \?\? entry\.fieldId \?\? '', locale, text\.title\)/);
  const skonto = helpEntries.skonto;
  assert.equal(skonto.fieldId, 'payment.skonto[0].days');
  assert.equal(skonto.mistakesFieldId, 'payment.skonto[0].percent');
  const quantity = helpEntries.quantityPrice;
  for (const locale of locales) {
    const rendered = skonto.mistakes.map((code) => describeError(code, skonto.mistakesFieldId, locale, skonto[locale].title)).join(' | ');
    assert.match(rendered, locale === 'de' ? /höchstens 2 Nachkommastellen/ : /at most 2 fractional digits/);
    assert.doesNotMatch(rendered, /\b6\b/);
    assert.match(rendered, /2,5/);
    assert.doesNotMatch(rendered, /12,50/);
    const qty = quantity.mistakes.map((code) => describeError(code, '', locale, quantity[locale].title)).join(' | ');
    assert.match(qty, locale === 'de' ? /höchstens 6 Nachkommastellen/ : /at most 6 fractional digits/);
  }
  // Every other help entry renders exactly as before: none sets a mistakes field of its own.
  for (const [id, entry] of Object.entries(helpEntries)) if (id !== 'skonto') assert.equal('mistakesFieldId' in entry, false, id);
});

test('F1 in a tier field opens the Skonto help through the workspace drawer; no listener outside the tier inputs', () => {
  const editor = readFileSync(new URL('../../src/components/tools/xrechnung/SkontoEditor.svelte', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../../src/components/tools/xrechnung/XRechnungWorkspace.svelte', import.meta.url), 'utf8');
  assert.match(editor, /aria-keyshortcuts="F1" onkeydown=\{helpKey\}/);
  assert.doesNotMatch(editor, /addEventListener|aria-live|role="status"/);
  assert.match(workspace, /onhelp=\{\(el\) => openHelp\('skonto', el\)\}/);
});

test('the scope note lead names no count of reason groups, so it stays true when an empty group is hidden', () => {
  for (const locale of locales) assert.doesNotMatch(copy['sheet.scopeCannotLead'][locale], /\b(Drei|Zwei|Vier|Three|Two|Four|\d+)\b/i);
  const note = readFileSync(new URL('../../src/components/tools/xrechnung/ScopeNote.svelte', import.meta.url), 'utf8');
  assert.match(note, /cannot\.filter\(\(group\) => scopeLists\[group\.key\]\[locale\]\.length > 0\)/);
});
