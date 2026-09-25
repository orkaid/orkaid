// V1 XRechnung semantic invoice model and monetary calculation.
// Scope: domestic German B2B invoice, EUR, BT-3 = 380, VAT category S at 19% or 7%, non-negative amounts.
// Syntax-independent: no UBL/CII structures. Anything outside the scope is an explicit failure, never a fallback.
//
// Calculation contract (project engineering policy for V1; HALF_UP is not an EN 16931/XRechnung mandate;
// BR-CO-17 itself only requires rounding BT-117 to two decimals):
//   BT-131 = round(quantity x unit price, 2)          per line
//   BT-116 = sum of BT-131 per VAT category and rate
//   BT-117 = round(BT-116 x BT-119 / 100, 2)          once per bucket (BR-CO-17), never summed per line
//   BT-110 = sum of BT-117
//   BT-115 = BT-112, as BR-CO-16 with BT-113 and BT-114 absent
// Identification, parties, dates and payment data belong to document.ts, which delegates every amount to this module.

import { add, multiply, roundHalfUp, type Decimal, type DecimalErrorCode } from './decimal.ts';
import { parseDecimalInput, type NumberNotation } from './number-notation.ts';

export const SUPPORTED_VAT_RATES = ['19', '7'] as const;
export type VatRate = (typeof SUPPORTED_VAT_RATES)[number];

/** Shape the boundary expects. Every field is validated at runtime; amounts are decimal strings, never numbers. */
export type InvoiceInput = {
  documentTypeCode: string; // BT-3, must be '380'
  currency: string; // BT-5, must be 'EUR'
  lines: readonly InvoiceLineInput[];
};

/**
 * quantity, unitPrice and vatRate are decimal strings in the notation given by InvoiceOptions.notation. A supported
 * rate may be written with equivalent trailing zeros ('19', '19.0', '19.00', or '19,00' in German notation) and is
 * normalized to '19' or '7'.
 */
export type InvoiceLineInput = {
  quantity: string; // BT-129
  unitPrice: string; // BT-146, per one unit (no price base quantity in V1)
  vatCategory: string; // BT-151, must be 'S'; never inferred from the rate
  vatRate: string; // BT-152, must equal 19 or 7
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
  | 'unsupported_document_type'
  | 'unsupported_currency'
  | 'unsupported_vat_category'
  | 'unsupported_vat_rate';

export type InvoiceError = { readonly code: InvoiceErrorCode; readonly path: string };

export type VatBreakdown = {
  readonly category: 'S'; // BT-118
  readonly rate: VatRate; // BT-119
  readonly taxableAmount: Decimal; // BT-116
  readonly taxAmount: Decimal; // BT-117
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
  readonly vatRate: VatRate; // BT-152
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
const LINE_FIELDS = ['quantity', 'unitPrice', 'vatCategory', 'vatRate'];
const CENT_SCALE = 2;
const ZERO: Decimal = { units: 0n, scale: CENT_SCALE };

type ParsedLine = { readonly quantity: Decimal; readonly unitPrice: Decimal; readonly vatRate: VatRate };

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
  return { ok: true, value: { lines: validated.lines, totals: calculate(validated.lines) } };
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
  const quantity = parseAmount(line.quantity, `${path}.quantity`, notation, errors);
  const unitPrice = parseAmount(line.unitPrice, `${path}.unitPrice`, notation, errors);
  if (line.vatCategory !== 'S') errors.push({ code: 'unsupported_vat_category', path: `${path}.vatCategory` });
  const vatRate = normalizeVatRate(line.vatRate, notation);
  if (vatRate === undefined) errors.push({ code: 'unsupported_vat_rate', path: `${path}.vatRate` });
  reportUnknownFields(line, [...LINE_FIELDS, ...callerLineFields], path, errors);

  if (errors.length > errorsBefore || !quantity || !unitPrice || !vatRate) return undefined;
  return { quantity, unitPrice, vatRate };
}

function parseAmount(input: unknown, path: string, notation: NumberNotation, errors: InvoiceError[]): Decimal | undefined {
  const result = parseDecimalInput(input, notation);
  if (result.ok) return result.value;
  errors.push({ code: result.code, path });
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

function reportUnknownFields(record: Record<string, unknown>, allowed: readonly string[], path: string, errors: InvoiceError[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) errors.push({ code: 'unknown_field', path: path ? `${path}.${key}` : key });
  }
}

function calculate(lines: readonly ParsedLine[]): InvoiceTotals {
  const netAmounts = lines.map((line) => roundHalfUp(multiply(line.quantity, line.unitPrice), CENT_SCALE));

  const vatBreakdown: VatBreakdown[] = [];
  for (const rate of SUPPORTED_VAT_RATES) {
    const bucket = lines.flatMap((line, index) => (line.vatRate === rate ? [netAmounts[index] as Decimal] : []));
    if (bucket.length === 0) continue;

    const taxableAmount = bucket.reduce(add, ZERO);
    // rate / 100 is the integer rate at scale 2; VAT is rounded once per bucket.
    const taxAmount = roundHalfUp(multiply(taxableAmount, { units: BigInt(rate), scale: 2 }), CENT_SCALE);
    vatBreakdown.push({ category: 'S', rate, taxableAmount, taxAmount });
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
