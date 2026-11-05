// Local KoSIT validation harness for the invoice fixtures. Development and testing only: it needs Java and the
// official XRechnung bundle, neither of which belongs to the repository, so it is NOT part of `npm test`.
//
//   ORKAID_KOSIT_BUNDLE=/path/to/xrechnung-3.0.2-bundle-2026-08-31.zip npm run test:kosit [-- <fixture> ...]
//
// It verifies the recorded hashes (tools/kosit/kosit-manifest.json), extracts the validator and configuration into
// the git-ignored .cache/, regenerates each fixture's XML in-process and requires it to equal the committed golden
// file, runs the validator on that exact file, and writes one evidence record per document to
// .cache/kosit/evidence/. The process exit code of the validator, the report's `valid` field, the message
// severities and the assessment are recorded separately; a zero exit code alone is never treated as acceptance.
// A document passes only if the matched scenario is the intended one, every validation step is valid, the
// assessment is `accept`, and every message is explicitly triaged in tests/fixtures/xrechnung/kosit-triage.json.
// A control document (a golden copy with BT-10 removed) must be rejected, which shows the harness accepts no
// document unconditionally. The Kleinunternehmer fixtures are validated in UBL and CII, each with mutated controls
// that must be rejected by the rule they break; the reverse-charge fixtures likewise (UBL and CII, both identifier
// branches, mutated controls for BR-AE-02, -05, -09 and -10); payment means 30 likewise (BR-50, BR-61, CII-SR-470,
// BR-DE-23-a, BR-CL-16); the electronic-address schemes 0204 and 0088 in both party roles (control: an unknown scheme,
// BR-CL-25) and seller BT-29 with BT-32 (control: BT-29 removed, so BT-32 alone is left, BR-CO-26) likewise; standard
// and reverse charge in one invoice likewise (controls for BR-AE-02, -05 and -10 with the standard bucket present).
// The invoicing period BG-14 instead of BT-72 (MDR-37) on a 380 and a 381 likewise (controls for BR-29, BR-CO-19 and the
// XSD element positions). A Leitweg-ID as BT-10 (MDR-38) on a 380 and a 381, in UBL and CII, is built with the opt-in
// policy; the pinned configuration only requires BT-10 to be present (BR-DE-15), so the existing missing-BT-10 control is the
// only negative control and no rejection of a malformed Leitweg-ID is claimed or derived from a hand-edited probe.
// Structured Skonto (MDR-39) on a 380, in UBL and CII, with mutated controls that break the BR-DE-18 line format. The Orkaid
// profile limits (tier count, day range, order, percent range, BASISBETRAG, 381) are not validator rules and have no control here.
// A pass here is not legal certification and says nothing about tax correctness.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { buildInvoice, UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { CREDIT_NOTE_FIXTURE_NAMES, CREDIT_NOTE_PERIOD_FIXTURE_NAMES, FIXTURE_NAMES, LEITWEG_FIXTURE_NAMES, PERIOD_FIXTURE_NAMES, REFERENCE_FIXTURE_NAMES, SKONTO_FIXTURE_NAMES, loadFixtureInput, type CreditNoteFixtureName, type FixtureName, type LeitwegFixtureName, type PeriodFixtureName, type ReferenceFixtureName, type SkontoFixtureName } from '../../tests/support/fixtures.ts';
import { parseReport, type ParsedReport } from './report.ts';

export type Manifest = {
  bundle: { file: string; sha256: string };
  validator: { version: string; archiveEntry: string; sha256: string; minimumJava: number };
  configuration: { version: string; archiveEntry: string; sha256: string; scenarios: string };
  expectedScenario: string;
};
type Triage = Record<string, { code: string; level: string; disposition: string }[]>;

// Everything is resolved from the repository root, so the harness works from any working directory.
const ROOT = resolve(import.meta.dirname, '../..');
export const CACHE = join(ROOT, '.cache/kosit');
const GOLDEN = join(ROOT, 'tests/fixtures/xrechnung/golden');
const CONTROL_NAME = 'control-missing-buyer-reference';
type Syntax = 'ubl' | 'cii';
const SCENARIOS: Record<Syntax, string> = { ubl: 'EN16931 XRechnung (UBL Invoice)', cii: 'EN16931 XRechnung (CII)' };
// A credit note 381 is a UBL CreditNote document and matches the validator's own CreditNote scenario (MDR-35); in CII it is
// the same CrossIndustryInvoice scenario as any invoice.
const UBL_CREDIT_NOTE_SCENARIO = 'EN16931 XRechnung (UBL CreditNote)';
const isCreditNoteFixture = (name: string): boolean => ([...CREDIT_NOTE_FIXTURE_NAMES, ...CREDIT_NOTE_PERIOD_FIXTURE_NAMES, 'zf-leitweg-id-credit-note'] as readonly string[]).includes(name);
// M1 current evidence: these fixtures are also validated in CII (their goldens are `<name>.cii.xml`).
const CII_FIXTURES: readonly FixtureName[] = ['e-kleinunternehmer', 'f-kleinunternehmer-lines', 'g-reverse-charge-vat-ids', 'h-reverse-charge-registration-ids', 'i-invoice-note', 'j-invoice-notes-multiline', 'k-payment-terms-only', 'l-payment-due-date-and-terms', 'm-payment-means-30', 'n-payment-means-30-account-details', 'o-eas-0204-seller-0088-buyer', 'p-eas-0088-seller-0204-buyer', 'q-seller-bt29-bt32', 'r-numeric-precision-boundary', 's-standard-and-reverse-charge'];
const ciiName = (name: string): string => `${name}.cii`;
type AnyFixtureName = FixtureName | CreditNoteFixtureName | ReferenceFixtureName | PeriodFixtureName | LeitwegFixtureName | SkontoFixtureName;
const isLeitwegFixture = (name: string): boolean => (LEITWEG_FIXTURE_NAMES as readonly string[]).includes(name);

