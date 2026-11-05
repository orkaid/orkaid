// UBL 2.1 Invoice and CreditNote serializer for the XRechnung CIUS. A pure function from a validated Invoice to an XML string.
// A 381 is a CreditNote document, not an Invoice with another code (BR-CL-01, UBL-CR); MDR-35.
//
// This is the only file that knows UBL element names and namespaces. It performs no arithmetic: every amount is a
// Decimal produced by the monetary calculation and is only formatted, by formatXmlDecimal (MDR-15). Element order
// follows the UBL 2.1 XSD sequences, paths and cardinalities follow the official SeMoX CIUS model (binding ubl-inv),
// both taken from the KoSIT configuration 2026-08-31. CEN/TS 16931-3-2 was not available, so no exhaustive
// verification against it is claimed. The output is deterministic: fixed order, two-space indentation, LF newlines,
// UTF-8, no timestamps.

import { hasOwnField, isValidatedInvoice, paymentTermsText, type Invoice, type InvoiceLine, type InvoiceParty, type PaymentAccount, type PrecedingInvoiceReference } from './document.ts';
import type { Decimal } from './decimal.ts';
import { formatXmlDecimal } from './number-notation.ts';
import { appendOwn } from './own-data.ts';

export type UblResult =
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly errors: readonly { readonly code: 'unvalidated_invoice'; readonly path: '' }[] };

const NAMESPACE_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const NAMESPACE_CREDIT_NOTE = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
// UNCL4461 code 97, clearing between partners: the only payment of a 381 (MDR-35). It carries no BG-17.
const CLEARING_PAYMENT_MEANS_CODE = '97';
const NAMESPACE_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const NAMESPACE_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';

// BT-24: the XRechnung 3.0 CIUS identifier (XRechnung 3.0.2 section 11.27). It says `xrechnung_3.0`, not `_3.0.2`.
const SPECIFICATION_IDENTIFIER = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
// BT-23: XRechnung 3.0.2 section 11.27 allows this default when the recipient prescribes no business process.
const BUSINESS_PROCESS_TYPE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

type Attribute = readonly [name: string, value: string];
type Element = { readonly name: string; readonly attributes?: readonly Attribute[]; readonly text?: string; readonly children?: readonly Element[] };

const leaf = (name: string, text: string, attributes: readonly Attribute[] = []): Element => ({ name, text, attributes });
const group = (name: string, ...children: readonly Element[]): Element => ({ name, children });
const amount = (name: string, value: Decimal, currency: string): Element => leaf(name, formatXmlDecimal(value), [['currencyID', currency]]);

