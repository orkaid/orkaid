import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDocumentInput, checkForm, exportXml } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState, FIELD_IDS, type FormState } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, errorMessages, labelFor, scopeLists } from '../../src/i18n/xrechnung.ts';
import { helpEntries } from '../../src/i18n/xrechnung-help.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';

// Slice 2: BT-11/12/13, BT-72 or BG-14, opt-in Leitweg-ID check. The adapter still owns no rule.

const LEITWEG = '04011000-12345-03'; // fictional; passes structure and check digits
const LEITWEG_BAD_CHECKSUM = '04011000-12345-00';

function validState(): FormState {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'RE-2026-0002', issueDate: '05.11.2026', deliveryDate: '01.11.2026', buyerReference: 'BR-4711',
    'seller.name': 'Muster GmbH', 'seller.address.street': 'Musterstraße 1', 'seller.address.postCode': '10115', 'seller.address.city': 'Berlin',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@muster.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 30 1234567', 'seller.contact.email': 'erika@muster.example',
    'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel AG', 'buyer.address.street': 'Beispielweg 2', 'buyer.address.postCode': '80331', 'buyer.address.city': 'München',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'einkauf@beispiel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE79000000001234567890', 'payment.dueDate': '05.12.2026',
  });
  state.lines = [{ name: 'Beratung', unitCode: 'HUR', quantity: '10', unitPrice: '95', vatRate: '19' }];
  return state;
}

const problems = (state: FormState) => {
  const result = checkForm(state);
  return result.ok ? assert.fail('expected diagnostics') : result.items;
};

test('defaults: a fresh form is single-date mode with the Leitweg-ID check off, and the input equals the Slice 1 input', () => {
  const fresh = emptyFormState();
  assert.equal(fresh.supplyMode, 'date');
  assert.equal(fresh.leitwegCheck, false);
  const input = buildDocumentInput(validState());
  assert.equal(input.deliveryDate, '2026-11-01');
  for (const key of ['invoicingPeriod', 'projectReference', 'contractReference', 'orderReference', 'buyerReferencePolicy']) assert.ok(!(key in input), key);
  assert.deepEqual(Object.keys(input).sort(), ['buyer', 'buyerReference', 'currency', 'deliveryDate', 'documentTypeCode', 'invoiceNumber', 'issueDate', 'lines', 'payment', 'seller']);
});

test('BT-11, BT-12, BT-13 are sent exactly as typed, omitted when empty, and independent of BT-10 and of each other', () => {
  const state = validState();
  state.fields.projectReference = 'PRJ-1';
  state.fields.orderReference = 'PO-7';
  let input = buildDocumentInput(state);
  assert.equal(input.projectReference, 'PRJ-1');
  assert.equal(input.orderReference, 'PO-7');
  assert.ok(!('contractReference' in input));
  assert.equal(input.buyerReference, 'BR-4711');
  state.fields.buyerReference = 'BR-9';
  input = buildDocumentInput(state);
  assert.equal(input.projectReference, 'PRJ-1'); // not derived from BT-10
  state.fields.contractReference = ' V-1'; // never trimmed: the domain refuses it on its own field
  const found = problems(state).find((item) => item.path === 'contractReference');
  assert.equal(found?.code, 'invalid_text');
  assert.equal(found?.fieldId, 'contractReference');
  assert.equal(found?.section, 'document');
  state.fields.contractReference = 'V-1';
  assert.ok(checkForm(state).ok);
});

