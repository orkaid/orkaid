// Pure adapter between the workspace form and the frozen domain (`xrechnung-domain-v1`).
// It owns no validation rule and no arithmetic: it builds the domain input, calls the domain, and classifies the answer
// for presentation. No Svelte, no DOM.

import { serializeCiiInvoice } from '../../../lib/domain/xrechnung/cii.ts';
import { buildInvoice, type DocumentErrorCode, type DocumentOptions, type Invoice } from '../../../lib/domain/xrechnung/document.ts';
import {
  calculateInvoiceTotals, KLEINUNTERNEHMER_EXEMPTION_TEXT, REVERSE_CHARGE_TEXT, type InvoiceTotals, type VatBreakdown,
} from '../../../lib/domain/xrechnung/invoice.ts';
import { serializeUblInvoice } from '../../../lib/domain/xrechnung/ubl.ts';
import { dateInput, decimalInput } from './input-format.ts';
import { CLEARING_CONFIRMATION_ID, CREDIT_TRANSFER_FIELD_IDS, PRECEDING_INVOICE_FIELD_IDS, type FieldId, type FormState, type LineForm } from './form-state.ts';

export type SectionId = 'document' | 'seller' | 'buyer' | 'lines' | 'payment' | 'notes';
export const SECTION_IDS: readonly SectionId[] = ['document', 'seller', 'buyer', 'lines', 'payment', 'notes'];

export type ErrorKind = 'missing' | 'invalid' | 'internal';

/** One domain diagnostic, classified for presentation. `fieldId` is the DOM id to focus (undefined: no field to go to). */
export type DiagnosticItem = {
  readonly code: DocumentErrorCode;
  readonly path: string;
  readonly fieldId: string | undefined;
  readonly section: SectionId | 'general';
  readonly kind: ErrorKind;
};

export function sectionOf(path: string): SectionId | 'general' {
  if (path === '' || path === 'general') return 'general';
  // `buyerReference` (BT-10) belongs to the invoice details, not to the buyer party.
  if (path === 'seller' || path.startsWith('seller.')) return 'seller';
  if (path === 'buyer' || path.startsWith('buyer.')) return 'buyer';
  if (path.startsWith('lines')) return 'lines';
  if (path.startsWith('payment')) return 'payment';
  if (path.startsWith('notes')) return 'notes';
  return 'document';
}

/**
 * Every active value in the form under its domain path, including each line field (`lines[0].quantity`). Fields of the
 * inactive document type are left out, as they are from the domain input; on a 381 the clearing confirmation is listed under
 * its own path ('' while unconfirmed) so that its diagnostic is placed and navigated like a field's.
 */
export function fieldValues(state: FormState): Record<string, string> {
  const values: Record<string, string> = { ...state.fields };
  const inactive = state.documentType === '381' ? CREDIT_TRANSFER_FIELD_IDS : PRECEDING_INVOICE_FIELD_IDS;
  for (const id of inactive) delete values[id];
  if (state.documentType === '381') values[CLEARING_CONFIRMATION_ID] = state.clearingConfirmed ? 'confirmed' : '';
  state.lines.forEach((line, i) => {
    values[`lines[${i}].name`] = line.name;
    values[`lines[${i}].unitCode`] = line.unitCode;
    values[`lines[${i}].quantity`] = line.quantity;
    values[`lines[${i}].unitPrice`] = line.unitPrice;
    values[`lines[${i}].vat.rate`] = line.vatRate;
  });
  return values;
}

// An empty field is omitted (the domain then answers "missing"); it is never sent as '' and never trimmed.
const put = (target: Record<string, unknown>, key: string, value: string, convert?: (text: string) => string): void => {
  if (value !== '') target[key] = convert === undefined ? value : convert(value);
};
// Dates and decimals are typed in the German format and reach the domain canonical (see input-format.ts).
const putDate = (target: Record<string, unknown>, key: string, value: string): void => put(target, key, value, dateInput);
const putDecimal = (target: Record<string, unknown>, key: string, value: string): void => put(target, key, value, decimalInput);

