import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  activeFixedReasons, buildDocumentInput, buildMonetaryInput, checkForm, exportXml, hasReverseCharge, lineVat, previewTotals, vatBucketKey,
} from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState, emptyLine, FIELD_IDS, type FormState } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, errorMessages, labelFor, scopeLists, vatBucketLabel } from '../../src/i18n/xrechnung.ts';
import { helpEntries } from '../../src/i18n/xrechnung-help.ts';
import { buildInvoice } from '../../src/lib/domain/xrechnung/document.ts';
import { calculateInvoiceTotals, KLEINUNTERNEHMER_EXEMPTION_TEXT, REVERSE_CHARGE_TEXT } from '../../src/lib/domain/xrechnung/invoice.ts';

// Slice 3 (MDR-44): the document-level regime, the per-line treatment and the buyer / seller identifiers. The adapter owns no
// rule; every expectation is about what reaches the frozen domain and how its answer is presented.

const locales = ['de', 'en'] as const;
type Choice = '' | '19' | '7' | 'reverse-charge';

function base(): FormState {
  const state = emptyFormState();
  Object.assign(state.fields, {
    invoiceNumber: 'RE-2026-0001', issueDate: '05.11.2026', deliveryDate: '01.11.2026', buyerReference: 'BR-4711',
    'seller.name': 'Muster GmbH', 'seller.address.street': 'Musterstraße 1', 'seller.address.postCode': '10115', 'seller.address.city': 'Berlin',
    'seller.electronicAddress.schemeId': 'EM', 'seller.electronicAddress.value': 'rechnung@muster.example',
    'seller.contact.name': 'Erika Mustermann', 'seller.contact.telephone': '+49 30 1234567', 'seller.contact.email': 'erika@muster.example',
    'seller.vatId': 'DE123456789',
    'buyer.name': 'Beispiel AG', 'buyer.address.street': 'Beispielweg 2', 'buyer.address.postCode': '80331', 'buyer.address.city': 'München',
    'buyer.electronicAddress.schemeId': 'EM', 'buyer.electronicAddress.value': 'einkauf@beispiel.example',
    'payment.means.code': '58', 'payment.means.account.id.value': 'DE79000000001234567890', 'payment.dueDate': '05.12.2026',
  });
  return state;
}

function withLines(choices: readonly Choice[], regime: FormState['vatRegime'] = 'regular'): FormState {
  const state = base();
  state.vatRegime = regime;
  state.lines = choices.map((vatRate, i) => ({ name: `Position ${i + 1}`, unitCode: 'HUR', quantity: '2', unitPrice: '10,50', vatRate }));
  return state;
}

const codes = (state: FormState) => {
  const result = checkForm(state);
  return result.ok ? [] : result.items.map((item) => `${item.code}@${item.path}`);
};

// ---------------------------------------------------------------- mapping

test('the four user choices map to exactly the frozen treatment / category / rate', () => {
  const state = withLines(['19']);
  const line = (vatRate: Choice) => ({ ...state.lines[0], vatRate });
  assert.deepEqual(lineVat(state, line('19')), { treatment: 'standard', category: 'S', rate: '19' });
  assert.deepEqual(lineVat(state, line('7')), { treatment: 'standard', category: 'S', rate: '7' });
  assert.deepEqual(lineVat(state, line('reverse-charge')), { treatment: 'reverse-charge', category: 'AE', rate: '0' });
  state.vatRegime = 'kleinunternehmer';
  assert.deepEqual(lineVat(state, line('19')), { treatment: 'kleinunternehmer', category: 'E', rate: '0' });
});

test('no choice is made on the user\'s behalf: a fresh form is regular with no line treatment, and an open choice sends no rate', () => {
  const fresh = emptyFormState();
  assert.equal(fresh.vatRegime, 'regular');
  assert.equal(fresh.lines[0].vatRate, '');
  assert.deepEqual(lineVat(fresh, fresh.lines[0]), { treatment: 'standard', category: 'S' });
  const missing = checkForm(fresh);
  assert.ok(!missing.ok && missing.items.some((item) => item.path === 'lines[0].vat.rate' && item.kind === 'missing'));
});

