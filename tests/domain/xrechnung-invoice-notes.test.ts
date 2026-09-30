import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withValue, type JsonObject } from '../support/fixtures.ts';
import { childNames, one, parseXml, select, textAt } from '../support/xml.ts';

// BT-22, invoice note (BG-1, 0..n). Expectations come from the pinned KoSIT configuration 2026-08-31, not from the code
// under test: SeMoX CIUS model (BG-1 0..unbounded, BT-22 1..1 inside it, datatype "text" = line breaks allowed and no
// field length limit; UBL /Invoice/cbc:Note, CII /rsm:ExchangedDocument/ram:IncludedNote/ram:Content), the UBL 2.1 and
// CII D16B XSD sequences, and Schematron CII-SR-027/028/032 (no Subject, ContentCode or ID on a header note).
// EXTERNAL: the above. PROFILE (Orkaid engineering choices, not EN 16931/XRechnung claims): LF only, CR and other C0
// controls rejected, no trimming, PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH.

const base = () => loadFixtureInput('a-simple');
const withNotes = (notes: unknown): JsonObject => withValue(base(), 'notes', notes);

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  return result.ok ? result.value : assert.fail(`expected success: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
}

function rejected(input: JsonObject): readonly string[] {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected rejection');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
}

const ublRoot = (invoice: Invoice) => {
  const r = serializeUblInvoice(invoice);
  return r.ok ? parseXml(r.xml) : assert.fail('ubl');
};
const ciiRoot = (invoice: Invoice) => {
  const r = serializeCiiInvoice(invoice);
  return r.ok ? parseXml(r.xml) : assert.fail('cii');
};
const ublNotes = (invoice: Invoice) => select(ublRoot(invoice), 'cbc:Note').map((n) => n.text);
const ciiNotes = (invoice: Invoice) => select(ciiRoot(invoice), 'rsm:ExchangedDocument/ram:IncludedNote/ram:Content').map((n) => n.text);

// ------------------------------------------------------------------------------------------------ positive

test('BT-22: no notes (absent or empty) gives an empty collection and no note element in either syntax', () => {
  for (const input of [base(), withNotes([])]) {
    const invoice = built(input);
    assert.deepEqual(invoice.notes, []);
    assert.equal(select(ublRoot(invoice), 'cbc:Note').length, 0);
    assert.equal(select(ciiRoot(invoice), 'rsm:ExchangedDocument/ram:IncludedNote').length, 0);
  }
});

test('BT-22: a single note is carried in domain, UBL cbc:Note and CII ram:IncludedNote/ram:Content', () => {
  const invoice = built(withNotes([{ text: 'Zahlbar innerhalb von 14 Tagen.' }]));
  assert.deepEqual(invoice.notes, [{ text: 'Zahlbar innerhalb von 14 Tagen.' }]);
  assert.deepEqual(ublNotes(invoice), ['Zahlbar innerhalb von 14 Tagen.']);
  assert.deepEqual(ciiNotes(invoice), ['Zahlbar innerhalb von 14 Tagen.']);
});

test('BT-22: several notes stay separate, in input order, one element each (0..n)', () => {
  const texts = ['Erste Notiz', 'Zweite Notiz', 'Dritte Notiz', 'Erste Notiz'];
  const invoice = built(withNotes(texts.map((text) => ({ text }))));
  assert.deepEqual(invoice.notes.map((n) => n.text), texts);
  assert.deepEqual(ublNotes(invoice), texts);
  assert.deepEqual(ciiNotes(invoice), texts);
});

test('BT-22: element order follows the XSD sequences; a CII note carries only ram:Content (no BT-21, no Subject/ID)', () => {
  const invoice = built(withNotes([{ text: 'A' }, { text: 'B' }]));
  // UBL 2.1 Invoice: ... IssueDate, DueDate, InvoiceTypeCode, Note*, ..., DocumentCurrencyCode
  const ubl = childNames(ublRoot(invoice));
  assert.deepEqual(ubl.slice(ubl.indexOf('cbc:InvoiceTypeCode'), ubl.indexOf('cbc:DocumentCurrencyCode') + 1), [
    'cbc:InvoiceTypeCode', 'cbc:Note', 'cbc:Note', 'cbc:DocumentCurrencyCode',
  ]);
  // CII ExchangedDocument: ID, TypeCode, IssueDateTime, ..., IncludedNote*
  const document = one(ciiRoot(invoice), 'rsm:ExchangedDocument');
  assert.deepEqual(childNames(document), ['ram:ID', 'ram:TypeCode', 'ram:IssueDateTime', 'ram:IncludedNote', 'ram:IncludedNote']);
  for (const note of select(document, 'ram:IncludedNote')) assert.deepEqual(childNames(note), ['ram:Content']);
  // No language or subject attributes in either syntax.
  for (const node of select(ublRoot(invoice), 'cbc:Note')) assert.deepEqual(node.attributes, {});
  for (const node of select(document, 'ram:IncludedNote/ram:Content')) assert.deepEqual(node.attributes, {});
});

test('BT-22: a multiline note keeps its LF exactly (blank line, inner trailing space) through domain, UBL and CII', () => {
  const text = 'Line one\nLine two  \n\nLine four';
  const invoice = built(withNotes([{ text }]));
  assert.equal(invoice.notes[0]?.text, text);
  assert.deepEqual(ublNotes(invoice), [text]);
  assert.deepEqual(ciiNotes(invoice), [text]);
  const xml = serializeUblInvoice(invoice);
  assert.ok(xml.ok && xml.xml.includes(`<cbc:Note>${text}</cbc:Note>`), 'LF written as-is, not as an entity or normalised');
});

test('BT-22: markup characters are escaped in both syntaxes and round-trip', () => {
  const text = 'A & B <tag> "quoted"';
  const invoice = built(withNotes([{ text }]));
  assert.deepEqual(ublNotes(invoice), [text]);
  assert.deepEqual(ciiNotes(invoice), [text]);
  const xml = serializeCiiInvoice(invoice);
  assert.ok(xml.ok && xml.xml.includes('A &amp; B &lt;tag&gt;'));
});

test('BT-22: the validated collection is frozen and independent of later changes to the caller input', () => {
  const input = withNotes([{ text: 'one' }]);
  const invoice = built(input);
  (input.notes as { text: string }[])[0]!.text = 'changed';
  (input.notes as { text: string }[]).push({ text: 'two' });
  assert.deepEqual(invoice.notes, [{ text: 'one' }]);
  assert.ok(Object.isFrozen(invoice.notes) && Object.isFrozen(invoice.notes[0]));
});

// ------------------------------------------------------------------------------------------------ not a tax reason

test('BT-22: exemption reasons (BT-120) are never copied into notes; an identical caller-supplied note is emitted once', () => {
  for (const name of ['e-kleinunternehmer', 'g-reverse-charge-vat-ids'] as const) {
    const input = loadFixtureInput(name);
    const invoice = built(input);
    assert.deepEqual(invoice.notes, [], `${name}: no synthesised note`);
    assert.equal(select(ublRoot(invoice), 'cbc:Note').length, 0);
    assert.equal(select(ciiRoot(invoice), 'rsm:ExchangedDocument/ram:IncludedNote').length, 0);
    const bucket = invoice.totals.vatBreakdown[0];
    const reason = bucket !== undefined && bucket.treatment !== 'standard' ? bucket.exemptionReason : undefined;
    assert.ok(typeof reason === 'string' && reason.length > 0);
    assert.equal(textAt(ublRoot(invoice), 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReason'), reason);

    const own = built(withValue(input, 'notes', [{ text: reason }]));
    assert.deepEqual(ublNotes(own), [reason], `${name}: the caller's own note, once`);
    assert.deepEqual(ciiNotes(own), [reason]);
    assert.equal(select(ublRoot(own), 'cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReason').length, 1);
  }
});

