// UI state of the XRechnung workspace: strings only. Nothing derived from money or validation is stored here.
// Field ids are the domain input paths (document.ts), so a diagnostic { code, path } addresses its field directly.

export const FIELD_IDS = [
  'invoiceNumber', 'issueDate', 'deliveryDate', 'invoicingPeriod.startDate', 'invoicingPeriod.endDate', 'buyerReference',
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
export type FormState = { fields: Record<FieldId, string>; lines: LineForm[]; supplyMode: SupplyMode; leitwegCheck: boolean; vatRegime: VatRegime };

export function emptyLine(previous?: LineForm): LineForm {
  // A new line repeats the unit and a standard rate the user already chose on the previous line; nothing else. Reverse Charge
  // is a treatment the user states line by line, so it is never carried over.
  const rate = previous?.vatRate === 'reverse-charge' ? '' : (previous?.vatRate ?? '');
  return { name: '', unitCode: previous?.unitCode ?? '', quantity: '', unitPrice: '', vatRate: rate };
}

export function emptyFormState(): FormState {
  const fields = Object.fromEntries(FIELD_IDS.map((id) => [id, ''])) as Record<FieldId, string>;
  return { fields, lines: [emptyLine()], supplyMode: 'date', leitwegCheck: false, vatRegime: 'regular' };
}

/** Fields the domain requires for a 380 in this slice; a test proves each answers `missing_field` when empty. */
export const REQUIRED_FIELD_IDS: readonly FieldId[] = [
  'invoiceNumber', 'issueDate', 'deliveryDate', 'buyerReference',
  'seller.name', 'seller.address.street', 'seller.address.postCode', 'seller.address.city',
  'seller.electronicAddress.schemeId', 'seller.electronicAddress.value',
  'seller.contact.name', 'seller.contact.telephone', 'seller.contact.email',
  'buyer.name', 'buyer.address.street', 'buyer.address.postCode', 'buyer.address.city',
  'buyer.electronicAddress.schemeId', 'buyer.electronicAddress.value',
  'payment.means.code', 'payment.means.account.id.value',
];
