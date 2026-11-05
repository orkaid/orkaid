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
  ownElement,
  PROVISIONAL_MAX_REPORTED_ERRORS,
  type InvoiceError,
  type InvoiceErrorCode,
  type InvoiceLineVat,
  type InvoiceOptions,
  type InvoiceTotals,
  type VatInput,
} from './invoice.ts';
import { compare, effectiveFractionDigits, formatDecimal, roundHalfUp, type Decimal } from './decimal.ts';
import { checkLeitwegId } from './leitweg-id.ts';
import { parseDecimalInput, type NumberNotation } from './number-notation.ts';
import { appendOwn, defineOwn } from './own-data.ts';

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
  /** BT-72 or BG-14, exactly one (PROFILE, MDR-37): a runtime rule, so the input type does not encode it. */
  deliveryDate?: string; // BT-72, YYYY-MM-DD
  invoicingPeriod?: { startDate: string; endDate: string }; // BG-14: BT-73, BT-74, each YYYY-MM-DD
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
    termsText?: string; // BT-20 free text, 0..1, one text that may contain LF; no `#`
    /** 380 only, refused on a 381 (PROFILE, MDR-39). Projected into BT-20 after the free text. `days` is an integer count, not a decimal. */
    skonto?: readonly { days: number; percent: string }[];
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

/**
 * One Skonto condition (MDR-39), descriptive only: it changes no amount. `days` is a neutral count: XRechnung 3.0.2 does not
 * unequivocally define its reference point, so none is assumed and no deadline exists in the model. `percent` has scale 2.
 */
export type SkontoTier = { readonly days: number; readonly percent: Decimal };

