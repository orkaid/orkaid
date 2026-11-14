// UI state of the XRechnung workspace: strings only. Nothing derived from money or validation is stored here.
// Field ids are the domain input paths (document.ts), so a diagnostic { code, path } addresses its field directly.

export const FIELD_IDS = [
  'invoiceNumber', 'issueDate', 'precedingInvoice.number', 'precedingInvoice.issueDate',
  'deliveryDate', 'invoicingPeriod.startDate', 'invoicingPeriod.endDate', 'buyerReference',
  'projectReference', 'contractReference', 'orderReference',
  'seller.name', 'seller.address.street', 'seller.address.postCode', 'seller.address.city',
  'seller.electronicAddress.schemeId', 'seller.electronicAddress.value',
  'seller.contact.name', 'seller.contact.telephone', 'seller.contact.email',
  'seller.vatId', 'seller.taxRegistrationId', 'seller.legalRegistrationId', 'seller.sellerIdentifiers[0]',
  'buyer.name', 'buyer.address.street', 'buyer.address.postCode', 'buyer.address.city',
  'buyer.electronicAddress.schemeId', 'buyer.electronicAddress.value', 'buyer.vatId', 'buyer.legalRegistrationId',
  'payment.means.code', 'payment.means.account.id.value', 'payment.means.account.name', 'payment.means.account.bic',
  'payment.dueDate', 'payment.termsText',
  'notes[0].text',
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

/**
 * One invoice line as typed. `vatRate` is the line's own choice, '' until the user makes it: '19', '7' or 'reverse-charge'.
 * No treatment is chosen silently. It is only read while the document regime is `regular` (see `lineVat`).
 */
export type LineForm = { name: string; unitCode: string; quantity: string; unitPrice: string; vatRate: string };

/**
 * `supplyMode` selects which of BT-72 (`deliveryDate`) and BG-14 (`invoicingPeriod.*`) is the active alternative; the other's
 * values stay here but are never sent. `leitwegCheck` is the explicit opt-in for the Leitweg-ID check of BT-10 (off by default).
 * `vatRegime` is the document-level choice (MDR-44): `regular` is only the initial selection that continues the established
 * workflow, never a determination of the issuer's tax status. While it is `kleinunternehmer` every line is E/0 and the lines'
 * own choices stay here, unused.
 */
export type SupplyMode = 'date' | 'period';
export type VatRegime = 'regular' | 'kleinunternehmer';
/**
 * `documentType` is the explicit BT-3 choice (MDR-49): '380' is only the initial selection that continues the established
 * workflow. Values of the inactive type (BG-3 on a 380, the credit-transfer fields on a 381) stay here but are never sent.
 * `clearingConfirmed` is the user's own declaration of an existing reciprocal obligation on a 381 (MDR-41); it is never
 * preselected, and `selectDocumentType` clears it on every change of type.
 */
export type DocumentType = '380' | '381';
/**
 * One structured Skonto tier as typed (Days, Percent). The tiers belong to an invoice 380 only: on a 381 they stay here, unused,
 * and are never sent. An added tier stays until the user removes it, empty or not; tiers are kept in the order entered.
 */
export type SkontoTierForm = { days: string; percent: string };
export const MAX_SKONTO_TIERS = 10;
export type FormState = {
  fields: Record<FieldId, string>; lines: LineForm[]; supplyMode: SupplyMode; leitwegCheck: boolean; vatRegime: VatRegime;
  documentType: DocumentType; clearingConfirmed: boolean; skonto: SkontoTierForm[];
};

export function emptyLine(previous?: LineForm): LineForm {
  // A new line repeats only the unit the user chose on the previous line. Its VAT treatment is never preselected or taken from
  // another line (MDR-44): the user states it line by line.
  return { name: '', unitCode: previous?.unitCode ?? '', quantity: '', unitPrice: '', vatRate: '' };
}

export function emptyFormState(): FormState {
  const fields = Object.fromEntries(FIELD_IDS.map((id) => [id, ''])) as Record<FieldId, string>;
  return { fields, lines: [emptyLine()], supplyMode: 'date', leitwegCheck: false, vatRegime: 'regular', documentType: '380', clearingConfirmed: false, skonto: [] };
}

/** The one way the document type changes: every change, in either direction, withdraws the clearing confirmation. */
export function selectDocumentType(state: FormState, type: DocumentType): void {
  if (state.documentType === type) return;
  state.documentType = type;
  state.clearingConfirmed = false;
}

/** DOM id of the clearing confirmation; it is also the domain path of its diagnostic, so navigation lands on the control. */
export const CLEARING_CONFIRMATION_ID = 'payment.settlement.reciprocalObligationConfirmed';

/** Fields the domain requires for a 380; a test proves each answers `missing_field` when empty. */
export const REQUIRED_FIELD_IDS: readonly FieldId[] = [
  'invoiceNumber', 'issueDate', 'deliveryDate', 'buyerReference',
  'seller.name', 'seller.address.street', 'seller.address.postCode', 'seller.address.city',
  'seller.electronicAddress.schemeId', 'seller.electronicAddress.value',
  'seller.contact.name', 'seller.contact.telephone', 'seller.contact.email',
  'buyer.name', 'buyer.address.street', 'buyer.address.postCode', 'buyer.address.city',
  'buyer.electronicAddress.schemeId', 'buyer.electronicAddress.value',
  'payment.means.code', 'payment.means.account.id.value',
];

/** On a 381 the credit-transfer fields leave the form and BT-25 is required (MDR-35, MDR-49); a test proves the same. */
export const REQUIRED_FIELD_IDS_381: readonly FieldId[] = [
  ...REQUIRED_FIELD_IDS.filter((id) => !id.startsWith('payment.means.')),
  'precedingInvoice.number',
];

/** Fields that belong to one document type only; the other type never sends them. */
export const CREDIT_TRANSFER_FIELD_IDS: readonly FieldId[] = ['payment.means.code', 'payment.means.account.id.value', 'payment.means.account.name', 'payment.means.account.bic'];
export const PRECEDING_INVOICE_FIELD_IDS: readonly FieldId[] = ['precedingInvoice.number', 'precedingInvoice.issueDate'];
