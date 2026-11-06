import assert from 'node:assert/strict';
import test from 'node:test';

import { FIELD_IDS } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, errorMessages, labelFor, LABEL_KEYS, unitLabels } from '../../src/i18n/xrechnung.ts';
import { helpEntries, type HelpEntry } from '../../src/i18n/xrechnung-help.ts';
import { UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';

const locales = ['de', 'en'] as const;

test('every form field has a label in both languages', () => {
  for (const id of FIELD_IDS) {
    assert.ok(LABEL_KEYS[id], `${id} has a label key`);
    for (const locale of locales) assert.notEqual(labelFor(id, locale), id, `${id} label (${locale})`);
  }
  for (const key of ['lines.name', 'lines.unitCode', 'lines.quantity', 'lines.unitPrice', 'lines.vat.rate']) assert.ok(LABEL_KEYS[key]);
});

test('no copy or error text is empty or leaves a placeholder unfilled, and DE and EN differ', () => {
  for (const [key, message] of Object.entries(copy)) for (const locale of locales) assert.ok(message[locale].trim().length > 0, `${key} (${locale})`);
  for (const [code, message] of Object.entries(errorMessages)) {
    for (const locale of locales) {
      const text = describeError(code as keyof typeof errorMessages, 'seller.name', locale);
      assert.ok(text.length > 0 && !/[{}]/.test(text), `${code} (${locale}): ${text}`);
      assert.ok(message[locale].length > 0);
    }
  }
  assert.notEqual(errorMessages.missing_field.de, errorMessages.missing_field.en);
});

test('every unit code the profile supports has a display label in both languages', () => {
  for (const code of UNIT_CODES) for (const locale of locales) assert.ok(unitLabels[code]?.[locale], `${code} (${locale})`);
});

test('every help entry names its sources and its mistakes are real diagnostics', () => {
  for (const [id, entry] of Object.entries<HelpEntry>(helpEntries)) {
    assert.ok(entry.sources.length > 0, `${id} has sources`);
    for (const code of entry.mistakes ?? []) assert.ok(code in errorMessages, `${id}: ${code}`);
    for (const locale of locales) {
      const text = entry[locale];
      assert.ok(text.title && text.short && text.enter, `${id} (${locale}) core text`);
      // A conditional entry must say under which condition; a section overview lists its fields.
      if (text.status === 'conditional') assert.ok(text.condition, `${id} (${locale}) condition`);
    }
    // The two languages describe the same structure.
    assert.equal(entry.de.invalid?.length ?? 0, entry.en.invalid?.length ?? 0, `${id} invalid examples`);
    assert.equal(entry.de.external?.length ?? 0, entry.en.external?.length ?? 0, `${id} external rules`);
    assert.equal(entry.de.profile?.length ?? 0, entry.en.profile?.length ?? 0, `${id} profile restrictions`);
    assert.equal(entry.de.unverified?.length ?? 0, entry.en.unverified?.length ?? 0, `${id} unverified`);
  }
});

test('no user-facing text claims validation, certification or acceptance of the user document', () => {
  const forbidden = /KoSIT-valid|zertifiziert|certified|fully compliant|vollständig konform|recipient accepted|Empfänger akzeptiert/i;
  for (const [key, message] of Object.entries(copy)) for (const locale of locales) assert.doesNotMatch(message[locale], forbidden, key);
  for (const message of Object.values(errorMessages)) for (const locale of locales) assert.doesNotMatch(message[locale], forbidden);
});
