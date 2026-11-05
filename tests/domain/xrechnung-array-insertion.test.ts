import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CREDIT_NOTE_FIXTURE_NAMES,
  CREDIT_NOTE_PERIOD_FIXTURE_NAMES,
  FIXTURE_NAMES,
  LEITWEG_FIXTURE_NAMES,
  loadFixtureInput,
  PERIOD_FIXTURE_NAMES,
  REFERENCE_FIXTURE_NAMES,
  SKONTO_FIXTURE_NAMES,
} from '../support/fixtures.ts';

// IR39-01: `list.push(value)`, `Reflect.set` and `record[index] = value` all perform [[Set]], which walks the prototype chain and
// runs an inherited numeric setter. Own-data-property creation does not. Every case runs in a child process, which plants the
// pollution only around the call under test and removes it before any output: it must never reach the test runner.

const LIB = (file: string) => new URL(`../../src/lib/domain/xrechnung/${file}`, import.meta.url).href;
const LIMIT = 128; // above PROVISIONAL_MAX_REPORTED_ERRORS, so the truncation marker is covered too

const PRELUDE = `
import { buildInvoice, paymentTermsText } from ${JSON.stringify(LIB('document.ts'))};
import { serializeUblInvoice } from ${JSON.stringify(LIB('ubl.ts'))};
import { serializeCiiInvoice } from ${JSON.stringify(LIB('cii.ts'))};
const data = JSON.parse(process.env.INSERTION_INPUT);
let hits = 0;
const place = (target, index, value) => Object.defineProperty(target, index, { value, writable: true, enumerable: true, configurable: true });
const isTier = (value) => typeof value === 'object' && value !== null && Object.hasOwn(value, 'days');
const isRawTier = (value) => isTier(value) && typeof value.percent === 'string';
const isValidatedTier = (value) => isTier(value) && typeof value.percent === 'object';
const setter = (decide) => (index) => ({ configurable: true, set(value) { hits += 1; decide(this, index, value); } });
const PLANTS = {
  'substitute-raw-tier': setter((t, i, v) => place(t, i, isRawTier(v) ? { days: 999, percent: '999.99' } : v)),
  'substitute-validated-tier': setter((t, i, v) => place(t, i, isValidatedTier(v) ? { days: 999, percent: { units: 99999n, scale: 2 } } : v)),
  'throw-on-raw-tier': setter((t, i, v) => { if (isRawTier(v)) throw new Error('setter ran'); place(t, i, v); }),
  'throw-on-validated-tier': setter((t, i, v) => { if (isValidatedTier(v)) throw new Error('setter ran'); place(t, i, v); }),
  'throw-always': setter(() => { throw new Error('setter ran'); }),
  swallow: setter(() => {}),
  'read-only': () => ({ value: 'planted', writable: false, configurable: true }),
};
const HOSTS = { 'Object.prototype': Object.prototype, 'Array.prototype': Array.prototype };
function polluted(plant, host, run) {
  for (let index = 0; index < ${LIMIT}; index++) Object.defineProperty(host, index, PLANTS[plant](index));
  try {
    return run();
  } finally {
    for (let index = 0; index < ${LIMIT}; index++) delete host[index];
    if (host === Array.prototype) Array.prototype.length = 0;
  }
}
const text = (value) => JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? String(v) : v));
function attempt(input, options) {
  try {
    const result = buildInvoice(input, options);
    if (!result.ok) return text({ ok: false, errors: result.errors, truncated: result.truncated });
    return text({ ok: true, invoice: result.value, ubl: serializeUblInvoice(result.value), cii: serializeCiiInvoice(result.value) });
  } catch (error) {
    return 'threw: ' + String(error?.message);
  }
}
const sweep = (cases) => {
  const failures = [];
  for (const [name, input, options] of cases) {
    const clean = attempt(input, options);
    for (const plant of Object.keys(PLANTS)) for (const hostName of Object.keys(HOSTS)) {
      hits = 0;
      const seen = polluted(plant, HOSTS[hostName], () => attempt(input, options));
      if (seen !== clean || hits !== 0) failures.push({ name, plant, host: hostName, hits, seen: seen.slice(0, 160) });
    }
  }
  return failures;
};
const codes = (input, options) => {
  const result = buildInvoice(input, options);
  return result.ok ? ['ok'] : result.errors.map((e) => e.code + '@' + e.path);
};
let report;
`;

