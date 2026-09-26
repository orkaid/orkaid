// UBL 2.1 Invoice serializer for the XRechnung CIUS. A pure function from a validated Invoice to an XML string.
//
// This is the only file that knows UBL element names and namespaces. It performs no arithmetic: every amount is a
// Decimal produced by the monetary calculation and is only formatted, by formatXmlDecimal (MDR-15). Element order
// follows the UBL 2.1 XSD sequences, paths and cardinalities follow the official SeMoX CIUS model (binding ubl-inv),
// both taken from the KoSIT configuration 2026-08-31. CEN/TS 16931-3-2 was not available, so no exhaustive
// verification against it is claimed. The output is deterministic: fixed order, two-space indentation, LF newlines,
// UTF-8, no timestamps.

import { isValidatedInvoice, type Invoice, type InvoiceLine, type InvoiceParty } from './document.ts';
import type { Decimal } from './decimal.ts';
import { formatXmlDecimal } from './number-notation.ts';

export type UblResult =
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly errors: readonly { readonly code: 'unvalidated_invoice'; readonly path: '' }[] };

const NAMESPACE_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
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
  const root: Element = {
    name: 'Invoice',
    attributes: [
      ['xmlns', NAMESPACE_INVOICE],
      ['xmlns:cac', NAMESPACE_CAC],
      ['xmlns:cbc', NAMESPACE_CBC],
    ],
    children: [
      leaf('cbc:CustomizationID', SPECIFICATION_IDENTIFIER), // BT-24
      leaf('cbc:ProfileID', BUSINESS_PROCESS_TYPE), // BT-23
      leaf('cbc:ID', invoice.invoiceNumber), // BT-1
      leaf('cbc:IssueDate', invoice.issueDate), // BT-2
      leaf('cbc:DueDate', invoice.paymentDueDate), // BT-9
      leaf('cbc:InvoiceTypeCode', invoice.documentTypeCode), // BT-3
      leaf('cbc:DocumentCurrencyCode', currency), // BT-5
      leaf('cbc:BuyerReference', invoice.buyerReference), // BT-10
      group('cac:AccountingSupplierParty', party(invoice.seller, invoice.seller)), // BG-4
      group('cac:AccountingCustomerParty', party(invoice.buyer)), // BG-7
      group('cac:Delivery', leaf('cbc:ActualDeliveryDate', invoice.deliveryDate)), // BT-72
      group(
        'cac:PaymentMeans', // BG-16
        leaf('cbc:PaymentMeansCode', invoice.payment.meansCode), // BT-81
        group('cac:PayeeFinancialAccount', leaf('cbc:ID', invoice.payment.iban)), // BG-17, BT-84
      ),
      taxTotal(invoice, currency),
      group(
        'cac:LegalMonetaryTotal', // BG-22
        amount('cbc:LineExtensionAmount', invoice.totals.sumOfLineNetAmounts, currency), // BT-106
        amount('cbc:TaxExclusiveAmount', invoice.totals.totalWithoutVat, currency), // BT-109
        amount('cbc:TaxInclusiveAmount', invoice.totals.totalWithVat, currency), // BT-112
        amount('cbc:PayableAmount', invoice.totals.amountDue, currency), // BT-115
      ),
      ...invoice.lines.map((line, index) => invoiceLine(line, index, currency)),
    ],
  };

  return { ok: true, xml: `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0).join('\n')}\n` };
}

// BG-4 carries the seller VAT identifier (BT-31) and the seller contact (BG-6); BG-7 has neither in this profile.
function party(source: InvoiceParty, seller?: Invoice['seller']): Element {
  return group(
    'cac:Party',
    leaf('cbc:EndpointID', source.electronicAddress.value, [['schemeID', source.electronicAddress.schemeId]]), // BT-34 / BT-49
    group(
      'cac:PostalAddress',
      leaf('cbc:StreetName', source.address.street), // BT-35 / BT-50
      leaf('cbc:CityName', source.address.city), // BT-37 / BT-52
      leaf('cbc:PostalZone', source.address.postCode), // BT-38 / BT-53
      group('cac:Country', leaf('cbc:IdentificationCode', source.address.country)), // BT-40 / BT-55
    ),
    ...(seller ? [group('cac:PartyTaxScheme', leaf('cbc:CompanyID', seller.vatId), group('cac:TaxScheme', leaf('cbc:ID', 'VAT')))] : []), // BT-31
    group('cac:PartyLegalEntity', leaf('cbc:RegistrationName', source.name)), // BT-27 / BT-44
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
          group('cac:TaxScheme', leaf('cbc:ID', 'VAT')),
        ),
      ),
    ),
  );
}

function invoiceLine(line: InvoiceLine, index: number, currency: string): Element {
  return group(
    'cac:InvoiceLine', // BG-25
    leaf('cbc:ID', String(index + 1)), // BT-126
    leaf('cbc:InvoicedQuantity', formatXmlDecimal(line.quantity), [['unitCode', line.unitCode]]), // BT-129, BT-130
    amount('cbc:LineExtensionAmount', line.netAmount, currency), // BT-131
    group(
      'cac:Item',
      leaf('cbc:Name', line.name), // BT-153
      group(
        'cac:ClassifiedTaxCategory', // BG-30
        leaf('cbc:ID', line.vatCategory), // BT-151
        leaf('cbc:Percent', line.vatRate), // BT-152
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