test('date and period are mutually exclusive in the submitted input; inactive values stay in the form only', () => {
  const state = validState();
  state.fields['invoicingPeriod.startDate'] = '01.10.2026';
  state.fields['invoicingPeriod.endDate'] = '31.10.2026';
  assert.ok(!('invoicingPeriod' in buildDocumentInput(state))); // date mode: period values are not sent
  state.supplyMode = 'period';
  const input = buildDocumentInput(state);
  assert.ok(!('deliveryDate' in input)); // period mode: the typed delivery date is not sent
  assert.deepEqual(input.invoicingPeriod, { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(state.fields.deliveryDate, '01.11.2026'); // still held in the form
  assert.ok(checkForm(state).ok);
  state.supplyMode = 'date';
  assert.ok(checkForm(state).ok);
});

test('an incomplete or inverted period is reported on its own visible field, never on deliveryDate or as an unreachable code', () => {
  const state = validState();
  state.supplyMode = 'period';
  let items = problems(state);
  const byPath = new Map(items.map((item) => [item.path, item]));
  assert.deepEqual([byPath.get('invoicingPeriod.startDate')?.kind, byPath.get('invoicingPeriod.startDate')?.fieldId], ['missing', 'invoicingPeriod.startDate']);
  assert.deepEqual([byPath.get('invoicingPeriod.endDate')?.kind, byPath.get('invoicingPeriod.endDate')?.fieldId], ['missing', 'invoicingPeriod.endDate']);
  assert.ok(!items.some((item) => item.path === 'deliveryDate'));
  state.fields['invoicingPeriod.startDate'] = '31.10.2026';
  items = problems(state);
  assert.equal(items.find((item) => item.path === 'invoicingPeriod.endDate')?.kind, 'missing');
  state.fields['invoicingPeriod.endDate'] = '01.10.2026';
  const order = problems(state).find((item) => item.code === 'invalid_invoicing_period');
  assert.deepEqual([order?.path, order?.fieldId, order?.kind], ['invoicingPeriod.endDate', 'invoicingPeriod.endDate', 'invalid']);
  state.fields['invoicingPeriod.endDate'] = '31.10.2026';
  assert.ok(checkForm(state).ok);
  state.fields['invoicingPeriod.endDate'] = '31.10.2026';
  state.fields['invoicingPeriod.startDate'] = '31.10.2026'; // equal dates: a one-day period
  assert.ok(checkForm(state).ok);
  for (const mode of ['date', 'period'] as const) {
    state.supplyMode = mode;
    state.fields['invoicingPeriod.startDate'] = '01.10.2026';
    assert.ok(!problems({ ...state, fields: { ...state.fields, deliveryDate: 'x', 'invoicingPeriod.endDate': 'y' } }).some((item) => item.code === 'unsupported_delivery_date_with_invoicing_period'));
  }
});

test('the Leitweg-ID check is off by default: the same BT-10 value is accepted and exported', () => {
  const state = validState();
  state.fields.buyerReference = LEITWEG_BAD_CHECKSUM;
  assert.ok(checkForm(state).ok);
  assert.ok(exportXml(state, 'ubl').ok);
});

test('enabling the check changes validation, not BT-10; checking and exporting use the same policy', () => {
  const state = validState();
  state.leitwegCheck = true;
  state.fields.buyerReference = 'BR-4711';
  assert.equal(problems(state).find((item) => item.path === 'buyerReference')?.code, 'invalid_leitweg_id_format');
  state.fields.buyerReference = LEITWEG_BAD_CHECKSUM;
  const bad = problems(state).find((item) => item.path === 'buyerReference');
  assert.deepEqual([bad?.code, bad?.kind, bad?.fieldId], ['invalid_leitweg_id_checksum', 'invalid', 'buyerReference']);
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(state, format);
    assert.equal(out.ok, false);
    assert.ok(!out.ok && out.reason === 'invalid' && out.items.some((item) => item.code === 'invalid_leitweg_id_checksum'));
  }
  assert.equal(state.fields.buyerReference, LEITWEG_BAD_CHECKSUM); // text untouched
  state.fields.buyerReference = LEITWEG;
  assert.ok(checkForm(state).ok);
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(state, format);
    assert.ok(out.ok && out.xml.includes(LEITWEG));
  }
  // What the form calls valid is exactly what the domain says for the same input and the same option.
  const direct = buildInvoice(buildDocumentInput(state), { buyerReferencePolicy: 'leitweg-id' });
  assert.equal(direct.ok, checkForm(state).ok);
  state.leitwegCheck = false;
  state.fields.buyerReference = LEITWEG_BAD_CHECKSUM;
  assert.ok(exportXml(state, 'cii').ok);
});

