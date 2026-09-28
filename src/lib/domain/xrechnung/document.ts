// Semantic invoice document: the business data around the monetary calculation, validated for the implemented
// profile. Syntax-independent: no UBL/CII structures, paths or element names (BT/BG numbers appear only
// as documentation). Every amount comes from invoice.ts; this module performs no arithmetic on money.
//
// Three kinds of rule are kept apart in this file (see the comments on the constants):
//   EXTERNAL     imposed by EN 16931 / XRechnung CIUS / UStG, cited to its source;
//   CONDITIONAL  applies only in stated circumstances;
//   PROFILE      a restriction chosen for the implemented profile. It is not a claim that law or XRechnung requires
//                exactly this, and not a permanent Orkaid V1 limit. Input outside the profile fails explicitly as
//                `unsupported_*`, never as "legally invalid".
//
// Runtime protection: `Invoice` is created only by `buildInvoice`, which deep-freezes it and registers it in a
// module-private set. A branded type alone is not a runtime boundary, so consumers must call `isValidatedInvoice`.

import {
  calculateInvoice,
  PROVISIONAL_MAX_REPORTED_ERRORS,
  type InvoiceError,
  type InvoiceErrorCode,
  type InvoiceLineVat,
  type InvoiceOptions,
  type InvoiceTotals,
  type VatInput,
} from './invoice.ts';
import type { Decimal } from './decimal.ts';

// PROFILE: unit codes (UN/ECE Recommendation 20/21). Each is present in the KoSIT configuration 2026-08-31 code list
// (rule BR-CL-23); tools/kosit/validate.ts re-verifies that against the validator configuration on every run.
export const UNIT_CODES = ['C62', 'HUR', 'DAY', 'MON', 'KGM', 'LTR', 'MTR'] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

// Provisional defensive bound on a single text value, NOT a product rule (like the guards in number-notation.ts and invoice.ts).
export const PROVISIONAL_MAX_TEXT_LENGTH = 512;

export type PartyInput = {
  name: string; // BT-27 / BT-44
  electronicAddress: { schemeId: string; value: string }; // BT-34 / BT-49
  address: { street: string; city: string; postCode: string; country: string }; // BG-5 / BG-8
};

/**
 * BT-29, validated. A plain `{ value }` rather than a bare string: MDR-21 commits no scheme in M1, but keeps the
 * shape ready to carry one additively later (a `scheme?` field) without changing the collection's element type.
 */
export type SellerIdentifier = {
  readonly value: string;
};

/** Shape the boundary expects. Every field is validated at runtime. Amounts are decimal strings, never numbers. */
export type InvoiceDocumentInput = {
  documentTypeCode: string; // BT-3, validated by invoice.ts
  currency: string; // BT-5, validated by invoice.ts
  invoiceNumber: string; // BT-1
  issueDate: string; // BT-2, YYYY-MM-DD
  deliveryDate: string; // BT-72, YYYY-MM-DD
  paymentDueDate: string; // BT-9, YYYY-MM-DD
  buyerReference: string; // BT-10, buyer-provided business information (not a generated Leitweg-ID)
  seller: PartyInput & {
    sellerIdentifiers?: readonly string[]; // BT-29, 0..n; no scheme in M1 (MDR-21)
    legalRegistrationId?: string; // BT-30; no scheme in M1 (MDR-21)
    vatId?: string; // BT-31
    taxRegistrationId?: string; // BT-32
    contact: { name: string; telephone: string; email: string }; // BG-6: BT-41, BT-42, BT-43
  };
  buyer: PartyInput;
  payment: { meansCode: string; iban: string }; // BT-81, BT-84
  lines: readonly {
    name: string; // BT-153
    unitCode: string; // BT-130
    quantity: string; // BT-129
    unitPrice: string; // BT-146
    vat: VatInput; // BT-151 / BT-152, plus the treatment discriminant
  }[];
};