function inChild(body: string, input: unknown): unknown {
  const script = `${PRELUDE}\n${body}\nconsole.log(JSON.stringify(report));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, INSERTION_INPUT: JSON.stringify(input) } });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const ZH = loadFixtureInput('zh-skonto-tiers-terms-due-date');
const ZG = loadFixtureInput('zg-skonto-single-tier');
const CREDIT_NOTE = loadFixtureInput('t-credit-note-full-reversal');
const ZH_BT20 = 'Zahlbar innerhalb von 30 Tagen ohne Abzug.\nBitte Rechnungsnummer & Kundennummer angeben.\n#SKONTO#TAGE=7#PROZENT=3.00#\n#SKONTO#TAGE=14#PROZENT=2.25#\n#SKONTO#TAGE=28#PROZENT=1.00#\n';

for (const plant of ['substitute-raw-tier', 'substitute-validated-tier', 'throw-on-raw-tier', 'throw-on-validated-tier', 'throw-always', 'swallow', 'read-only']) {
  for (const host of ['Object.prototype', 'Array.prototype']) {
    test(`IR39-01 ${plant} on ${host}: valid tiers keep their days and percent and the setter never runs`, () => {
      const report = inChild(
        `report = polluted(${JSON.stringify(plant)}, HOSTS[${JSON.stringify(host)}], () => {
  const result = buildInvoice(data.zh);
  const skonto = result.ok ? result.value.payment.skonto.map((tier) => tier.days + '/' + tier.percent.units + '/' + tier.percent.scale) : result.errors;
  return { ok: result.ok, skonto, bt20: result.ok ? paymentTermsText(result.value.payment) : undefined };
});
report.hits = hits;`,
        { zh: ZH },
      );
      assert.deepEqual(report, { ok: true, skonto: ['7/300/2', '14/225/2', '28/100/2'], bt20: ZH_BT20, hits: 0 });
    });
  }
}

test('IR39-01 the exact reproduction: days=14, percent="2.00" never becomes 999 / 999.99', () => {
  const report = inChild(
    `report = polluted('substitute-raw-tier', Object.prototype, () => {
  const result = buildInvoice(data.zg);
  return result.ok ? paymentTermsText(result.value.payment) : result.errors;
});`,
    { zg: ZG },
  );
  assert.equal(report, '#SKONTO#TAGE=14#PROZENT=2.00#\n');
});

test('IR39-01 the snapshot never hands a raw array entry to a setter: nothing the setter could see is reported', () => {
  const report = inChild(
    `const seen = [];
Object.defineProperty(Object.prototype, '0', { configurable: true, set(value) { seen.push(typeof value); } });
let outcome;
try { outcome = buildInvoice(data.zg).ok; } finally { delete Object.prototype[0]; }
report = { outcome, seen };`,
    { zg: ZG },
  );
  assert.deepEqual(report, { outcome: true, seen: [] });
});

test('IR39-01 every fixture: documents, UBL and CII are byte-identical to the clean run under every plant, with no setter run', () => {
  const names = [...FIXTURE_NAMES, ...CREDIT_NOTE_FIXTURE_NAMES, ...REFERENCE_FIXTURE_NAMES, ...PERIOD_FIXTURE_NAMES, ...CREDIT_NOTE_PERIOD_FIXTURE_NAMES, ...LEITWEG_FIXTURE_NAMES, ...SKONTO_FIXTURE_NAMES];
  const leitweg: readonly string[] = LEITWEG_FIXTURE_NAMES;
  const cases = names.map((name) => [name, loadFixtureInput(name), leitweg.includes(name) ? { buyerReferencePolicy: 'leitweg-id' } : {}]);
  assert.deepEqual(inChild('report = sweep(data);', cases), []);
});

test('IR39-01 UBL and CII still carry the same BT-20 under pollution', () => {
  const report = inChild(
    `const pick = (xml, tag) => xml.slice(xml.indexOf('<' + tag + '>') + tag.length + 2, xml.indexOf('</' + tag + '>'));
report = polluted('substitute-validated-tier', Object.prototype, () => {
  const invoice = buildInvoice(data.zh).value;
  return { ubl: pick(serializeUblInvoice(invoice).xml, 'cbc:Note'), cii: pick(serializeCiiInvoice(invoice).xml, 'ram:Description') };
});`,
    { zh: ZH },
  );
  const escaped = ZH_BT20.replace('&', '&amp;');
  assert.deepEqual(report, { ubl: escaped, cii: escaped });
});

test('IR39-01 array shape: length, order and own data descriptors match the clean run', () => {
  const report = inChild(
    `const shape = (list) => ({ array: Array.isArray(list), length: list.length, frozen: Object.isFrozen(list), keys: Object.keys(list), first: Object.getOwnPropertyDescriptor(list, '0') && { writable: Object.getOwnPropertyDescriptor(list, '0').writable, enumerable: Object.getOwnPropertyDescriptor(list, '0').enumerable, configurable: Object.getOwnPropertyDescriptor(list, '0').configurable } });
const shapes = (invoice) => text({ skonto: shape(invoice.payment.skonto), lines: shape(invoice.lines), notes: shape(invoice.notes), breakdown: shape(invoice.totals.vatBreakdown) });
const clean = shapes(buildInvoice(data.zh).value);
const dirty = polluted('throw-always', Object.prototype, () => shapes(buildInvoice(data.zh).value));
report = { same: clean === dirty, clean: JSON.parse(clean).skonto };`,
    { zh: ZH },
  );
  assert.deepEqual(report, { same: true, clean: { array: true, length: 3, frozen: true, keys: ['0', '1', '2'], first: { writable: false, enumerable: true, configurable: false } } });
});

// Written out in the child, because a hole does not survive the JSON that carries the base input.
const SKONTO_CASES = `const withSkonto = (skonto, base = data.zh) => ({ ...base, payment: { ...base.payment, skonto } });
const t = (days, percent) => ({ days, percent });
const holed = new Array(2); holed[0] = t(7, '3.00');
const CASES = {
  days: [withSkonto([t(0, '2.00')]), 'unsupported_skonto_days@payment.skonto[0].days'],
  daysText: [withSkonto([t('14', '2.00')]), 'invalid_type@payment.skonto[0].days'],
  grammar: [withSkonto([t(14, 'abc')]), 'invalid_decimal@payment.skonto[0].percent'],
  percent: [withSkonto([t(14, '0.00')]), 'unsupported_skonto_percent@payment.skonto[0].percent'],
  precision: [withSkonto([t(14, '2.255')]), 'fraction_digits_limit@payment.skonto[0].percent'],
  order: [withSkonto([t(14, '2.00'), t(7, '3.00')]), 'unsupported_skonto_tier_order@payment.skonto[1].days'],
  count: [withSkonto(Array.from({ length: 11 }, (_, i) => t(i + 1, '1.00'))), 'unsupported_skonto_tier_count@payment.skonto'],
  base: [withSkonto([{ ...t(14, '2.00'), baseAmount: '1.00' }]), 'unsupported_skonto_base_amount@payment.skonto[0].baseAmount'],
  unknown: [withSkonto([{ ...t(14, '2.00'), extra: 1 }]), 'unknown_field@payment.skonto[0].extra'],
  hole: [withSkonto(holed), 'missing_field@payment.skonto[1]'],
  creditNote: [withSkonto([t(14, '2.00')], data.creditNote), 'unsupported_skonto_on_credit_note@payment.skonto'],
};`;

for (const plant of ['substitute-raw-tier', 'substitute-validated-tier', 'throw-always', 'swallow', 'read-only']) {
  for (const host of ['Object.prototype', 'Array.prototype']) {
    test(`IR39-01 ${plant} on ${host}: malformed or unsupported tiers keep their exact diagnostics`, () => {
      const report = inChild(
        `${SKONTO_CASES}
report = {};
for (const [name, [input, expected]] of Object.entries(CASES)) {
  let got;
  try { got = polluted(${JSON.stringify(plant)}, HOSTS[${JSON.stringify(host)}], () => codes(input)); } catch (error) { got = ['threw: ' + error.message]; }
  if (got.length !== 1 || got[0] !== expected) report[name] = { got, expected };
}`,
        { zh: ZH, creditNote: CREDIT_NOTE },
      );
      assert.deepEqual(report, {});
    });
  }
}

test('IR39-01 every other error list holds under pollution: business, monetary, accessor and truncation paths', () => {
  const report = inChild(
    `const a = data.a;
const invalid = (patch) => ({ ...a, ...patch });
const accessor = () => { const input = structuredClone(a); Object.defineProperty(input, 'invoiceNumber', { enumerable: true, get() { throw new Error('getter ran'); } }); Object.defineProperty(input, 'currency', { enumerable: true, get() { throw new Error('getter ran'); } }); return input; };
const manyAccessors = () => { const input = structuredClone(a); input.notes = Array.from({ length: 120 }, () => Object.defineProperty({}, 'text', { enumerable: true, get() { throw new Error('getter ran'); } })); return input; };
report = sweep([
  ['root not an object', 'text'],
  ['empty object', {}],
  ['no lines', invalid({ lines: [] })],
  ['lines not a list', invalid({ lines: 'x' })],
  ['bad line', invalid({ lines: [{ name: 'x' }] })],
  ['bad currency and type', invalid({ currency: 'USD', documentTypeCode: '999' })],
  ['bad notes', invalid({ notes: 'x' })],
  ['bad note entries', invalid({ notes: [1, {}, { text: 'ok', extra: 1 }] })],
  ['many bad notes', invalid({ notes: Array.from({ length: 150 }, () => 1) })],
  ['many bad lines', invalid({ lines: Array.from({ length: 150 }, () => 1) })],
  ['unknown fields', invalid({ extra: 1, other: 2 })],
  ['bad seller', invalid({ seller: { ...a.seller, sellerIdentifiers: 'x', contact: undefined, vatId: undefined, legalRegistrationId: undefined } })],
  ['bad buyer', invalid({ buyer: { name: 'x' } })],
  ['no due information', invalid({ payment: { means: a.payment.means } })],
  ['seller not an object', invalid({ seller: 'x' })],
  ['unknown seller field', invalid({ seller: { ...a.seller, extra: 1 } })],
  ['no seller identification', invalid({ seller: { ...a.seller, sellerIdentifiers: undefined, legalRegistrationId: undefined, vatId: undefined, taxRegistrationId: undefined } })],
  ['no buyer identifier under reverse charge', { ...data.reverseCharge, buyer: { ...data.reverseCharge.buyer, vatId: undefined, legalRegistrationId: undefined } }],
  ['mixed treatments', invalid({ lines: [a.lines[0], { ...a.lines[0], vat: data.kleinunternehmer.lines[0].vat }] })],
  ['unknown settlement field', { ...data.creditNote, payment: { ...data.creditNote.payment, settlement: { ...data.creditNote.payment.settlement, extra: 1 } } }],
  ['hole in notes', invalid({ notes: new Array(1) })],
  ['two accessors', accessor()],
  ['many accessors', manyAccessors()],
]);`,
    { a: loadFixtureInput('a-simple'), reverseCharge: loadFixtureInput('g-reverse-charge-vat-ids'), kleinunternehmer: loadFixtureInput('e-kleinunternehmer'), creditNote: CREDIT_NOTE },
  );
  assert.deepEqual(report, []);
});

test('IR39-01 the insertion itself does not depend on Object.prototype: an inherited get or set leaves the result unchanged', () => {
  const report = inChild(
    `const bad = { ...data.zg, payment: { ...data.zg.payment, skonto: [{ days: 0, percent: '2.00' }] } };
const proto = '__proto__';
const keyed = JSON.parse('{"' + proto + '": 1}');
const withOddKey = { ...data.zg, ...{} };
Object.defineProperty(withOddKey, proto, { value: keyed, enumerable: true, configurable: true, writable: true });
report = {};
for (const [name, input] of Object.entries({ valid: data.zg, invalid: bad, oddKey: withOddKey })) {
  const clean = attempt(input, {});
  for (const key of ['get', 'set']) {
    Object.defineProperty(Object.prototype, key, { value() { throw new Error('inherited ' + key + ' ran'); }, writable: true, configurable: true });
    let seen;
    try { seen = attempt(input, {}); } finally { delete Object.prototype[key]; }
    if (seen !== clean) report[name + ' ' + key] = seen.slice(0, 160);
  }
}`,
    { zg: ZG },
  );
  assert.deepEqual(report, {});
});

test('IR39-01 with IR38-03: an own accessor is still told apart from data, and never runs, with both pollutions planted', () => {
  const report = inChild(
    `const counts = { own: 0 };
const input = structuredClone(data.zg);
Object.defineProperty(input.payment.skonto[0], 'days', { enumerable: true, get() { counts.own += 1; return 14; } });
const got = polluted('throw-always', Object.prototype, () => {
  Object.defineProperty(Object.prototype, 'value', { value: '14', writable: true, configurable: true });
  try { return codes(input); } finally { delete Object.prototype.value; }
});
report = { got, counts, hits };`,
    { zg: ZG },
  );
  assert.deepEqual(report, { got: ['invalid_type@payment.skonto[0].days'], counts: { own: 0 }, hits: 0 });
});

test('IR39-01 with IR38-01: the policy accessor is still a programming error, and the planted setter does not run', () => {
  const report = inChild(
    `const options = Object.defineProperty({}, 'buyerReferencePolicy', { enumerable: true, get() { return 'leitweg-id'; } });
let outcome;
try {
  outcome = polluted('throw-always', Object.prototype, () => {
    Object.defineProperty(Object.prototype, 'value', { value: 'leitweg-id', writable: true, configurable: true });
    try { return codes(data.zg, options); } finally { delete Object.prototype.value; }
  });
} catch (error) { outcome = error.name + ': ' + error.message; }
report = { outcome, hits };`,
    { zg: ZG },
  );
  assert.deepEqual(report, { outcome: 'RangeError: buyerReferencePolicy must be a data property, not an accessor', hits: 0 });
});

test('IR39-01 the validated modules hold no [[Set]]-based array insertion', () => {
  for (const file of ['document.ts', 'invoice.ts', 'ubl.ts', 'cii.ts']) {
    const source = readFileSync(new URL(`../../src/lib/domain/xrechnung/${file}`, import.meta.url), 'utf8');
    assert.equal(/\.push\(|\.unshift\(|Reflect\.set\(/.test(source), false, file);
  }
});
