// V1 XRechnung semantic invoice model and monetary calculation.
// Scope: domestic German B2B invoice, EUR, BT-3 = 380, VAT category S at 19% or 7%, the Kleinunternehmer treatment
// (category E, rate 0) or the reverse-charge treatment (category AE, rate 0), non-negative amounts.
// Syntax-independent: no UBL/CII structures. Anything outside the scope is an explicit failure, never a fallback (MDR-12).
//
// Calculation contract, a project engineering policy for V1 (MDR-13). HALF_UP is not an EN 16931/XRechnung mandate;
// BR-CO-17 itself only requires rounding BT-117 to two decimals:
//   BT-131 = round(quantity x unit price, 2)          per line
//   BT-116 = sum of BT-131 per VAT category and rate
//   BT-117 = round(BT-116 x BT-119 / 100, 2)          once per bucket (BR-CO-17), never summed per line
//   BT-110 = sum of BT-117
//   BT-115 = BT-112, as BR-CO-16 with BT-113 and BT-114 absent
// Numeric bounds, PROFILE (M1), checked on exact decimals: BT-129 and BT-146 each at most 6 effective fractional
// digits and below 10^9; every amount calculated above below 10^10 EUR, checked after the calculation.
// Identification, parties, dates and payment data belong to document.ts, which delegates every amount to this module.

import { add, compare, effectiveFractionDigits, multiply, roundHalfUp, type Decimal, type DecimalErrorCode } from './decimal.ts';
import { parseDecimalInput, type NumberNotation } from './number-notation.ts';

export const SUPPORTED_VAT_RATES = ['19', '7'] as const;
export type VatRate = (typeof SUPPORTED_VAT_RATES)[number];

// PROFILE (M1) numeric bounds. Upper bounds are exclusive and compared exactly; precision counts effective fractional
// digits (trailing zeros ignored), while the parsed value keeps the scale the caller wrote. The amount ceiling is an
// interoperability guard for the pinned validation baseline, chosen with a margin below the amounts at which that
// validator was observed to fail; it is not an EN 16931, XRechnung or XSD maximum. The non-negative lower bound is the
// existing sign rule of the decimal parser; zero is neither rejected nor singled out here. These bounds are the accepted
// M1 numeric policy (MDR-24, resting on MDR-13, MDR-14 and MDR-18); the validator observation is evidence for it, not
// a rule of the specification.
export const MAX_QUANTITY_EFFECTIVE_FRACTION_DIGITS = 6; // BT-129
export const MAX_UNIT_PRICE_EFFECTIVE_FRACTION_DIGITS = 6; // BT-146
export const MAX_QUANTITY_EXCLUSIVE: Decimal = Object.freeze({ units: 1_000_000_000n, scale: 0 }); // BT-129
export const MAX_UNIT_PRICE_EXCLUSIVE: Decimal = Object.freeze({ units: 1_000_000_000n, scale: 0 }); // BT-146
// BT-131, BT-116, BT-117, BT-106, BT-109, BT-110, BT-112 and BT-115, in EUR.
export const MAX_CALCULATED_AMOUNT_EXCLUSIVE: Decimal = Object.freeze({ units: 10_000_000_000n, scale: 0 });

/**
 * BT-120 and BT-33 text for a Kleinunternehmer invoice. EXTERNAL (recommendation): XRechnung 3.0.2 section 13.3 gives
 * this wording for both terms; no executable rule tests it and § 34a UStDV only requires a note that the exemption of
 * § 19 UStG applies. Orkaid choice: this fixed German text, held here once and only rendered by the serializers, is not
 * caller-editable in M1. No claim is made that it is legally sufficient beyond being the text the specification gives.
 * The whole Kleinunternehmer contract (category E, rate 0, BT-120 and BT-33 wording, BT-121 omitted, seller tax
 * identifier BT-31 or BT-32, one treatment per invoice, no eligibility check) is the accepted implementation decision
 * (MDR-22, resting on MDR-18 and MDR-21); the law and the specification above remain the authority for the rule itself.
 */
export const KLEINUNTERNEHMER_EXEMPTION_TEXT = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG';

