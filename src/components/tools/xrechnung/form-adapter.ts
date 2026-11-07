// Pure adapter between the workspace form and the frozen domain (`xrechnung-domain-v1`).
// It owns no validation rule and no arithmetic: it builds the domain input, calls the domain, and classifies the answer
// for presentation. No Svelte, no DOM.

import { serializeCiiInvoice } from '../../../lib/domain/xrechnung/cii.ts';
import { buildInvoice, type DocumentErrorCode, type DocumentOptions, type Invoice } from '../../../lib/domain/xrechnung/document.ts';
import { calculateInvoiceTotals, type InvoiceTotals } from '../../../lib/domain/xrechnung/invoice.ts';
import type { NumberLocale } from '../../../lib/domain/xrechnung/number-notation.ts';
import { serializeUblInvoice } from '../../../lib/domain/xrechnung/ubl.ts';
import type { FieldId, FormState } from './form-state.ts';

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

/** Every value in the form under its domain path, including each line field (`lines[0].quantity`). */
export function fieldValues(state: FormState): Record<string, string> {
  const values: Record<string, string> = { ...state.fields };
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
const put = (target: Record<string, unknown>, key: string, value: string): void => {
  if (value !== '') target[key] = value;
};

/** The domain input for an invoice 380. Objects are always present so a diagnostic names the field, not its parent. */
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

  const account: Record<string, unknown> = { id: {} };
  const accountId = account.id as Record<string, unknown>;
  accountId.scheme = 'IBAN';
  put(accountId, 'value', f['payment.means.account.id.value']);
  put(account, 'name', f['payment.means.account.name']);
  put(account, 'bic', f['payment.means.account.bic']);
  const means: Record<string, unknown> = { kind: 'credit-transfer', account };
  put(means, 'code', f['payment.means.code']);
  const payment: Record<string, unknown> = { means };
  put(payment, 'dueDate', f['payment.dueDate']);
  put(payment, 'termsText', f['payment.termsText']);

  const input: Record<string, unknown> = { documentTypeCode: '380', currency: 'EUR' };
  put(input, 'invoiceNumber', f.invoiceNumber);
  put(input, 'issueDate', f.issueDate);
  // Only the active alternative of BT-72 / BG-14 enters the input. In period mode the object is always present, so an empty
  // boundary is reported on its own visible field and not as a missing `deliveryDate` the user cannot see.
  if (state.supplyMode === 'period') {
    const period: Record<string, unknown> = {};
    put(period, 'startDate', f['invoicingPeriod.startDate']);
    put(period, 'endDate', f['invoicingPeriod.endDate']);
    input.invoicingPeriod = period;
  } else {
    put(input, 'deliveryDate', f.deliveryDate);
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
    put(out, 'quantity', line.quantity);
    put(out, 'unitPrice', line.unitPrice);
    const vat: Record<string, unknown> = { treatment: 'standard', category: 'S' };
    put(vat, 'rate', line.vatRate);
    out.vat = vat;
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
    documentTypeCode: '380',
    currency: 'EUR',
    lines: state.lines.map((line) => {
      const out: Record<string, unknown> = {};
      put(out, 'quantity', line.quantity);
      put(out, 'unitPrice', line.unitPrice);
      const vat: Record<string, unknown> = { treatment: 'standard', category: 'S' };
      put(vat, 'rate', line.vatRate);
      out.vat = vat;
      return out;
    }),
  };
}

export type PreviewResult = { readonly ok: true; readonly totals: InvoiceTotals } | { readonly ok: false };

/** Lines-only totals from the domain's own calculation: a preview, never a statement that the invoice is valid. */
export function previewTotals(state: FormState, locale: NumberLocale): PreviewResult {
  const result = calculateInvoiceTotals(buildMonetaryInput(state), { notation: locale });
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
export function documentOptions(state: FormState, locale: NumberLocale): DocumentOptions {
  return state.leitwegCheck ? { notation: locale, buyerReferencePolicy: 'leitweg-id' } : { notation: locale };
}

/** One run of the domain's full validation on the current form. */
export function checkForm(state: FormState, locale: NumberLocale): CheckResult {
  const result = buildInvoice(buildDocumentInput(state), documentOptions(state, locale));
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
export function exportXml(state: FormState, locale: NumberLocale, format: ExportFormat): ExportResult {
  const checked = checkForm(state, locale);
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