// PROFILE: the electronic address schemes (BT-34 / BT-49) M1 commits to, from the CEF EAS list (EXTERNAL: BR-CL-25).
// A scheme code carries no routing or product meaning here; the list is deliberately not the whole EAS list.
export const EAS_SCHEMES = ['EM', '0204', '0088'] as const;
export type EasScheme = (typeof EAS_SCHEMES)[number];
export type ElectronicAddress = { readonly schemeId: EasScheme; readonly value: string };

export type InvoiceParty = {
  readonly name: string;
  readonly electronicAddress: ElectronicAddress;
  readonly address: { readonly street: string; readonly city: string; readonly postCode: string; readonly country: 'DE' };
};

export type InvoiceLine = {
  readonly name: string; // BT-153
  readonly unitCode: UnitCode; // BT-130
  readonly quantity: Decimal; // BT-129, with the scale the caller typed
  readonly unitPrice: Decimal; // BT-146, with the scale the caller typed
  readonly vat: InvoiceLineVat; // BT-151 / BT-152, plus the treatment discriminant
  readonly netAmount: Decimal; // BT-131, from the monetary calculation
};

declare const validatedBrand: unique symbol;

export type Invoice = {
  readonly [validatedBrand]: true;
  readonly documentTypeCode: '380'; // BT-3
  readonly currency: 'EUR'; // BT-5
  readonly invoiceNumber: string; // BT-1
  readonly issueDate: string; // BT-2
  readonly deliveryDate: string; // BT-72
  readonly paymentDueDate: string; // BT-9
  readonly buyerReference: string; // BT-10
  readonly seller: InvoiceParty & {
    readonly sellerIdentifiers: readonly SellerIdentifier[]; // BT-29, 0..n
    readonly legalRegistrationId?: string; // BT-30
    readonly vatId?: string; // BT-31
    readonly taxRegistrationId?: string; // BT-32
    readonly contact: { readonly name: string; readonly telephone: string; readonly email: string };
  };
  readonly buyer: InvoiceParty;
  readonly payment: { readonly meansCode: '58'; readonly iban: string };
  readonly lines: readonly InvoiceLine[];
  readonly totals: InvoiceTotals;
};

export type DocumentErrorCode =
  | InvoiceErrorCode
  | 'missing_field'
  | 'empty_text'
  | 'invalid_text'
  | 'text_too_long'
  | 'invalid_date'
  | 'invalid_vat_id'
  | 'invalid_email'
  | 'invalid_telephone'
  | 'invalid_iban'
  | 'unsupported_country'
  | 'unsupported_electronic_address_scheme'
  | 'unsupported_payment_means'
  | 'unsupported_unit_code'
  | 'missing_seller_identification' // BR-CO-26: none of BT-29, BT-30, BT-31 is present
  | 'missing_seller_tax_identifier' // standard treatment: neither BT-31 nor BT-32 is present
  | 'internal_inconsistency';

export type DocumentError = { readonly code: DocumentErrorCode; readonly path: string };

/**
 * On failure, `truncated` says whether `errors` is incomplete. When true, the last entry is an
 * 'error_list_truncated' error naming where scanning stopped (same contract as invoice.ts).
 */
export type DocumentResult =
  | { readonly ok: true; readonly value: Invoice }
  | { readonly ok: false; readonly errors: readonly DocumentError[]; readonly truncated: boolean };

const DOCUMENT_FIELDS = ['invoiceNumber', 'issueDate', 'deliveryDate', 'paymentDueDate', 'buyerReference', 'seller', 'buyer', 'payment'];
const LINE_FIELDS = ['name', 'unitCode'];
const PARTY_FIELDS = ['name', 'electronicAddress', 'address'];
const SELLER_FIELDS = [...PARTY_FIELDS, 'sellerIdentifiers', 'legalRegistrationId', 'vatId', 'taxRegistrationId', 'contact'];
const ADDRESS_FIELDS = ['street', 'city', 'postCode', 'country'];
const ELECTRONIC_ADDRESS_FIELDS = ['schemeId', 'value'];