/**
 * The one place a line's VAT value for the domain is decided, for the full document and for the totals preview alike (MDR-44).
 * The document regime wins: in Kleinunternehmer mode every line is E/0 and the line's own choice is not read. In the regular
 * regime 'reverse-charge' is AE/0 and anything else is the standard treatment with the rate as typed ('' sends none, so the
 * domain still answers `unsupported_vat_rate`; nothing is chosen or normalized here). Which compositions are supported,
 * and every amount, stay the domain's decision.
 */
export function lineVat(state: Pick<FormState, 'vatRegime'>, line: Pick<LineForm, 'vatRate'>): Record<string, unknown> {
  if (state.vatRegime === 'kleinunternehmer') return { treatment: 'kleinunternehmer', category: 'E', rate: '0' };
  if (line.vatRate === 'reverse-charge') return { treatment: 'reverse-charge', category: 'AE', rate: '0' };
  const vat: Record<string, unknown> = { treatment: 'standard', category: 'S' };
  put(vat, 'rate', line.vatRate);
  return vat;
}

/** True when an active line is Reverse Charge: only then is BT-47 or BT-48 of the buyer required (BR-AE-02). */
export function hasReverseCharge(state: FormState): boolean {
  return state.vatRegime === 'regular' && state.lines.some((line) => line.vatRate === 'reverse-charge');
}

/** The fixed, non-editable texts the domain writes for the active treatments, with the business terms that carry them. */
export type FixedReason = { readonly treatment: 'kleinunternehmer' | 'reverse-charge'; readonly text: string; readonly terms: readonly string[] };
export function activeFixedReasons(state: FormState): readonly FixedReason[] {
  if (state.vatRegime === 'kleinunternehmer') return [{ treatment: 'kleinunternehmer', text: KLEINUNTERNEHMER_EXEMPTION_TEXT, terms: ['BT-120', 'BT-33'] }];
  return hasReverseCharge(state) ? [{ treatment: 'reverse-charge', text: REVERSE_CHARGE_TEXT, terms: ['BT-120'] }] : [];
}

/** A VAT bucket is identified by treatment and rate, never by the rate alone (E and AE are both rate 0). */
export const vatBucketKey = (bucket: Pick<VatBreakdown, 'treatment' | 'rate'>): string => `${bucket.treatment}:${bucket.rate}`;

/**
 * The domain input for the selected document type (BT-3, never inferred from amounts). Objects are always present so a
 * diagnostic names the field, not its parent. A 380 sends credit-transfer payment and never BG-3 or a settlement; a 381 sends
 * BG-3 and the clearing of MDR-41, never a payment means. The clearing is sent as confirmed only after the user's explicit
 * confirmation; until then the domain itself answers `missing_clearing_confirmation`, so code 97 cannot be written unconfirmed.
 */