// Mutated copies of a Kleinunternehmer golden that the official validator must reject, each by the named rules.
// The domain refuses to generate these documents, so they are derived from the golden text.
const removeElement = (xml: string, pattern: RegExp): string => {
  const mutated = xml.replace(pattern, '');
  if (mutated === xml) fail('a control mutation did not change the document');
  return mutated;
};
const KLEINUNTERNEHMER_CONTROLS: Record<string, { syntax: Syntax; base: AnyFixtureName; mutate: (xml: string) => string; codes: string[]; scenario?: string }> = {
  'control-ku-ubl-missing-bt120': { syntax: 'ubl', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<cbc:TaxExemptionReason>.*<\/cbc:TaxExemptionReason>\n/m), codes: ['BR-E-10'] },
  'control-ku-ubl-nonzero-vat': { syntax: 'ubl', base: 'e-kleinunternehmer', mutate: (x) => x.replace(/(<cbc:TaxAmount currencyID="EUR">)0\.00/g, '$11.00'), codes: ['BR-E-09'] },
  'control-ku-ubl-missing-seller-tax-id': { syntax: 'ubl', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m), codes: ['BR-E-02', 'BR-DE-16'] },
  'control-ku-cii-missing-bt120': { syntax: 'cii', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<ram:ExemptionReason>.*<\/ram:ExemptionReason>\n/m), codes: ['BR-E-10'] },
  'control-ku-cii-nonzero-vat': { syntax: 'cii', base: 'e-kleinunternehmer', mutate: (x) => x.replace(/(<ram:CalculatedAmount>)0\.00/g, '$11.00'), codes: ['BR-E-09'] },
  'control-ku-cii-missing-seller-tax-id': { syntax: 'cii', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m), codes: ['BR-E-02', 'BR-DE-16'] },
};
// Applies `mutate` to the part of the document from `marker` on (the buyer party), so the seller's identifiers are left alone.
const fromMarker = (xml: string, marker: string, mutate: (rest: string) => string): string => {
  const at = xml.indexOf(marker);
  if (at < 0) fail(`a control mutation found no ${marker}`);
  return xml.slice(0, at) + mutate(xml.slice(at));
};
const UBL_BUYER = '<cac:AccountingCustomerParty>';
const CII_BUYER = '<ram:BuyerTradeParty>';
// Reverse charge (AE). RC-1 (g: seller BT-31, buyer BT-48) and RC-2 (h: seller BT-30 + BT-32, buyer BT-47) each
// lose the one identifier that their branch of BR-AE-02 relies on; h keeps BR-CO-26 satisfied through BT-30, so only the AE rule fires.
const REVERSE_CHARGE_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-rc-ubl-missing-buyer-bt48': { syntax: 'ubl', base: 'g-reverse-charge-vat-ids', mutate: (x) => fromMarker(x, UBL_BUYER, (s) => removeElement(s, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m)), codes: ['BR-AE-02'] },
  'control-rc-ubl-missing-buyer-bt47': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => fromMarker(x, UBL_BUYER, (s) => removeElement(s, /^ *<cbc:CompanyID>.*<\/cbc:CompanyID>\n/m)), codes: ['BR-AE-02'] },
  'control-rc-ubl-missing-seller-tax-id': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m), codes: ['BR-AE-02', 'BR-DE-16'] },
  'control-rc-ubl-nonzero-vat': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<cbc:TaxAmount currencyID="EUR">)0\.00/g, '$11.00'), codes: ['BR-AE-09'] },
  'control-rc-ubl-nonzero-line-rate': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<cac:ClassifiedTaxCategory>\n *<cbc:ID>AE<\/cbc:ID>\n *<cbc:Percent>)0</g, '$119<'), codes: ['BR-AE-05'] },
  'control-rc-ubl-missing-bt120': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<cbc:TaxExemptionReason>.*<\/cbc:TaxExemptionReason>\n/m), codes: ['BR-AE-10'] },
  'control-rc-cii-missing-buyer-bt48': { syntax: 'cii', base: 'g-reverse-charge-vat-ids', mutate: (x) => fromMarker(x, CII_BUYER, (s) => removeElement(s, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m)), codes: ['BR-AE-02'] },
  'control-rc-cii-missing-buyer-bt47': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => fromMarker(x, CII_BUYER, (s) => removeElement(s, /^ *<ram:SpecifiedLegalOrganization>\n(?:.*\n){2}/m)), codes: ['BR-AE-02'] },
  'control-rc-cii-missing-seller-tax-id': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m), codes: ['BR-AE-02', 'BR-DE-16'] },
  'control-rc-cii-nonzero-vat': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<ram:CalculatedAmount>)0\.00/g, '$11.00'), codes: ['BR-AE-09'] },
  'control-rc-cii-nonzero-line-rate': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<ram:CategoryCode>AE<\/ram:CategoryCode>\n *<ram:RateApplicablePercent>)0</g, '$119<'), codes: ['BR-AE-05'] },
  'control-rc-cii-missing-bt120': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<ram:ExemptionReason>.*<\/ram:ExemptionReason>\n/m), codes: ['BR-AE-10'] },
};
// Payment means 30 (m: IBAN only): the account identifier, the whole BG-17, or a code outside UNTDID 4461 is removed or replaced.
const PAYMENT_MEANS_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-pm30-ubl-missing-bt84': { syntax: 'ubl', base: 'm-payment-means-30', mutate: (x) => removeElement(x, /^ *<cbc:ID>DE79000000001234567890<\/cbc:ID>\n/m), codes: ['BR-50', 'BR-61'] },
  'control-pm30-ubl-missing-bg17': { syntax: 'ubl', base: 'm-payment-means-30', mutate: (x) => removeElement(x, /^ *<cac:PayeeFinancialAccount>\n(?:.*\n){2}/m), codes: ['BR-61', 'BR-DE-23-a'] },
  'control-pm30-ubl-unknown-code': { syntax: 'ubl', base: 'm-payment-means-30', mutate: (x) => x.replace('<cbc:PaymentMeansCode>30<', '<cbc:PaymentMeansCode>99<'), codes: ['BR-CL-16'] },
  'control-pm30-cii-missing-bt84': { syntax: 'cii', base: 'm-payment-means-30', mutate: (x) => removeElement(x, /^ *<ram:IBANID>.*<\/ram:IBANID>\n/m), codes: ['BR-50', 'BR-61', 'CII-SR-470'] },
  'control-pm30-cii-missing-bg17': { syntax: 'cii', base: 'm-payment-means-30', mutate: (x) => removeElement(x, /^ *<ram:PayeePartyCreditorFinancialAccount>\n(?:.*\n){2}/m), codes: ['CII-SR-470', 'BR-DE-23-a'] },
  'control-pm30-cii-unknown-code': { syntax: 'cii', base: 'm-payment-means-30', mutate: (x) => x.replace('<ram:TypeCode>30<', '<ram:TypeCode>99<'), codes: ['BR-CL-16'] },
};
// M1 evidence controls. The domain cannot build either document: an unknown scheme is refused, and BT-32 alone fails
// BR-CO-26 in the core too. EAS (o): the seller scheme 0204 becomes 9999, outside the CEF EAS list. BT-29 (q: seller
// BT-29 + BT-32, no BT-31): BT-29 is removed and BT-32 is kept, so the tax-identifier rule still holds and only the
// seller-identification rule fails.
const replaceExact = (xml: string, from: string, to: string): string => {
  if (!xml.includes(from)) fail(`a control mutation found no ${from}`);
  return xml.replace(from, to);
};
const EVIDENCE_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-eas-ubl-unknown-scheme': { syntax: 'ubl', base: 'o-eas-0204-seller-0088-buyer', mutate: (x) => replaceExact(x, '<cbc:EndpointID schemeID="0204">', '<cbc:EndpointID schemeID="9999">'), codes: ['BR-CL-25'] },
  'control-eas-cii-unknown-scheme': { syntax: 'cii', base: 'o-eas-0204-seller-0088-buyer', mutate: (x) => replaceExact(x, '<ram:URIID schemeID="0204">', '<ram:URIID schemeID="9999">'), codes: ['BR-CL-25'] },
  'control-bt29-ubl-bt32-only': { syntax: 'ubl', base: 'q-seller-bt29-bt32', mutate: (x) => removeElement(x, /^ *<cac:PartyIdentification>\n *<cbc:ID>Kreditor-4711<\/cbc:ID>\n *<\/cac:PartyIdentification>\n/m), codes: ['BR-CO-26'] },
  'control-bt29-cii-bt32-only': { syntax: 'cii', base: 'q-seller-bt29-bt32', mutate: (x) => removeElement(x, /^ *<ram:ID>Kreditor-4711<\/ram:ID>\n/m), codes: ['BR-CO-26'] },
};
// Standard + reverse charge (s: S19 line and AE line, seller BT-31, buyer BT-48). Each control breaks one AE rule while the
// standard line and bucket stay intact: the buyer's BT-48, the AE line rate, or the AE BT-120.
const MIXED_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-mixed-ubl-missing-buyer-bt48': { syntax: 'ubl', base: 's-standard-and-reverse-charge', mutate: (x) => fromMarker(x, UBL_BUYER, (s) => removeElement(s, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m)), codes: ['BR-AE-02'] },
  'control-mixed-ubl-ae-line-rate-19': { syntax: 'ubl', base: 's-standard-and-reverse-charge', mutate: (x) => x.replace(/(<cac:ClassifiedTaxCategory>\n *<cbc:ID>AE<\/cbc:ID>\n *<cbc:Percent>)0</g, '$119<'), codes: ['BR-AE-05'] },
  'control-mixed-ubl-missing-bt120': { syntax: 'ubl', base: 's-standard-and-reverse-charge', mutate: (x) => removeElement(x, /^ *<cbc:TaxExemptionReason>.*<\/cbc:TaxExemptionReason>\n/m), codes: ['BR-AE-10'] },
  'control-mixed-cii-missing-buyer-bt48': { syntax: 'cii', base: 's-standard-and-reverse-charge', mutate: (x) => fromMarker(x, CII_BUYER, (s) => removeElement(s, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m)), codes: ['BR-AE-02'] },
  'control-mixed-cii-ae-line-rate-19': { syntax: 'cii', base: 's-standard-and-reverse-charge', mutate: (x) => x.replace(/(<ram:CategoryCode>AE<\/ram:CategoryCode>\n *<ram:RateApplicablePercent>)0</g, '$119<'), codes: ['BR-AE-05'] },
  'control-mixed-cii-missing-bt120': { syntax: 'cii', base: 's-standard-and-reverse-charge', mutate: (x) => removeElement(x, /^ *<ram:ExemptionReason>.*<\/ram:ExemptionReason>\n/m), codes: ['BR-AE-10'] },
};
// Credit note 381 (MDR-35). Each control breaks one rule the 381 slice newly exercises while the rest of the credit note stays
// intact. The domain refuses to generate all of these documents, so they are derived from the golden text:
// a 381 under an Invoice root (BR-CL-01: the document type code must match the root), a CreditNote with a root DueDate
// (XSD: BT-9 belongs in PaymentMeans), a BG-3 without BT-25 (BR-55 in CII, XSD in UBL), and a transfer code 30 without
// BG-17 (the account the domain never writes for a 381; BR-61 and CII-SR-470 with BR-DE-23-a).
const CREDIT_NOTE_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-cn-ubl-381-under-invoice-root': {
    syntax: 'ubl', base: 't-credit-note-full-reversal', scenario: SCENARIOS.ubl, codes: ['BR-CL-01'],
    mutate: (x) => x.replace(/<CreditNote xmlns="[^"]*CreditNote-2"/, '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"').replace('</CreditNote>', '</Invoice>').replaceAll('CreditNoteTypeCode', 'InvoiceTypeCode').replaceAll('CreditNoteLine', 'InvoiceLine').replaceAll('CreditedQuantity', 'InvoicedQuantity'),
  },
  'control-cn-ubl-root-duedate': { syntax: 'ubl', base: 't-credit-note-full-reversal', mutate: (x) => replaceExact(x, '  <cbc:CreditNoteTypeCode>', '  <cbc:DueDate>2026-10-24</cbc:DueDate>\n  <cbc:CreditNoteTypeCode>'), codes: ['cvc-complex-type.2.4.a'] },
  'control-cn-ubl-bg3-without-bt25': { syntax: 'ubl', base: 't-credit-note-full-reversal', mutate: (x) => removeElement(x, /^ *<cbc:ID>RE-2026-0001<\/cbc:ID>\n/m), codes: ['cvc-complex-type.2.4.a'] },
  'control-cn-cii-bg3-without-bt25': { syntax: 'cii', base: 't-credit-note-full-reversal', mutate: (x) => removeElement(x, /^ *<ram:IssuerAssignedID>.*<\/ram:IssuerAssignedID>\n/m), codes: ['BR-55'] },
  'control-cn-ubl-transfer-without-bg17': { syntax: 'ubl', base: 't-credit-note-full-reversal', mutate: (x) => replaceExact(x, '<cbc:PaymentMeansCode>97<', '<cbc:PaymentMeansCode>30<'), codes: ['BR-61', 'BR-DE-23-a'] },
  'control-cn-cii-transfer-without-bg17': { syntax: 'cii', base: 't-credit-note-full-reversal', mutate: (x) => replaceExact(x, '<ram:TypeCode>97<', '<ram:TypeCode>30<'), codes: ['CII-SR-470', 'BR-DE-23-a'] },
};
// BT-11, BT-12, BT-13 (MDR-36). The validator checks these references by schema only, so each control breaks the structure the
// serializers must get right: the CII project without its required Name, a UBL order reference without its ID, and a UBL
// CreditNote that carries the Invoice binding `cac:ProjectReference` (an element the CreditNote schema does not have).
const REFERENCE_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-ref-cii-project-without-name': { syntax: 'cii', base: 'x-references-all-three', mutate: (x) => removeElement(x, /^ *<ram:Name>Project reference<\/ram:Name>\n/m), codes: ['cvc-complex-type.2.4.b'] },
  'control-ref-ubl-order-without-id': { syntax: 'ubl', base: 'x-references-all-three', mutate: (x) => removeElement(x, /^ *<cbc:ID>PO-4711<\/cbc:ID>\n/m), codes: ['cvc-complex-type.2.4.b'] },
  'control-ref-ubl-381-invoice-style-project': {
    syntax: 'ubl', base: 'y-credit-note-references-all-three', codes: ['cvc-complex-type.2.4.a'],
    mutate: (x) => x.replace(/ *<cac:AdditionalDocumentReference>\n *<cbc:ID>PRJ-2026-77<\/cbc:ID>\n *<cbc:DocumentTypeCode>50<\/cbc:DocumentTypeCode>\n *<\/cac:AdditionalDocumentReference>\n/, '  <cac:ProjectReference>\n    <cbc:ID>PRJ-2026-77</cbc:ID>\n  </cac:ProjectReference>\n'),
  },
};
// Invoicing period BG-14 (MDR-37). The domain refuses to build any of these, so each is a controlled mutation of a period
// golden: a reversed period (BR-29) across a leap day on the 380 (zb: 2024-02-29) and within a month on the 381 (zc), in
// both syntaxes; an empty period element (BR-CO-19); the period moved out of its XSD position (UBL after OrderReference,
// CII after the payment terms); and a CII document without the required ApplicableHeaderTradeDelivery.
const UBL_LEAP_DAY = '    <cbc:StartDate>2024-02-29</cbc:StartDate>\n    <cbc:EndDate>2024-02-29</cbc:EndDate>\n';
const CII_LEAP_END = '<ram:EndDateTime>\n          <udt:DateTimeString format="102">20240229<';
const UBL_PERIOD = /^ *<cac:InvoicePeriod>\n(?:.*\n){2} *<\/cac:InvoicePeriod>\n/m;
const CII_PERIOD = /^ *<ram:BillingSpecifiedPeriod>\n(?:.*\n){6} *<\/ram:BillingSpecifiedPeriod>\n/m;
const movedAfter = (xml: string, element: RegExp, anchor: string): string => {
  const moved = element.exec(xml)?.[0];
  if (moved === undefined) fail('a control mutation found no element to move');
  return replaceExact(removeElement(xml, element), anchor, `${anchor}${moved}`);
};
const PERIOD_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-period-ubl-reversed-leap-day': { syntax: 'ubl', base: 'zb-period-single-day-leap', mutate: (x) => replaceExact(x, UBL_LEAP_DAY, '    <cbc:StartDate>2024-02-29</cbc:StartDate>\n    <cbc:EndDate>2024-02-28</cbc:EndDate>\n'), codes: ['BR-29'] },
  'control-period-cii-reversed-leap-day': { syntax: 'cii', base: 'zb-period-single-day-leap', mutate: (x) => replaceExact(x, CII_LEAP_END, CII_LEAP_END.replace('20240229', '20240228')), codes: ['BR-29'] },
  'control-period-ubl-381-reversed': { syntax: 'ubl', base: 'zc-credit-note-period-month-references', mutate: (x) => replaceExact(x, '<cbc:EndDate>2026-09-30<', '<cbc:EndDate>2026-08-31<'), codes: ['BR-29'] },
  'control-period-cii-381-reversed': { syntax: 'cii', base: 'zc-credit-note-period-month-references', mutate: (x) => replaceExact(x, 'format="102">20260930<', 'format="102">20260831<'), codes: ['BR-29'] },
  'control-period-ubl-empty': { syntax: 'ubl', base: 'za-period-month-references', mutate: (x) => x.replace(UBL_PERIOD, '  <cac:InvoicePeriod></cac:InvoicePeriod>\n'), codes: ['BR-CO-19'] },
  'control-period-cii-empty': { syntax: 'cii', base: 'za-period-month-references', mutate: (x) => x.replace(CII_PERIOD, '      <ram:BillingSpecifiedPeriod></ram:BillingSpecifiedPeriod>\n'), codes: ['BR-CO-19'] },
  'control-period-ubl-after-order-reference': { syntax: 'ubl', base: 'za-period-month-references', mutate: (x) => movedAfter(x, UBL_PERIOD, '  </cac:OrderReference>\n'), codes: ['cvc-complex-type.2.4.a'] },
  'control-period-cii-after-payment-terms': { syntax: 'cii', base: 'za-period-month-references', mutate: (x) => movedAfter(x, CII_PERIOD, '      </ram:SpecifiedTradePaymentTerms>\n'), codes: ['cvc-complex-type.2.4.a'] },
  'control-period-cii-without-delivery': { syntax: 'cii', base: 'za-period-month-references', mutate: (x) => removeElement(x, /^ *<ram:ApplicableHeaderTradeDelivery><\/ram:ApplicableHeaderTradeDelivery>\n/m), codes: ['cvc-complex-type.2.4.a'] },
};
// Structured Skonto (MDR-39). The domain never writes these lines, so each control is a labelled mutation of the zh golden
// (three tiers after free text, with BT-9) that breaks the BR-DE-18 format in one way.
const SKONTO_BASE = 'zh-skonto-tiers-terms-due-date';
const SKONTO_LAST_LINE = '#SKONTO#TAGE=28#PROZENT=1.00#\n';
const SKONTO_MUTATIONS: Record<string, (xml: string, closing: string) => string> = {
  'no-final-lf': (x, closing) => replaceExact(x, `${SKONTO_LAST_LINE}${closing}`, `${SKONTO_LAST_LINE.trimEnd()}${closing}`),
  'comma-decimal': (x) => replaceExact(x, '#PROZENT=2.25#', '#PROZENT=2,25#'),
  lowercase: (x) => replaceExact(x, '#SKONTO#TAGE=14#', '#skonto#tage=14#'),
  'malformed-segment': (x) => replaceExact(x, '#TAGE=14#PROZENT=2.25#', '#TAGE=14#2.25#'),
};
const SKONTO_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = Object.fromEntries(
  Object.entries(SKONTO_MUTATIONS).flatMap(([label, mutate]) => [
    [`control-skonto-ubl-${label}`, { syntax: 'ubl' as const, base: SKONTO_BASE, mutate: (x: string) => mutate(x, '</cbc:Note>'), codes: ['BR-DE-18'] }],
    [`control-skonto-cii-${label}`, { syntax: 'cii' as const, base: SKONTO_BASE, mutate: (x: string) => mutate(x, '</ram:Description>'), codes: ['BR-DE-18'] }],
  ]),
);
const SPECIAL_CONTROLS = { ...KLEINUNTERNEHMER_CONTROLS, ...REVERSE_CHARGE_CONTROLS, ...PAYMENT_MEANS_CONTROLS, ...EVIDENCE_CONTROLS, ...MIXED_CONTROLS, ...CREDIT_NOTE_CONTROLS, ...REFERENCE_CONTROLS, ...PERIOD_CONTROLS, ...SKONTO_CONTROLS };
const REQUIRED_STEPS = ['val-xsd', 'val-sch.1', 'val-sch.2', 'val-xml'];

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const sha256Base64 = (data: Buffer | string): string => createHash('sha256').update(data).digest('base64');