// ------------------------------------------------------------------------------------------------ negative (PROFILE and shape)

test('BT-22: empty and whitespace-only text is rejected, at the note path', () => {
  assert.deepEqual(rejected(withNotes([{ text: '' }])), ['empty_text@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 'ok' }, { text: ' \n ' }])), ['empty_text@notes[1].text']);
});

test('BT-22: shape errors: note not an object, missing text, non-string text, notes not an array', () => {
  assert.deepEqual(rejected(withNotes(['plain string'])), ['invalid_type@notes[0]']);
  assert.deepEqual(rejected(withNotes([null])), ['invalid_type@notes[0]']);
  assert.deepEqual(rejected(withNotes([{}])), ['missing_field@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 5 }])), ['invalid_type@notes[0].text']);
  assert.deepEqual(rejected(withNotes({ text: 'x' })), ['invalid_type@notes']);
});

test('BT-22: unknown note fields are rejected, including BT-21-like ones (BT-21 is not in M1)', () => {
  assert.deepEqual(rejected(withNotes([{ text: 'x', subjectCode: 'AAI' }])), ['unknown_field@notes[0].subjectCode']);
  assert.deepEqual(rejected(withNotes([{ text: 'x', subject: 'AAI' }])), ['unknown_field@notes[0].subject']);
});

test('BT-22: control characters are rejected; LF is allowed, CR and CRLF are not (never silently normalised)', () => {
  assert.deepEqual(rejected(withNotes([{ text: 'a\u0007b' }])), ['invalid_text@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 'a\tb' }])), ['invalid_text@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 'a\rb' }])), ['invalid_text@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 'a\r\nb' }])), ['invalid_text@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 'a\u0085b' }])), ['invalid_text@notes[0].text']);
  assert.deepEqual(rejected(withNotes([{ text: 'a b' }])), ['invalid_text@notes[0].text']);
  assert.equal(built(withNotes([{ text: 'a\nb' }])).notes.length, 1);
});

test('BT-22: leading or trailing whitespace (including a line break) is rejected, not trimmed', () => {
  for (const text of [' x', 'x ', '\nx', 'x\n']) assert.deepEqual(rejected(withNotes([{ text }])), ['invalid_text@notes[0].text']);
});

test('BT-22: the defensive length limit is exact, and is larger than the single-line limit', () => {
  assert.ok(PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH > 512);
  const atLimit = 'x'.repeat(PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH);
  assert.equal(built(withNotes([{ text: atLimit }])).notes[0]?.text, atLimit);
  assert.deepEqual(rejected(withNotes([{ text: `${atLimit}x` }])), ['text_too_long@notes[0].text']);
});

test('BT-22: multiline policy is for notes only; single-line fields still reject LF', () => {
  assert.deepEqual(rejected(withValue(base(), 'buyerReference', 'a\nb')), ['invalid_text@buyerReference']);
});