/**
 * BT-120 text for a reverse-charge invoice. EXTERNAL (law): § 14a Abs. 5 Satz 1 UStG requires the invoice to carry the
 * statement „Steuerschuldnerschaft des Leistungsempfängers“; BR-AE-10 only tests that BT-120 or BT-121 exists.
 * Orkaid choice: this statutory phrase, held here once and only rendered by the serializers, is not caller-editable in M1
 * (XRechnung 3.0.2 suggests 'Umkehrung der Steuerschuldnerschaft' for BT-120; using the statutory phrase instead is an
 * Orkaid choice, and BT-121 is omitted). No claim is made that it is legally sufficient beyond being the phrase the
 * statute names. The whole reverse-charge contract (category AE, rate 0, seller BT-31 or BT-32, buyer BT-47 or BT-48,
 * one treatment per invoice, domestic, no § 13b applicability check) is the accepted implementation decision (MDR-23,
 * resting on MDR-18, MDR-21 and MDR-22).
 */
export const REVERSE_CHARGE_TEXT = 'Steuerschuldnerschaft des Leistungsempfängers';

/**
 * The semantic identity of a line's VAT treatment: `treatment` is the discriminator, `category` and `rate` are
 * carried alongside it rather than derived from it, so a further treatment (MDR-18, MDR-21) is
 * additive and never requires re-deriving this shape or the VAT bucket key below. `kleinunternehmer` is category E
 * with rate 0 (XRechnung 3.0.2 section 13.3, BR-E-05..07); `reverse-charge` is category AE with rate 0 (BR-AE-05..07).
 * Neither is a generic zero-rate mode and neither category is selectable on its own.
 */
export type InvoiceLineVat =
  | {
      readonly treatment: 'standard';
      readonly category: 'S'; // BT-151
      readonly rate: VatRate; // BT-152
    }
  | {
      readonly treatment: 'kleinunternehmer';
      readonly category: 'E'; // BT-151
      readonly rate: '0'; // BT-152
    }
  | {
      readonly treatment: 'reverse-charge';
      readonly category: 'AE'; // BT-151
      readonly rate: '0'; // BT-152
    };

/** Shape the boundary expects. Every field is validated at runtime; amounts are decimal strings, never numbers. */
export type InvoiceInput = {
  documentTypeCode: string; // BT-3, must be '380'
  currency: string; // BT-5, must be 'EUR'
  lines: readonly InvoiceLineInput[];
};

/** The unvalidated counterpart of InvoiceLineVat: every field is a string the caller wrote, checked independently. */
export type VatInput = {
  treatment: string; // 'standard', 'kleinunternehmer' or 'reverse-charge'
  category: string; // BT-151, must be 'S' for standard, 'E' for kleinunternehmer and 'AE' for reverse-charge; never inferred from the rate
  rate: string; // BT-152, must equal 19 or 7 for standard and 0 for the other two
};

/**
 * quantity, unitPrice and vat.rate are decimal strings in the notation given by InvoiceOptions.notation. A supported
 * rate may be written with equivalent trailing zeros ('19', '19.0', '19.00', or '19,00' in German notation) and is
 * normalized to '19' or '7'.
 */
export type InvoiceLineInput = {
  quantity: string; // BT-129
  unitPrice: string; // BT-146, per one unit (no price base quantity in V1)
  vat: VatInput; // BT-151 / BT-152, plus the treatment discriminant
};

export type InvoiceOptions = {
  /** How the amount strings are written. Default 'canonical' (locale-independent "1234.56"). */
  readonly notation?: NumberNotation;
};

export type InvoiceErrorCode =
  | DecimalErrorCode
  | 'invalid_type'
  | 'unknown_field'
  | 'no_lines'
  | 'error_list_truncated'
  | 'fraction_digits_limit'
  | 'magnitude_limit'
  | 'calculated_amount_limit'
  | 'unsupported_document_type'
  | 'unsupported_currency'
  | 'unsupported_vat_treatment'
  | 'unsupported_vat_category'
  | 'unsupported_vat_rate';

export type InvoiceError = { readonly code: InvoiceErrorCode; readonly path: string };