// MDR-44: no line treatment is preselected. A new line never takes its VAT treatment from another line; only the unit repeats.
test('a new line has no VAT treatment, whatever the previous line chose (S19, S7, AE0), and the initial line has none', () => {
  assert.equal(emptyFormState().lines[0].vatRate, '');
  assert.equal(emptyLine().vatRate, '');
  for (const previous of ['19', '7', 'reverse-charge'] as const) {
    const line = emptyLine({ name: 'Vorher', unitCode: 'HUR', quantity: '1', unitPrice: '5', vatRate: previous });
    assert.deepEqual(line, { name: '', unitCode: 'HUR', quantity: '', unitPrice: '', vatRate: '' }, `after ${previous}`);
  }
});

test('adding a line leaves the existing selections untouched and the new line open; the form is then not ready for export', () => {
  const state = withLines(['19', 'reverse-charge']);
  state.fields['buyer.vatId'] = 'DE987654321';
  assert.ok(exportXml(state, 'ubl').ok);
  state.lines.push(emptyLine(state.lines[state.lines.length - 1]));
  assert.deepEqual(state.lines.map((line) => line.vatRate), ['19', 'reverse-charge', '']);
  const result = checkForm(state);
  assert.ok(!result.ok);
  assert.ok(result.items.some((item) => item.path === 'lines[2].vat.rate' && item.kind === 'missing'));
  for (const format of ['ubl', 'cii'] as const) assert.equal(exportXml(state, format).ok, false, format);
});

test('a line added in Kleinunternehmer mode is E/0 like the others, and after switching back it is open while earlier choices return', () => {
  const state = withLines(['19', '7'], 'kleinunternehmer');
  state.lines.push({ ...emptyLine(state.lines[state.lines.length - 1]), name: 'Position 3', quantity: '1', unitPrice: '5' });
  assert.deepEqual((buildDocumentInput(state).lines as { vat: unknown }[]).map((line) => line.vat), Array(3).fill({ treatment: 'kleinunternehmer', category: 'E', rate: '0' }));
  assert.deepEqual(codes(state), []);
  state.vatRegime = 'regular';
  assert.deepEqual(state.lines.map((line) => line.vatRate), ['19', '7', '']);
  assert.ok(codes(state).some((code) => code.endsWith('@lines[2].vat.rate')));
  assert.ok(!codes(state).some((code) => code.endsWith('@lines[0].vat.rate') || code.endsWith('@lines[1].vat.rate')));
});

test('the default regular path sends what Slice 2 sent: the full input and the monetary input are unchanged', () => {
  const state = withLines(['19', '7']);
  const input = buildDocumentInput(state);
  assert.deepEqual(input.lines, [
    { name: 'Position 1', unitCode: 'HUR', quantity: '2', unitPrice: '10.50', vat: { treatment: 'standard', category: 'S', rate: '19' } },
    { name: 'Position 2', unitCode: 'HUR', quantity: '2', unitPrice: '10.50', vat: { treatment: 'standard', category: 'S', rate: '7' } },
  ]);
  assert.deepEqual(buildMonetaryInput(state), {
    documentTypeCode: '380', currency: 'EUR',
    lines: [
      { quantity: '2', unitPrice: '10.50', vat: { treatment: 'standard', category: 'S', rate: '19' } },
      { quantity: '2', unitPrice: '10.50', vat: { treatment: 'standard', category: 'S', rate: '7' } },
    ],
  });
  assert.equal(input.buyer && 'legalRegistrationId' in (input.buyer as object), false);
  assert.ok(checkForm(state).ok);
});

// ---------------------------------------------------------------- compositions

const CHOICES: readonly Choice[] = ['', '19', '7', 'reverse-charge'];
function* allStates(maxLines: number): Generator<FormState> {
  for (const regime of ['regular', 'kleinunternehmer'] as const) {
    for (let n = 1; n <= maxLines; n++) {
      const total = CHOICES.length ** n;
      for (let k = 0; k < total; k++) {
        const choices = Array.from({ length: n }, (_, i) => CHOICES[Math.floor(k / CHOICES.length ** i) % CHOICES.length]);
        yield withLines(choices, regime);
      }
    }
  }
}