const validated = new WeakSet<object>();

/** True only for an object that `buildInvoice` produced. Copies, clones and hand-made look-alikes are not. */
export function isValidatedInvoice(value: unknown): value is Invoice {
  return typeof value === 'object' && value !== null && validated.has(value);
}

export function buildInvoice(rawInput: unknown, options: InvoiceOptions = {}): DocumentResult {
  // One snapshot of the caller's data, taken once. Both the business validation below and the monetary calculation
  // read only this snapshot, so an object that answers differently on a second read (a getter, a Proxy) cannot make
  // the two halves of one invoice disagree, and hostile input cannot make this function throw.
  const problems: string[] = [];
  let input: unknown;
  try {
    input = snapshot(rawInput, '', 0, problems);
  } catch {
    return { ok: false, errors: [{ code: 'invalid_type', path: '' }], truncated: false };
  }
  if (problems.length > 0) {
    // While any property is an accessor the rest of the input is not validated: the caller has to fix these first.
    const reported: DocumentError[] = problems.slice(0, PROVISIONAL_MAX_REPORTED_ERRORS).map((path) => ({ code: 'invalid_type', path }));
    const stoppedAt = problems[PROVISIONAL_MAX_REPORTED_ERRORS];
    if (stoppedAt !== undefined) reported.push({ code: 'error_list_truncated', path: stoppedAt });
    return { ok: false, errors: reported, truncated: stoppedAt !== undefined };
  }

  const money = calculateInvoice(input, options, { invoice: DOCUMENT_FIELDS, line: LINE_FIELDS });
  if (!isRecord(input)) return failure([], money, undefined);

  const errors: DocumentError[] = [];
  const invoiceNumber = readText(input, 'invoiceNumber', 'invoiceNumber', errors);
  const issueDate = readDate(input, 'issueDate', 'issueDate', errors);
  const deliveryDate = readDate(input, 'deliveryDate', 'deliveryDate', errors);
  const paymentDueDate = readDate(input, 'paymentDueDate', 'paymentDueDate', errors);
  const buyerReference = readText(input, 'buyerReference', 'buyerReference', errors);
  const seller = readSeller(input, errors);
  const buyer = readParty(input, 'buyer', 'buyer', errors);
  const payment = readPayment(input, errors);
  const { lines: lineData, stoppedAt } = readLineData(input, errors);

  if (money.ok && errors.length === 0 && stoppedAt === undefined) {
    if (
      invoiceNumber === undefined || issueDate === undefined || deliveryDate === undefined || paymentDueDate === undefined ||
      buyerReference === undefined || seller === undefined || buyer === undefined || payment === undefined
    ) {
      return { ok: false, errors: [{ code: 'internal_inconsistency', path: '' }], truncated: false };
    }
    const lines: InvoiceLine[] = [];
    for (const [index, calculated] of money.value.lines.entries()) {
      const data = lineData[String(index)];
      const totalsLine = money.value.totals.lines[index];
      if (data === undefined || totalsLine === undefined) return { ok: false, errors: [{ code: 'internal_inconsistency', path: `lines[${index}]` }], truncated: false };
      lines.push({ ...data, quantity: calculated.quantity, unitPrice: calculated.unitPrice, vat: calculated.vat, netAmount: totalsLine.netAmount });
    }
    return {
      ok: true,
      value: seal({
        documentTypeCode: '380',
        currency: 'EUR',
        invoiceNumber, issueDate, deliveryDate, paymentDueDate, buyerReference,
        seller, buyer, payment,
        lines,
        totals: money.value.totals,
      }),
    };
  }
  return failure(errors, money, stoppedAt);
}

