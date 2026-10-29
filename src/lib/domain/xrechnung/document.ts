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
  KLEINUNTERNEHMER_EXEMPTION_TEXT,
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
export const UNIT_CODES = ['C62', 'HUR', 'DAY', 'MON', 'KGM', 'LTR', 'MTR', 'H87'] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

// Provisional defensive bound on a single text value, NOT a product rule (like the guards in number-notation.ts and invoice.ts).
export const PROVISIONAL_MAX_TEXT_LENGTH = 512;

// Orkaid defensive engineering limit for a multiline text (BT-22), NOT an EN 16931 / XRechnung maximum: the SeMoX
// datatype "text" defines no field length limit. Large enough for a professional invoice note, but not unbounded.
export const PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH = 10_000;

export type PartyInput = {
  name: string; // BT-27 / BT-44
  electronicAddress: { schemeId: string; value: string }; // BT-34 / BT-49
  address: { street: string; city: string; postCode: string; country: string }; // BG-5 / BG-8
};

/** BT-22, validated. An object rather than a bare string so BT-21 (subject code) can be added later without changing the element type. */
export type InvoiceNote = {
  readonly text: string;
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
  documentTypeCode: string; // BT-3: '380' or '381', validated by invoice.ts
  currency: string; // BT-5, validated by invoice.ts
  invoiceNumber: string; // BT-1
  issueDate: string; // BT-2, YYYY-MM-DD
  deliveryDate: string; // BT-72, YYYY-MM-DD
  buyerReference: string; // BT-10, buyer-provided business information (not a generated Leitweg-ID)
  /** BT-11, BT-12, BT-13 (MDR-36): independent optional facts, each 0..1, plain text. A list is refused. Never derived from BT-10. */
  projectReference?: string; // BT-11
  contractReference?: string; // BT-12
  orderReference?: string; // BT-13
  seller: PartyInput & {
    sellerIdentifiers?: readonly string[]; // BT-29, 0..n; no scheme in M1 (MDR-21)
    legalRegistrationId?: string; // BT-30; no scheme in M1 (MDR-21)
    vatId?: string; // BT-31
    taxRegistrationId?: string; // BT-32
    contact: { name: string; telephone: string; email: string }; // BG-6: BT-41, BT-42, BT-43
  };
  buyer: PartyInput & {
    legalRegistrationId?: string; // BT-47; no scheme in M1
    vatId?: string; // BT-48
  };
  /** BG-3, exactly one on a 381 (PROFILE: mandatory, MDR-35), never on a 380. */
  precedingInvoice?: { number: string; issueDate?: string }; // BT-25, BT-26
  payment: {
    dueDate?: string; // BT-9, 0..1, YYYY-MM-DD
    termsText?: string; // BT-20, 0..1, one text that may contain LF; no `#` in M1
    /** 380 only: required there, refused on a 381. */
    means?: {
      kind: string;
      code: string; // BT-81
      account: { id: { scheme: string; value: string }; name?: string; bic?: string }; // BG-17: BT-84, BT-85, BT-86
    };
    /** 381 only: required there, refused on a 380. Nothing defaults to clearing. */
    settlement?: { kind: string; reciprocalObligationConfirmed?: unknown };
  };
  notes?: readonly { text: string }[]; // BG-1 / BT-22, 0..n, order preserved; text may contain LF (BT-21 is not supported)
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

/** BT-84 with the kind of identifier it is. PROFILE: IBAN only; a non-IBAN identifier (CII ProprietaryID) is outside M1. */
export type PaymentAccountId = { readonly scheme: 'IBAN'; readonly value: string };

/** BG-17, one account in M1 (the standard allows 0..n). */
export type PaymentAccount = {
  readonly id: PaymentAccountId; // BT-84
  readonly name?: string; // BT-85, 0..1
  readonly bic?: string; // BT-86, 0..1; PROFILE: a BIC (ISO 9362)
};

/**
 * BG-16 payment means. `kind` separates credit transfer (BG-17) from card (BG-18) and direct debit (BG-19), none of which
 * besides credit transfer is in M1; `code` is BT-81: 30 (credit transfer) or 58 (SEPA credit transfer), the two codes
 * BR-DE-23 names as credit transfer.
 */
export type PaymentMeans = { readonly kind: 'credit-transfer'; readonly code: '30' | '58'; readonly account: PaymentAccount };

/** BT-9 and BT-20 are independent and both optional; BR-CO-25 (checked by buildInvoice) needs one of them when BT-115 > 0. */
export type Payment = {
  readonly dueDate?: string; // BT-9
  readonly termsText?: string; // BT-20, unstructured; may contain LF
  readonly means: PaymentMeans;
};

/**
 * A credit note's payment (MDR-35). `clearing` is UNCL4461 code 97, clearing between partners, and is available only
 * because the caller selected it and confirmed an existing reciprocal obligation. There is no payment means and no
 * BG-17: the validated type cannot name an account, so the issuer's 380 account cannot be reused by mistake.
 */
export type CreditNotePayment = {
  readonly dueDate?: string; // BT-9
  readonly termsText?: string; // BT-20
  readonly settlement: { readonly kind: 'clearing' };
};

/** BG-3. PROFILE: mandatory on a 381. BT-26 is optional; supply it when BT-25 alone does not identify the invoice. */
export type PrecedingInvoiceReference = {
  readonly number: string; // BT-25
  readonly issueDate?: string; // BT-26
};

declare const validatedBrand: unique symbol;

type InvoiceBase = {
  readonly [validatedBrand]: true;
  readonly currency: 'EUR'; // BT-5
  readonly invoiceNumber: string; // BT-1
  readonly issueDate: string; // BT-2
  readonly deliveryDate: string; // BT-72
  readonly buyerReference: string; // BT-10
  readonly projectReference?: string; // BT-11
  readonly contractReference?: string; // BT-12
  readonly orderReference?: string; // BT-13
  readonly seller: InvoiceParty & {
    readonly sellerIdentifiers: readonly SellerIdentifier[]; // BT-29, 0..n
    readonly legalRegistrationId?: string; // BT-30
    readonly vatId?: string; // BT-31
    readonly taxRegistrationId?: string; // BT-32
    readonly additionalLegalInformation?: string; // BT-33, set by buildInvoice for the Kleinunternehmer treatment, never by the caller
    readonly contact: { readonly name: string; readonly telephone: string; readonly email: string };
  };
  readonly buyer: InvoiceParty & {
    readonly legalRegistrationId?: string; // BT-47
    readonly vatId?: string; // BT-48
  };
  readonly notes: readonly InvoiceNote[]; // BG-1 / BT-22, 0..n, in input order
  readonly lines: readonly InvoiceLine[];
  readonly totals: InvoiceTotals;
};

/** BT-3 is the only carrier of the document kind (Model C): a sign never decides it, and a 381 keeps positive amounts. */
export type CommercialInvoice = InvoiceBase & { readonly documentTypeCode: '380'; readonly payment: Payment };
export type CreditNote = InvoiceBase & {
  readonly documentTypeCode: '381';
  readonly precedingInvoice: PrecedingInvoiceReference;
  readonly payment: CreditNotePayment;
};
export type Invoice = CommercialInvoice | CreditNote;
type Unbranded<T> = T extends unknown ? Omit<T, typeof validatedBrand> : never;

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
  | 'invalid_bic'
  | 'unsupported_country'
  | 'unsupported_electronic_address_scheme'
  | 'unsupported_payment_means'
  | 'unsupported_payment_account_scheme'
  | 'unsupported_hash_in_payment_terms' // PROFILE: `#` in BT-20 (structured Skonto, BR-DE-18, is not in M1)
  | 'unsupported_preceding_invoice_reference' // PROFILE: BG-3 on a 380 (MDR-35)
  | 'unsupported_settlement_on_invoice' // PROFILE: a credit note settlement on a 380 (MDR-35)
  | 'unsupported_credit_note_payment_means' // PROFILE: 380-style payment means (BG-17) on a 381 (MDR-35)
  | 'unsupported_credit_note_refund_transfer' // PROFILE: refund by credit transfer on a 381 is not verified (MDR-35)
  | 'unsupported_credit_note_settlement' // PROFILE: any settlement other than clearing on a 381 (MDR-35)
  | 'missing_clearing_confirmation' // clearing needs the caller's explicit confirmation of a reciprocal obligation
  | 'missing_payment_due_information' // BR-CO-25: BT-115 > 0 and neither BT-9 nor BT-20 is present
  | 'unsupported_unit_code'
  | 'missing_seller_identification' // BR-CO-26: none of BT-29, BT-30, BT-31 is present
  | 'missing_seller_tax_identifier' // neither BT-31 nor BT-32 is present (BR-S-02, BR-E-02, BR-DE-16)
  | 'missing_buyer_identifier' // BR-AE-02: a reverse-charge invoice has neither BT-47 nor BT-48
  | 'unsupported_mixed_vat_treatments' // PROFILE: a combination of treatments other than standard + reverse-charge
  | 'internal_inconsistency';

export type DocumentError = { readonly code: DocumentErrorCode; readonly path: string };

/**
 * On failure, `truncated` says whether `errors` is incomplete. When true, the last entry is an
 * 'error_list_truncated' error naming where scanning stopped (same contract as invoice.ts).
 */
export type DocumentResult =
  | { readonly ok: true; readonly value: Invoice }
  | { readonly ok: false; readonly errors: readonly DocumentError[]; readonly truncated: boolean };

const DOCUMENT_FIELDS = ['invoiceNumber', 'issueDate', 'deliveryDate', 'buyerReference', 'projectReference', 'contractReference', 'orderReference', 'precedingInvoice', 'seller', 'buyer', 'payment', 'notes'];
const LINE_FIELDS = ['name', 'unitCode'];
const PARTY_FIELDS = ['name', 'electronicAddress', 'address'];
const SELLER_FIELDS = [...PARTY_FIELDS, 'sellerIdentifiers', 'legalRegistrationId', 'vatId', 'taxRegistrationId', 'contact'];
const BUYER_FIELDS = [...PARTY_FIELDS, 'legalRegistrationId', 'vatId'];
const ADDRESS_FIELDS = ['street', 'city', 'postCode', 'country'];
const NOTE_FIELDS = ['text'];
const PAYMENT_FIELDS = ['dueDate', 'termsText', 'means', 'settlement'];
const PRECEDING_INVOICE_FIELDS = ['number', 'issueDate'];
const SETTLEMENT_FIELDS = ['kind', 'reciprocalObligationConfirmed'];
const PAYMENT_MEANS_FIELDS = ['kind', 'code', 'account'];
const PAYMENT_ACCOUNT_FIELDS = ['id', 'name', 'bic'];
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
  const scanLimit = firstUnscannedLine(money);

  const errors: DocumentError[] = [];
  const invoiceNumber = readText(input, 'invoiceNumber', 'invoiceNumber', errors);
  const issueDate = readDate(input, 'issueDate', 'issueDate', errors);
  const deliveryDate = readDate(input, 'deliveryDate', 'deliveryDate', errors);
  const buyerReference = readText(input, 'buyerReference', 'buyerReference', errors);
  // BT-11, BT-12, BT-13: each an independent optional fact. No default, no derivation from BT-10, no cross-check.
  const projectReference = readOptionalText(input, 'projectReference', 'projectReference', errors);
  const contractReference = readOptionalText(input, 'contractReference', 'contractReference', errors);
  const orderReference = readOptionalText(input, 'orderReference', 'orderReference', errors);
  const seller = readSeller(input, errors);
  const buyer = readBuyer(input, usesReverseCharge(input, scanLimit), errors);
  // Only an explicit 380 or 381 selects a kind-specific rule; any other BT-3 is reported once by the monetary calculation
  // (unsupported_document_type) and does not add noise about references or settlements.
  const creditNote = input.documentTypeCode === '381';
  const commercial = input.documentTypeCode === '380';
  const precedingInvoice = readPrecedingInvoice(input, creditNote, commercial, errors);
  const payment = creditNote ? readCreditNotePayment(input, errors) : readPayment(input, commercial, errors);
  const notes = readNotes(input, errors);
  const { lines: lineData, stoppedAt } = readLineData(input, scanLimit, errors);
  // PROFILE: the supported treatment compositions are listed, not derived. One treatment alone, or standard combined
  // with reverse charge (S + AE: an ordinary supply and a recipient-liable one billed together, UStAE 13b.4 (2) example
  // 1). Kleinunternehmer is never combined, and any combination not listed is refused as outside the profile, not as
  // legally invalid. Whether a line's supply qualifies for § 13b remains the caller's input, never checked here.
  if (money.ok && !isSupportedComposition(new Set(money.value.lines.map((line) => line.vat.treatment)))) {
    errors.push({ code: 'unsupported_mixed_vat_treatments', path: 'lines' });
  }
  // EXTERNAL, BR-CO-25 (SeMoX CIUS model; not implemented by the pinned Schematron, so the domain owns it): with a
  // positive amount due (BT-115) at least one of BT-9 and BT-20 is present. It needs the computed BT-115, so it is
  // checked only when the calculation succeeded. Presence is read from the raw input: a supplied-but-malformed value is
  // reported by its own diagnostic, not also as missing.
  if (money.ok && money.value.totals.amountDue.units > 0n && isRecord(input.payment) && input.payment.dueDate === undefined && input.payment.termsText === undefined) {
    errors.push({ code: 'missing_payment_due_information', path: 'payment' });
  }

  if (money.ok && errors.length === 0 && stoppedAt === undefined) {
    if (
      invoiceNumber === undefined || issueDate === undefined || deliveryDate === undefined ||
      buyerReference === undefined || seller === undefined || buyer === undefined || payment === undefined ||
      (creditNote && precedingInvoice === undefined)
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
    const common = {
      currency: 'EUR' as const,
      invoiceNumber, issueDate, deliveryDate, buyerReference,
      ...(projectReference !== undefined ? { projectReference } : {}),
      ...(contractReference !== undefined ? { contractReference } : {}),
      ...(orderReference !== undefined ? { orderReference } : {}),
      // BT-33: XRechnung 3.0.2 section 13.3 asks for the exemption text here as well as in BT-120.
      seller: money.value.lines.some((line) => line.vat.treatment === 'kleinunternehmer')
        ? { ...seller, additionalLegalInformation: KLEINUNTERNEHMER_EXEMPTION_TEXT }
        : seller,
      buyer, notes,
      lines,
      totals: money.value.totals,
    };
    // The kind is fixed by BT-3 alone. The two payment shapes are not interchangeable: only a 380 can carry payment means.
    if (creditNote) {
      if (precedingInvoice === undefined || !isCreditNotePayment(payment)) return { ok: false, errors: [{ code: 'internal_inconsistency', path: '' }], truncated: false };
      return { ok: true, value: seal({ ...common, documentTypeCode: '381', precedingInvoice, payment }) };
    }
    if (isCreditNotePayment(payment)) return { ok: false, errors: [{ code: 'internal_inconsistency', path: '' }], truncated: false };
    return { ok: true, value: seal({ ...common, documentTypeCode: '380', payment }) };
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
// property is reported at its path. Containers deeper than the input can legitimately be (root, then payment, then
// its `means`, then the `account`, then the account `id`, then only values) are replaced by an empty object, which
// also ends any cycle. The copy of a huge sparse array stays sparse. Ceiling: a hostile object with very many keys is
// copied in full (no entry budget).
const MAX_SNAPSHOT_DEPTH = 5;

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

  // No prototype (IR35-01, IR36-01): a field the caller did not supply as an own property reads as absent, never as a
  // value inherited from Object.prototype.
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    const entry = readData(value, key, path === '' ? key : `${path}.${key}`);
    // defineProperty, not assignment: a key named "__proto__" must stay an ordinary own property of the copy.
    if (entry.present) Object.defineProperty(copy, key, { value: entry.value, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

/**
 * Whether a validated document supplies an optional field (IR36-01): an own property that is not undefined. The validated
 * objects keep the ordinary prototype, so a plain `record.field !== undefined` would also see a value put on
 * Object.prototype later; serializers test every optional field through this.
 */
export function hasOwnField<T extends object, K extends keyof T>(record: T, key: K): record is T & { readonly [P in K]-?: Exclude<T[P], undefined> } {
  return Object.hasOwn(record, key) && record[key] !== undefined;
}

function seal(data: Unbranded<Invoice>): Invoice {
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
  // Seller tax identifier: BT-31 or BT-32. Every implemented treatment needs it: standard (BR-S-02, BR-DE-16),
  // kleinunternehmer (BR-E-02, BR-DE-16) and reverse-charge (BR-AE-02, BR-DE-16), verified in UBL and CII; it is not
  // relaxed for any category. BT-63/BG-11 (the tax representative branch these rules also accept) is not implemented in
  // M1, so only these two are checked (MDR-21).
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

// BT-47 and BT-48 are two distinct optional slots. An invoice with at least one reverse-charge line needs one of them
// (BR-AE-02), also when standard lines are present; other invoices are never forced to supply either. The treatment is
// read from the raw input so that this rule is also reported when the monetary calculation fails for another reason.
function readBuyer(parent: Record<string, unknown>, reverseCharge: boolean, errors: DocumentError[]): Invoice['buyer'] | undefined {
  const record = readObject(parent, 'buyer', 'buyer', BUYER_FIELDS, errors);
  if (record === undefined) return undefined;

  const errorsBefore = errors.length;
  const party = readPartyFields(record, 'buyer', errors);
  const legalRegistrationId = readOptionalText(record, 'legalRegistrationId', 'buyer.legalRegistrationId', errors);
  const vatId = readOptionalVatId(record, 'vatId', 'buyer.vatId', errors);

  // Presence is read from the raw input, never from the validated value: a supplied-but-malformed field is reported by
  // its own diagnostic and must not also be reported as missing.
  if (reverseCharge && record.legalRegistrationId === undefined && record.vatId === undefined) {
    errors.push({ code: 'missing_buyer_identifier', path: 'buyer' });
  }

  if (errors.length > errorsBefore || !party) return undefined;
  return {
    ...party,
    ...(legalRegistrationId !== undefined ? { legalRegistrationId } : {}),
    ...(vatId !== undefined ? { vatId } : {}),
  };
}

// MDR-14: once the error bound is hit, further lines are not scanned. A truncated monetary scan names its first unscanned
// line in its last error; every line-derived check after it reads only the indices below that one (exclusive bound).
// undefined when the scan was not cut short. A marker that does not name a line gives 0: nothing is read rather than too
// much. A bigint, not a Number, so no text reaches a binary floating-point conversion in this module.
function firstUnscannedLine(money: ReturnType<typeof calculateInvoice>): bigint | undefined {
  if (money.ok || !money.truncated) return undefined;
  const match = /^lines\[(0|[1-9][0-9]*)\]$/.exec(money.errors.at(-1)?.path ?? '');
  return match ? BigInt(match[1] ?? '0') : 0n;
}

function isSupportedComposition(treatments: ReadonlySet<InvoiceLineVat['treatment']>): boolean {
  return treatments.size === 1 || (treatments.size === 2 && treatments.has('standard') && treatments.has('reverse-charge'));
}

// Reads only the lines the monetary scan reached (see firstUnscannedLine).
function usesReverseCharge(input: Record<string, unknown>, scanLimit: bigint | undefined): boolean {
  const list = input.lines;
  if (!Array.isArray(list)) return false;
  for (let index = 0; index < list.length && (scanLimit === undefined || BigInt(index) < scanLimit); index++) {
    const line: unknown = list[index];
    if (isRecord(line) && isRecord(line.vat) && line.vat.treatment === 'reverse-charge') return true;
  }
  return false;
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

function readPayment(parent: Record<string, unknown>, commercial: boolean, errors: DocumentError[]): Payment | undefined {
  const record = readObject(parent, 'payment', 'payment', PAYMENT_FIELDS, errors);
  if (record === undefined) return undefined;
  const errorsBefore = errors.length;
  // BT-9 and BT-20 are each 0..1. Nothing is derived: no due date from the issue date or the terms, no default terms.
  const dueDate = record.dueDate === undefined ? undefined : readDate(record, 'dueDate', 'payment.dueDate', errors);
  const termsText = record.termsText === undefined ? undefined : readPaymentTerms(record.termsText, errors);
  if (commercial && record.settlement !== undefined) report(errors, 'unsupported_settlement_on_invoice', 'payment.settlement');
  const means = readPaymentMeans(record, errors);
  if (errors.length > errorsBefore || means === undefined) return undefined;
  return { ...(dueDate !== undefined ? { dueDate } : {}), ...(termsText !== undefined ? { termsText } : {}), means };
}

// BG-3 (MDR-35). PROFILE: exactly one on a 381, with BT-25; BT-26 is optional. On a 380 it is refused rather than
// ignored. The domain holds no original invoice, so it cannot check that the reference matches a real invoice or that
// the credited amounts do not exceed it: that stays the caller's responsibility.
function readPrecedingInvoice(parent: Record<string, unknown>, creditNote: boolean, commercial: boolean, errors: DocumentError[]): PrecedingInvoiceReference | undefined {
  if (!creditNote) {
    if (commercial && parent.precedingInvoice !== undefined) report(errors, 'unsupported_preceding_invoice_reference', 'precedingInvoice');
    return undefined;
  }
  const record = readObject(parent, 'precedingInvoice', 'precedingInvoice', PRECEDING_INVOICE_FIELDS, errors);
  if (record === undefined) return undefined;
  const number = readText(record, 'number', 'precedingInvoice.number', errors);
  const issueDate = record.issueDate === undefined ? undefined : readDate(record, 'issueDate', 'precedingInvoice.issueDate', errors);
  if (number === undefined || (record.issueDate !== undefined && issueDate === undefined)) return undefined;
  return { number, ...(issueDate !== undefined ? { issueDate } : {}) };
}

// Payment on a 381 (MDR-35). The only supported arrangement is a clearing the caller selected and confirmed (UNCL4461 code
// 97, clearing between partners): nothing defaults to it, a refund by transfer is refused explicitly (no source says whose
// account BG-17 would name on a credit note), and 380-style payment means are refused so the issuer's account is never reused.
function readCreditNotePayment(parent: Record<string, unknown>, errors: DocumentError[]): CreditNotePayment | undefined {
  const record = readObject(parent, 'payment', 'payment', PAYMENT_FIELDS, errors);
  if (record === undefined) return undefined;
  const errorsBefore = errors.length;
  const dueDate = record.dueDate === undefined ? undefined : readDate(record, 'dueDate', 'payment.dueDate', errors);
  const termsText = record.termsText === undefined ? undefined : readPaymentTerms(record.termsText, errors);
  if (record.means !== undefined) report(errors, 'unsupported_credit_note_payment_means', 'payment.means');
  const settled = readClearing(record, errors);
  if (errors.length > errorsBefore || !settled) return undefined;
  return { ...(dueDate !== undefined ? { dueDate } : {}), ...(termsText !== undefined ? { termsText } : {}), settlement: { kind: 'clearing' } };
}

function readClearing(payment: Record<string, unknown>, errors: DocumentError[]): boolean {
  const path = 'payment.settlement';
  const settlement = payment.settlement;
  if (settlement === undefined) return report(errors, 'missing_field', path) ?? false;
  if (!isRecord(settlement)) return report(errors, 'invalid_type', path) ?? false;
  const kind = settlement.kind;
  if (kind === undefined) return report(errors, 'missing_field', `${path}.kind`) ?? false;
  if (typeof kind !== 'string') return report(errors, 'invalid_type', `${path}.kind`) ?? false;
  if (kind === 'refund-transfer') return report(errors, 'unsupported_credit_note_refund_transfer', `${path}.kind`) ?? false;
  if (kind !== 'clearing') return report(errors, 'unsupported_credit_note_settlement', `${path}.kind`) ?? false;
  for (const name of Object.keys(settlement)) if (!SETTLEMENT_FIELDS.includes(name)) errors.push({ code: 'unknown_field', path: `${path}.${name}` });
  // Exactly the boolean true: "true", 1 or an omitted field is not a confirmation.
  if (settlement.reciprocalObligationConfirmed !== true) return report(errors, 'missing_clearing_confirmation', `${path}.reciprocalObligationConfirmed`) ?? false;
  return true;
}

function isCreditNotePayment(payment: Payment | CreditNotePayment | undefined): payment is CreditNotePayment {
  return payment !== undefined && Object.hasOwn(payment, 'settlement');
}

// BT-20 is one text value that may span several lines (the BT-22 multiline policy). PROFILE: no `#` at all. XRechnung
// forbids `#` in unstructured BT-20 text and reserves it for structured Skonto lines (BR-DE-18), which M1 does not
// support, so any `#` is refused rather than parsed.
function readPaymentTerms(value: unknown, errors: DocumentError[]): string | undefined {
  const text = readTextValue(value, 'payment.termsText', errors, true);
  if (text === undefined) return undefined;
  return text.includes('#') ? report(errors, 'unsupported_hash_in_payment_terms', 'payment.termsText') : text;
}

function readPaymentMeans(parent: Record<string, unknown>, errors: DocumentError[]): PaymentMeans | undefined {
  const means = readObject(parent, 'means', 'payment.means', PAYMENT_MEANS_FIELDS, errors);
  if (means === undefined) return undefined;
  // PROFILE: credit transfer with code 30 (credit transfer) or 58 (SEPA credit transfer) only.
  const kind = readChoice(means, 'kind', 'payment.means.kind', ['credit-transfer'], 'unsupported_payment_means', errors);
  const code = readChoice(means, 'code', 'payment.means.code', ['30', '58'], 'unsupported_payment_means', errors);
  // EXTERNAL, BR-DE-23 (codes 30 and 58): a credit transfer carries BG-17, so the account is required; BR-50/BR-61: it
  // carries BT-84. PROFILE: one account (BG-17 is 0..n) identified by an IBAN; a non-IBAN BT-84 (CII ProprietaryID) is
  // not supported. BT-85 and BT-86 are each 0..1, and nothing requires BT-86 for code 30.
  const account = readObject(means, 'account', 'payment.means.account', PAYMENT_ACCOUNT_FIELDS, errors);
  const id = account && readObject(account, 'id', 'payment.means.account.id', ['scheme', 'value'], errors);
  const scheme = id && readChoice(id, 'scheme', 'payment.means.account.id.scheme', ['IBAN'], 'unsupported_payment_account_scheme', errors);
  const value = id && readIban(id, 'value', 'payment.means.account.id.value', errors);
  const name = account && readOptionalText(account, 'name', 'payment.means.account.name', errors);
  const bic = account && readOptionalBic(account, 'bic', 'payment.means.account.bic', errors);
  if (kind === undefined || code === undefined || scheme === undefined || value === undefined) return undefined;
  return { kind, code, account: { id: { scheme, value }, ...(name !== undefined ? { name } : {}), ...(bic !== undefined ? { bic } : {}) } };
}

// BG-1 / BT-22: 0..n notes, order preserved. Absent is valid and gives an empty collection. A note is an object with
// exactly `text`; BT-21 (subject code) is not supported, so any other field is reported as unknown. Notes are caller
// content only: nothing here or in the serializers derives a note from a VAT exemption reason (BT-120).
function readNotes(parent: Record<string, unknown>, errors: DocumentError[]): readonly InvoiceNote[] {
  const value = parent.notes;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push({ code: 'invalid_type', path: 'notes' });
    return [];
  }
  const notes: InvoiceNote[] = [];
  for (const [index, entry] of value.entries()) {
    const path = `notes[${index}]`;
    if (entry === undefined) {
      errors.push({ code: 'missing_field', path });
    } else if (!isRecord(entry)) {
      errors.push({ code: 'invalid_type', path });
    } else {
      for (const name of Object.keys(entry)) if (!NOTE_FIELDS.includes(name)) errors.push({ code: 'unknown_field', path: `${path}.${name}` });
      const text = readTextValue(entry.text, `${path}.text`, errors, true);
      if (text !== undefined) notes.push({ text });
    }
  }
  return notes;
}

// ------------------------------------------------------------------------------------------------ lines

// Reads only the business part of each line (name, unit code). Monetary fields, non-record lines and holes are
// reported by invoice.ts. Object.keys visits the elements that exist, so a huge sparse array cannot stall the scan, and
// lists array indices in ascending order, so the scan ends at the first index the monetary scan did not reach.
function readLineData(input: Record<string, unknown>, scanLimit: bigint | undefined, errors: DocumentError[]): { lines: Record<string, { name: string; unitCode: UnitCode }>; stoppedAt: string | undefined } {
  const lines: Record<string, { name: string; unitCode: UnitCode }> = {};
  const list = input.lines;
  if (!Array.isArray(list)) return { lines, stoppedAt: undefined };

  for (const key of Object.keys(list)) {
    if (!/^(0|[1-9][0-9]*)$/.test(key)) continue;
    if (scanLimit !== undefined && BigInt(key) >= scanLimit) break;
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

// `multiline` (BT-22 only) additionally admits LF inside the text. PROFILE choice, not an EN/XRechnung rule: CR is
// rejected rather than normalised (an XML parser would turn CR and CRLF into LF), and every other control stays illegal.
function readTextValue(value: unknown, path: string, errors: DocumentError[], multiline = false): string | undefined {
  if (value === undefined) return report(errors, 'missing_field', path);
  if (typeof value !== 'string') return report(errors, 'invalid_type', path);
  if (value.trim() === '') return report(errors, 'empty_text', path);
  if (value.length > (multiline ? PROVISIONAL_MAX_MULTILINE_TEXT_LENGTH : PROVISIONAL_MAX_TEXT_LENGTH)) return report(errors, 'text_too_long', path);
  // Never trimmed or otherwise repaired: the caller is told, the text is not silently changed.
  if (value !== value.trim() || ILLEGAL_TEXT.test(multiline ? value.replaceAll('\n', '') : value)) return report(errors, 'invalid_text', path);
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
// valid and never reported. The same check serves the buyer's BT-48: EN 16931 only needs the ISO 3166 prefix
// (BR-CO-09), the German format is a PROFILE restriction for a domestic buyer.
function readOptionalVatId(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  const text = readTextValue(value, path, errors);
  if (text === undefined) return undefined;
  return /^DE[0-9]{9}$/.test(text) ? text : report(errors, 'invalid_vat_id', path);
}

// CONDITIONAL: with payment means 58, XRechnung BR-DE-19 expects a valid IBAN (a SHOULD, severity warning). ISO 13616
// mod-97 on the electronic form; like the validator, this does not check the per-country length. With code 30 no rule
// checks the IBAN; the same check applies there because the account identifier is declared to be an IBAN (PROFILE).
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

// PROFILE: BT-86 is a BIC (ISO 9362: four-letter institution code, ISO 3166 country, two-character location, optional
// three-character branch), the identifier SeMoX describes and the CII binding (BICID) names. No inspected rule checks it.
function readOptionalBic(parent: Record<string, unknown>, key: string, path: string, errors: DocumentError[]): string | undefined {
  const text = readOptionalText(parent, key, path, errors);
  if (text === undefined) return undefined;
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(text) ? text : report(errors, 'invalid_bic', path);
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