test('across every reachable state the preview and the full input carry the same VAT per line, and KU is never mixed', () => {
  let states = 0;
  for (const state of allStates(3)) {
    states++;
    const full = (buildDocumentInput(state).lines as { vat: unknown }[]).map((line) => line.vat);
    const monetary = (buildMonetaryInput(state).lines as { vat: unknown }[]).map((line) => line.vat);
    assert.deepEqual(full, monetary);
    const treatments = new Set(full.map((vat) => (vat as { treatment: string }).treatment));
    if (treatments.has('kleinunternehmer')) assert.deepEqual([...treatments], ['kleinunternehmer']);
    assert.ok(!codes(state).includes('unsupported_mixed_vat_treatments@lines'));
  }
  assert.equal(states, 2 * (4 + 16 + 64));
});

test('each nonempty subset of S19, S7 and Reverse Charge is accepted by the domain with otherwise valid data', () => {
  const subsets: Choice[][] = [['19'], ['7'], ['reverse-charge'], ['19', '7'], ['19', 'reverse-charge'], ['7', 'reverse-charge'], ['19', '7', 'reverse-charge']];
  for (const choices of subsets) {
    const state = withLines(choices);
    state.fields['buyer.vatId'] = 'DE987654321';
    assert.deepEqual(codes(state), [], choices.join('+'));
    const result = buildInvoice(buildDocumentInput(state));
    assert.ok(result.ok, choices.join('+'));
  }
});

test('Kleinunternehmer: every line is E/0 whatever the leftover selections are, and they return with the regular regime', () => {
  const state = withLines(['19', 'reverse-charge', ''], 'kleinunternehmer');
  const input = buildDocumentInput(state);
  assert.deepEqual((input.lines as { vat: unknown }[]).map((line) => line.vat), Array(3).fill({ treatment: 'kleinunternehmer', category: 'E', rate: '0' }));
  assert.deepEqual(codes(state), []);
  const result = buildInvoice(input);
  assert.ok(result.ok);
  assert.deepEqual(result.value.totals.vatBreakdown.map((bucket) => bucket.treatment), ['kleinunternehmer']);
  assert.equal(result.value.totals.totalVat.units, 0n);
  // inactive state is kept, never sent
  assert.deepEqual(state.lines.map((line) => line.vatRate), ['19', 'reverse-charge', '']);
  state.vatRegime = 'regular';
  assert.deepEqual(state.lines.map((line) => line.vatRate), ['19', 'reverse-charge', '']);
  assert.deepEqual((buildDocumentInput(state).lines as { vat: { category: string } }[]).map((line) => line.vat.category), ['S', 'AE', 'S']);
  assert.ok(codes(state).includes('missing_buyer_identifier@buyer'));
});

test('exported XML of a Kleinunternehmer form has only E/0 and of a regular form never the Kleinunternehmer text', () => {
  const ku = withLines(['19', 'reverse-charge'], 'kleinunternehmer');
  ku.fields['seller.vatId'] = '';
  ku.fields['seller.taxRegistrationId'] = '12/345/67890';
  ku.fields['seller.legalRegistrationId'] = 'HRB 12345';
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(ku, format);
    assert.ok(out.ok, format);
    assert.ok(out.xml.includes(KLEINUNTERNEHMER_EXEMPTION_TEXT));
    assert.ok(!out.xml.includes(REVERSE_CHARGE_TEXT));
    assert.doesNotMatch(out.xml, /<(?:cbc:)?(?:ram:)?(?:ID|CategoryCode)>(?:S|AE)</);
  }
  ku.vatRegime = 'regular';
  ku.fields['buyer.vatId'] = 'DE987654321';
  for (const format of ['ubl', 'cii'] as const) {
    const out = exportXml(ku, format);
    assert.ok(out.ok, format);
    assert.ok(!out.xml.includes(KLEINUNTERNEHMER_EXEMPTION_TEXT));
    assert.ok(out.xml.includes(REVERSE_CHARGE_TEXT));
  }
});

// ---------------------------------------------------------------- identifiers

