import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { buildInvoice, isValidatedInvoice, UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';
import { PROVISIONAL_MAX_REPORTED_ERRORS } from '../../src/lib/domain/xrechnung/invoice.ts';
import { EXPECTED, FIXTURE_NAMES, loadFixtureInput, withoutValue, withValue, type JsonObject } from '../support/fixtures.ts';

// The semantic document: business data around the existing monetary calculation. Amounts are never computed here
// (document.ts delegates to invoice.ts), so the expected values are the hand-worked ones in tests/support/fixtures.ts.

const base = () => loadFixtureInput('a-simple');

function failure(input: unknown, options?: Parameters<typeof buildInvoice>[1]) {
  const result = buildInvoice(input, options);
  assert.equal(result.ok, false, 'expected failure');
  return result.ok ? assert.fail('unreachable') : result;
}

const asPairs = (input: unknown) => failure(input).errors.map((e) => `${e.code}@${e.path}`);

// ------------------------------------------------------------------------------------------- valid fixtures

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}: builds, and the amounts equal the independently worked values`, () => {
    const result = buildInvoice(loadFixtureInput(name));
    assert.equal(result.ok, true, JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
    const invoice = result.ok ? result.value : assert.fail('unreachable');
    const expected = EXPECTED[name];

    assert.deepEqual(invoice.lines.map((l) => formatDecimal(l.netAmount)), expected.lineNets); // BT-131
    assert.deepEqual(
      invoice.totals.vatBreakdown.map((b) => ({ rate: b.rate, taxable: formatDecimal(b.taxableAmount), tax: formatDecimal(b.taxAmount) })),
      expected.breakdown,
    ); // BT-116, BT-117
    assert.equal(formatDecimal(invoice.totals.sumOfLineNetAmounts), expected.sumOfLineNets); // BT-106
    assert.equal(formatDecimal(invoice.totals.totalWithoutVat), expected.sumOfLineNets); // BT-109
    assert.equal(formatDecimal(invoice.totals.totalVat), expected.totalVat); // BT-110
    assert.equal(formatDecimal(invoice.totals.totalWithVat), expected.gross); // BT-112
    assert.equal(formatDecimal(invoice.totals.amountDue), expected.gross); // BT-115
  });
}

test('the validated invoice carries the business data and the typed line quantities and prices', () => {
  const result = buildInvoice(loadFixtureInput('c-rounded-line-net'));
  const invoice = result.ok ? result.value : assert.fail('expected success');
  assert.equal(invoice.invoiceNumber, 'RE-2026-0003');
  assert.equal(invoice.seller.vatId, 'DE123456789');
  assert.equal(invoice.buyer.address.city, 'Hamburg');
  assert.equal(invoice.payment.iban, 'DE79000000001234567890');
  assert.deepEqual(
    invoice.lines.map((l) => [l.name, l.unitCode, formatDecimal(l.quantity), formatDecimal(l.unitPrice), l.vatRate]),
    [['Lieferung Kleinmaterial', 'C62', '3', '0.335', '19'], ['Sonderanfertigung', 'KGM', '2.5', '1.999', '19']],
  );
});

test('German, English and canonical notation give the same validated invoice', () => {
  const canonical = { ...base(), lines: [{ ...(base().lines as JsonObject[])[0], quantity: '1234.5', unitPrice: '1234.56', vatRate: '19.00' }] };
  const german = { ...canonical, lines: [{ ...(canonical.lines[0] as JsonObject), quantity: '1.234,5', unitPrice: '1.234,56', vatRate: '19,00' }] };
  const english = { ...canonical, lines: [{ ...(canonical.lines[0] as JsonObject), quantity: '1,234.5', unitPrice: '1,234.56' }] };
  const a = buildInvoice(canonical);
  const b = buildInvoice(german, { notation: 'de' });
  const c = buildInvoice(english, { notation: 'en' });
  assert.equal(a.ok && b.ok && c.ok, true);
  assert.deepEqual(a.ok ? a.value : undefined, b.ok ? b.value : undefined);
  assert.deepEqual(a.ok ? a.value : undefined, c.ok ? c.value : undefined);
  // By hand: 1234.56 x 1000 = 1,234,560.00; x 200 = 246,912.00; x 34 = 41,975.04; x 0.5 = 617.28; sum 1,524,064.32.
  assert.equal(a.ok ? formatDecimal(a.value.totals.sumOfLineNetAmounts) : '', '1524064.32');
});

test('a successful build does not modify the input and repeated builds are identical', () => {
  const input = base();
  const snapshot = structuredClone(input);
  const first = buildInvoice(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(buildInvoice(input), first);
});

// ------------------------------------------------------------------------------------------- the profile

test('input outside the implemented profile fails explicitly, per field, without being called legally invalid', () => {
  const cases: [string, JsonObject, string][] = [
    ['another document type', withValue(base(), 'documentTypeCode', '384'), 'unsupported_document_type@documentTypeCode'],
    ['another currency', withValue(base(), 'currency', 'USD'), 'unsupported_currency@currency'],
    ['a VAT category other than S', withValue(base(), 'lines.0.vatCategory', 'Z'), 'unsupported_vat_category@lines[0].vatCategory'],
    ['a rate other than 19 or 7', withValue(base(), 'lines.0.vatRate', '16'), 'unsupported_vat_rate@lines[0].vatRate'],
    ['a negative amount', withValue(base(), 'lines.0.unitPrice', '-1.00'), 'negative_amount@lines[0].unitPrice'],
    ['a foreign seller country', withValue(base(), 'seller.address.country', 'AT'), 'unsupported_country@seller.address.country'],
    ['a foreign buyer country', withValue(base(), 'buyer.address.country', 'FR'), 'unsupported_country@buyer.address.country'],
    ['a seller electronic address scheme other than EM', withValue(base(), 'seller.electronicAddress.schemeId', '0204'), 'unsupported_electronic_address_scheme@seller.electronicAddress.schemeId'],
    ['a buyer electronic address scheme other than EM', withValue(base(), 'buyer.electronicAddress.schemeId', '9930'), 'unsupported_electronic_address_scheme@buyer.electronicAddress.schemeId'],
    ['a payment means code other than 58', withValue(base(), 'payment.meansCode', '30'), 'unsupported_payment_means@payment.meansCode'],
    ['a unit code outside the supported list', withValue(base(), 'lines.0.unitCode', 'ZZZ'), 'unsupported_unit_code@lines[0].unitCode'],
  ];
  for (const [what, input, expected] of cases) assert.deepEqual(asPairs(input), [expected], what);
});

test('every supported unit code is accepted, and a code that is not on the list is not', () => {
  assert.ok(UNIT_CODES.length > 0 && UNIT_CODES.length <= 10, 'the list stays small and explicit');
  for (const code of UNIT_CODES) assert.equal(buildInvoice(withValue(base(), 'lines.0.unitCode', code)).ok, true, code);
  for (const code of ['c62', 'C62 ', 'X', 'KG', '']) assert.equal(buildInvoice(withValue(base(), 'lines.0.unitCode', code)).ok, false, JSON.stringify(code));
});

test('out-of-profile errors say "unsupported", never that the input is legally invalid', () => {
  const outOfProfile = [
    withValue(base(), 'seller.address.country', 'AT'),
    withValue(base(), 'seller.electronicAddress.schemeId', '0204'),
    withValue(base(), 'payment.meansCode', '30'),
    withValue(base(), 'lines.0.unitCode', 'ZZZ'),
  ];
  for (const input of outOfProfile) {
    const codes = failure(input).errors.map((e) => e.code);
    assert.equal(codes.length, 1);
    assert.match(codes[0] as string, /^unsupported_/);
  }
});

// ------------------------------------------------------------------------------------------- required fields

test('every required business field is reported when it is missing', () => {
  const required = [
    'invoiceNumber', 'issueDate', 'deliveryDate', 'paymentDueDate', 'buyerReference',
    'seller', 'seller.name', 'seller.vatId', 'seller.electronicAddress', 'seller.electronicAddress.value',
    'seller.address', 'seller.address.street', 'seller.address.city', 'seller.address.postCode', 'seller.address.country',
    'seller.contact', 'seller.contact.name', 'seller.contact.telephone', 'seller.contact.email',
    'buyer', 'buyer.name', 'buyer.electronicAddress', 'buyer.address.street', 'buyer.address.city', 'buyer.address.postCode',
    'payment', 'payment.meansCode', 'payment.iban',
    'lines.0.name', 'lines.0.unitCode',
  ];
  for (const path of required) {
    const errors = failure(withoutValue(base(), path)).errors;
    assert.ok(errors.length >= 1 && errors.every((e) => e.code === 'missing_field' || e.path.startsWith(path)), `${path}: ${JSON.stringify(errors)}`);
    assert.ok(errors.some((e) => e.code === 'missing_field'), `${path} reports missing_field`);
  }
});

test('BT-10 is buyer-provided: it is required and never generated or defaulted', () => {
  assert.deepEqual(asPairs(withoutValue(base(), 'buyerReference')), ['missing_field@buyerReference']);
  assert.deepEqual(asPairs(withValue(base(), 'buyerReference', '')), ['empty_text@buyerReference']);
  const ok = buildInvoice(withValue(base(), 'buyerReference', 'any buyer text, not a Leitweg-ID'));
  assert.equal(ok.ok ? ok.value.buyerReference : '', 'any buyer text, not a Leitweg-ID');
});

test('wrong types are reported as invalid_type at the field', () => {
  assert.deepEqual(asPairs(withValue(base(), 'invoiceNumber', 42)), ['invalid_type@invoiceNumber']);
  assert.deepEqual(asPairs(withValue(base(), 'seller', 'text')), ['invalid_type@seller']);
  assert.deepEqual(asPairs(withValue(base(), 'seller.address.city', null)), ['invalid_type@seller.address.city']);
  assert.deepEqual(asPairs('text'), ['invalid_type@']);
  assert.deepEqual(asPairs(null), ['invalid_type@']);
  assert.deepEqual(asPairs([]), ['invalid_type@']);
});

test('unknown fields are rejected at every level', () => {
  for (const path of ['surplus', 'seller.surplus', 'seller.address.surplus', 'seller.contact.surplus', 'seller.electronicAddress.surplus', 'buyer.surplus', 'payment.surplus']) {
    assert.deepEqual(asPairs(withValue(base(), path, 'x')), [`unknown_field@${path}`], path);
  }
  assert.deepEqual(asPairs(withValue(base(), 'lines.0.surplus', 'x')), ['unknown_field@lines[0].surplus']);
});

// ------------------------------------------------------------------------------------------- field validation

test('text fields: empty, padded, control-character, illegal-XML and over-long values are rejected, never trimmed', () => {
  const bad: [unknown, string][] = [
    ['', 'empty_text'],
    ['   ', 'empty_text'],
    [' padded', 'invalid_text'],
    ['padded ', 'invalid_text'],
    ['line\nbreak', 'invalid_text'],
    ['tab\there', 'invalid_text'],
    ['nul\u0000char', 'invalid_text'],
    ['bell\u0007', 'invalid_text'],
    ['c1\u0085control', 'invalid_text'],
    ['nonchar￾', 'invalid_text'],
    ['lone\uD800surrogate', 'invalid_text'],
    ['lone\uDC00surrogate', 'invalid_text'],
    ['x'.repeat(513), 'text_too_long'],
  ];
  for (const [value, code] of bad) assert.deepEqual(asPairs(withValue(base(), 'buyer.name', value)), [`${code}@buyer.name`], JSON.stringify(value));
});

test('text fields accept umlauts, sharp s, symbols, supplementary-plane characters and markup characters', () => {
  for (const value of ['Müller & Söhne GmbH', 'Straße', 'A < B > C "quoted" \'single\'', 'Preis in € pro Stück', 'Emoji 😀 test']) {
    const result = buildInvoice(withValue(base(), 'buyer.name', value));
    assert.equal(result.ok ? result.value.buyer.name : undefined, value);
  }
});

test('dates must be real calendar dates in YYYY-MM-DD form', () => {
  const good = ['2026-09-24', '2024-02-29', '2000-02-29', '2026-12-31', '0001-01-01'];
  for (const date of good) assert.equal(buildInvoice(withValue(base(), 'issueDate', date)).ok, true, date);
  const bad = ['2026-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '2026-9-24', '24.09.2026', '2026-09-24T10:00:00', '2026-09-24 ', '', 20260924, null];
  for (const date of bad) {
    const errors = asPairs(withValue(base(), 'issueDate', date));
    assert.equal(errors.length, 1, JSON.stringify(date));
    assert.match(errors[0] as string, /^(invalid_date|invalid_text|empty_text|invalid_type)@issueDate$/, JSON.stringify(date));
  }
  assert.deepEqual(asPairs(withValue(base(), 'deliveryDate', '2026-02-30')), ['invalid_date@deliveryDate']);
  assert.deepEqual(asPairs(withValue(base(), 'paymentDueDate', '2026-10-32')), ['invalid_date@paymentDueDate']);
});

test('the seller USt-IdNr must be DE followed by nine digits', () => {
  for (const vatId of ['DE123456789', 'DE000000000']) assert.equal(buildInvoice(withValue(base(), 'seller.vatId', vatId)).ok, true, vatId);
  for (const vatId of ['DE12345678', 'DE1234567890', 'de123456789', 'DE 123456789', 'AT123456789', 'DE12345678X', '123456789']) {
    assert.deepEqual(asPairs(withValue(base(), 'seller.vatId', vatId)), ['invalid_vat_id@seller.vatId'], vatId);
  }
});

test('the IBAN must pass the ISO 13616 mod-97 check and is not normalised', () => {
  for (const iban of ['DE79000000001234567890', 'DE89370400440532013000', 'GB82WEST12345698765432']) {
    assert.equal(buildInvoice(withValue(base(), 'payment.iban', iban)).ok, true, iban);
  }
  for (const iban of ['DE79000000001234567891', 'DE89370400440532013001', 'DE00000000001234567890', 'de79000000001234567890', 'DE79 0000 0000 1234 5678 90', 'DE79', 'DE79000000001234567890X1234567890123456789012345']) {
    assert.deepEqual(asPairs(withValue(base(), 'payment.iban', iban)), ['invalid_iban@payment.iban'], iban);
  }
});

test('contact and electronic addresses: e-mail shape and at least three digits in the telephone number', () => {
  for (const email of ['a@b.de', 'erika.muster@example.com', 'x@sub.example.co.uk']) {
    assert.equal(buildInvoice(withValue(base(), 'seller.contact.email', email)).ok, true, email);
  }
  for (const email of ['no-at.example.com', 'a@@b.de', 'a b@c.de', 'a@b', 'a@.b.de', 'a@b..de', '@b.de', 'a@b.de.']) {
    assert.deepEqual(asPairs(withValue(base(), 'seller.contact.email', email)), ['invalid_email@seller.contact.email'], email);
  }
  assert.deepEqual(asPairs(withValue(base(), 'seller.electronicAddress.value', 'not-an-address')), ['invalid_email@seller.electronicAddress.value']);
  assert.deepEqual(asPairs(withValue(base(), 'buyer.electronicAddress.value', 'x@y')), ['invalid_email@buyer.electronicAddress.value']);
  for (const telephone of ['+49 30 1234567', '123', '(030) 12 34']) assert.equal(buildInvoice(withValue(base(), 'seller.contact.telephone', telephone)).ok, true, telephone);
  for (const telephone of ['12', 'abc', '+ - ()']) assert.deepEqual(asPairs(withValue(base(), 'seller.contact.telephone', telephone)), ['invalid_telephone@seller.contact.telephone'], telephone);
});

// ------------------------------------------------------------------------------------------- errors: shape and bounds

test('business and monetary errors are reported together, business first, each at its own path', () => {
  const input = withValue(withValue(withValue(base(), 'invoiceNumber', ''), 'lines.0.quantity', 'x'), 'lines.1.vatRate', '16');
  assert.deepEqual(asPairs(input), ['empty_text@invoiceNumber', 'invalid_decimal@lines[0].quantity', 'unsupported_vat_rate@lines[1].vatRate']);
  assert.equal(failure(input).truncated, false);
});

test('the notation applies to the monetary fields only, and an unknown notation is a programming error', () => {
  const line = { name: 'x', unitCode: 'C62', quantity: '1,5', unitPrice: '49,90', vatCategory: 'S', vatRate: '19' };
  const german = withValue(base(), 'lines', [line]);
  assert.equal(buildInvoice(german, { notation: 'de' }).ok, true);
  // The same text in canonical notation is a different, malformed number: "1,5" has no canonical reading.
  assert.deepEqual(asPairs(german), ['invalid_decimal@lines[0].quantity', 'invalid_decimal@lines[0].unitPrice']);
  assert.throws(() => buildInvoice(base(), { notation: 'fr' as never }), RangeError);
});

test('lines: a missing, empty or non-array list is reported', () => {
  assert.deepEqual(asPairs(withoutValue(base(), 'lines')), ['invalid_type@lines']);
  assert.deepEqual(asPairs(withValue(base(), 'lines', [])), ['no_lines@lines']);
  assert.deepEqual(asPairs(withValue(base(), 'lines', 'x')), ['invalid_type@lines']);
  assert.deepEqual(asPairs(withValue(base(), 'lines', [null])), ['invalid_type@lines[0]']);
});

test('an over-long error list is cut at the provisional bound and identified as incomplete exactly once', () => {
  const lines = Array.from({ length: PROVISIONAL_MAX_REPORTED_ERRORS + 50 }, () => ({ quantity: '1', unitPrice: '1.00', vatCategory: 'S', vatRate: '19', unitCode: 'C62' }));
  const result = failure(withValue(base(), 'lines', lines)); // every line lacks its name
  assert.equal(result.truncated, true);
  assert.equal(result.errors.filter((e) => e.code === 'error_list_truncated').length, 1);
  assert.equal(result.errors.at(-1)?.code, 'error_list_truncated');
  assert.ok(result.errors.length <= PROVISIONAL_MAX_REPORTED_ERRORS + 2);
});

test('a huge sparse line list terminates and is reported as incomplete', () => {
  const result = failure(withValue(base(), 'lines', new Array(4294967295)));
  assert.equal(result.truncated, true);
  assert.equal(result.errors.at(-1)?.code, 'error_list_truncated');
});

// ------------------------------------------------------------------------------------------- runtime protection

test('a validated invoice is deeply frozen', () => {
  const invoice = (() => {
    const result = buildInvoice(base());
    return result.ok ? result.value : assert.fail('expected success');
  })();
  assert.equal(Object.isFrozen(invoice) && Object.isFrozen(invoice.seller) && Object.isFrozen(invoice.seller.address), true);
  assert.equal(Object.isFrozen(invoice.lines) && Object.isFrozen(invoice.lines[0]) && Object.isFrozen(invoice.totals), true);
  assert.throws(() => {
    (invoice as { invoiceNumber: string }).invoiceNumber = 'changed';
  }, TypeError);
});

test('only invoices produced by buildInvoice are recognised: copies, clones and hand-made objects are not', () => {
  const result = buildInvoice(base());
  const invoice = result.ok ? result.value : assert.fail('expected success');
  assert.equal(isValidatedInvoice(invoice), true);
  assert.equal(isValidatedInvoice({ ...invoice }), false);
  assert.equal(isValidatedInvoice(structuredClone(invoice)), false);
  assert.equal(isValidatedInvoice(Object.create(invoice)), false);
  for (const value of [undefined, null, 0, 'invoice', [], {}, base()]) assert.equal(isValidatedInvoice(value), false);
});

// ------------------------------------------------------------------------------------------- one snapshot of the input

test('the input is read once into a snapshot: accessors are never executed and are reported as invalid_type', () => {
  let calls = 0;
  const hostile = base();
  Object.defineProperty(hostile, 'lines', {
    enumerable: true,
    get() {
      calls++;
      return calls === 1 ? [] : (base().lines as unknown[]);
    },
  });
  assert.deepEqual(asPairs(hostile), ['invalid_type@lines']);
  assert.equal(calls, 0, 'the getter must not run at all');

  const nested = base();
  Object.defineProperty(nested.seller as object, 'name', { enumerable: true, get: () => 'x' });
  assert.deepEqual(asPairs(nested), ['invalid_type@seller.name']);
});

test('hostile input never makes buildInvoice throw: throwing getters, revoked and trapping proxies, cycles', () => {
  const throwing = base();
  Object.defineProperty(throwing, 'buyerReference', { enumerable: true, get: () => { throw new Error('boom'); } });
  assert.deepEqual(asPairs(throwing), ['invalid_type@buyerReference']);

  const revocable = Proxy.revocable(base(), {});
  revocable.revoke();
  assert.deepEqual(asPairs(revocable.proxy), ['invalid_type@']);

  const trapping = new Proxy(base(), { ownKeys: () => { throw new Error('trap'); } });
  assert.deepEqual(asPairs(trapping), ['invalid_type@']);

  const cyclic = base();
  (cyclic.seller as JsonObject).self = cyclic;
  assert.deepEqual(asPairs(cyclic), ['unknown_field@seller.self']);
});

test('an over-long list of accessor problems is cut at the bound and identified as incomplete', () => {
  const hostile = base();
  for (let i = 0; i < PROVISIONAL_MAX_REPORTED_ERRORS + 50; i++) Object.defineProperty(hostile, `extra${i}`, { enumerable: true, get: () => 'x' });
  const result = failure(hostile);
  assert.equal(result.truncated, true);
  assert.equal(result.errors.length, PROVISIONAL_MAX_REPORTED_ERRORS + 1);
  assert.equal(result.errors.at(-1)?.code, 'error_list_truncated');
  assert.equal(result.errors.filter((e) => e.code === 'error_list_truncated').length, 1);
});

test('inherited properties are not input: only own enumerable properties count', () => {
  const inherited = Object.create(base());
  assert.equal(buildInvoice(inherited).ok, false);
  const withPrototypeKey = JSON.parse(JSON.stringify(base()).replace('"invoiceNumber"', '"__proto__"')) as unknown;
  const errors = asPairs(withPrototypeKey);
  assert.ok(errors.includes('missing_field@invoiceNumber') && errors.includes('unknown_field@__proto__'), errors.join(' '));
});

test('a valid invoice built from a snapshot is unaffected by later changes to the caller input', () => {
  const input = base();
  const built = buildInvoice(input);
  (input.seller as JsonObject).name = 'changed after the build';
  assert.equal(built.ok ? built.value.seller.name : '', 'Beispiel Beratung GmbH');
});

test('extra non-index properties on the lines array are ignored, only the elements are input', () => {
  const lines = base().lines as JsonObject[] & { note?: string };
  lines.note = 'ignored';
  assert.equal(buildInvoice(withValue(base(), 'lines', lines)).ok, true);
});

// ------------------------------------------------------------------------------------------- both scanners truncated

test('when the business scan and the monetary scan both stop early, each names where it stopped', () => {
  // Lines 0-49: no name and no unit code (2 business errors) and an unreadable quantity (1 monetary error).
  // Lines 50-149: only the unreadable quantity. The business scan stops at line 50, the monetary scan at line 100.
  const lines = Array.from({ length: 150 }, (_, i) => (i < 50 ? { quantity: 'x', unitPrice: '1.00', vatCategory: 'S', vatRate: '19' } : { name: 'n', unitCode: 'C62', quantity: 'x', unitPrice: '1.00', vatCategory: 'S', vatRate: '19' }));
  const result = failure(withValue(base(), 'lines', lines));
  assert.equal(result.truncated, true);
  const markers = result.errors.filter((e) => e.code === 'error_list_truncated');
  assert.deepEqual(markers.map((m) => m.path), ['lines[50]', 'lines[100]']);
  assert.equal(result.errors.at(-1)?.path, 'lines[100]', 'a marker is always the last entry');
});

// ------------------------------------------------------------------------------------------- text edge cases

test('line and paragraph separators are rejected inside a single-line text', () => {
  for (const separator of ['\u2028', '\u2029']) {
    assert.deepEqual(asPairs(withValue(base(), 'buyer.name', `a${separator}b`)), ['invalid_text@buyer.name']);
  }
});
