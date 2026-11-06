// UI state of the XRechnung workspace: strings only. Nothing derived from money or validation is stored here.
// Field ids are the domain input paths (document.ts), so a diagnostic { code, path } addresses its field directly.

export const FIELD_IDS = [
  'invoiceNumber', 'issueDate', 'deliveryDate', 'buyerReference',
  'seller.name', 'seller.address.street', 'seller.address.postCode', 'seller.address.city',
  'seller.electronicAddress.schemeId', 'seller.electronicAddress.value',
  'seller.contact.name', 'seller.contact.telephone', 'seller.contact.email',
  'seller.vatId', 'seller.taxRegistrationId', 'seller.legalRegistrationId', 'seller.sellerIdentifiers[0]',
  'buyer.name', 'buyer.address.street', 'buyer.address.postCode', 'buyer.address.city',
  'buyer.electronicAddress.schemeId', 'buyer.electronicAddress.value', 'buyer.vatId',
  'payment.means.code', 'payment.means.account.id.value', 'payment.means.account.name', 'payment.means.account.bic',
  'payment.dueDate', 'payment.termsText',
  'notes[0].text',
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

/** One invoice line as typed. `vatRate` is '' until the user chooses 19 or 7: no tax rate is chosen silently. */
export type LineForm = { name: string; unitCode: string; quantity: string; unitPrice: string; vatRate: string };

export type FormState = { fields: Record<FieldId, string>; lines: LineForm[] };

export function emptyLine(previous?: LineForm): LineForm {
  // A new line repeats the unit and rate the user already chose on the previous line; nothing else.
  return { name: '', unitCode: previous?.unitCode ?? '', quantity: '', unitPrice: '', vatRate: previous?.vatRate ?? '' };
}

export function emptyFormState(): FormState {
  const fields = Object.fromEntries(FIELD_IDS.map((id) => [id, ''])) as Record<FieldId, string>;
  return { fields, lines: [emptyLine()] };
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