export function serializeUblInvoice(invoice: Invoice): UblResult {
  // The type says Invoice, the runtime check says it really came from buildInvoice.
  if (!isValidatedInvoice(invoice)) return { ok: false, errors: [{ code: 'unvalidated_invoice', path: '' }] };

  const currency = invoice.currency;
  const creditNote = invoice.documentTypeCode === '381';
  const root: Element = {
    name: creditNote ? 'CreditNote' : 'Invoice',
    attributes: [
      ['xmlns', creditNote ? NAMESPACE_CREDIT_NOTE : NAMESPACE_INVOICE],
      ['xmlns:cac', NAMESPACE_CAC],
      ['xmlns:cbc', NAMESPACE_CBC],
    ],
    children: [
      leaf('cbc:CustomizationID', SPECIFICATION_IDENTIFIER), // BT-24
      leaf('cbc:ProfileID', BUSINESS_PROCESS_TYPE), // BT-23
      leaf('cbc:ID', invoice.invoiceNumber), // BT-1
      leaf('cbc:IssueDate', invoice.issueDate), // BT-2
      ...(invoice.documentTypeCode === '380' && hasOwnField(invoice.payment, 'dueDate') ? [leaf('cbc:DueDate', invoice.payment.dueDate)] : []), // BT-9 (a CreditNote has no DueDate)
      leaf(creditNote ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode', invoice.documentTypeCode), // BT-3
      ...invoice.notes.map((note) => leaf('cbc:Note', note.text)), // BG-1 / BT-22
      leaf('cbc:DocumentCurrencyCode', currency), // BT-5
      leaf('cbc:BuyerReference', invoice.buyerReference), // BT-10
      // BG-14 (MDR-37): InvoicePeriod follows BuyerReference in both sequences (a CreditNote's DiscrepancyResponse, never
      // written, would come next). It replaces Delivery: a validated document carries exactly one of BG-14 and BT-72.
      ...(hasOwnField(invoice, 'invoicingPeriod')
        ? [group('cac:InvoicePeriod', leaf('cbc:StartDate', invoice.invoicingPeriod.startDate), leaf('cbc:EndDate', invoice.invoicingPeriod.endDate))] // BT-73, BT-74
        : []),
      ...(hasOwnField(invoice, 'orderReference') ? [group('cac:OrderReference', leaf('cbc:ID', invoice.orderReference))] : []), // BT-13
      ...(invoice.documentTypeCode === '381' ? [billingReference(invoice.precedingInvoice)] : []), // BG-3
      ...(hasOwnField(invoice, 'contractReference') ? [group('cac:ContractDocumentReference', leaf('cbc:ID', invoice.contractReference))] : []), // BT-12
      ...projectReference(invoice), // BT-11
      group('cac:AccountingSupplierParty', party(invoice.seller, invoice.seller)), // BG-4
      group('cac:AccountingCustomerParty', party(invoice.buyer)), // BG-7
      ...(hasOwnField(invoice, 'deliveryDate') ? [group('cac:Delivery', leaf('cbc:ActualDeliveryDate', invoice.deliveryDate))] : []), // BT-72
      paymentMeans(invoice),
      ...paymentTerms(invoice.payment),
      taxTotal(invoice, currency),
      group(
        'cac:LegalMonetaryTotal', // BG-22
        amount('cbc:LineExtensionAmount', invoice.totals.sumOfLineNetAmounts, currency), // BT-106
        amount('cbc:TaxExclusiveAmount', invoice.totals.totalWithoutVat, currency), // BT-109
        amount('cbc:TaxInclusiveAmount', invoice.totals.totalWithVat, currency), // BT-112
        amount('cbc:PayableAmount', invoice.totals.amountDue, currency), // BT-115
      ),
      ...invoice.lines.map((line, index) => invoiceLine(line, index, currency, creditNote)),
    ],
  };

  return { ok: true, xml: `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0).join('\n')}\n` };
}

// BT-20. Line breaks stay literal in the element text: BR-DE-18 requires the LF after each Skonto line (MDR-39).
function paymentTerms(payment: Invoice['payment']): readonly Element[] {
  const text = paymentTermsText(payment);
  return text === undefined ? [] : [group('cac:PaymentTerms', leaf('cbc:Note', text))];
}

// BT-11 (MDR-36). A UBL Invoice has ProjectReference. A UBL CreditNote has no such element: the XRechnung model binds BT-11 to
// AdditionalDocumentReference/ID without a discriminator, a path it shares with the supporting documents of BG-24. The
// OpenPeppol BIS Billing documentation separates the two by DocumentTypeCode 50, so the credit note writes exactly that
// element, with only ID and DocumentTypeCode. Code 50 is an explicit Orkaid binding choice supported by that
// documentation, not an XRechnung mandate. Position: after ContractDocumentReference, before the parties.
const PROJECT_REFERENCE_TYPE_CODE = '50';
function projectReference(invoice: Invoice): readonly Element[] {
  if (!hasOwnField(invoice, 'projectReference')) return [];
  return invoice.documentTypeCode === '381'
    ? [group('cac:AdditionalDocumentReference', leaf('cbc:ID', invoice.projectReference), leaf('cbc:DocumentTypeCode', PROJECT_REFERENCE_TYPE_CODE))]
    : [group('cac:ProjectReference', leaf('cbc:ID', invoice.projectReference))];
}

// BG-3. PrecedingInvoice reference: BillingReference follows BuyerReference in the CreditNote sequence.
function billingReference(reference: PrecedingInvoiceReference): Element {
  return group(
    'cac:BillingReference',
    group(
      'cac:InvoiceDocumentReference',
      leaf('cbc:ID', reference.number), // BT-25
      ...(hasOwnField(reference, 'issueDate') ? [leaf('cbc:IssueDate', reference.issueDate)] : []), // BT-26
    ),
  );
}

// BG-16. A 380 names its credit transfer (BG-17). A 381 is a clearing: code 97, no account, and BT-9 sits here as
// PaymentDueDate because a CreditNote has no root DueDate (PaymentMeansType order: code, PaymentDueDate, accounts).
function paymentMeans(invoice: Invoice): Element {
  if (invoice.documentTypeCode === '381') {
    return group(
      'cac:PaymentMeans',
      leaf('cbc:PaymentMeansCode', CLEARING_PAYMENT_MEANS_CODE), // BT-81
      ...(hasOwnField(invoice.payment, 'dueDate') ? [leaf('cbc:PaymentDueDate', invoice.payment.dueDate)] : []), // BT-9
    );
  }
  return group(
    'cac:PaymentMeans', // BG-16
    leaf('cbc:PaymentMeansCode', invoice.payment.means.code), // BT-81
    payeeFinancialAccount(invoice.payment.means.account), // BG-17
  );
}

// FinancialAccountType order: ID, Name, then FinancialInstitutionBranch. No schemeID on either ID (UBL-CR-654, UBL-CR-655).
function payeeFinancialAccount(account: PaymentAccount): Element {
  return group(
    'cac:PayeeFinancialAccount',
    leaf('cbc:ID', account.id.value), // BT-84
    ...(hasOwnField(account, 'name') ? [leaf('cbc:Name', account.name)] : []), // BT-85
    ...(hasOwnField(account, 'bic') ? [group('cac:FinancialInstitutionBranch', leaf('cbc:ID', account.bic))] : []), // BT-86
  );
}

// BT-32's TaxScheme/ID: the SeMoX UBL binding requires only `!= 'VAT'` (verified against the pinned EN16931-UBL and
// XRechnung-UBL stylesheets and the official maxRechnung_ubl.xml test instance, which uses an arbitrary non-VAT
// placeholder). No specific value is mandated by any inspected rule or code list. 'FC' is an Orkaid choice, not an
// EN16931/XRechnung requirement, reused from the CII binding (which does require it) for cross-syntax consistency.
const UBL_TAX_REGISTRATION_SCHEME = 'FC';

// BG-4 carries the seller identifiers (BT-29/30/31/32) and the seller contact (BG-6); BG-7 carries only BT-47 and BT-48.
// Element order follows the UBL 2.1 PartyType sequence: EndpointID, PartyIdentification, PostalAddress,
// PartyTaxScheme, PartyLegalEntity, Contact.
type Identified = InvoiceParty & { readonly legalRegistrationId?: string; readonly vatId?: string };

function party(source: Identified, seller?: Invoice['seller']): Element {
  return group(
    'cac:Party',
    leaf('cbc:EndpointID', source.electronicAddress.value, [['schemeID', source.electronicAddress.schemeId]]), // BT-34 / BT-49
    ...(seller?.sellerIdentifiers.map((identifier) => group('cac:PartyIdentification', leaf('cbc:ID', identifier.value))) ?? []), // BT-29
    group(
      'cac:PostalAddress',
      leaf('cbc:StreetName', source.address.street), // BT-35 / BT-50
      leaf('cbc:CityName', source.address.city), // BT-37 / BT-52
      leaf('cbc:PostalZone', source.address.postCode), // BT-38 / BT-53
      group('cac:Country', leaf('cbc:IdentificationCode', source.address.country)), // BT-40 / BT-55
    ),
    ...taxSchemes(source, seller), // BT-31 / BT-32 / BT-48
    group(
      'cac:PartyLegalEntity',
      leaf('cbc:RegistrationName', source.name), // BT-27 / BT-44
      ...(hasOwnField(source, 'legalRegistrationId') ? [leaf('cbc:CompanyID', source.legalRegistrationId)] : []), // BT-30 / BT-47
      ...(seller !== undefined && hasOwnField(seller, 'additionalLegalInformation') ? [leaf('cbc:CompanyLegalForm', seller.additionalLegalInformation)] : []), // BT-33
    ),
    ...(seller
      ? [
          group(
            'cac:Contact', // BG-6
            leaf('cbc:Name', seller.contact.name), // BT-41
            leaf('cbc:Telephone', seller.contact.telephone), // BT-42
            leaf('cbc:ElectronicMail', seller.contact.email), // BT-43
          ),
        ]
      : []),
  );
}

function taxSchemes(source: Identified, seller?: Invoice['seller']): readonly Element[] {
  const schemes: Element[] = [];
  if (hasOwnField(source, 'vatId')) appendOwn(schemes, group('cac:PartyTaxScheme', leaf('cbc:CompanyID', source.vatId), group('cac:TaxScheme', leaf('cbc:ID', 'VAT')))); // BT-31 / BT-48
  if (seller !== undefined && hasOwnField(seller, 'taxRegistrationId')) {
    appendOwn(schemes, group('cac:PartyTaxScheme', leaf('cbc:CompanyID', seller.taxRegistrationId), group('cac:TaxScheme', leaf('cbc:ID', UBL_TAX_REGISTRATION_SCHEME)))); // BT-32
  }
  return schemes;
}

function taxTotal(invoice: Invoice, currency: string): Element {
  return group(
    'cac:TaxTotal',
    amount('cbc:TaxAmount', invoice.totals.totalVat, currency), // BT-110
    ...invoice.totals.vatBreakdown.map((bucket) =>
      group(
        'cac:TaxSubtotal', // BG-23
        amount('cbc:TaxableAmount', bucket.taxableAmount, currency), // BT-116
        amount('cbc:TaxAmount', bucket.taxAmount, currency), // BT-117
        group(
          'cac:TaxCategory',
          leaf('cbc:ID', bucket.category), // BT-118
          leaf('cbc:Percent', bucket.rate), // BT-119
          ...(bucket.treatment !== 'standard' ? [leaf('cbc:TaxExemptionReason', bucket.exemptionReason)] : []), // BT-120
          group('cac:TaxScheme', leaf('cbc:ID', 'VAT')),
        ),
      ),
    ),
  );
}

function invoiceLine(line: InvoiceLine, index: number, currency: string, creditNote: boolean): Element {
  return group(
    creditNote ? 'cac:CreditNoteLine' : 'cac:InvoiceLine', // BG-25
    leaf('cbc:ID', String(index + 1)), // BT-126
    leaf(creditNote ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity', formatXmlDecimal(line.quantity), [['unitCode', line.unitCode]]), // BT-129, BT-130
    amount('cbc:LineExtensionAmount', line.netAmount, currency), // BT-131
    group(
      'cac:Item',
      leaf('cbc:Name', line.name), // BT-153
      group(
        'cac:ClassifiedTaxCategory', // BG-30
        leaf('cbc:ID', line.vat.category), // BT-151
        leaf('cbc:Percent', line.vat.rate), // BT-152
        group('cac:TaxScheme', leaf('cbc:ID', 'VAT')),
      ),
    ),
    group('cac:Price', amount('cbc:PriceAmount', line.unitPrice, currency)), // BG-29, BT-146
  );
}

// ------------------------------------------------------------------------------------------------ rendering

function render(element: Element, depth: number): string[] {
  const padding = '  '.repeat(depth);
  const attributes = (element.attributes ?? []).map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  if (element.children !== undefined) {
    return [`${padding}<${element.name}${attributes}>`, ...element.children.flatMap((child) => render(child, depth + 1)), `${padding}</${element.name}>`];
  }
  return [`${padding}<${element.name}${attributes}>${escapeText(element.text ?? '')}</${element.name}>`];
}

// Text that reached this point was validated by buildInvoice (no characters that are illegal in XML 1.0), so
// escaping only has to protect markup. `&` goes first so the entities written afterwards are not escaped again.
const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = (value: string): string => escapeText(value).replaceAll('"', '&quot;');
