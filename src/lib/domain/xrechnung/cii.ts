// UN/CEFACT CII D16B CrossIndustryInvoice serializer for the XRechnung CIUS. A pure function from the same validated
// Invoice the UBL serializer consumes to an XML string, built for the preregistered Increment 3 experiment (MDR-16).
//
// This is the only file that knows CII element names and namespaces. It performs no arithmetic: every amount is a
// Decimal produced by the monetary calculation and is only formatted, by formatXmlDecimal. Element order follows the
// CII D16B XSD sequences, paths follow the official SeMoX CIUS model (binding cii), both taken from the KoSIT
// configuration 2026-08-31. CEN/TS 16931-3-3 was not available, so no verification against it is claimed. Where
// SeMoX admits two bindings the frozen project choices apply: BT-41 is PersonName, BT-84 is IBANID, BT-34-1/BT-49-1
// are URIID/@schemeID, and dates are DateTimeString with format 102. The output is deterministic: fixed order,
// two-space indentation, LF newlines, UTF-8, no timestamps.

import { isValidatedInvoice, type Invoice, type InvoiceLine, type InvoiceParty } from './document.ts';
import type { Decimal } from './decimal.ts';
import { formatXmlDecimal } from './number-notation.ts';

export type CiiResult =
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly errors: readonly { readonly code: 'unvalidated_invoice'; readonly path: '' }[] };

const NAMESPACE_RSM = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
const NAMESPACE_RAM = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
const NAMESPACE_UDT = 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100';

// BT-24 and BT-23: the same XRechnung 3.0.2 section 11.27 values as in ubl.ts. They are not carried by Invoice, so each
// serializer holds its own copy (a MODEL-U item of the experiment, reported rather than moved).
const SPECIFICATION_IDENTIFIER = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const BUSINESS_PROCESS_TYPE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

type Attribute = readonly [name: string, value: string];
type Element = { readonly name: string; readonly attributes?: readonly Attribute[]; readonly text?: string; readonly children?: readonly Element[] };

const leaf = (name: string, text: string, attributes: readonly Attribute[] = []): Element => ({ name, text, attributes });
const group = (name: string, ...children: readonly Element[]): Element => ({ name, children });
// CII amounts carry no currencyID, except BT-110 (TaxTotalAmount), which needs it.
const amount = (name: string, value: Decimal): Element => leaf(name, formatXmlDecimal(value));
// The domain holds YYYY-MM-DD (checked by buildInvoice); format 102 is the same date as YYYYMMDD.
const date = (name: string, isoDate: string): Element => group(name, leaf('udt:DateTimeString', isoDate.replaceAll('-', ''), [['format', '102']]));

export function serializeCiiInvoice(invoice: Invoice): CiiResult {
  // The type says Invoice, the runtime check says it really came from buildInvoice.
  if (!isValidatedInvoice(invoice)) return { ok: false, errors: [{ code: 'unvalidated_invoice', path: '' }] };

  const root: Element = {
    name: 'rsm:CrossIndustryInvoice',
    attributes: [
      ['xmlns:rsm', NAMESPACE_RSM],
      ['xmlns:ram', NAMESPACE_RAM],
      ['xmlns:udt', NAMESPACE_UDT],
    ],
    children: [
      group(
        'rsm:ExchangedDocumentContext',
        group('ram:BusinessProcessSpecifiedDocumentContextParameter', leaf('ram:ID', BUSINESS_PROCESS_TYPE)), // BT-23
        group('ram:GuidelineSpecifiedDocumentContextParameter', leaf('ram:ID', SPECIFICATION_IDENTIFIER)), // BT-24
      ),
      group(
        'rsm:ExchangedDocument',
        leaf('ram:ID', invoice.invoiceNumber), // BT-1
        leaf('ram:TypeCode', invoice.documentTypeCode), // BT-3
        date('ram:IssueDateTime', invoice.issueDate), // BT-2
        ...invoice.notes.map((note) => group('ram:IncludedNote', leaf('ram:Content', note.text))), // BG-1 / BT-22
      ),
      group(
        'rsm:SupplyChainTradeTransaction',
        ...invoice.lines.map((line, index) => lineItem(line, index)),
        group(
          'ram:ApplicableHeaderTradeAgreement',
          leaf('ram:BuyerReference', invoice.buyerReference), // BT-10
          party('ram:SellerTradeParty', invoice.seller, invoice.seller), // BG-4
          party('ram:BuyerTradeParty', invoice.buyer), // BG-7
        ),
        group('ram:ApplicableHeaderTradeDelivery', group('ram:ActualDeliverySupplyChainEvent', date('ram:OccurrenceDateTime', invoice.deliveryDate))), // BT-72
        settlement(invoice),
      ),
    ],
  };

  return { ok: true, xml: `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0).join('\n')}\n` };
}