/**
 * BG-23. Grouped by `(treatment, category, rate)`, not by rate alone: the bucket identity must never depend on
 * BT-120 reason text. The Kleinunternehmer breakdown carries that text as `exemptionReason`, beside and not in the
 * key. Its taxable amount is the sum of its lines and its tax amount is exactly zero (BR-E-08, BR-E-09). The
 * reverse-charge breakdown is built the same way with BT-120 from REVERSE_CHARGE_TEXT (BR-AE-08, BR-AE-09, BR-AE-10).
 */
export type VatBreakdown =
  | {
      readonly treatment: 'standard';
      readonly category: 'S'; // BT-118
      readonly rate: VatRate; // BT-119
      readonly taxableAmount: Decimal; // BT-116
      readonly taxAmount: Decimal; // BT-117
    }
  | {
      readonly treatment: 'kleinunternehmer';
      readonly category: 'E'; // BT-118
      readonly rate: '0'; // BT-119
      readonly taxableAmount: Decimal; // BT-116
      readonly taxAmount: Decimal; // BT-117, zero
      readonly exemptionReason: typeof KLEINUNTERNEHMER_EXEMPTION_TEXT; // BT-120
    }
  | {
      readonly treatment: 'reverse-charge';
      readonly category: 'AE'; // BT-118
      readonly rate: '0'; // BT-119
      readonly taxableAmount: Decimal; // BT-116
      readonly taxAmount: Decimal; // BT-117, zero
      readonly exemptionReason: typeof REVERSE_CHARGE_TEXT; // BT-120
    };

export type InvoiceTotals = {
  readonly lines: readonly { readonly netAmount: Decimal }[]; // BT-131, in input order
  readonly vatBreakdown: readonly VatBreakdown[]; // BG-23, in SUPPORTED_VAT_RATES order
  readonly sumOfLineNetAmounts: Decimal; // BT-106
  readonly totalWithoutVat: Decimal; // BT-109 (BT-107 = BT-108 = 0 in V1)
  readonly totalVat: Decimal; // BT-110
  readonly totalWithVat: Decimal; // BT-112
  readonly amountDue: Decimal; // BT-115 (BT-113 = BT-114 = 0 in V1, BR-CO-16)
};

/** A line as parsed by the calculation, with the scale the caller typed. Its BT-131 is `totals.lines[i].netAmount`. */
export type CalculatedLine = {
  readonly quantity: Decimal; // BT-129
  readonly unitPrice: Decimal; // BT-146
  readonly vat: InvoiceLineVat; // BT-151 / BT-152
};

export type CalculatedInvoice = { readonly lines: readonly CalculatedLine[]; readonly totals: InvoiceTotals };

/**
 * Field names that belong to a caller's own validation (for example document.ts). The calculation ignores them
 * instead of reporting `unknown_field`; every other unknown field is still rejected.
 */
export type CallerFields = { readonly invoice?: readonly string[]; readonly line?: readonly string[] };

/**
 * On failure, `truncated` says whether `errors` is incomplete. When true, line scanning stopped early and the last
 * entry is an 'error_list_truncated' error whose path is the first line that was not scanned: fixing the listed
 * errors may reveal more. When false, `errors` holds every error found.
 */
export type InvoiceFailure = { readonly ok: false; readonly errors: readonly InvoiceError[]; readonly truncated: boolean };

export type InvoiceResult = { readonly ok: true; readonly value: InvoiceTotals } | InvoiceFailure;

export type CalculationResult = { readonly ok: true; readonly value: CalculatedInvoice } | InvoiceFailure;

const INVOICE_FIELDS = ['documentTypeCode', 'currency', 'lines'];
const LINE_FIELDS = ['quantity', 'unitPrice', 'vat'];
const VAT_FIELDS = ['treatment', 'category', 'rate'];
const CENT_SCALE = 2;
const ZERO: Decimal = { units: 0n, scale: CENT_SCALE };

type ParsedLine = { readonly quantity: Decimal; readonly unitPrice: Decimal; readonly vat: InvoiceLineVat };