test('every new field has a label in both languages and every new diagnostic a specific, honest text', () => {
  for (const id of FIELD_IDS) for (const locale of ['de', 'en'] as const) assert.notEqual(labelFor(id, locale), id, `${id} (${locale})`);
  for (const code of ['invalid_leitweg_id_format', 'invalid_leitweg_id_checksum', 'invalid_invoicing_period'] as const) {
    for (const locale of ['de', 'en'] as const) {
      assert.notEqual(errorMessages[code][locale], errorMessages.unsupported_document_type[locale], code);
      assert.doesNotMatch(describeError(code, 'buyerReference', locale), /[{}]/);
    }
  }
  assert.match(errorMessages.invalid_leitweg_id_format.en, /Leitweg-ID/);
  assert.match(errorMessages.invalid_leitweg_id_checksum.de, /Prüfziffer/);
  assert.match(errorMessages.invalid_invoicing_period.en, /end|before/i);
  for (const locale of ['de', 'en'] as const) {
    const note = copy.leitwegNote[locale];
    assert.match(note, locale === 'de' ? /Zuteilung|zugeteilt/ : /assign/i);
    assert.match(note, locale === 'de' ? /Routing/ : /routing/i);
    assert.doesNotMatch(note, /B2G-Workflow|complete B2G/i);
  }
});

test('scope note: the Slice 2 capabilities moved to "available", the rest stays in the domain core', () => {
  const now = scopeLists.now.en.join(' | ');
  const core = scopeLists.core.en.join(' | ');
  for (const needle of ['BT-11', 'BG-14', 'Leitweg-ID']) {
    assert.match(now, new RegExp(needle), `now: ${needle}`);
    assert.doesNotMatch(core, new RegExp(needle), `core: ${needle}`);
  }
  // Slice 3 (MDR-44) moved Kleinunternehmer and Reverse Charge out of the core list, MDR-49 moved 381; Skonto remains.
  assert.match(core, /Skonto/);
  assert.doesNotMatch(core, /381/);
  const nowDe = scopeLists.now.de.join(' | ');
  for (const needle of ['BT-11', 'BG-14', 'Leitweg-ID']) assert.match(nowDe, new RegExp(needle), needle);
  assert.equal(scopeLists.now.de.length, scopeLists.now.en.length);
  assert.equal(scopeLists.core.de.length, scopeLists.core.en.length);
});

test('help no longer says the date or the Leitweg-ID check cannot be used, and has entries for the new controls', () => {
  for (const locale of ['de', 'en'] as const) {
    assert.doesNotMatch((helpEntries.buyerReference[locale].profile ?? []).join(' '), /noch nicht bedienbar|cannot be used in this stage/);
    assert.doesNotMatch((helpEntries.deliveryDate[locale].profile ?? []).join(' '), /nur das Datum bedienbar|only the date can be used/);
  }
  for (const id of ['references', 'invoicingPeriod', 'leitwegCheck'] as const) assert.ok(helpEntries[id].sources.length > 0, id);
});

test('frozen domain, serializers and golden fixtures are unchanged since the freeze commit', (t) => {
  // The dependency manifests are pinned to the approved security baseline (MDR-48); any other change to them fails here.
  const APPROVED_MANIFESTS = {
    'package.json': '73ba9cff4c6499699dab85edc14e4fabf21d86314fe653ce5f9ffc4ad3e8321e',
    'package-lock.json': 'f0ca371a0d8f7b37cae54d1a9366bc9cbff7c20d413055cbfc2eaf7129c19408',
  };
  for (const [file, sha256] of Object.entries(APPROVED_MANIFESTS)) assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), sha256, `${file} differs from the approved dependency baseline`);
  const FREEZE = '52d62c89d6039b56edbaab79f3390fdfdd99f663';
  try { execFileSync('git', ['cat-file', '-e', `${FREEZE}^{commit}`], { stdio: 'ignore' }); } catch { return t.skip('freeze commit not available in this checkout'); }
  const diff = execFileSync('git', ['diff', '--stat', FREEZE, '--', 'src/lib', 'tests/fixtures', 'tests/domain'], { encoding: 'utf8' });
  // The only permitted difference is the README status paragraph changed before M3 (e1be000).
  const files = diff.split('\n').filter((line) => line.includes('|')).map((line) => line.split('|')[0]?.trim());
  assert.deepEqual(files, ['src/lib/domain/xrechnung/README.md']);
});