test('buyer BT-47 is a form field with a label in both languages and is sent exactly as typed, omitted when empty, never copied from BT-48', () => {
  assert.ok(FIELD_IDS.includes('buyer.legalRegistrationId'));
  for (const locale of locales) assert.notEqual(labelFor('buyer.legalRegistrationId', locale), 'buyer.legalRegistrationId');
  const state = withLines(['19']);
  assert.equal((buildDocumentInput(state).buyer as Record<string, unknown>).legalRegistrationId, undefined);
  state.fields['buyer.legalRegistrationId'] = ' HRB 99';
  state.fields['buyer.vatId'] = 'DE987654321';
  const buyer = buildDocumentInput(state).buyer as Record<string, unknown>;
  assert.equal(buyer.legalRegistrationId, ' HRB 99');
  assert.equal(buyer.vatId, 'DE987654321');
  state.fields['buyer.vatId'] = '';
  assert.equal((buildDocumentInput(state).buyer as Record<string, unknown>).vatId, undefined);
});

test('a Reverse Charge line needs BT-47 or BT-48: the group error is visible, navigable, and cleared by either alone', () => {
  const state = withLines(['19', 'reverse-charge']);
  const result = checkForm(state);
  assert.ok(!result.ok);
  const item = result.items.find((entry) => entry.code === 'missing_buyer_identifier');
  assert.deepEqual([item?.path, item?.section, item?.kind, item?.fieldId], ['buyer', 'buyer', 'missing', 'buyer.vatId']);
  assert.equal(hasReverseCharge(state), true);
  state.fields['buyer.legalRegistrationId'] = 'HRB 99';
  assert.deepEqual(codes(state), []);
  state.fields['buyer.legalRegistrationId'] = '';
  state.fields['buyer.vatId'] = 'DE987654321';
  assert.deepEqual(codes(state), []);
  // no Reverse Charge line (or Kleinunternehmer): neither is required
  const standard = withLines(['19', '7']);
  assert.equal(hasReverseCharge(standard), false);
  assert.deepEqual(codes(standard), []);
  const ku = withLines(['reverse-charge'], 'kleinunternehmer');
  assert.equal(hasReverseCharge(ku), false);
  assert.deepEqual(codes(ku), []);
});

test('seller identification stays two separate groups, both required, on a regular and on a Kleinunternehmer form', () => {
  const sellerFields = ['seller.vatId', 'seller.taxRegistrationId', 'seller.legalRegistrationId', 'seller.sellerIdentifiers[0]'] as const;
  const seller = (set: Partial<Record<(typeof sellerFields)[number], string>>, regime: FormState['vatRegime']) => {
    const state = withLines(['19'], regime);
    for (const id of sellerFields) state.fields[id] = '';
    Object.assign(state.fields, set);
    return codes(state);
  };
  for (const regime of ['regular', 'kleinunternehmer'] as const) {
    assert.deepEqual(seller({ 'seller.vatId': 'DE123456789' }, regime), [], `BT-31 alone (${regime})`);
    assert.deepEqual(seller({ 'seller.taxRegistrationId': '12/345/67890' }, regime), ['missing_seller_identification@seller'], `BT-32 alone (${regime})`);
    assert.deepEqual(seller({ 'seller.legalRegistrationId': 'HRB 1' }, regime), ['missing_seller_tax_identifier@seller'], `BT-30 alone (${regime})`);
    assert.deepEqual(seller({ 'seller.sellerIdentifiers[0]': 'K-1' }, regime), ['missing_seller_tax_identifier@seller'], `BT-29 alone (${regime})`);
    assert.deepEqual(seller({ 'seller.taxRegistrationId': '12/345/67890', 'seller.legalRegistrationId': 'HRB 1' }, regime), [], `BT-32+BT-30 (${regime})`);
    assert.deepEqual(seller({ 'seller.taxRegistrationId': '12/345/67890', 'seller.sellerIdentifiers[0]': 'K-1' }, regime), [], `BT-32+BT-29 (${regime})`);
  }
});

// ---------------------------------------------------------------- summary rail

