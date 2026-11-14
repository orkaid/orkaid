import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkForm } from '../../src/components/tools/xrechnung/form-adapter.ts';
import { emptyFormState } from '../../src/components/tools/xrechnung/form-state.ts';
import { copy, describeError, scopeLists } from '../../src/i18n/xrechnung.ts';
import { helpEntries } from '../../src/i18n/xrechnung-help.ts';

const locales = ['de', 'en'] as const;
const VALID_IBAN = 'DE79000000001234567890';
const WRONG_CHECKSUM_IBAN = 'DE79000000001234567891'; // well-formed, last digit changed

test('IBAN: the documented example passes the domain, the one-digit change fails with invalid_iban, and input is not normalised', () => {
  const state = emptyFormState();
  const codeFor = (iban: string) => {
    state.fields['payment.means.account.id.value'] = iban;
    const result = checkForm(state);
    return result.ok ? undefined : result.items.find((item) => item.path === 'payment.means.account.id.value')?.code;
  };
  assert.equal(codeFor(VALID_IBAN), undefined);
  assert.equal(codeFor(WRONG_CHECKSUM_IBAN), 'invalid_iban');
  assert.equal(codeFor('DE79 0000 0000 1234 5678 90'), 'invalid_iban');
  assert.equal(codeFor(VALID_IBAN.toLowerCase()), 'invalid_iban');
  assert.equal(state.fields['payment.means.account.id.value'], VALID_IBAN.toLowerCase());
});

test('IBAN: the inline error is concise and points to the help; the detailed checksum guidance stays in the help entry', () => {
  const entry = helpEntries.iban;
  for (const locale of locales) assert.ok(entry[locale].invalid?.some((row) => row.value === WRONG_CHECKSUM_IBAN), locale);
  const de = describeError('invalid_iban', 'payment.means.account.id.value', 'de', 'IBAN');
  const en = describeError('invalid_iban', 'payment.means.account.id.value', 'en', 'IBAN');
  assert.ok(de.length < 150 && en.length < 150, `${de.length}/${en.length}`);
  assert.match(de, /Zeichen, Leerzeichen und Prüfziffern/);
  assert.match(de, /Hilfe/);
  assert.match(en, /characters, spaces and check digits/);
  assert.match(en, /help/);
  assert.match(entry.de.format ?? '', /Prüfziffern.*Modulo 97/);
  assert.match(entry.en.format ?? '', /check digits.*mod 97/);
  assert.match(entry.de.enter, /ohne Leerzeichen/);
  assert.match(entry.en.enter, /without spaces/);
  assert.ok(entry.sources.length > 0);
  for (const locale of locales) assert.match(copy.ibanHint[locale], /./);
});

test('help drawer waits for its content, then focuses the close button on every opening', () => {
  const source = readFileSync(new URL('../../src/components/tools/xrechnung/HelpDrawer.svelte', import.meta.url), 'utf8');
  const open = source.slice(source.indexOf('export async function open'), source.indexOf('const entry'));
  assert.ok(open.indexOf('await tick()') !== -1 && open.indexOf('await tick()') < open.indexOf('showModal()'));
  assert.ok(open.indexOf("querySelector<HTMLElement>('.close')?.focus()") > open.indexOf('showModal()'));
});

test('scope note: four groups in both languages with equal structure; capabilities are placed in the right group', () => {
  for (const key of ['now', 'core', 'out', 'tool'] as const) {
    // The domain-core group is empty once every frozen capability is operable; the scope note then does not show it.
    if (key !== 'core') assert.ok(scopeLists[key].de.length > 0);
    assert.equal(scopeLists[key].de.length, scopeLists[key].en.length, key);
  }
  const core = scopeLists.core.en.join(' | ');
  // Slice 3 (MDR-44) moved Kleinunternehmer and Reverse Charge from the domain core to "available", the credit note slice
  // (MDR-49) moved 381, and the structured Skonto interface slice moved Skonto; the core list is empty.
  assert.equal(scopeLists.core.en.length, 0);
  assert.match(scopeLists.now.en.join(' | '), /Skonto/);
  assert.doesNotMatch(core, /381/);
  assert.match(scopeLists.now.en.join(' | '), /381/);
  for (const needle of ['Kleinunternehmer', 'Reverse Charge']) assert.doesNotMatch(core, new RegExp(needle, 'i'), needle);
  for (const needle of ['Kleinunternehmer', 'Reverse Charge']) assert.match(scopeLists.now.en.join(' | '), new RegExp(needle), needle);
  const out = scopeLists.out.en.join(' | ');
  // A capability of the frozen domain must never be listed as unsupported. Kleinunternehmer and Reverse Charge may appear there
  // only as the combination the profile rejects (Kleinunternehmer together with 19 %, 7 % or Reverse Charge), never on their own.
  for (const needle of ['Skonto', 'Leitweg', 'BG-14']) assert.doesNotMatch(out, new RegExp(needle, 'i'), needle);
  for (const locale of locales) {
    const mentions = scopeLists.out[locale].filter((line) => /Kleinunternehmer|Reverse Charge/i.test(line));
    assert.deepEqual(mentions.length, 1, locale);
    assert.match(mentions[0], locale === 'de' ? /^Kleinunternehmer \(§ 19 UStG\) zusammen mit 19 %, 7 % oder Reverse Charge/ : /^Kleinunternehmer \(§ 19 UStG\) together with 19%, 7% or Reverse Charge/);
  }
  // Application features that do not exist are a category of their own, not invoice scenarios outside the profile.
  assert.doesNotMatch(out, /XML import|PDF/);
  assert.match(scopeLists.tool.en.join(' | '), /XML import/);
  assert.match(scopeLists.tool.en.join(' | '), /PDF/);
  assert.match(scopeLists.tool.de.join(' | '), /XML-Import/);
  assert.match(scopeLists.tool.de.join(' | '), /PDF/);
  assert.equal(copy['scope.toolTitle'].de, 'Nicht verfügbare Werkzeugfunktionen');
  assert.equal(copy['scope.toolTitle'].en, 'Unavailable tool features');
  assert.match(scopeLists.now.en.join(' '), /19%.*7%/);
  assert.match(scopeLists.now.en.join(' '), /30 or 58/);
});

test('scope note never presents tool limits as legal prohibitions', () => {
  const forbidden = /illegal|unlawful|verboten|unzulässig|rechtswidrig|ungültig|invalid/i;
  for (const locale of locales) {
    for (const key of ['now', 'core', 'out', 'tool'] as const) for (const line of scopeLists[key][locale]) assert.doesNotMatch(line, forbidden, line);
    assert.doesNotMatch(copy['scope.summary'][locale], forbidden);
  }
  assert.match(copy['scope.disclaimer'].de, /kein/);
  assert.match(copy['scope.disclaimer'].en, /does not say/);
});