export function buildDocumentInput(state: FormState): Record<string, unknown> {
  const f = state.fields;
  const party = (side: 'seller' | 'buyer'): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    put(p, 'name', f[`${side}.name`]);
    const address: Record<string, unknown> = { country: 'DE' };
    put(address, 'street', f[`${side}.address.street`]);
    put(address, 'city', f[`${side}.address.city`]);
    put(address, 'postCode', f[`${side}.address.postCode`]);
    p.address = address;
    const electronicAddress: Record<string, unknown> = {};
    put(electronicAddress, 'schemeId', f[`${side}.electronicAddress.schemeId`]);
    put(electronicAddress, 'value', f[`${side}.electronicAddress.value`]);
    p.electronicAddress = electronicAddress;
    put(p, 'vatId', f[`${side}.vatId`]);
    // BT-47: the buyer's own slot, sent as typed and never derived from BT-48 (the seller's BT-30 is set separately below).
    if (side === 'buyer') put(p, 'legalRegistrationId', f['buyer.legalRegistrationId']);
    return p;
  };
  const seller = party('seller');
  const contact: Record<string, unknown> = {};
  put(contact, 'name', f['seller.contact.name']);
  put(contact, 'telephone', f['seller.contact.telephone']);
  put(contact, 'email', f['seller.contact.email']);
  seller.contact = contact;
  put(seller, 'taxRegistrationId', f['seller.taxRegistrationId']);
  put(seller, 'legalRegistrationId', f['seller.legalRegistrationId']);
  if (f['seller.sellerIdentifiers[0]'] !== '') seller.sellerIdentifiers = [f['seller.sellerIdentifiers[0]']];

  const creditNote = state.documentType === '381';
  let payment: Record<string, unknown>;
  if (creditNote) {
    const settlement: Record<string, unknown> = { kind: 'clearing' };
    if (state.clearingConfirmed) settlement.reciprocalObligationConfirmed = true;
    payment = {};
    putDate(payment, 'dueDate', f['payment.dueDate']);
    put(payment, 'termsText', f['payment.termsText']);
    payment.settlement = settlement;
  } else {
    const account: Record<string, unknown> = { id: {} };
    const accountId = account.id as Record<string, unknown>;
    accountId.scheme = 'IBAN';
    put(accountId, 'value', f['payment.means.account.id.value']);
    put(account, 'name', f['payment.means.account.name']);
    put(account, 'bic', f['payment.means.account.bic']);
    const means: Record<string, unknown> = { kind: 'credit-transfer', account };
    put(means, 'code', f['payment.means.code']);
    payment = { means };
    putDate(payment, 'dueDate', f['payment.dueDate']);
    put(payment, 'termsText', f['payment.termsText']);
  }

  const input: Record<string, unknown> = { documentTypeCode: state.documentType, currency: 'EUR' };
  put(input, 'invoiceNumber', f.invoiceNumber);
  putDate(input, 'issueDate', f.issueDate);
  if (creditNote) {
    // BG-3: exactly one reference, BT-25 required by the profile, BT-26 only when entered (MDR-35). Nothing is looked up.
    const reference: Record<string, unknown> = {};
    put(reference, 'number', f['precedingInvoice.number']);
    putDate(reference, 'issueDate', f['precedingInvoice.issueDate']);
    input.precedingInvoice = reference;
  }
  // Only the active alternative of BT-72 / BG-14 enters the input. In period mode the object is always present, so an empty
  // boundary is reported on its own visible field and not as a missing `deliveryDate` the user cannot see.
  if (state.supplyMode === 'period') {
    const period: Record<string, unknown> = {};
    putDate(period, 'startDate', f['invoicingPeriod.startDate']);
    putDate(period, 'endDate', f['invoicingPeriod.endDate']);
    input.invoicingPeriod = period;
  } else {
    putDate(input, 'deliveryDate', f.deliveryDate);
  }
  put(input, 'buyerReference', f.buyerReference);
  put(input, 'projectReference', f.projectReference);
  put(input, 'contractReference', f.contractReference);
  put(input, 'orderReference', f.orderReference);
  input.seller = seller;
  input.buyer = party('buyer');
  input.payment = payment;
  if (f['notes[0].text'] !== '') input.notes = [{ text: f['notes[0].text'] }];
  input.lines = state.lines.map((line) => {
    const out: Record<string, unknown> = {};
    put(out, 'name', line.name);
    put(out, 'unitCode', line.unitCode);
    putDecimal(out, 'quantity', line.quantity);
    putDecimal(out, 'unitPrice', line.unitPrice);
    out.vat = lineVat(state, line);
    return out;
  });
  return input;
}

/**
 * The monetary subset only. `calculateInvoiceTotals` takes no caller-field list, so `name` and `unitCode` would come back as
 * `unknown_field`; the totals preview needs only quantity, unit price and the rate.
 */
export function buildMonetaryInput(state: FormState): Record<string, unknown> {
  return {
    documentTypeCode: state.documentType,
    currency: 'EUR',
    lines: state.lines.map((line) => {
      const out: Record<string, unknown> = {};
      putDecimal(out, 'quantity', line.quantity);
      putDecimal(out, 'unitPrice', line.unitPrice);
      out.vat = lineVat(state, line);
      return out;
    }),
  };
}

export type PreviewResult = { readonly ok: true; readonly totals: InvoiceTotals } | { readonly ok: false };

/** Lines-only totals from the domain's own calculation: a preview, never a statement that the invoice is valid. */
export function previewTotals(state: FormState): PreviewResult {
  const result = calculateInvoiceTotals(buildMonetaryInput(state));
  return result.ok ? { ok: true, totals: result.value } : { ok: false };
}