// Business errors come first, then the monetary errors, then the marker of each scan that was cut short, so a
// marker is always the last entry. The two scans have their own bound (PROVISIONAL_MAX_REPORTED_ERRORS), so a list can
// hold up to about twice that many errors, and each marker names where its own scan stopped.
function failure(
  business: readonly DocumentError[],
  money: ReturnType<typeof calculateInvoice>,
  businessStoppedAt: string | undefined,
): DocumentResult {
  const moneyErrors: readonly InvoiceError[] = money.ok ? [] : money.errors;
  const moneyTruncated = !money.ok && money.truncated;
  const moneyMarker = moneyTruncated ? moneyErrors.slice(-1) : [];
  const moneyRest = moneyTruncated ? moneyErrors.slice(0, -1) : moneyErrors;
  const businessMarker: DocumentError[] = businessStoppedAt !== undefined ? [{ code: 'error_list_truncated', path: businessStoppedAt }] : [];
  return {
    ok: false,
    errors: [...business, ...moneyRest, ...businessMarker, ...moneyMarker],
    truncated: moneyTruncated || businessStoppedAt !== undefined,
  };
}

// Deep copy of own enumerable data properties. Accessors are never executed: a property that is not a plain data
// property is reported at its path. Containers deeper than the input can legitimately be (root, party or lines,
// address or line, then a line's `vat`, then only values) are replaced by an empty object, which also ends any
// cycle. The copy of a huge sparse array stays sparse. Ceiling: a hostile object with very many keys is copied in
// full (no entry budget).
const MAX_SNAPSHOT_DEPTH = 4;