// Provisional defensive bound, NOT a product rule: line scanning stops once this many errors are collected, so a huge
// sparse array cannot amplify into an unbounded error list. The result is a failure either way, and a scan that was
// cut short is never silent: the failure is marked truncated and ends with an 'error_list_truncated' error.
export const PROVISIONAL_MAX_REPORTED_ERRORS = 100;

export function calculateInvoiceTotals(input: unknown, options: InvoiceOptions = {}): InvoiceResult {
  const result = calculateInvoice(input, options);
  return result.ok ? { ok: true, value: result.value.totals } : result;
}

/** The same validation and calculation as `calculateInvoiceTotals`, also returning the parsed line data. */
export function calculateInvoice(input: unknown, options: InvoiceOptions = {}, callerFields: CallerFields = {}): CalculationResult {
  const errors: InvoiceError[] = [];
  const validated = validate(input, options.notation ?? 'canonical', errors, callerFields);
  if (validated === undefined) return { ok: false, errors, truncated: false };
  if (errors.length > 0) return { ok: false, errors, truncated: validated.truncated };
  const totals = calculate(validated.lines);
  const ceilingErrors = calculatedAmountErrors(totals);
  if (ceilingErrors.length > 0) return { ok: false, errors: ceilingErrors, truncated: false };
  return { ok: true, value: { lines: validated.lines, totals } };
}

// Ownership: a line whose BT-131 reaches the ceiling owns the diagnostic (lines[i]). The totals that contain it (its
// BT-116, BT-106, BT-109, BT-112, BT-115) then reach it too, so no document diagnostic is added. Only when no line
// reaches it, and a breakdown or document amount still does, is one diagnostic reported for the document, at 'lines'.
function calculatedAmountErrors(totals: InvoiceTotals): InvoiceError[] {
  const reachesCeiling = (amount: Decimal) => compare(amount, MAX_CALCULATED_AMOUNT_EXCLUSIVE) >= 0;
  const lineErrors = totals.lines.flatMap(({ netAmount }, index) =>
    reachesCeiling(netAmount) ? [{ code: 'calculated_amount_limit' as const, path: `lines[${index}]` }] : [],
  );
  if (lineErrors.length > 0) return lineErrors;
  const documentAmounts = [
    ...totals.vatBreakdown.flatMap((bucket) => [bucket.taxableAmount, bucket.taxAmount]), // BT-116, BT-117
    totals.sumOfLineNetAmounts, // BT-106
    totals.totalWithoutVat, // BT-109
    totals.totalVat, // BT-110
    totals.totalWithVat, // BT-112
    totals.amountDue, // BT-115
  ];
  return documentAmounts.some(reachesCeiling) ? [{ code: 'calculated_amount_limit', path: 'lines' }] : [];
}

function validate(
  input: unknown,
  notation: NumberNotation,
  errors: InvoiceError[],
  callerFields: CallerFields,
): { lines: ParsedLine[]; truncated: boolean } | undefined {
  if (!isRecord(input)) {
    errors.push({ code: 'invalid_type', path: '' });
    return undefined;
  }

  if (input.documentTypeCode !== '380') errors.push({ code: 'unsupported_document_type', path: 'documentTypeCode' });
  if (input.currency !== 'EUR') errors.push({ code: 'unsupported_currency', path: 'currency' });

  const parsedLines: ParsedLine[] = [];
  let firstUnscanned: number | undefined;
  if (!Array.isArray(input.lines)) {
    errors.push({ code: 'invalid_type', path: 'lines' });
  } else if (input.lines.length === 0) {
    errors.push({ code: 'no_lines', path: 'lines' });
  } else {
    // Indexed loop, not forEach: forEach skips holes, which would silently drop lines (new Array(1) -> "valid").
    // A hole reads as undefined and is reported as an invalid line.
    let index = 0;
    for (; index < input.lines.length && errors.length < PROVISIONAL_MAX_REPORTED_ERRORS; index++) {
      const parsed = validateLine(input.lines[index], `lines[${index}]`, notation, errors, callerFields.line ?? []);
      if (parsed) parsedLines.push(parsed);
    }
    if (index < input.lines.length) firstUnscanned = index;
  }

  reportUnknownFields(input, [...INVOICE_FIELDS, ...(callerFields.invoice ?? [])], '', errors);
  // Last on purpose: a caller that only reads `errors` still sees that the list is incomplete.
  if (firstUnscanned !== undefined) errors.push({ code: 'error_list_truncated', path: `lines[${firstUnscanned}]` });
  return { lines: parsedLines, truncated: firstUnscanned !== undefined };
}