test('VAT buckets are identified by treatment and rate, and E and AE are never labelled as an ordinary 0 % VAT', () => {
  const calculated = calculateInvoiceTotals({
    documentTypeCode: '380', currency: 'EUR',
    lines: [
      { quantity: '1', unitPrice: '100', vat: { treatment: 'standard', category: 'S', rate: '19' } },
      { quantity: '1', unitPrice: '100', vat: { treatment: 'standard', category: 'S', rate: '7' } },
      { quantity: '1', unitPrice: '100', vat: { treatment: 'reverse-charge', category: 'AE', rate: '0' } },
      { quantity: '1', unitPrice: '100', vat: { treatment: 'kleinunternehmer', category: 'E', rate: '0' } }, // the preview does not check the composition
    ],
  });
  assert.ok(calculated.ok);
  const buckets = calculated.value.vatBreakdown;
  const keys = buckets.map(vatBucketKey);
  assert.equal(new Set(keys).size, 4, keys.join(','));
  for (const locale of locales) {
    const labels = buckets.map((bucket) => vatBucketLabel(bucket, '100,00 EUR', locale));
    assert.equal(new Set(labels).size, 4, labels.join(' | '));
    for (const bucket of buckets) {
      const label = vatBucketLabel(bucket, '100,00 EUR', locale);
      if (bucket.treatment === 'standard') assert.match(label, new RegExp(`${bucket.rate} %`));
      else {
        assert.doesNotMatch(label, /(?:USt|VAT) 0 ?%/);
        assert.match(label, bucket.treatment === 'reverse-charge' ? /Reverse Charge \(§ 13b UStG\)/ : /Kleinunternehmer \(§ 19 UStG\)/);
      }
    }
  }
  // the totals shown remain the domain's: the preview of a form is the domain's own calculation
  const preview = previewTotals(withLines(['19', 'reverse-charge']));
  assert.ok(preview.ok);
  assert.deepEqual(preview.totals.vatBreakdown.map(vatBucketKey).length, 2);
});

// ---------------------------------------------------------------- fixed reasons and copy

test('the read-only reasons shown are the domain constants: Kleinunternehmer (BT-120, BT-33) and Reverse Charge (BT-120), no BT-121', () => {
  assert.deepEqual(activeFixedReasons(withLines(['19', '7'])), []);
  assert.deepEqual(activeFixedReasons(withLines(['19', 'reverse-charge'])), [{ treatment: 'reverse-charge', text: REVERSE_CHARGE_TEXT, terms: ['BT-120'] }]);
  assert.deepEqual(activeFixedReasons(withLines(['19', 'reverse-charge'], 'kleinunternehmer')), [
    { treatment: 'kleinunternehmer', text: KLEINUNTERNEHMER_EXEMPTION_TEXT, terms: ['BT-120', 'BT-33'] },
  ]);
});

test('every diagnostic the interface can now produce has a specific text; only the unreachable mixed-treatment code stays generic', () => {
  const generic = /Außerhalb des unterstützten Funktionsumfangs|Outside what this tool supports/;
  for (const locale of locales) {
    assert.doesNotMatch(errorMessages.missing_buyer_identifier[locale], generic);
    assert.match(errorMessages.missing_buyer_identifier[locale], /BT-47/);
    assert.match(errorMessages.missing_buyer_identifier[locale], /BT-48/);
    assert.match(errorMessages.missing_buyer_identifier[locale], /Reverse[- ]Charge/);
    assert.match(errorMessages.unsupported_vat_rate[locale], /Reverse Charge/);
    assert.match(errorMessages.unsupported_mixed_vat_treatments[locale], generic);
    assert.match(describeError('missing_buyer_identifier', 'buyer', locale), /\S/);
  }
});

test('regime, treatment and identifier copy exists in both languages with the agreed working labels', () => {
  const keys = ['vatRegime.legend', 'vatRegime.regular', 'vatRegime.kleinunternehmer', 'vatRegime.hint', 'vatRegime.kuSellerHint', 'vat.reverseCharge', 'vat.fixedKu', 'grp.buyerId', 'grp.buyerIdHint', 'grp.buyerIdHintRc', 'reason.title', 'reason.ku', 'reason.rc', 'rail.vatKu', 'rail.vatRc'] as const;
  for (const key of keys) for (const locale of locales) assert.ok(copy[key][locale].trim().length > 0, `${key} (${locale})`);
  assert.equal(copy['vatRegime.regular'].de, 'Reguläre Besteuerung / Reverse Charge');
  assert.equal(copy['vatRegime.kleinunternehmer'].de, 'Kleinunternehmer (§ 19 UStG)');
  assert.match(copy['vatRegime.regular'].en, /Reverse Charge/);
  assert.match(copy['vatRegime.kleinunternehmer'].en, /§ 19 UStG/);
});