function snapshot(value: unknown, path: string, depth: number, problems: string[]): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_SNAPSHOT_DEPTH) return {};

  const readData = (source: object, key: string, childPath: string): { present: boolean; value?: unknown } => {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined) return { present: false };
    if (!('value' in descriptor)) {
      problems.push(childPath);
      return { present: false };
    }
    return { present: true, value: snapshot(descriptor.value, childPath, depth + 1, problems) };
  };

  if (Array.isArray(value)) {
    const copy: unknown[] = new Array(value.length);
    for (const key of Object.keys(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) continue;
      const entry = readData(value, key, `${path}[${key}]`);
      if (entry.present) Reflect.set(copy, key, entry.value);
    }
    return copy;
  }

  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const entry = readData(value, key, path === '' ? key : `${path}.${key}`);
    // defineProperty, not assignment: a key named "__proto__" must stay an ordinary own property of the copy.
    if (entry.present) Object.defineProperty(copy, key, { value: entry.value, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

function seal(data: Omit<Invoice, typeof validatedBrand>): Invoice {
  // The one assertion in this module: the brand has no runtime representation, `validated` is the runtime proof.
  const invoice = deepFreeze(data) as Invoice;
  validated.add(invoice);
  return invoice;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ------------------------------------------------------------------------------------------------ parties

function readSeller(parent: Record<string, unknown>, errors: DocumentError[]): Invoice['seller'] | undefined {
  const record = readObject(parent, 'seller', 'seller', SELLER_FIELDS, errors);
  if (record === undefined) return undefined;

  const errorsBefore = errors.length;
  const party = readPartyFields(record, 'seller', errors);
  const sellerIdentifiers = readSellerIdentifiers(record, errors);
  const legalRegistrationId = readOptionalText(record, 'legalRegistrationId', 'seller.legalRegistrationId', errors);
  const vatId = readOptionalVatId(record, 'vatId', 'seller.vatId', errors);
  const taxRegistrationId = readOptionalText(record, 'taxRegistrationId', 'seller.taxRegistrationId', errors);
  const contact = readContact(record, errors);

  // Presence is read from the raw input, never from the validated value: a supplied-but-malformed field is reported
  // by its own diagnostic and must not also be reported as missing. An empty BT-29 array supplies nothing; a
  // non-array BT-29 was supplied (and is reported as invalid_type).
  const suppliesBt29 = record.sellerIdentifiers !== undefined && !(Array.isArray(record.sellerIdentifiers) && record.sellerIdentifiers.length === 0);
  const suppliesBt30 = record.legalRegistrationId !== undefined;
  const suppliesBt31 = record.vatId !== undefined;
  const suppliesBt32 = record.taxRegistrationId !== undefined;

  // BR-CO-26 (MDR-21): at least one of BT-29, BT-30, BT-31 identifies the seller. BT-32 alone does not satisfy it,
  // and this invariant is never merged with the tax-identifier rule below -- each fails independently.
  if (!suppliesBt29 && !suppliesBt30 && !suppliesBt31) {
    errors.push({ code: 'missing_seller_identification', path: 'seller' });
  }
  // Standard-treatment seller tax identifier: BT-31 or BT-32. BT-63/BG-11 (the tax representative branch these
  // rules also accept) is not implemented in M1, so only these two are checked here (MDR-21).
  if (!suppliesBt31 && !suppliesBt32) {
    errors.push({ code: 'missing_seller_tax_identifier', path: 'seller' });
  }

  if (errors.length > errorsBefore || !party || !contact) return undefined;
  return { ...party, sellerIdentifiers, legalRegistrationId, vatId, taxRegistrationId, contact };
}

// BT-29: caller-supplied values, no scheme in M1. Absent is valid (0..n); each present entry is validated as text.
function readSellerIdentifiers(parent: Record<string, unknown>, errors: DocumentError[]): readonly SellerIdentifier[] {
  const value = parent.sellerIdentifiers;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push({ code: 'invalid_type', path: 'seller.sellerIdentifiers' });
    return [];
  }
  const identifiers: SellerIdentifier[] = [];
  for (const [index, entry] of value.entries()) {
    const text = readTextValue(entry, `seller.sellerIdentifiers[${index}]`, errors);
    if (text !== undefined) identifiers.push({ value: text });
  }
  return identifiers;
}

function readParty(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): InvoiceParty | undefined {
  const record = readObject(parent, key, path, PARTY_FIELDS, errors);
  return record === undefined ? undefined : readPartyFields(record, path, errors);
}

function readPartyFields(record: Record<string, unknown>, path: string, errors: DocumentError[]): InvoiceParty | undefined {
  const name = readText(record, 'name', `${path}.name`, errors);
  const address = readObject(record, 'address', `${path}.address`, ADDRESS_FIELDS, errors);
  const street = address && readText(address, 'street', `${path}.address.street`, errors);
  const city = address && readText(address, 'city', `${path}.address.city`, errors);
  const postCode = address && readText(address, 'postCode', `${path}.address.postCode`, errors);
  // PROFILE: domestic scenario, both parties in Germany.
  const country = address && readChoice(address, 'country', `${path}.address.country`, ['DE'], 'unsupported_country', errors);

  const electronic = readObject(record, 'electronicAddress', `${path}.electronicAddress`, ELECTRONIC_ADDRESS_FIELDS, errors);
  // EXTERNAL: BR-62/BR-63 require the scheme. PROFILE: only EAS_SCHEMES. The value is checked per scheme: EM is an
  // e-mail address; no pinned rule constrains the value of 0204 or 0088, so those get the safe-text guard only.
  const schemeId = electronic && readChoice(electronic, 'schemeId', `${path}.electronicAddress.schemeId`, EAS_SCHEMES, 'unsupported_electronic_address_scheme', errors);
  const readValue = schemeId === 'EM' ? readEmail : readText;
  const value = electronic && readValue(electronic, 'value', `${path}.electronicAddress.value`, errors);

  if (name === undefined || !street || !city || !postCode || country !== 'DE' || schemeId === undefined || value === undefined) return undefined;
  return { name, electronicAddress: { schemeId, value }, address: { street, city, postCode, country } };
}

function readContact(record: Record<string, unknown>, errors: DocumentError[]): Invoice['seller']['contact'] | undefined {
  // EXTERNAL: XRechnung CIUS BR-DE-2, BR-DE-5, BR-DE-6, BR-DE-7 require the seller contact group, point, telephone, e-mail.
  const contact = readObject(record, 'contact', 'seller.contact', ['name', 'telephone', 'email'], errors);
  if (contact === undefined) return undefined;
  const name = readText(contact, 'name', 'seller.contact.name', errors);
  const telephone = readTelephone(contact, 'telephone', 'seller.contact.telephone', errors);
  const email = readEmail(contact, 'email', 'seller.contact.email', errors);
  return name !== undefined && telephone !== undefined && email !== undefined ? { name, telephone, email } : undefined;
}

function readPayment(parent: Record<string, unknown>, errors: DocumentError[]): Invoice['payment'] | undefined {
  const record = readObject(parent, 'payment', 'payment', ['meansCode', 'iban'], errors);
  if (record === undefined) return undefined;
  // PROFILE: payment means code 58 (SEPA credit transfer) only.
  const meansCode = readChoice(record, 'meansCode', 'payment.meansCode', ['58'], 'unsupported_payment_means', errors);
  const iban = readIban(record, 'iban', 'payment.iban', errors);
  return meansCode === '58' && iban !== undefined ? { meansCode, iban } : undefined;
}

// ------------------------------------------------------------------------------------------------ lines

// Reads only the business part of each line (name, unit code). Monetary fields, non-record lines and holes are
// reported by invoice.ts. Object.keys visits the elements that exist, so a huge sparse array cannot stall the scan.
function readLineData(input: Record<string, unknown>, errors: DocumentError[]): { lines: Record<string, { name: string; unitCode: UnitCode }>; stoppedAt: string | undefined } {
  const lines: Record<string, { name: string; unitCode: UnitCode }> = {};
  const list = input.lines;
  if (!Array.isArray(list)) return { lines, stoppedAt: undefined };

  for (const key of Object.keys(list)) {
    if (!/^(0|[1-9][0-9]*)$/.test(key)) continue;
    if (errors.length >= PROVISIONAL_MAX_REPORTED_ERRORS) return { lines, stoppedAt: `lines[${key}]` };
    const line: unknown = Reflect.get(list, key);
    if (!isRecord(line)) continue;
    const path = `lines[${key}]`;
    const name = readText(line, 'name', `${path}.name`, errors);
    // PROFILE: a small explicit list of unit codes (UNIT_CODES).
    const unitCode = readChoice(line, 'unitCode', `${path}.unitCode`, UNIT_CODES, 'unsupported_unit_code', errors);
    if (name !== undefined && unitCode !== undefined) lines[key] = { name, unitCode };
  }
  return { lines, stoppedAt: undefined };
}

// ------------------------------------------------------------------------------------------------ field readers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObject(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly string[],
  errors: DocumentError[],
): Record<string, unknown> | undefined {
  const value = parent[key];
  if (value === undefined) {
    errors.push({ code: 'missing_field', path });
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push({ code: 'invalid_type', path });
    return undefined;
  }
  // Ceiling: unknown fields are reported without bound, as invoice.ts does for its own levels.
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name)) errors.push({ code: 'unknown_field', path: `${path}.${name}` });
  }
  return value;
}