function validateLine(
  line: unknown,
  path: string,
  notation: NumberNotation,
  errors: InvoiceError[],
  callerLineFields: readonly string[],
): ParsedLine | undefined {
  if (!isRecord(line)) {
    errors.push({ code: 'invalid_type', path });
    return undefined;
  }

  const errorsBefore = errors.length;
  const quantity = parseLineValue(line.quantity, `${path}.quantity`, notation, MAX_QUANTITY_EFFECTIVE_FRACTION_DIGITS, MAX_QUANTITY_EXCLUSIVE, errors);
  const unitPrice = parseLineValue(line.unitPrice, `${path}.unitPrice`, notation, MAX_UNIT_PRICE_EFFECTIVE_FRACTION_DIGITS, MAX_UNIT_PRICE_EXCLUSIVE, errors);
  const vat = validateVat(line.vat, `${path}.vat`, notation, errors);
  reportUnknownFields(line, [...LINE_FIELDS, ...callerLineFields], path, errors);

  if (errors.length > errorsBefore || !quantity || !unitPrice || !vat) return undefined;
  return { quantity, unitPrice, vat };
}

// PROFILE (M1): the standard, kleinunternehmer and reverse-charge treatments are implemented. category and rate are
// validated independently of each other, never inferred. A treatment that is not recognised is judged against the
// standard expectation, so the caller still sees every field that is wrong.
const ZERO_RATE_CATEGORY = { kleinunternehmer: 'E', 'reverse-charge': 'AE' } as const;

function validateVat(input: unknown, path: string, notation: NumberNotation, errors: InvoiceError[]): InvoiceLineVat | undefined {
  const record = isRecord(input) ? input : undefined;
  const special = record?.treatment === 'kleinunternehmer' || record?.treatment === 'reverse-charge' ? record.treatment : undefined;
  const treatmentOk = special !== undefined || record?.treatment === 'standard';
  if (!treatmentOk) errors.push({ code: 'unsupported_vat_treatment', path: `${path}.treatment` });
  const categoryOk = record?.category === (special === undefined ? 'S' : ZERO_RATE_CATEGORY[special]);
  if (!categoryOk) errors.push({ code: 'unsupported_vat_category', path: `${path}.category` });
  const standardRate = special === undefined ? normalizeVatRate(record?.rate, notation) : undefined;
  const rateOk = special === undefined ? standardRate !== undefined : isZeroRate(record?.rate, notation);
  if (!rateOk) errors.push({ code: 'unsupported_vat_rate', path: `${path}.rate` });
  if (record !== undefined) reportUnknownFields(record, VAT_FIELDS, path, errors);
  if (!treatmentOk || !categoryOk || !rateOk) return undefined;
  if (special === 'kleinunternehmer') return { treatment: 'kleinunternehmer', category: 'E', rate: '0' };
  if (special === 'reverse-charge') return { treatment: 'reverse-charge', category: 'AE', rate: '0' };
  return standardRate === undefined ? undefined : { treatment: 'standard', category: 'S', rate: standardRate };
}

// BT-129 and BT-146 only, in order: raw-input guard and grammar and sign (the parser), then precision, then magnitude.
// The first failure is the one reported. The value is returned with the scale the caller wrote.
function parseLineValue(
  input: unknown,
  path: string,
  notation: NumberNotation,
  maxFractionDigits: number,
  maxExclusive: Decimal,
  errors: InvoiceError[],
): Decimal | undefined {
  const result = parseDecimalInput(input, notation);
  let code: InvoiceErrorCode;
  if (!result.ok) code = result.code;
  else if (effectiveFractionDigits(result.value) > maxFractionDigits) code = 'fraction_digits_limit';
  else if (compare(result.value, maxExclusive) >= 0) code = 'magnitude_limit';
  else return result.value;
  errors.push({ code, path });
  return undefined;
}