/** BT-9 and BT-20 are independent and both optional; BR-CO-25 (checked by buildInvoice) needs one of them when BT-115 > 0. */
export type Payment = {
  readonly dueDate?: string; // BT-9
  readonly termsText?: string; // BT-20, unstructured; may contain LF
  readonly skonto?: readonly SkontoTier[]; // BT-20, structured; paymentTermsText builds the element from both
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

/** BG-14. PROFILE (MDR-37): both boundaries, although BR-CO-19 needs only one; EXTERNAL BR-29: end not before start. */
export type InvoicingPeriod = {
  readonly startDate: string; // BT-73
  readonly endDate: string; // BT-74
};

declare const validatedBrand: unique symbol;

type InvoiceBase = {
  readonly [validatedBrand]: true;
  readonly currency: 'EUR'; // BT-5
  readonly invoiceNumber: string; // BT-1
  readonly issueDate: string; // BT-2
  // Exactly one of BT-72 and BG-14 is present. A runtime invariant of buildInvoice, deliberately not a type-level union,
  // so a later contract can relax it without changing the validated type (MDR-37). Serializers branch by hasOwnField.
  readonly deliveryDate?: string; // BT-72
  readonly invoicingPeriod?: InvoicingPeriod; // BG-14
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
  | 'unsupported_hash_in_payment_terms' // `#` in the free text of BT-20; structured Skonto is `payment.skonto` (MDR-39)
  | 'unsupported_skonto_tier_count' // PROFILE (MDR-39): not 1 to 10 tiers
  | 'unsupported_skonto_days' // PROFILE (MDR-39): not an integer from 1 to 365
  | 'unsupported_skonto_tier_order' // PROFILE (MDR-39): days not strictly ascending
  | 'unsupported_skonto_percent' // PROFILE (MDR-39): not above 0 and at most 100
  | 'unsupported_skonto_base_amount' // PROFILE (MDR-39): BASISBETRAG is not supported
  | 'unsupported_skonto_on_credit_note' // PROFILE (MDR-39): a tier list on a 381
  | 'invalid_leitweg_id_format' // PROFILE (MDR-38), only with buyerReferencePolicy 'leitweg-id': BT-10 is not the Leitweg-ID structure
  | 'invalid_leitweg_id_checksum' // PROFILE (MDR-38), same policy: the check digits are not the canonical pair
  | 'invalid_invoicing_period' // BR-29: the end date (BT-74) is before the start date (BT-73)
  | 'unsupported_delivery_date_with_invoicing_period' // PROFILE: BT-72 and BG-14 together (MDR-37)
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
 * The options of `buildInvoice`: the monetary options plus the document policies. Kept apart from `InvoiceOptions`
 * so the monetary API (`calculateInvoice*`) is unchanged. A policy is a caller choice, never a document field and never
 * stored in the validated invoice.
 */
export type DocumentOptions = InvoiceOptions & {
  /**
   * Opt-in validation of BT-10 as a Leitweg-ID (MDR-38): local structure and check digits only, never proof that the
   * identifier is assigned, routable or accepted. Absent or undefined: BT-10 is validated as ordinary text, as before.
   */
  readonly buyerReferencePolicy?: 'leitweg-id';
};

/**
 * On failure, `truncated` says whether `errors` is incomplete. When true, the last entry is an
 * 'error_list_truncated' error naming where scanning stopped (same contract as invoice.ts).
 */
export type DocumentResult =
  | { readonly ok: true; readonly value: Invoice }
  | { readonly ok: false; readonly errors: readonly DocumentError[]; readonly truncated: boolean };

const DOCUMENT_FIELDS = ['invoiceNumber', 'issueDate', 'deliveryDate', 'invoicingPeriod', 'buyerReference', 'projectReference', 'contractReference', 'orderReference', 'precedingInvoice', 'seller', 'buyer', 'payment', 'notes'];
const LINE_FIELDS = ['name', 'unitCode'];
const PARTY_FIELDS = ['name', 'electronicAddress', 'address'];
const SELLER_FIELDS = [...PARTY_FIELDS, 'sellerIdentifiers', 'legalRegistrationId', 'vatId', 'taxRegistrationId', 'contact'];
const BUYER_FIELDS = [...PARTY_FIELDS, 'legalRegistrationId', 'vatId'];
const ADDRESS_FIELDS = ['street', 'city', 'postCode', 'country'];
const NOTE_FIELDS = ['text'];
const PAYMENT_FIELDS = ['dueDate', 'termsText', 'skonto', 'means', 'settlement'];
const SKONTO_TIER_FIELDS = ['days', 'percent'];
const INVOICING_PERIOD_FIELDS = ['startDate', 'endDate'];
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

export function buildInvoice(rawInput: unknown, options: DocumentOptions = {}): DocumentResult {
  const buyerReferencePolicy = readBuyerReferencePolicy(options);
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
    // Length check: an index past the end would read a value inherited at that index (IR39-01).
    const stoppedAt = problems.length > PROVISIONAL_MAX_REPORTED_ERRORS ? problems[PROVISIONAL_MAX_REPORTED_ERRORS] : undefined;
    if (stoppedAt !== undefined) appendOwn(reported, { code: 'error_list_truncated', path: stoppedAt });
    return { ok: false, errors: reported, truncated: stoppedAt !== undefined };
  }

  // Read once and handed on, so an accessor cannot make the amounts and the Skonto percent use different notations.
  const notation = (Object.hasOwn(options, 'notation') ? options.notation : undefined) ?? 'canonical';
  const money = calculateInvoice(input, { notation }, { invoice: DOCUMENT_FIELDS, line: LINE_FIELDS });
  if (!isRecord(input)) return failure([], money, undefined);
  const scanLimit = firstUnscannedLine(money);

  const errors: DocumentError[] = [];
  const invoiceNumber = readText(input, 'invoiceNumber', 'invoiceNumber', errors);
  const issueDate = readDate(input, 'issueDate', 'issueDate', errors);
  const { deliveryDate, invoicingPeriod } = readSupplyDate(input, errors);
  const buyerReference = readText(input, 'buyerReference', 'buyerReference', errors);
  // MDR-38: only after the ordinary BT-10 text rules succeeded, and the text is checked, never repaired.
  if (buyerReference !== undefined && buyerReferencePolicy === 'leitweg-id') {
    const violation = checkLeitwegId(buyerReference);
    if (violation !== undefined) report(errors, violation, 'buyerReference');
  }
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
  const payment = creditNote ? readCreditNotePayment(input, errors) : readPayment(input, commercial, notation, errors);
  const notes = readNotes(input, errors);
  const { lines: lineData, stoppedAt } = readLineData(input, scanLimit, errors);
  // PROFILE: the supported treatment compositions are listed, not derived. One treatment alone, or standard combined
  // with reverse charge (S + AE: an ordinary supply and a recipient-liable one billed together, UStAE 13b.4 (2) example
  // 1). Kleinunternehmer is never combined, and any combination not listed is refused as outside the profile, not as
  // legally invalid. Whether a line's supply qualifies for § 13b remains the caller's input, never checked here.
  if (money.ok && !isSupportedComposition(new Set(money.value.lines.map((line) => line.vat.treatment)))) {
    appendOwn(errors, { code: 'unsupported_mixed_vat_treatments', path: 'lines' });
  }
  // EXTERNAL, BR-CO-25 (SeMoX CIUS model; not implemented by the pinned Schematron, so the domain owns it): with a
  // positive amount due (BT-115) at least one of BT-9 and BT-20 is present. It needs the computed BT-115, so it is
  // checked only when the calculation succeeded. Presence is read from the raw input: a supplied-but-malformed value is
  // reported by its own diagnostic, not also as missing. A tier list is BT-20 content (MDR-39), so it counts as BT-20.
  if (money.ok && money.value.totals.amountDue.units > 0n && isRecord(input.payment) && input.payment.dueDate === undefined && input.payment.termsText === undefined && input.payment.skonto === undefined) {
    appendOwn(errors, { code: 'missing_payment_due_information', path: 'payment' });
  }

  if (money.ok && errors.length === 0 && stoppedAt === undefined) {
    if (
      invoiceNumber === undefined || issueDate === undefined || (deliveryDate === undefined) === (invoicingPeriod === undefined) ||
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
      appendOwn(lines, { ...data, quantity: calculated.quantity, unitPrice: calculated.unitPrice, vat: calculated.vat, netAmount: totalsLine.netAmount });
    }
    const common = {
      currency: 'EUR' as const,
      invoiceNumber, issueDate,
      ...(deliveryDate !== undefined ? { deliveryDate } : {}),
      ...(invoicingPeriod !== undefined ? { invoicingPeriod } : {}),
      buyerReference,
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

// The policy is the caller's explicit choice, so it is read like `notation` (invoice.ts): an own property only, never
// one inherited from a prototype, and never through an accessor. A value that is present but not a known policy is a
// programming error, not input: it throws instead of silently turning the check off. Undefined means "not chosen".
function readBuyerReferencePolicy(options: DocumentOptions): 'leitweg-id' | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(options, 'buyerReferencePolicy');
  if (descriptor === undefined) return undefined;
  // Own check: a descriptor is an ordinary object, so `'value' in descriptor` would also see Object.prototype.value (IR38-01).
  if (!Object.hasOwn(descriptor, 'value')) throw new RangeError('buyerReferencePolicy must be a data property, not an accessor');
  const policy: unknown = descriptor.value;
  if (policy === undefined) return undefined;
  if (policy === 'leitweg-id') return policy;
  throw new RangeError(`unknown buyer reference policy: ${typeof policy === 'string' ? JSON.stringify(policy) : typeof policy}`);
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
    // Own check: a descriptor is an ordinary object, so `'value' in descriptor` would also see Object.prototype.value (IR38-03).
    if (!Object.hasOwn(descriptor, 'value')) {
      appendOwn(problems, childPath);
      return { present: false };
    }
    return { present: true, value: snapshot(descriptor.value, childPath, depth + 1, problems) };
  };

  if (Array.isArray(value)) {
    const copy: unknown[] = new Array(value.length);
    for (const key of Object.keys(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) continue;
      const entry = readData(value, key, `${path}[${key}]`);
      if (entry.present) defineOwn(copy, key, entry.value);
    }
    return copy;
  }

  // No prototype (IR35-01, IR36-01): a field the caller did not supply as an own property reads as absent, never as a
  // value inherited from Object.prototype.
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    const entry = readData(value, key, path === '' ? key : `${path}.${key}`);
    // Not assignment: a key named "__proto__" must stay an ordinary own property of the copy.
    if (entry.present) defineOwn(copy, key, entry.value);
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

// ------------------------------------------------------------------------------------------------ supply date

// BT-72 or BG-14 (MDR-37), identically on a 380 and a 381; on a 381 either one states the credited delivery or service.
// PROFILE: exactly one of them. Neither keeps the existing missing_field on deliveryDate; both is refused as outside the
// profile, while each value is still validated on its own. Presence is read from the snapshot, which holds own properties
// only, so an inherited value is never a supplied one. Nothing is derived, defaulted or compared with another date.
function readSupplyDate(input: Record<string, unknown>, errors: DocumentError[]): { deliveryDate: string | undefined; invoicingPeriod: InvoicingPeriod | undefined } {
  const periodSupplied = input.invoicingPeriod !== undefined;
  const deliveryDate = periodSupplied && input.deliveryDate === undefined ? undefined : readDate(input, 'deliveryDate', 'deliveryDate', errors);
  const invoicingPeriod = periodSupplied ? readInvoicingPeriod(input, errors) : undefined;
  if (periodSupplied && input.deliveryDate !== undefined) report(errors, 'unsupported_delivery_date_with_invoicing_period', 'invoicingPeriod');
  // Both keys always own, also when undefined: the caller destructures them, and an absent key would read Object.prototype.
  return { deliveryDate, invoicingPeriod };
}

// BG-14. PROFILE: both boundaries are required (a one-sided period is conformant to BR-CO-19 but not supported); an empty
// object reports both. Each is a real calendar date by the BT-72 check; the order (BR-29) is checked only between two valid
// dates. YYYY-MM-DD compares in calendar order as text, and equal dates are a valid single-day period.
function readInvoicingPeriod(parent: Record<string, unknown>, errors: DocumentError[]): InvoicingPeriod | undefined {
  const record = readObject(parent, 'invoicingPeriod', 'invoicingPeriod', INVOICING_PERIOD_FIELDS, errors);
  if (record === undefined) return undefined;
  const startDate = readDate(record, 'startDate', 'invoicingPeriod.startDate', errors);
  const endDate = readDate(record, 'endDate', 'invoicingPeriod.endDate', errors);
  if (startDate === undefined || endDate === undefined) return undefined;
  if (endDate < startDate) return report(errors, 'invalid_invoicing_period', 'invoicingPeriod.endDate');
  return { startDate, endDate };
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
    appendOwn(errors, { code: 'missing_seller_identification', path: 'seller' });
  }
  // Seller tax identifier: BT-31 or BT-32. Every implemented treatment needs it: standard (BR-S-02, BR-DE-16),
  // kleinunternehmer (BR-E-02, BR-DE-16) and reverse-charge (BR-AE-02, BR-DE-16), verified in UBL and CII; it is not
  // relaxed for any category. BT-63/BG-11 (the tax representative branch these rules also accept) is not implemented in
  // M1, so only these two are checked (MDR-21).
  if (!suppliesBt31 && !suppliesBt32) {
    appendOwn(errors, { code: 'missing_seller_tax_identifier', path: 'seller' });
  }

  if (errors.length > errorsBefore || !party || !contact) return undefined;
  return { ...party, sellerIdentifiers, legalRegistrationId, vatId, taxRegistrationId, contact };
}

// BT-29: caller-supplied values, no scheme in M1. Absent is valid (0..n); each present entry is validated as text.
function readSellerIdentifiers(parent: Record<string, unknown>, errors: DocumentError[]): readonly SellerIdentifier[] {
  const value = parent.sellerIdentifiers;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    appendOwn(errors, { code: 'invalid_type', path: 'seller.sellerIdentifiers' });
    return [];
  }
  const identifiers: SellerIdentifier[] = [];
  for (let index = 0; index < value.length; index++) {
    const text = readTextValue(ownElement(value, index), `seller.sellerIdentifiers[${index}]`, errors);
    if (text !== undefined) appendOwn(identifiers, { value: text });
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
    appendOwn(errors, { code: 'missing_buyer_identifier', path: 'buyer' });
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
    const line = ownElement(list, index);
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

function readPayment(parent: Record<string, unknown>, commercial: boolean, notation: NumberNotation, errors: DocumentError[]): Payment | undefined {
  const record = readObject(parent, 'payment', 'payment', PAYMENT_FIELDS, errors);
  if (record === undefined) return undefined;
  const errorsBefore = errors.length;
  // BT-9 and BT-20 are each 0..1. Nothing is derived: no due date from the issue date or the terms, no default terms.
  const dueDate = record.dueDate === undefined ? undefined : readDate(record, 'dueDate', 'payment.dueDate', errors);
  const termsText = record.termsText === undefined ? undefined : readPaymentTerms(record.termsText, errors);
  const skonto = readSkonto(record, notation, errors);
  if (commercial && record.settlement !== undefined) report(errors, 'unsupported_settlement_on_invoice', 'payment.settlement');
  const means = readPaymentMeans(record, errors);
  if (errors.length > errorsBefore || means === undefined) return undefined;
  return { ...(dueDate !== undefined ? { dueDate } : {}), ...(termsText !== undefined ? { termsText } : {}), ...(skonto !== undefined ? { skonto } : {}), means };
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
  // PROFILE (MDR-39), not an XRechnung prohibition: no source consulted says what an early-payment discount means on a credit note.
  if (record.skonto !== undefined) report(errors, 'unsupported_skonto_on_credit_note', 'payment.skonto');
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
  for (const name of Object.keys(settlement)) if (!SETTLEMENT_FIELDS.includes(name)) appendOwn(errors, { code: 'unknown_field', path: `${path}.${name}` });
  // Exactly the boolean true: "true", 1 or an omitted field is not a confirmation.
  if (settlement.reciprocalObligationConfirmed !== true) return report(errors, 'missing_clearing_confirmation', `${path}.reciprocalObligationConfirmed`) ?? false;
  return true;
}

function isCreditNotePayment(payment: Payment | CreditNotePayment | undefined): payment is CreditNotePayment {
  return payment !== undefined && Object.hasOwn(payment, 'settlement');
}

// The free text of BT-20 is one value that may span several lines (the BT-22 multiline policy). EXTERNAL: XRechnung 3.0.2
// forbids `#` in unstructured BT-20 text and reserves it for structured Skonto lines (BR-DE-18). Those come only from
// `payment.skonto`, so any `#` here is refused rather than parsed.
function readPaymentTerms(value: unknown, errors: DocumentError[]): string | undefined {
  const text = readTextValue(value, 'payment.termsText', errors, true);
  if (text === undefined) return undefined;
  return text.includes('#') ? report(errors, 'unsupported_hash_in_payment_terms', 'payment.termsText') : text;
}

// PROFILE limits on structured Skonto (MDR-39), stricter than the standard: the pinned validator accepts TAGE=0, PROZENT=101.00
// and duplicate or descending tiers, so it cannot evidence them. Input is refused, never sorted, merged or repaired.
const MIN_SKONTO_TIERS = 1;
const MAX_SKONTO_TIERS = 10;
const MIN_SKONTO_DAYS = 1;
const MAX_SKONTO_DAYS = 365;
const MAX_SKONTO_PERCENT: Decimal = { units: 100n, scale: 0 };
const SKONTO_PERCENT_SCALE = 2;

function readSkonto(payment: Record<string, unknown>, notation: NumberNotation, errors: DocumentError[]): readonly SkontoTier[] | undefined {
  const path = 'payment.skonto';
  const list = payment.skonto;
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) return report(errors, 'invalid_type', path);
  // Checked before any element is read, so a huge sparse array costs nothing.
  if (list.length < MIN_SKONTO_TIERS || list.length > MAX_SKONTO_TIERS) return report(errors, 'unsupported_skonto_tier_count', path);

  const tiers: SkontoTier[] = [];
  let highestDays = 0;
  for (let index = 0; index < list.length; index++) {
    const tierPath = `${path}[${index}]`;
    const entry = ownElement(list, index);
    if (entry === undefined) {
      report(errors, 'missing_field', tierPath);
    } else if (!isRecord(entry)) {
      report(errors, 'invalid_type', tierPath);
    } else {
      for (const name of Object.keys(entry)) {
        if (name === 'baseAmount') report(errors, 'unsupported_skonto_base_amount', `${tierPath}.baseAmount`);
        else if (!SKONTO_TIER_FIELDS.includes(name)) report(errors, 'unknown_field', `${tierPath}.${name}`);
      }
      const days = readSkontoDays(entry.days, `${tierPath}.days`, errors);
      if (days !== undefined && days <= highestDays) report(errors, 'unsupported_skonto_tier_order', `${tierPath}.days`);
      const percent = readSkontoPercent(entry.percent, `${tierPath}.percent`, notation, errors);
      if (days !== undefined) highestDays = Math.max(highestDays, days);
      if (days !== undefined && percent !== undefined) appendOwn(tiers, { days, percent });
    }
  }
  return tiers;
}

// A count, not a decimal: a JSON number, never text. `% 1` is 0 only for a finite integer, and the range keeps it safe.
function readSkontoDays(value: unknown, path: string, errors: DocumentError[]): number | undefined {
  if (value === undefined) return report(errors, 'missing_field', path);
  if (typeof value !== 'number') return report(errors, 'invalid_type', path);
  return value % 1 === 0 && value >= MIN_SKONTO_DAYS && value <= MAX_SKONTO_DAYS ? value : report(errors, 'unsupported_skonto_days', path);
}

// In order, as for BT-129 and BT-146 (invoice.ts): grammar and sign, then precision, then range.
function readSkontoPercent(value: unknown, path: string, notation: NumberNotation, errors: DocumentError[]): Decimal | undefined {
  if (value === undefined) return report(errors, 'missing_field', path);
  if (typeof value !== 'string') return report(errors, 'invalid_type', path);
  const parsed = parseDecimalInput(value, notation);
  if (!parsed.ok) return report(errors, parsed.code, path);
  if (effectiveFractionDigits(parsed.value) > SKONTO_PERCENT_SCALE) return report(errors, 'fraction_digits_limit', path);
  if (parsed.value.units === 0n || compare(parsed.value, MAX_SKONTO_PERCENT) > 0) return report(errors, 'unsupported_skonto_percent', path);
  // Only changes the written scale: at most two effective fractional digits are left, so nothing rounds.
  return roundHalfUp(parsed.value, SKONTO_PERCENT_SCALE);
}

/**
 * BT-20, the one element both serializers write (MDR-39): the free text followed by LF when both exist, then one BR-DE-18 line
 * per tier, each followed by the LF XRechnung 3.0.2 section 12.6 requires. With no tiers it is exactly the free text.
 */
export function paymentTermsText(payment: { readonly termsText?: string; readonly skonto?: readonly SkontoTier[] }): string | undefined {
  const text = hasOwnField(payment, 'termsText') ? payment.termsText : undefined;
  if (!hasOwnField(payment, 'skonto')) return text;
  const tiers = payment.skonto.map((tier) => `#SKONTO#TAGE=${tier.days}#PROZENT=${formatDecimal(tier.percent)}#\n`).join('');
  return text === undefined ? tiers : `${text}\n${tiers}`;
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
    appendOwn(errors, { code: 'invalid_type', path: 'notes' });
    return [];
  }
  const notes: InvoiceNote[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = ownElement(value, index);
    const path = `notes[${index}]`;
    if (entry === undefined) {
      appendOwn(errors, { code: 'missing_field', path });
    } else if (!isRecord(entry)) {
      appendOwn(errors, { code: 'invalid_type', path });
    } else {
      for (const name of Object.keys(entry)) if (!NOTE_FIELDS.includes(name)) appendOwn(errors, { code: 'unknown_field', path: `${path}.${name}` });
      const text = readTextValue(entry.text, `${path}.text`, errors, true);
      if (text !== undefined) appendOwn(notes, { text });
    }
  }
  return notes;
}

// ------------------------------------------------------------------------------------------------ lines

// Reads only the business part of each line (name, unit code). Monetary fields, non-record lines and holes are
// reported by invoice.ts. Object.keys visits the elements that exist, so a huge sparse array cannot stall the scan, and
// lists array indices in ascending order, so the scan ends at the first index the monetary scan did not reach.
function readLineData(input: Record<string, unknown>, scanLimit: bigint | undefined, errors: DocumentError[]): { lines: Record<string, { name: string; unitCode: UnitCode }>; stoppedAt: string | undefined } {
  // No prototype: an index is written and read back here, and must not reach an inherited numeric setter or value (IR39-01).
  const lines: Record<string, { name: string; unitCode: UnitCode }> = Object.create(null);
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
    appendOwn(errors, { code: 'missing_field', path });
    return undefined;
  }
  if (!isRecord(value)) {
    appendOwn(errors, { code: 'invalid_type', path });
    return undefined;
  }
  // Ceiling: unknown fields are reported without bound, as invoice.ts does for its own levels.
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name)) appendOwn(errors, { code: 'unknown_field', path: `${path}.${name}` });
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
  appendOwn(errors, { code, path });
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
  // The range guard keeps the table lookup on its own entries: '00' or '13' would otherwise read Object.prototype.
  if (year === '0000' || month < '01' || month > '12') return false;
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