// XML 1.0 forbids most C0 controls and the non-characters U+FFFE/U+FFFF; a lone surrogate is not a character at all.
// C1 controls, DEL and the line and paragraph separators U+2028/U+2029 are legal in XML but never wanted in a business
// text that is a single line, so they are rejected too. Other legal characters (for example U+00A0) are accepted.
const ILLEGAL_TEXT = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function readTextValue(value: unknown, path: string, errors: DocumentError[]): string | undefined {
  if (value === undefined) return report(errors, 'missing_field', path);
  if (typeof value !== 'string') return report(errors, 'invalid_type', path);
  if (value.trim() === '') return report(errors, 'empty_text', path);
  if (value.length > PROVISIONAL_MAX_TEXT_LENGTH) return report(errors, 'text_too_long', path);
  // Never trimmed or otherwise repaired: the caller is told, the text is not silently changed.
  if (value !== value.trim() || ILLEGAL_TEXT.test(value)) return report(errors, 'invalid_text', path);
  return value;
}

function readText(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  return readTextValue(parent[key], path, errors);
}

// Optional counterpart of readText: an absent field is a valid "not supplied" (0..1), never `missing_field`. A
// present value is validated exactly as the required form would.
function readOptionalText(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const value = parent[key];
  return value === undefined ? undefined : readTextValue(value, path, errors);
}