// A rate is supported when its exact decimal value equals 19 or 7, however it is spelled ('19', '19.0', '19,00'...).
// Compared on scaled integers, never through floating-point. Text that does not parse, or any other value, is unsupported.
function normalizeVatRate(input: unknown, notation: NumberNotation): VatRate | undefined {
  const parsed = parseDecimalInput(input, notation);
  if (!parsed.ok) return undefined;
  const { units, scale } = parsed.value;
  return SUPPORTED_VAT_RATES.find((rate) => units === BigInt(rate) * 10n ** BigInt(scale));
}

// The Kleinunternehmer and reverse-charge rate is exactly zero, however it is spelled ('0', '0.00', '0,0'). Same exact-decimal comparison.
function isZeroRate(input: unknown, notation: NumberNotation): boolean {
  const parsed = parseDecimalInput(input, notation);
  return parsed.ok && parsed.value.units === 0n;
}

function reportUnknownFields(record: Record<string, unknown>, allowed: readonly string[], path: string, errors: InvoiceError[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push({ code: 'unknown_field', path: path ? `${path}.${key}` : key });
  }
}

function calculate(lines: readonly ParsedLine[]): InvoiceTotals {
  const netAmounts = lines.map((line) => roundHalfUp(multiply(line.quantity, line.unitPrice), CENT_SCALE));

  // The bucket carries the full key `(treatment, category, rate)`; the standard buckets come first, in
  // SUPPORTED_VAT_RATES order, then the Kleinunternehmer bucket, then the reverse-charge bucket.
  const vatBreakdown: VatBreakdown[] = [];
  for (const rate of SUPPORTED_VAT_RATES) {
    const bucket = lines.flatMap((line, index) => (line.vat.treatment === 'standard' && line.vat.rate === rate ? [netAmounts[index] as Decimal] : []));
    if (bucket.length === 0) continue;

    const taxableAmount = bucket.reduce(add, ZERO);
    // rate / 100 is the integer rate at scale 2; VAT is rounded once per bucket.
    const taxAmount = roundHalfUp(multiply(taxableAmount, { units: BigInt(rate), scale: 2 }), CENT_SCALE);
    vatBreakdown.push({ treatment: 'standard', category: 'S', rate, taxableAmount, taxAmount });
  }
  const kleinunternehmerNets = lines.flatMap((line, index) => (line.vat.treatment === 'kleinunternehmer' ? [netAmounts[index] as Decimal] : []));
  if (kleinunternehmerNets.length > 0) {
    // No VAT is computed: BR-E-09 requires exactly zero. BT-116 is the real sum of the lines, not forced to zero (BR-E-08).
    vatBreakdown.push({
      treatment: 'kleinunternehmer',
      category: 'E',
      rate: '0',
      taxableAmount: kleinunternehmerNets.reduce(add, ZERO),
      taxAmount: ZERO,
      exemptionReason: KLEINUNTERNEHMER_EXEMPTION_TEXT,
    });
  }
  const reverseChargeNets = lines.flatMap((line, index) => (line.vat.treatment === 'reverse-charge' ? [netAmounts[index] as Decimal] : []));
  if (reverseChargeNets.length > 0) {
    // No VAT is computed: BR-AE-09 requires exactly zero. BT-116 is the real sum of the lines (BR-AE-08).
    vatBreakdown.push({
      treatment: 'reverse-charge',
      category: 'AE',
      rate: '0',
      taxableAmount: reverseChargeNets.reduce(add, ZERO),
      taxAmount: ZERO,
      exemptionReason: REVERSE_CHARGE_TEXT,
    });
  }

  const sumOfLineNetAmounts = netAmounts.reduce(add, ZERO);
  const totalVat = vatBreakdown.reduce((sum, bucket) => add(sum, bucket.taxAmount), ZERO);
  const totalWithVat = add(sumOfLineNetAmounts, totalVat);
  return {
    lines: netAmounts.map((netAmount) => ({ netAmount })),
    vatBreakdown,
    sumOfLineNetAmounts,
    totalWithoutVat: sumOfLineNetAmounts,
    totalVat,
    totalWithVat,
    amountDue: totalWithVat,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