// BG-4 carries the seller identifiers (BT-29/30/31/32) and the seller contact (BG-6); BG-7 carries only BT-47 and BT-48.
// Element order follows the CII D16B TradePartyType sequence: ID, GlobalID, Name, Description, SpecifiedLegalOrganization,
// DefinedTradeContact, PostalTradeAddress, URIUniversalCommunication, SpecifiedTaxRegistration.
type Identified = InvoiceParty & { readonly legalRegistrationId?: string; readonly vatId?: string };

function party(name: string, source: Identified, seller?: Invoice['seller']): Element {
  return group(
    name,
    ...(seller?.sellerIdentifiers.map((identifier) => leaf('ram:ID', identifier.value)) ?? []), // BT-29, unscoped: no scheme in M1
    leaf('ram:Name', source.name), // BT-27 / BT-44
    ...(seller?.additionalLegalInformation !== undefined ? [leaf('ram:Description', seller.additionalLegalInformation)] : []), // BT-33
    ...(source.legalRegistrationId !== undefined ? [group('ram:SpecifiedLegalOrganization', leaf('ram:ID', source.legalRegistrationId))] : []), // BT-30 / BT-47
    ...(seller
      ? [
          group(
            'ram:DefinedTradeContact', // BG-6
            leaf('ram:PersonName', seller.contact.name), // BT-41
            group('ram:TelephoneUniversalCommunication', leaf('ram:CompleteNumber', seller.contact.telephone)), // BT-42
            group('ram:EmailURIUniversalCommunication', leaf('ram:URIID', seller.contact.email)), // BT-43
          ),
        ]
      : []),
    group(
      'ram:PostalTradeAddress',
      leaf('ram:PostcodeCode', source.address.postCode), // BT-38 / BT-53
      leaf('ram:LineOne', source.address.street), // BT-35 / BT-50
      leaf('ram:CityName', source.address.city), // BT-37 / BT-52
      leaf('ram:CountryID', source.address.country), // BT-40 / BT-55
    ),
    group('ram:URIUniversalCommunication', leaf('ram:URIID', source.electronicAddress.value, [['schemeID', source.electronicAddress.schemeId]])), // BT-34 / BT-49
    ...taxRegistrations(source, seller), // BT-31 / BT-32 / BT-48
  );
}

function taxRegistrations(source: Identified, seller?: Invoice['seller']): readonly Element[] {
  const registrations: Element[] = [];
  if (source.vatId !== undefined) registrations.push(group('ram:SpecifiedTaxRegistration', leaf('ram:ID', source.vatId, [['schemeID', 'VA']]))); // BT-31 / BT-48
  if (seller?.taxRegistrationId !== undefined) registrations.push(group('ram:SpecifiedTaxRegistration', leaf('ram:ID', seller.taxRegistrationId, [['schemeID', 'FC']]))); // BT-32
  return registrations;
}