function report(errors: DocumentError[], code: DocumentErrorCode, path: string): undefined {
  errors.push({ code, path });
  return undefined;
}

function readChoice<const T extends string>(
  parent: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
  unsupported: DocumentErrorCode,
  errors: DocumentError[],
): T | undefined {
  const value = parent[key];
  if (value === undefined) return report(errors, 'missing_field', path);
  if (typeof value !== 'string') return report(errors, 'invalid_type', path);
  const match = allowed.find((candidate) => candidate === value);
  return match ?? report(errors, unsupported, path);
}

const DAYS_IN_MONTH: Record<string, number> = {
  '01': 31, '02': 28, '03': 31, '04': 30, '05': 31, '06': 30, '07': 31, '08': 31, '09': 30, '10': 31, '11': 30, '12': 31,
};

// EXTERNAL: XRechnung Schematron BR-TMP-6 requires YYYY-MM-DD in UBL; the calendar check is arithmetic, not Date.
function isIsoDate(text: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text);
  if (!match) return false;
  const [, year = '', month = '', day = ''] = match;
  if (year === '0000') return false;
  const y = BigInt(year);
  const leap = (y % 4n === 0n && y % 100n !== 0n) || y % 400n === 0n;
  const last = month === '02' && leap ? 29 : DAYS_IN_MONTH[month];
  return last !== undefined && day >= '01' && day <= String(last).padStart(2, '0');
}

function readDate(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const text = readText(parent, key, path, errors);
  if (text === undefined) return undefined;
  return isIsoDate(text) ? text : report(errors, 'invalid_date', path);
}

// PROFILE: German USt-IdNr, DE followed by nine digits. EXTERNAL (BR-CO-09): a VAT identifier carries an ISO 3166 prefix.
// BT-31 is optional since MDR-21 (a seller may instead rely on BT-29 and/or BT-30 for BR-CO-26); an absent value is
// valid and never reported.
function readOptionalVatId(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  const text = readTextValue(value, path, errors);
  if (text === undefined) return undefined;
  return /^DE[0-9]{9}$/.test(text) ? text : report(errors, 'invalid_vat_id', path);
}

// CONDITIONAL: with payment means 58, XRechnung BR-DE-19 expects a valid IBAN (a SHOULD, severity warning). ISO 13616
// mod-97 on the electronic form; like the validator, this does not check the per-country length.
function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  let digits = '';
  for (const character of iban.slice(4) + iban.slice(0, 4)) digits += character >= 'A' ? String(character.charCodeAt(0) - 55) : character;
  return BigInt(digits) % 97n === 1n;
}

function readIban(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const text = readText(parent, key, path, errors);
  if (text === undefined) return undefined;
  return isValidIban(text) ? text : report(errors, 'invalid_iban', path);
}

// EXTERNAL for BT-43: the e-mail check of BR-DE-28 (its XR-EMAIL-REGEX, a SHOULD with severity warning). PROFILE: the
// same check is applied to every e-mail address of the invoice, including the electronic addresses BT-34 and BT-49.
function readEmail(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const text = readText(parent, key, path, errors);
  if (text === undefined) return undefined;
  return /^[^@\s]+@([^@.\s]+\.)+[^@.\s]+$/.test(text) ? text : report(errors, 'invalid_email', path);
}

// EXTERNAL: BR-DE-27, at least three digits in the seller contact telephone number (a SHOULD, severity warning).
function readTelephone(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const text = readText(parent, key, path, errors);
  if (text === undefined) return undefined;
  return (text.match(/[0-9]/g) ?? []).length >= 3 ? text : report(errors, 'invalid_telephone', path);
}