// EO eo-s3-no-eligibility-claim: over every user-visible Slice 3 string (copy, diagnostics, scope note, help) no sentence may say the tool
// checks, confirms, determines or grants entitlement under § 19 UStG / § 13b UStG unless it is explicitly negated.
const SUBJECT = /§ ?19|§ ?13b|Kleinunternehmer|Steuerschuldnerschaft|Reverse[- ]Charge/i;
const ASSERTS = /prüft|geprüft|bestätigt|feststell|festgestellt|ermittelt|entscheidet|berechtigt|Anspruch|zutrifft|anzuwenden|verified|confirm|determin|checks?\b|checked|decides|eligible|entitled|applies|applicable/i;
const NEGATED = /\b(nicht|weder|noch|kein|keine|keinen|keiner|keines|nie|not|neither|nor|never|no|none)\b|\bohne\b|\bwithout\b/i;
const claimsWithoutNegation = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n/).filter((sentence) => SUBJECT.test(sentence) && ASSERTS.test(sentence) && !NEGATED.test(sentence));

test('the eligibility-claim detector rejects real claims and accepts negations (so the scan below can fail)', () => {
  for (const claim of ['Sie sind nach § 19 UStG berechtigt.', 'Die Anwendbarkeit des § 13b UStG wurde geprüft.', 'You are eligible under § 19 UStG.', 'The tool confirms that Reverse Charge applies.', 'Das Werkzeug stellt fest, dass § 19 UStG zutrifft.']) {
    assert.equal(claimsWithoutNegation(claim).length, 1, claim);
  }
  for (const fine of ['Das Werkzeug prüft weder, ob § 19 UStG auf Sie zutrifft, noch ob § 13b UStG anzuwenden ist.', 'The tool does not check whether § 19 UStG applies to you.', 'Kleinunternehmer (§ 19 UStG)']) {
    assert.deepEqual(claimsWithoutNegation(fine), [], fine);
  }
});

test('no user-visible Slice 3 string states or implies that the tool determined entitlement under § 19 UStG or applicability of § 13b UStG', () => {
  const strings: { where: string; text: string }[] = [];
  for (const [key, message] of Object.entries(copy)) for (const locale of locales) strings.push({ where: `copy.${key} (${locale})`, text: message[locale] });
  for (const [code, message] of Object.entries(errorMessages)) for (const locale of locales) strings.push({ where: `error.${code} (${locale})`, text: message[locale] });
  for (const [group, lists] of Object.entries(scopeLists)) for (const locale of locales) for (const line of lists[locale]) strings.push({ where: `scope.${group} (${locale})`, text: line });
  for (const [id, entry] of Object.entries(helpEntries)) {
    for (const locale of locales) {
      const text = entry[locale] as Record<string, unknown>;
      for (const [field, value] of Object.entries(text)) {
        if (typeof value === 'string') strings.push({ where: `help.${id}.${field} (${locale})`, text: value });
        else if (Array.isArray(value)) for (const item of value) strings.push({ where: `help.${id}.${field} (${locale})`, text: typeof item === 'string' ? item : JSON.stringify(item) });
      }
    }
  }
  assert.ok(strings.length > 500, `scanned ${strings.length} strings`);
  const offenders = strings.flatMap(({ where, text }) => claimsWithoutNegation(text).map((sentence) => `${where}: ${sentence}`));
  assert.deepEqual(offenders, []);
});

test('the Reverse Charge help restates § 14a Abs. 5 UStG no wider than its wording (a § 13b Abs. 2 supply for which the recipient owes the tax)', () => {
  for (const id of ['vatRate', 'vatRegime'] as const) {
    assert.match(JSON.stringify(helpEntries[id].de.external), /§ 13b Abs\. 2 UStG.*§ 13b Abs\. 5/, id);
    assert.match(JSON.stringify(helpEntries[id].en.external), /§ 13b\(2\) UStG.*§ 13b\(5\) UStG/, id);
  }
});