const MISSING_CODES: ReadonlySet<DocumentErrorCode> = new Set<DocumentErrorCode>([
  'missing_field', 'empty_text', 'no_lines', 'missing_seller_identification', 'missing_seller_tax_identifier',
  'missing_buyer_identifier', 'missing_payment_due_information', 'missing_clearing_confirmation',
]);
const INTERNAL_CODES: ReadonlySet<DocumentErrorCode> = new Set<DocumentErrorCode>(['internal_inconsistency', 'unknown_field', 'invalid_type']);

// Group-level diagnostics carry a section path; "go to field" lands on the first field of that group.
const GROUP_TARGET: Readonly<Record<string, string>> = {
  seller: 'seller.vatId',
  buyer: 'buyer.vatId',
  payment: 'payment.dueDate',
  'payment.settlement': CLEARING_CONFIRMATION_ID,
  precedingInvoice: 'precedingInvoice.number',
  lines: 'lines[0].name',
};

export function classify(code: DocumentErrorCode, path: string, values: Readonly<Record<string, string>>): ErrorKind {
  if (INTERNAL_CODES.has(code) || path === '') return 'internal';
  if (MISSING_CODES.has(code)) return 'missing';
  // The monetary part answers an omitted amount with invalid_decimal / unsupported_vat_rate, not "missing". The form
  // knows the field is empty, so it is shown as missing; the domain's code is untouched.
  if (values[path] === '') return 'missing';
  return 'invalid';
}

export function toDiagnosticItems(
  errors: readonly { readonly code: DocumentErrorCode; readonly path: string }[],
  values: Readonly<Record<string, string>>,
): DiagnosticItem[] {
  return errors
    .filter((error) => error.code !== 'error_list_truncated')
    .map((error) => {
      const kind = classify(error.code, error.path, values);
      const fieldId = error.path in values ? error.path : GROUP_TARGET[error.path];
      return { code: error.code, path: error.path, fieldId, section: sectionOf(error.path), kind };
    });
}

export type CheckResult =
  | { readonly ok: true; readonly invoice: Invoice }
  | { readonly ok: false; readonly items: readonly DiagnosticItem[]; readonly truncated: boolean };

/** The single place the call options are built, so a check and an export can never apply different policies. */
export function documentOptions(state: FormState): DocumentOptions {
  return state.leitwegCheck ? { buyerReferencePolicy: 'leitweg-id' } : {};
}

/** One run of the domain's full validation on the current form. */
export function checkForm(state: FormState): CheckResult {
  const result = buildInvoice(buildDocumentInput(state), documentOptions(state));
  if (result.ok) return { ok: true, invoice: result.value };
  return { ok: false, items: toDiagnosticItems(result.errors, fieldValues(state)), truncated: result.truncated };
}

export type ExportFormat = 'ubl' | 'cii';

export function fileNameFor(invoiceNumber: string, format: ExportFormat): string {
  const base = invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 80);
  return `${base === '' ? 'xrechnung' : base}-${format}.xml`;
}

export type ExportResult =
  | { readonly ok: true; readonly xml: string; readonly fileName: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly items: readonly DiagnosticItem[]; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: 'serializer'; readonly code: string };

/** Always re-runs validation and serialization on the current form; never returns XML produced earlier. */
export function exportXml(state: FormState, format: ExportFormat): ExportResult {
  const checked = checkForm(state);
  if (!checked.ok) return { ok: false, reason: 'invalid', items: checked.items, truncated: checked.truncated };
  const serialized = format === 'ubl' ? serializeUblInvoice(checked.invoice) : serializeCiiInvoice(checked.invoice);
  if (!serialized.ok) return { ok: false, reason: 'serializer', code: serialized.errors[0]?.code ?? 'unknown' };
  return { ok: true, xml: serialized.xml, fileName: fileNameFor(state.fields.invoiceNumber, format) };
}

export function countByKind(items: readonly DiagnosticItem[]): { missing: number; invalid: number; internal: number } {
  const counts = { missing: 0, invalid: 0, internal: 0 };
  for (const item of items) counts[item.kind]++;
  return counts;
}

export type { FieldId };
