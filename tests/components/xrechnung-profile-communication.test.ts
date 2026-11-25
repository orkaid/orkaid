// M3 review C5-01, C5-03, C5-04, C5-05: the interface names the implemented profile and its boundaries in both languages.
// Key terms only, so that wording can still be edited; the frozen domain README is the source of each boundary.
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeError, scopeLists } from '../../src/i18n/xrechnung.ts';
import { helpFor } from '../../src/i18n/xrechnung-help.ts';

const locales = ['de', 'en'] as const;
const join = (lines: readonly string[]) => lines.join(' | ');

test('C5-01: the scope names the domestic commercial B2B profile and does not decide whether a case belongs to it', () => {
  assert.match(join(scopeLists.now.de), /Inlandsprofil für gewöhnliche Geschäftsvorgänge zwischen Unternehmen \(B2B\).*prüft das Werkzeug nicht/);
  assert.match(join(scopeLists.now.en), /domestic profile for ordinary commercial transactions between businesses \(B2B\).*does not check/);
});

test('C5-04: allowances and charges at both levels, paid amounts, payment schedules and BG-24 references are named as outside the profile', () => {
  const de = join(scopeLists.out.de);
  const en = join(scopeLists.out.en);
  for (const needle of [/Dokumentebene/, /je Position/, /Bereits gezahlte Beträge.*BT-113/, /strukturierte Zahlungspläne/, /BG-24.*Anhänge.*Verweise/]) assert.match(de, needle);
  for (const needle of [/document level/, /per line/, /already paid.*BT-113/, /structured payment schedules/, /BG-24.*attachments.*references/]) assert.match(en, needle);
});

test('C5-05: tax point BT-7/BT-8, Peppol sending and sign-in are named as unavailable', () => {
  for (const locale of locales) {
    assert.match(join(scopeLists.out[locale]), /BT-7, BT-8/, locale);
    assert.match(join(scopeLists.tool[locale]), /Peppol/, locale);
  }
  assert.match(join(scopeLists.tool.de), /Benutzerkonten und Anmeldung/);
  assert.match(join(scopeLists.tool.en), /User accounts and sign-in/);
});

test('C5-03: due-information guidance names structured Skonto on 380, none on 381, and the positive-amount condition', () => {
  for (const locale of locales) {
    const skonto = locale === 'de' ? /Rechnung \(380\).*Skonto/ : /invoice \(380\).*Skonto/;
    const aboveZero = locale === 'de' ? /Zahlbetrag über null/ : /amount due above zero/;
    const message = describeError('missing_payment_due_information', 'payment', locale);
    assert.match(message, aboveZero, locale);
    assert.match(message, skonto, locale);
    assert.match(helpFor('paymentDue', locale).enter, skonto, locale);
    assert.match(helpFor('sec.payment', locale).enter, aboveZero, locale);
    assert.match(helpFor('sec.payment', locale).enter, /Skonto/, locale);
    const clearing = helpFor('clearing', locale).enter;
    assert.match(clearing, aboveZero, locale);
    assert.match(clearing, locale === 'de' ? /Skonto gibt es bei der Gutschrift nicht/ : /Skonto is not available on a credit note/, locale);
    assert.match(helpFor('skonto', locale).format ?? '', locale === 'de' ? /nachgestellte Nullen zählen nicht/ : /trailing zeros not counted/, locale);
  }
});