function fail(message: string): never {
  console.error(`kosit: ${message}`);
  process.exit(2);
}

export function run(command: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  // A hung validator ends as a failed run (status null) instead of hanging the harness.
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  if (result.error) fail(`cannot run ${command}: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function verifiedHash(file: string, expected: string, what: string): void {
  const actual = sha256Hex(readFileSync(file));
  if (actual !== expected) fail(`${what} hash mismatch: expected ${expected}, found ${actual}`);
}

// ---------------------------------------------------------------------------------------------- tooling

export type Tooling = { jar: string; configuration: string; javaVersion: string; configurationDirectory: string };

export function prepareTooling(manifest: Manifest): Tooling {
  const bundle = process.env.ORKAID_KOSIT_BUNDLE;
  if (!bundle) fail('set ORKAID_KOSIT_BUNDLE to the local official bundle zip (see tools/kosit/kosit-manifest.json).');
  if (!existsSync(bundle)) fail(`ORKAID_KOSIT_BUNDLE does not exist: ${basename(bundle)}`);
  verifiedHash(bundle, manifest.bundle.sha256, 'bundle');

  const directory = join(CACHE, manifest.bundle.sha256.slice(0, 12));
  const jar = join(directory, manifest.validator.archiveEntry);
  const configurationZip = join(directory, manifest.configuration.archiveEntry);
  const configurationDirectory = join(directory, 'config');
  mkdirSync(directory, { recursive: true });

  if (!existsSync(jar) || !existsSync(configurationZip)) {
    const extracted = run('unzip', ['-o', '-q', bundle, manifest.validator.archiveEntry, manifest.configuration.archiveEntry, '-d', directory]);
    if (extracted.status !== 0) fail(`unzip of the bundle failed: ${extracted.stderr.trim()}`);
  }
  verifiedHash(jar, manifest.validator.sha256, 'validator jar');
  verifiedHash(configurationZip, manifest.configuration.sha256, 'validator configuration');
  // The configuration is extracted afresh from the hash-verified zip on every run, never reused from an earlier one.
  rmSync(configurationDirectory, { recursive: true, force: true });
  const extractedConfiguration = run('unzip', ['-o', '-q', configurationZip, '-d', configurationDirectory]);
  if (extractedConfiguration.status !== 0) fail(`unzip of the configuration failed: ${extractedConfiguration.stderr.trim()}`);

  const java = run('java', ['-version']);
  const javaVersion = (java.stderr || java.stdout).split('\n')[0]?.trim() ?? 'unknown';
  const major = /version "(?:1\.)?(\d+)/.exec(javaVersion)?.[1];
  if (major === undefined || BigInt(major) < BigInt(manifest.validator.minimumJava)) fail(`Java ${manifest.validator.minimumJava}+ required, found: ${javaVersion}`);

  return { jar, configuration: join(configurationDirectory, manifest.configuration.scenarios), javaVersion, configurationDirectory };
}

// The domain lists the unit codes it supports; each must be in the validator configuration's own code list (rule BR-CL-23).
function verifyUnitCodes(configurationDirectory: string): void {
  const stylesheet = readFileSync(join(configurationDirectory, 'resources/ubl/2.1/xsl/EN16931-UBL-validation.xsl'), 'utf8');
  const at = stylesheet.indexOf('id="BR-CL-23"');
  const start = stylesheet.lastIndexOf('<xsl:if test="', at);
  const list = /contains\(' ([^']+) '/.exec(stylesheet.slice(start, at))?.[1]?.split(' ');
  if (at < 0 || list === undefined) fail('cannot find the BR-CL-23 unit code list in the validator configuration');
  const missing = UNIT_CODES.filter((code) => !list.includes(code));
  if (missing.length > 0) fail(`unit codes not in the validator configuration list: ${missing.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------- documents

type Target = { name: string; syntax: Syntax; xmlPath: string; xml: string; fixtureInput?: string; expectAccept: boolean; expectCodes?: readonly string[]; scenario?: string };

function generate(name: AnyFixtureName, syntax: Syntax): string {
  const built = buildInvoice(loadFixtureInput(name), isLeitwegFixture(name) ? { buyerReferencePolicy: 'leitweg-id' } : {});
  if (!built.ok) fail(`fixture ${name} does not build: ${JSON.stringify(built.errors)}`);
  const serialized = syntax === 'ubl' ? serializeUblInvoice(built.value) : serializeCiiInvoice(built.value);
  if (!serialized.ok) fail(`fixture ${name} does not serialize`);
  return serialized.xml;
}

function fixtureTarget(name: AnyFixtureName, syntax: Syntax): Target {
  const goldenPath = join(GOLDEN, `${syntax === 'ubl' ? name : ciiName(name)}.xml`);
  if (!existsSync(goldenPath)) fail(`missing golden file ${goldenPath}`);
  const golden = readFileSync(goldenPath, 'utf8');

  // The XML that is validated must be the XML the serializer generates from the fixture, byte for byte.
  if (generate(name, syntax) !== golden) fail(`fixture ${name}: the generated ${syntax} XML differs from ${goldenPath}`);

  return { name: syntax === 'ubl' ? name : ciiName(name), syntax, xmlPath: goldenPath, xml: golden, fixtureInput: readFileSync(join(ROOT, `tests/fixtures/xrechnung/${name}.json`), 'utf8'), expectAccept: true, ...(isCreditNoteFixture(name) && syntax === 'ubl' ? { scenario: UBL_CREDIT_NOTE_SCENARIO } : {}) };
}

function writeControl(name: string, syntax: Syntax, xml: string, expectCodes: readonly string[], scenario?: string): Target {
  const directory = join(CACHE, 'work');
  mkdirSync(directory, { recursive: true });
  const xmlPath = join(directory, `${name}.xml`);
  writeFileSync(xmlPath, xml);
  return { name, syntax, xmlPath, xml, expectAccept: false, expectCodes, ...(scenario !== undefined ? { scenario } : {}) };
}

function specialControlTarget(name: string): Target {
  const control = SPECIAL_CONTROLS[name];
  if (control === undefined) fail(`unknown control ${name}`);
  // The base is the committed golden, after it has been proven equal to the generated document.
  // A control that is meant to match another scenario says so; otherwise it must still match its base's scenario.
  const scenario = control.scenario ?? (isCreditNoteFixture(control.base) && control.syntax === 'ubl' ? UBL_CREDIT_NOTE_SCENARIO : undefined);
  return writeControl(name, control.syntax, control.mutate(fixtureTarget(control.base, control.syntax).xml), control.codes, scenario);
}

function controlTarget(): Target {
  const golden = readFileSync(join(GOLDEN, 'a-simple.xml'), 'utf8');
  const control = golden.replace(/^ *<cbc:BuyerReference>.*<\/cbc:BuyerReference>\n/m, '');
  if (control === golden) fail('the control document could not be derived from a-simple.xml');
  return writeControl(CONTROL_NAME, 'ubl', control, ['BR-DE-15']);
}

// ---------------------------------------------------------------------------------------------- validation

/** Runs the validator once on one file and reads its report. Shared with tools/cii-experiment/run.ts. */
export function runValidator(name: string, xmlPath: string, tooling: Tooling): { executed: ReturnType<typeof run>; reportText: string | undefined; report: ParsedReport | undefined; problems: string[] } {
  // A report left by an earlier run must never be mistaken for this run's result.
  const outputDirectory = join(CACHE, 'reports', name);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const executed = run('java', ['-jar', tooling.jar, '-s', tooling.configuration, '-r', tooling.configurationDirectory, '-o', outputDirectory, '-h', resolve(xmlPath)]);

  const reportPath = join(outputDirectory, `${basename(xmlPath, '.xml')}-report.xml`);
  // A real report is a few tens of kilobytes; the parser is only meant for such machine-generated files.
  const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined;
  const problems: string[] = [];
  if (reportText !== undefined && reportText.length > 2_000_000) problems.push('the validator report is unexpectedly large and was not parsed');
  const report: ParsedReport | undefined = reportText !== undefined && reportText.length <= 2_000_000 ? parseReport(reportText) : undefined;
  return { executed, reportText, report, problems };
}

function validate(target: Target, tooling: Tooling, manifest: Manifest, triage: Triage) {
  const { executed, reportText, report, problems } = runValidator(target.name, target.xmlPath, tooling);
  const triaged: { code: string; level: string; disposition: string }[] = [];

  // The exit code is a separate result. It does not prove acceptance, but a validator run that failed to complete
  // normally invalidates the run: an accepted document must end with 0, and the rejected control with a nonzero code
  // (1 with validator 1.6.3, as observed).
  if (target.expectAccept && executed.status !== 0) problems.push(`the validator exited with ${executed.status}, expected 0`);
  if (!target.expectAccept && (executed.status === 0 || executed.status === null)) problems.push(`the validator exited with ${executed.status} for a document it should reject`);

  if (report === undefined) {
    if (reportText === undefined) problems.push('the validator wrote no report');
  } else {
    const expectedScenario = target.scenario ?? SCENARIOS[target.syntax];
    if (report.scenario !== expectedScenario) problems.push(`matched scenario is "${report.scenario}", expected "${expectedScenario}"`);
    if (report.documentHashSha256Base64 !== sha256Base64(target.xml)) problems.push('the validator hashed different bytes than the ones that were generated');
    if (report.engine !== `KoSIT Validator ${manifest.validator.version}`) problems.push(`engine is "${report.engine}"`);

    if (target.expectAccept) {
      for (const id of REQUIRED_STEPS) if (!report.steps.some((s) => s.id === id)) problems.push(`validation step ${id} is missing from the report`);
      for (const step of report.steps) if (!step.valid) problems.push(`validation step ${step.id} is not valid`);
      if (report.valid !== true) problems.push('the report is not valid');
      if (report.assessment !== 'accept') problems.push(`assessment is ${report.assessment}`);
      for (const message of report.messages) {
        const entry = (triage[target.name] ?? []).find((t) => t.code === message.code && t.level === message.level);
        if (message.level !== 'information') problems.push(`${message.level} ${message.code}: ${message.text}`);
        else if (entry === undefined) problems.push(`untriaged information message ${message.code}: ${message.text}`);
        else triaged.push(entry);
      }
    } else {
      // Control: the harness must be able to say no.
      if (report.assessment !== 'reject') problems.push(`the control document was not rejected (assessment ${report.assessment})`);
      for (const code of target.expectCodes ?? []) if (!report.messages.some((m) => m.code === code)) problems.push(`the control document did not trigger ${code}`);
    }
  }

  const evidence = {
    document: target.name,
    role: target.expectAccept ? 'positive fixture' : 'negative control',
    fixtureInputSha256: target.fixtureInput === undefined ? undefined : sha256Hex(target.fixtureInput),
    xmlFile: basename(target.xmlPath),
    xmlSha256: sha256Hex(target.xml),
    validator: { version: manifest.validator.version, engine: report?.engine, jarSha256: manifest.validator.sha256 },
    configuration: { version: manifest.configuration.version, archiveSha256: manifest.configuration.sha256 },
    java: tooling.javaVersion,
    scenarioMatched: report?.scenario,
    steps: report?.steps,
    reportValid: report?.valid,
    assessment: report?.assessment,
    messages: report?.messages,
    triage: triaged,
    processExitCode: executed.status,
    stdout: executed.stdout.slice(0, 20000),
    stderr: executed.stderr.slice(0, 20000),
    pass: problems.length === 0,
    problems,
  };
  mkdirSync(join(CACHE, 'evidence'), { recursive: true });
  writeFileSync(join(CACHE, 'evidence', `${target.name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function main(): void {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tools/kosit/kosit-manifest.json'), 'utf8')) as Manifest;
  const triage = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/xrechnung/kosit-triage.json'), 'utf8')) as Triage;
  const requested = process.argv.slice(2);
  const allNames = [...FIXTURE_NAMES, ...CII_FIXTURES.map(ciiName), ...CREDIT_NOTE_FIXTURE_NAMES, ...CREDIT_NOTE_FIXTURE_NAMES.map(ciiName), ...REFERENCE_FIXTURE_NAMES, ...REFERENCE_FIXTURE_NAMES.map(ciiName), ...PERIOD_FIXTURE_NAMES, ...PERIOD_FIXTURE_NAMES.map(ciiName), ...CREDIT_NOTE_PERIOD_FIXTURE_NAMES, ...CREDIT_NOTE_PERIOD_FIXTURE_NAMES.map(ciiName), ...LEITWEG_FIXTURE_NAMES, ...LEITWEG_FIXTURE_NAMES.map(ciiName), ...SKONTO_FIXTURE_NAMES, ...SKONTO_FIXTURE_NAMES.map(ciiName), CONTROL_NAME, ...Object.keys(SPECIAL_CONTROLS)];
  const names = requested.length > 0 ? requested : allNames;
  for (const name of names) if (!allNames.includes(name)) fail(`unknown fixture ${name}`);

  const tooling = prepareTooling(manifest);
  verifyUnitCodes(tooling.configurationDirectory);
  console.log(`${tooling.javaVersion} | validator ${manifest.validator.version} | configuration ${manifest.configuration.version}`);

  let allPassed = true;
  for (const name of names) {
    const target =
      name === CONTROL_NAME
        ? controlTarget()
        : name in SPECIAL_CONTROLS
          ? specialControlTarget(name)
          : name.endsWith('.cii')
            ? fixtureTarget(name.slice(0, -'.cii'.length) as FixtureName, 'cii')
            : fixtureTarget(name as FixtureName, 'ubl');
    const evidence = validate(target, tooling, manifest, triage);
    allPassed &&= evidence.pass;
    console.log(
      `${evidence.pass ? 'PASS' : 'FAIL'} ${target.name.padEnd(34)} exit=${evidence.processExitCode} valid=${evidence.reportValid} assessment=${evidence.assessment} messages=${evidence.messages?.length ?? '-'} xml=${evidence.xmlSha256.slice(0, 12)}`,
    );
    for (const message of evidence.messages ?? []) console.log(`       ${message.level} ${message.code}`);
    for (const problem of evidence.problems) console.log(`       problem: ${problem}`);
  }
  console.log(`evidence: ${CACHE}/evidence/`);
  process.exit(allPassed ? 0 : 1);
}

if (import.meta.main) main();