function settlement(invoice: Invoice): Element {
  const totals = invoice.totals;
  return group(
    'ram:ApplicableHeaderTradeSettlement',
    leaf('ram:InvoiceCurrencyCode', invoice.currency), // BT-5
    group(
      'ram:SpecifiedTradeSettlementPaymentMeans', // BG-16
      leaf('ram:TypeCode', invoice.payment.means.code), // BT-81
      ...creditTransfer(invoice.payment.means.account), // BG-17
    ),
    ...totals.vatBreakdown.map((bucket) =>
      group(
        'ram:ApplicableTradeTax', // BG-23
        amount('ram:CalculatedAmount', bucket.taxAmount), // BT-117
        leaf('ram:TypeCode', 'VAT'),
        ...(bucket.treatment !== 'standard' ? [leaf('ram:ExemptionReason', bucket.exemptionReason)] : []), // BT-120
        amount('ram:BasisAmount', bucket.taxableAmount), // BT-116
        leaf('ram:CategoryCode', bucket.category), // BT-118
        leaf('ram:RateApplicablePercent', bucket.rate), // BT-119
      ),
    ),
    ...paymentTerms(invoice.payment),
    group(
      'ram:SpecifiedTradeSettlementHeaderMonetarySummation', // BG-22
      amount('ram:LineTotalAmount', totals.sumOfLineNetAmounts), // BT-106
      amount('ram:TaxBasisTotalAmount', totals.totalWithoutVat), // BT-109
      leaf('ram:TaxTotalAmount', formatXmlDecimal(totals.totalVat), [['currencyID', invoice.currency]]), // BT-110
      amount('ram:GrandTotalAmount', totals.totalWithVat), // BT-112
      amount('ram:DuePayableAmount', totals.amountDue), // BT-115
    ),
  );
}

// BG-17 is split over two siblings of TypeCode: the account (IBANID, then AccountName) and, for BT-86, the institution.
// SeMoX binds BT-84 to IBANID for an IBAN (ProprietaryID otherwise, not in M1) and BT-86 to
// PayeeSpecifiedCreditorFinancialInstitution/BICID for a credit transfer.
function creditTransfer(account: Invoice['payment']['means']['account']): readonly Element[] {
  return [
    group(
      'ram:PayeePartyCreditorFinancialAccount',
      leaf('ram:IBANID', account.id.value), // BT-84
      ...(account.name !== undefined ? [leaf('ram:AccountName', account.name)] : []), // BT-85
    ),
    ...(account.bic !== undefined ? [group('ram:PayeeSpecifiedCreditorFinancialInstitution', leaf('ram:BICID', account.bic))] : []), // BT-86
  ];
}

// One SpecifiedTradePaymentTerms (CII-SR rule: at most one) holding BT-20 and/or BT-9 in XSD order: Description, then
// DueDateDateTime. Absent when neither is supplied (BR-CO-25 allows that only for a zero amount due; buildInvoice checks it).
function paymentTerms(payment: Invoice['payment']): readonly Element[] {
  const children = [
    ...(payment.termsText !== undefined ? [leaf('ram:Description', payment.termsText)] : []), // BT-20
    ...(payment.dueDate !== undefined ? [date('ram:DueDateDateTime', payment.dueDate)] : []), // BT-9
  ];
  return children.length > 0 ? [group('ram:SpecifiedTradePaymentTerms', ...children)] : [];
}

function lineItem(line: InvoiceLine, index: number): Element {
  return group(
    'ram:IncludedSupplyChainTradeLineItem', // BG-25
    group('ram:AssociatedDocumentLineDocument', leaf('ram:LineID', String(index + 1))), // BT-126
    group('ram:SpecifiedTradeProduct', leaf('ram:Name', line.name)), // BT-153
    group('ram:SpecifiedLineTradeAgreement', group('ram:NetPriceProductTradePrice', amount('ram:ChargeAmount', line.unitPrice))), // BG-29, BT-146
    group('ram:SpecifiedLineTradeDelivery', leaf('ram:BilledQuantity', formatXmlDecimal(line.quantity), [['unitCode', line.unitCode]])), // BT-129, BT-130
    group(
      'ram:SpecifiedLineTradeSettlement',
      group(
        'ram:ApplicableTradeTax', // BG-30
        leaf('ram:TypeCode', 'VAT'),
        leaf('ram:CategoryCode', line.vat.category), // BT-151
        leaf('ram:RateApplicablePercent', line.vat.rate), // BT-152
      ),
      group('ram:SpecifiedTradeSettlementLineMonetarySummation', amount('ram:LineTotalAmount', line.netAmount)), // BT-131
    ),
  );
}

// ------------------------------------------------------------------------------------------------ rendering

// ponytail: same renderer as ubl.ts. ubl.ts is pinned by the Increment 3 manifest, so it is not refactored during the
// experiment; extract a shared module once the experiment is closed.
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