test('the totals on the document key VAT buckets by treatment and rate and caption them by treatment', () => {
  // MDR-46 retired the summary rail; the same assertions apply to every component that presents the VAT breakdown.
  const directory = new URL('../../src/components/tools/xrechnung/', import.meta.url);
  const presenting = readdirSync(directory).filter((file) => file.endsWith('.svelte') && readFileSync(new URL(file, directory), 'utf8').includes('vatBreakdown'));
  assert.deepEqual(presenting, ['LinesEditor.svelte']);
  for (const file of presenting) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    assert.match(source, /\{#each totals\.vatBreakdown as bucket \(vatBucketKey\(bucket\)\)\}/, file);
    assert.match(source, /vatBucketLabel\(bucket,/, file);
    assert.doesNotMatch(source, /\(bucket\.rate\)/, file);
    assert.doesNotMatch(source, /rail\.vatLine/, file);
  }
});

test('the lines editor shows fixed text instead of a choice in Kleinunternehmer mode and offers Reverse Charge in the regular regime', () => {
  const source = readFileSync(new URL('../../src/components/tools/xrechnung/LinesEditor.svelte', import.meta.url), 'utf8');
  assert.match(source, /\{#if regime === 'kleinunternehmer'\}[\s\S]*?vat\.fixedKu[\s\S]*?\{:else\}[\s\S]*?<select id=\{id\(i, 'vat\.rate'\)\}[\s\S]*?\{#each vatOptions as option/);
  // The Kleinunternehmer branch is fixed text only: it holds no control that could carry a line treatment.
  const kuStart = source.indexOf("{#if regime === 'kleinunternehmer'}");
  assert.doesNotMatch(source.slice(kuStart, source.indexOf('{:else}', kuStart)), /<(select|input|textarea|Field)\b/);
  // The regular regime offers exactly 19 %, 7 % and Reverse Charge.
  const options = /const vatOptions = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
  assert.deepEqual([...options.matchAll(/value: '([^']+)'/g)].map((match) => match[1]), ['19', '7', 'reverse-charge']);
  assert.match(source, /value: 'reverse-charge', label: copy\['vat\.reverseCharge'\]\[locale\]/);
  const workspace = readFileSync(new URL('../../src/components/tools/xrechnung/XRechnungWorkspace.svelte', import.meta.url), 'utf8');
  assert.match(workspace, /name="vatRegime" value="regular" bind:group=\{form\.vatRegime\}/);
  assert.match(workspace, /regime=\{form\.vatRegime\}/);
  // The closed select truncates the Reverse Charge label, so the full label is repeated visibly (hidden from the accessibility tree, where the select names it).
  assert.match(source, /\{#if line\.vatRate === 'reverse-charge'\}<span class="vat-full" aria-hidden="true">\{copy\['vat\.reverseCharge'\]\[locale\]\}<\/span>\{\/if\}/);
});

test('the buyer identifier group states its condition visibly and in each field\'s description, without marking either field required', () => {
  const workspace = readFileSync(new URL('../../src/components/tools/xrechnung/XRechnungWorkspace.svelte', import.meta.url), 'utf8');
  assert.match(workspace, /<p class="group-hint" class:active=\{buyerNeedsId\} id="buyer-id-hint">\{buyerNeedsId \? copy\['grp\.buyerIdHintRc'\]/);
  for (const id of ['buyer.vatId', 'buyer.legalRegistrationId']) {
    const field = workspace.match(new RegExp(`<Field id="${id.replace('.', '\\.')}"[^\\n]*/>`))?.[0] ?? '';
    assert.match(field, /optionalMark describedById="buyer-id-hint"/, id);
    assert.doesNotMatch(field, /\brequired\b/, id);
  }
  for (const locale of locales) {
    assert.match(copy['grp.buyerId'][locale], locale === 'de' ? /bei Reverse Charge mindestens eine/ : /at least one with Reverse Charge/);
    assert.match(copy['grp.buyerIdHintRc'][locale], /BT-48[\s\S]*BT-47/);
  }
});

test('help separates the external rule, the Orkaid profile restriction, the user\'s responsibility and what is not verified', () => {
  for (const id of ['vatRegime', 'vatRate', 'buyerIdentification'] as const) {
    for (const locale of locales) {
      const entry = helpEntries[id][locale] as { external?: readonly string[]; profile?: readonly string[]; unverified?: readonly string[] };
      assert.ok((entry.external?.length ?? 0) > 0 || id === 'vatRate', `${id} external (${locale})`);
      assert.ok((entry.profile?.length ?? 0) > 0, `${id} profile (${locale})`);
      assert.ok((entry.unverified?.length ?? 0) > 0, `${id} unverified (${locale})`);
    }
    assert.equal(helpEntries[id].de.profile?.length, helpEntries[id].en.profile?.length);
    assert.equal(helpEntries[id].de.external?.length ?? 0, helpEntries[id].en.external?.length ?? 0);
  }
  const unverified = (id: 'vatRegime' | 'vatRate', locale: 'de' | 'en') => (helpEntries[id][locale] as { unverified?: readonly string[] }).unverified?.join(' ') ?? '';
  assert.match(unverified('vatRegime', 'de'), /§ 19/);
  assert.match(unverified('vatRegime', 'de'), /§ 13b/);
  assert.match(unverified('vatRegime', 'en'), /§ 19/);
  assert.match(unverified('vatRegime', 'en'), /§ 13b/);
});

test('the Kleinunternehmer seller-identifier explanation states the whole invariant and recommends nothing for a Steuernummer-only seller', () => {
  const text = (locale: 'de' | 'en') => JSON.stringify([helpEntries.vatRegime[locale], helpEntries.sellerTaxNumber[locale], helpEntries.sellerIdentification[locale]]);
  for (const locale of locales) {
    const all = text(locale);
    for (const needle of ['BT-31', 'BT-32', 'BT-29', 'BT-30']) assert.match(all, new RegExp(needle));
  }
  assert.match(text('en'), /BT-32 alone does not satisfy/);
  assert.match(text('en'), /BT-29 or BT-30 alone does not/);
  assert.match(text('de'), /BT-32 allein erfüllt/);
  assert.match(text('de'), /BT-29 oder BT-30 allein/);
  assert.doesNotMatch(text('en'), /(?:we|you) (?:recommend|should|must) (?:use|enter|obtain)/i);
  assert.match(text('en'), /no recommendation/i);
  assert.match(text('de'), /keine Empfehlung/);
});

test('scope note: Kleinunternehmer and Reverse Charge are available, the rest stays in the domain core', () => {
  const now = (l: 'de' | 'en') => scopeLists.now[l].join(' | ');
  const core = (l: 'de' | 'en') => scopeLists.core[l].join(' | ');
  assert.match(now('en'), /Kleinunternehmer/);
  assert.match(now('en'), /Reverse Charge/i);
  assert.doesNotMatch(core('en'), /Kleinunternehmer|Reverse charge/i);
  assert.match(core('en'), /381/);
  assert.match(core('en'), /Skonto/);
  assert.match(now('de'), /Kleinunternehmer/);
  assert.doesNotMatch(core('de'), /Kleinunternehmer|Reverse Charge/);
  assert.equal(scopeLists.now.de.length, scopeLists.now.en.length);
  assert.equal(scopeLists.core.de.length, scopeLists.core.en.length);
  assert.equal(scopeLists.out.de.length, scopeLists.out.en.length);
});

// Four different things stay apart: what the interface supports, the combination the frozen profile rejects, application
// features that do not exist, and the statutory eligibility the tool does not determine.
test('scope note keeps supported, profile-unsupported, missing-feature and not-determined-eligibility statements in their own places', () => {
  for (const locale of locales) {
    const now = scopeLists.now[locale].join(' | ');
    assert.doesNotMatch(now, /nicht mit|not combinable|Einschränkung|restriction|Kleinunternehmer[^|]*(?:zusammen mit|together with)/i, `now (${locale})`);
    assert.doesNotMatch(now, /prüft weder|checks neither|§ 13b UStG noch|nor the applicability/, `now (${locale})`);
    const out = scopeLists.out[locale].join(' | ');
    assert.match(out, locale === 'de' ? /Kleinunternehmer \(§ 19 UStG\) zusammen mit 19 %, 7 % oder Reverse Charge in einer Rechnung/ : /Kleinunternehmer \(§ 19 UStG\) together with 19%, 7% or Reverse Charge in one invoice/);
    assert.doesNotMatch(scopeLists.tool[locale].join(' | '), /Kleinunternehmer|Reverse Charge|§ 19|§ 13b/);
    assert.doesNotMatch(scopeLists.core[locale].join(' | '), /§ 19|§ 13b/);
    assert.match(copy['scope.disclaimer'][locale], locale === 'de' ? /prüft weder die Voraussetzungen des § 19 UStG noch die Anwendbarkeit des § 13b UStG/ : /checks neither the conditions of § 19 UStG nor the applicability of § 13b UStG/);
  }
});
