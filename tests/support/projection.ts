// Normalized semantic projection of generated UBL and CII (PROTOCOL.md section 5 of the preregistered Increment 3
// experiment, tests/fixtures/xrechnung/cii-experiment). It reads the XML independently of the serializers, with the
// paths of the frozen table, and never repairs a value: a missing, repeated or malformed value is an extraction
// error, not a guess. Also holds the comparator, the monetary oracle comparison and the structural binding checks,
// which are separate from semantic equality.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { one, parseXml, renderXml, select, type XmlNode } from './xml.ts';

export type Syntax = 'ubl' | 'cii';
export type Projection = { [key: string]: string | Projection };
export type Extraction = { projection: Projection; lexical: Record<string, string>; errors: string[] };

const PACKAGE = resolve(import.meta.dirname, '../fixtures/xrechnung/cii-experiment');
export const loadPackageJson = <T>(name: string): T => JSON.parse(readFileSync(resolve(PACKAGE, name), 'utf8')) as T;

// ------------------------------------------------------------------------------------------------ paths

// kind: text is exact; decimal is normalized to its minimal exact form; date is ISO in UBL; date102 is CII
// DateTimeString[@format='102'] with 8 digits. `attribute` reads that attribute of the element instead of its text.
type Kind = 'text' | 'decimal' | 'date' | 'date102';
type Field = { readonly path: string; readonly kind: Kind; readonly attribute?: string };
type Table = {
  readonly root: string;
  readonly header: Record<string, Field>;
  readonly seller: string;
  readonly buyer: string;
  readonly party: Record<string, Field>; // relative to a party; BT numbers of the seller
  readonly sellerOnly: Record<string, Field>;
  readonly vatId: { readonly path: string; readonly where: (node: XmlNode) => boolean; readonly value: string };
  readonly lines: string;
  readonly line: Record<string, Field>;
  readonly buckets: string;
  readonly bucketFilter: (node: XmlNode) => boolean;
  readonly bucket: Record<string, Field>;
  readonly totals: Record<string, Field>;
};

const t = (path: string, kind: Kind = 'text', attribute?: string): Field => ({ path, kind, ...(attribute ? { attribute } : {}) });
const textIs = (path: string, value: string) => (node: XmlNode): boolean => select(node, path).some((n) => n.text === value);

const UBL_PARTY = 'cac:Party';
const UBL: Table = {
  root: 'Invoice',
  header: {
    'BT-1': t('cbc:ID'), 'BT-2': t('cbc:IssueDate', 'date'), 'BT-3': t('cbc:InvoiceTypeCode'), 'BT-5': t('cbc:DocumentCurrencyCode'),
    'BT-9': t('cbc:DueDate', 'date'), 'BT-10': t('cbc:BuyerReference'), 'BT-23': t('cbc:ProfileID'), 'BT-24': t('cbc:CustomizationID'),
    'BT-72': t('cac:Delivery/cbc:ActualDeliveryDate', 'date'),
    'BG-16/BT-81': t('cac:PaymentMeans/cbc:PaymentMeansCode'), 'BG-16/BT-84': t('cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID'),
  },
  seller: 'cac:AccountingSupplierParty',
  buyer: 'cac:AccountingCustomerParty',
  party: {
    'BT-27': t(`${UBL_PARTY}/cac:PartyLegalEntity/cbc:RegistrationName`), 'BT-34': t(`${UBL_PARTY}/cbc:EndpointID`),
    'BT-34-1': t(`${UBL_PARTY}/cbc:EndpointID`, 'text', 'schemeID'), 'BT-35': t(`${UBL_PARTY}/cac:PostalAddress/cbc:StreetName`),
    'BT-37': t(`${UBL_PARTY}/cac:PostalAddress/cbc:CityName`), 'BT-38': t(`${UBL_PARTY}/cac:PostalAddress/cbc:PostalZone`),
    'BT-40': t(`${UBL_PARTY}/cac:PostalAddress/cac:Country/cbc:IdentificationCode`),
  },
  sellerOnly: {
    'BT-41': t(`${UBL_PARTY}/cac:Contact/cbc:Name`), 'BT-42': t(`${UBL_PARTY}/cac:Contact/cbc:Telephone`),
    'BT-43': t(`${UBL_PARTY}/cac:Contact/cbc:ElectronicMail`),
  },
  vatId: { path: `${UBL_PARTY}/cac:PartyTaxScheme`, where: textIs('cac:TaxScheme/cbc:ID', 'VAT'), value: 'cbc:CompanyID' },
  lines: 'cac:InvoiceLine',
  line: {
    'BT-126': t('cbc:ID'), 'BT-153': t('cac:Item/cbc:Name'), 'BT-129': t('cbc:InvoicedQuantity', 'decimal'),
    'BT-130': t('cbc:InvoicedQuantity', 'text', 'unitCode'), 'BT-146': t('cac:Price/cbc:PriceAmount', 'decimal'),
    'BT-151': t('cac:Item/cac:ClassifiedTaxCategory/cbc:ID'), 'BT-152': t('cac:Item/cac:ClassifiedTaxCategory/cbc:Percent', 'decimal'),
    'BT-131': t('cbc:LineExtensionAmount', 'decimal'),
  },
  buckets: 'cac:TaxTotal/cac:TaxSubtotal',
  bucketFilter: () => true,
  bucket: {
    'BT-118': t('cac:TaxCategory/cbc:ID'), 'BT-119': t('cac:TaxCategory/cbc:Percent', 'decimal'),
    'BT-116': t('cbc:TaxableAmount', 'decimal'), 'BT-117': t('cbc:TaxAmount', 'decimal'),
  },
  totals: {
    'BT-106': t('cac:LegalMonetaryTotal/cbc:LineExtensionAmount', 'decimal'), 'BT-109': t('cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount', 'decimal'),
    'BT-110': t('cac:TaxTotal/cbc:TaxAmount', 'decimal'), 'BT-112': t('cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', 'decimal'),
    'BT-115': t('cac:LegalMonetaryTotal/cbc:PayableAmount', 'decimal'),
  },
};

const TX = 'rsm:SupplyChainTradeTransaction';
const HA = `${TX}/ram:ApplicableHeaderTradeAgreement`;
const HD = `${TX}/ram:ApplicableHeaderTradeDelivery`;
const HS = `${TX}/ram:ApplicableHeaderTradeSettlement`;
const MS = `${HS}/ram:SpecifiedTradeSettlementHeaderMonetarySummation`;
const PM = `${HS}/ram:SpecifiedTradeSettlementPaymentMeans`;
const CII: Table = {
  root: 'rsm:CrossIndustryInvoice',
  header: {
    'BT-1': t('rsm:ExchangedDocument/ram:ID'), 'BT-2': t('rsm:ExchangedDocument/ram:IssueDateTime', 'date102'),
    'BT-3': t('rsm:ExchangedDocument/ram:TypeCode'), 'BT-5': t(`${HS}/ram:InvoiceCurrencyCode`),
    'BT-9': t(`${HS}/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime`, 'date102'), 'BT-10': t(`${HA}/ram:BuyerReference`),
    'BT-23': t('rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID'),
    'BT-24': t('rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID'),
    'BT-72': t(`${HD}/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime`, 'date102'),
    'BG-16/BT-81': t(`${PM}/ram:TypeCode`), 'BG-16/BT-84': t(`${PM}/ram:PayeePartyCreditorFinancialAccount/ram:IBANID`),
  },
  seller: `${HA}/ram:SellerTradeParty`,
  buyer: `${HA}/ram:BuyerTradeParty`,
  party: {
    'BT-27': t('ram:Name'), 'BT-34': t('ram:URIUniversalCommunication/ram:URIID'),
    'BT-34-1': t('ram:URIUniversalCommunication/ram:URIID', 'text', 'schemeID'), 'BT-35': t('ram:PostalTradeAddress/ram:LineOne'),
    'BT-37': t('ram:PostalTradeAddress/ram:CityName'), 'BT-38': t('ram:PostalTradeAddress/ram:PostcodeCode'),
    'BT-40': t('ram:PostalTradeAddress/ram:CountryID'),
  },
  sellerOnly: {
    'BT-41': t('ram:DefinedTradeContact/ram:PersonName'), 'BT-42': t('ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber'),
    'BT-43': t('ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID'),
  },
  vatId: { path: 'ram:SpecifiedTaxRegistration', where: (node) => select(node, 'ram:ID').some((n) => n.attributes.schemeID === 'VA'), value: 'ram:ID' },
  lines: `${TX}/ram:IncludedSupplyChainTradeLineItem`,
  line: {
    'BT-126': t('ram:AssociatedDocumentLineDocument/ram:LineID'), 'BT-153': t('ram:SpecifiedTradeProduct/ram:Name'),
    'BT-129': t('ram:SpecifiedLineTradeDelivery/ram:BilledQuantity', 'decimal'),
    'BT-130': t('ram:SpecifiedLineTradeDelivery/ram:BilledQuantity', 'text', 'unitCode'),
    'BT-146': t('ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount', 'decimal'),
    'BT-151': t('ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode'),
    'BT-152': t('ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent', 'decimal'),
    'BT-131': t('ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount', 'decimal'),
  },
  buckets: `${HS}/ram:ApplicableTradeTax`,
  bucketFilter: textIs('ram:TypeCode', 'VAT'),
  bucket: {
    'BT-118': t('ram:CategoryCode'), 'BT-119': t('ram:RateApplicablePercent', 'decimal'),
    'BT-116': t('ram:BasisAmount', 'decimal'), 'BT-117': t('ram:CalculatedAmount', 'decimal'),
  },
  totals: {
    'BT-106': t(`${MS}/ram:LineTotalAmount`, 'decimal'), 'BT-109': t(`${MS}/ram:TaxBasisTotalAmount`, 'decimal'),
    'BT-110': t(`${MS}/ram:TaxTotalAmount`, 'decimal'), 'BT-112': t(`${MS}/ram:GrandTotalAmount`, 'decimal'),
    'BT-115': t(`${MS}/ram:DuePayableAmount`, 'decimal'),
  },
};

export const TABLES: Record<Syntax, Table> = { ubl: UBL, cii: CII };

// BT-23 and BT-24 are protocol constants and BT-5 is projected once (PROTOCOL.md section 5).
const HEADER_ORDER = ['BT-1', 'BT-2', 'BT-3', 'BT-5', 'BT-9', 'BT-10', 'BT-23', 'BT-24', 'BT-72'];
const BUYER_TERMS: Record<string, string> = { 'BT-27': 'BT-44', 'BT-34': 'BT-49', 'BT-34-1': 'BT-49-1', 'BT-35': 'BT-50', 'BT-37': 'BT-52', 'BT-38': 'BT-53', 'BT-40': 'BT-55' };

// ------------------------------------------------------------------------------------------------ normalization

/** Minimal exact form of an xs:decimal lexical value (`1.50` -> `1.5`, `0.00` -> `0`), or undefined if it is not one. */
export function normalizeDecimal(lexical: string): string | undefined {
  const match = /^([+-]?)([0-9]*)(?:\.([0-9]*))?$/.exec(lexical);
  if (!match || !/[0-9]/.test(lexical)) return undefined;
  const [, sign = '', integer = '', fraction = ''] = match;
  const int = integer.replace(/^0+/, '') || '0';
  const frac = fraction.replace(/0+$/, '');
  const value = frac === '' ? int : `${int}.${frac}`;
  return sign === '-' && value !== '0' ? `-${value}` : value;
}

function readField(node: XmlNode, field: Field, label: string, errors: string[], lexical: Record<string, string>): string | undefined {
  const found = select(node, field.path);
  if (found.length !== 1) {
    errors.push(`${label}: expected exactly one ${field.path}, found ${found.length}`);
    return undefined;
  }
  const element = found[0] as XmlNode;
  if (field.attribute !== undefined) {
    const value = element.attributes[field.attribute];
    if (value === undefined) errors.push(`${label}: attribute ${field.attribute} is missing`);
    return value;
  }
  if (field.kind === 'date102') {
    const strings = select(element, 'udt:DateTimeString');
    const string = strings[0];
    if (strings.length !== 1 || element.children.length !== 1 || string === undefined) return fail(`${label}: expected exactly one udt:DateTimeString`);
    if (string.attributes.format !== '102') return fail(`${label}: DateTimeString format is ${string.attributes.format ?? 'absent'}, not 102`);
    const digits = /^([0-9]{4})([0-9]{2})([0-9]{2})$/.exec(string.text);
    if (!digits) return fail(`${label}: DateTimeString "${string.text}" is not 8 digits`);
    return `${digits[1]}-${digits[2]}-${digits[3]}`;
  }
  if (element.children.length > 0) return fail(`${label}: ${field.path} has child elements`);
  if (field.kind === 'date') return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(element.text) ? element.text : fail(`${label}: "${element.text}" is not YYYY-MM-DD`);
  if (field.kind === 'decimal') {
    lexical[label] = element.text;
    return normalizeDecimal(element.text) ?? fail(`${label}: "${element.text}" is not an xs:decimal lexical value`);
  }
  return element.text;

  function fail(message: string): undefined {
    errors.push(message);
    return undefined;
  }
}

function readAll(node: XmlNode, fields: Record<string, Field>, prefix: string, errors: string[], lexical: Record<string, string>, rename: (term: string) => string = (x) => x): Projection {
  const out: Projection = {};
  for (const [term, field] of Object.entries(fields)) {
    const value = readField(node, field, `${prefix}${rename(term)}`, errors, lexical);
    if (value !== undefined) out[rename(term)] = value;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ extraction

export function extractProjection(xml: string, syntax: Syntax): Extraction {
  const errors: string[] = [];
  const lexical: Record<string, string> = {};
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (error) {
    return { projection: {}, lexical, errors: [`not readable: ${(error as Error).message}`] };
  }
  const table = TABLES[syntax];
  if (root.name !== table.root) return { projection: {}, lexical, errors: [`root is ${root.name}, expected ${table.root}`] };

  const projection: Projection = {};
  const header = readAll(root, table.header, '', errors, lexical);
  for (const term of HEADER_ORDER) if (header[term] !== undefined) projection[term] = header[term];

  const party = (path: string, role: 'BG-4' | 'BG-7'): Projection => {
    const nodes = select(root, path);
    if (nodes.length !== 1) {
      errors.push(`${role}: expected exactly one ${path}, found ${nodes.length}`);
      return {};
    }
    const node = nodes[0] as XmlNode;
    if (role === 'BG-7') return readAll(node, table.party, 'BG-7/', errors, lexical, (term) => BUYER_TERMS[term] ?? term);
    const out = { ...readAll(node, table.party, 'BG-4/', errors, lexical), ...readAll(node, table.sellerOnly, 'BG-4/', errors, lexical) };
    const schemes = select(node, table.vatId.path).filter(table.vatId.where);
    if (schemes.length !== 1) errors.push(`BG-4/BT-31: expected exactly one VAT registration, found ${schemes.length}`);
    else {
      const value = readField(schemes[0] as XmlNode, t(table.vatId.value), 'BG-4/BT-31', errors, lexical);
      if (value !== undefined) out['BT-31'] = value;
    }
    return out;
  };
  projection['BG-4'] = sortKeys(party(table.seller, 'BG-4'));
  projection['BG-7'] = sortKeys(party(table.buyer, 'BG-7'));
  projection['BG-16'] = { 'BT-81': header['BG-16/BT-81'] ?? '', 'BT-84': header['BG-16/BT-84'] ?? '' };

  const lines: Projection = {};
  for (const [index, node] of select(root, table.lines).entries()) {
    const values = readAll(node, table.line, `BG-25[${index}]/`, errors, lexical);
    const key = values['BT-126'];
    if (typeof key !== 'string') continue;
    if (key in lines) errors.push(`BG-25: duplicate BT-126 key ${key}`);
    delete values['BT-126'];
    lines[key] = values;
  }
  projection['BG-25'] = lines;

  const buckets: Projection = {};
  for (const [index, node] of select(root, table.buckets).filter(table.bucketFilter).entries()) {
    const values = readAll(node, table.bucket, `BG-23[${index}]/`, errors, lexical);
    const key = `${values['BT-118']}|${values['BT-119']}`;
    if (key in buckets) errors.push(`BG-23: duplicate key ${key}`);
    buckets[key] = values;
  }
  projection['BG-23'] = buckets;
  projection['BG-22'] = readAll(root, table.totals, 'BG-22/', errors, lexical);
  return { projection, lexical, errors };
}

function sortKeys(value: Projection): Projection {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Differences between two projections as paths, independent of key order. Empty means equal. */
export function compareProjections(expected: Projection, actual: Projection, prefix = ''): string[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  return keys.flatMap((key) => {
    const a = expected[key];
    const b = actual[key];
    const path = `${prefix}${key}`;
    if (typeof a === 'object' && typeof b === 'object') return compareProjections(a, b, `${path}/`);
    return a === b ? [] : [`${path}: expected ${JSON.stringify(a)}, found ${JSON.stringify(b)}`];
  });
}

/** BT-126 must be i + 1 for the i-th line in document order (checked on unmutated output only). */
export function lineIdsFollowOrder(xml: string, syntax: Syntax): boolean {
  const root = parseXml(xml);
  return select(root, TABLES[syntax].lines).every((node, index) => select(node, TABLES[syntax].line['BT-126']?.path ?? '')[0]?.text === String(index + 1));
}

// ------------------------------------------------------------------------------------------------ money

export type ExpectedMoney = {
  lines: { 'BT-126': string; 'BT-131': string }[];
  'BG-23': { 'BT-118': string; 'BT-119': string; 'BT-116': string; 'BT-117': string }[];
  'BG-22': Record<'BT-106' | 'BT-109' | 'BT-110' | 'BT-112' | 'BT-115', string>;
};

/** Every BT-106/109/110/112/115/116/117/131 of a projection against the frozen money oracle, by exact value. */
export function compareMoney(expected: ExpectedMoney, projection: Projection): string[] {
  const n = (value: string): string => normalizeDecimal(value) ?? `invalid:${value}`;
  const flat: Record<string, string> = {};
  for (const line of expected.lines) flat[`BG-25/${line['BT-126']}/BT-131`] = n(line['BT-131']);
  for (const bucket of expected['BG-23']) {
    const key = `${bucket['BT-118']}|${n(bucket['BT-119'])}`;
    flat[`BG-23/${key}/BT-116`] = n(bucket['BT-116']);
    flat[`BG-23/${key}/BT-117`] = n(bucket['BT-117']);
  }
  for (const [term, value] of Object.entries(expected['BG-22'])) flat[`BG-22/${term}`] = n(value);

  const actual: Record<string, string> = {};
  const lines = (projection['BG-25'] ?? {}) as Projection;
  for (const [key, line] of Object.entries(lines)) actual[`BG-25/${key}/BT-131`] = String((line as Projection)['BT-131']);
  const buckets = (projection['BG-23'] ?? {}) as Projection;
  for (const [key, bucket] of Object.entries(buckets)) {
    actual[`BG-23/${key}/BT-116`] = String((bucket as Projection)['BT-116']);
    actual[`BG-23/${key}/BT-117`] = String((bucket as Projection)['BT-117']);
  }
  for (const [term, value] of Object.entries((projection['BG-22'] ?? {}) as Projection)) actual[`BG-22/${term}`] = String(value);

  const keys = [...new Set([...Object.keys(flat), ...Object.keys(actual)])];
  return keys.filter((key) => flat[key] !== actual[key]).map((key) => `${key}: expected ${flat[key]}, found ${actual[key]}`);
}

// ------------------------------------------------------------------------------------------------ structure

const CII_NAMESPACES: Record<string, string> = {
  'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
};

type BindingChoices = { choices: { term: string; required: string; forbidden: string[] }[] };

/**
 * The frozen structural binding choices (binding-choices.json), checked on generated CII separately from the
 * projection. A violation here is SER (PROTOCOL.md section 9, step 2), whatever the projection says.
 */
export function checkCiiBindings(xml: string): { term: string; violation: string }[] {
  const root = parseXml(xml);
  const out: { term: string; violation: string }[] = [];
  for (const [prefix, uri] of Object.entries(CII_NAMESPACES)) {
    if (root.attributes[prefix] !== uri) out.push({ term: 'namespaces', violation: `${prefix} is not ${uri}` });
  }
  const at = (absolute: string): XmlNode[] => select(root, absolute.replace(/^\/rsm:CrossIndustryInvoice\//, ''));
  const { choices } = loadPackageJson<BindingChoices>('binding-choices.json');
  for (const choice of choices) {
    if (choice.required.startsWith('/')) {
      if (at(choice.required).length !== 1) out.push({ term: choice.term, violation: `required ${choice.required} is not present exactly once` });
      for (const forbidden of choice.forbidden) if (at(forbidden).length > 0) out.push({ term: choice.term, violation: `forbidden ${forbidden} is present` });
    }
  }
  for (const party of ['ram:SellerTradeParty', 'ram:BuyerTradeParty']) {
    const ids = select(root, `${HA}/${party}/ram:URIUniversalCommunication/ram:URIID`);
    if (ids.length !== 1 || ids[0]?.attributes.schemeID !== 'EM') out.push({ term: 'BT-34-1 / BT-49-1', violation: `${party} URIID/@schemeID is not EM` });
  }
  const dates = { 'BT-2': CII.header['BT-2'], 'BT-9': CII.header['BT-9'], 'BT-72': CII.header['BT-72'] };
  for (const [term, field] of Object.entries(dates)) {
    const strings = select(root, `${field?.path}/udt:DateTimeString`);
    if (strings.length !== 1 || strings[0]?.attributes.format !== '102' || !/^[0-9]{8}$/.test(strings[0]?.text ?? '')) {
      out.push({ term: 'BT-2 / BT-9 / BT-72', violation: `${term} is not one DateTimeString[@format='102'] with 8 digits` });
    }
  }
  // currencyID is validity, not projection: in CII only BT-110 carries it, and it must equal BT-5.
  const currency = select(root, CII.header['BT-5']?.path ?? '')[0]?.text;
  if (one(root, `${MS}/ram:TaxTotalAmount`).attributes.currencyID !== currency) out.push({ term: 'BT-110', violation: 'TaxTotalAmount/@currencyID is not BT-5' });
  return out;
}

/** UBL validity counterpart: every amount carries currencyID equal to BT-5. */
export function checkUblCurrency(xml: string): string[] {
  const root = parseXml(xml);
  const currency = one(root, 'cbc:DocumentCurrencyCode').text;
  const out: string[] = [];
  const visit = (node: XmlNode): void => {
    if (/Amount$/.test(node.name) && node.attributes.currencyID !== currency) out.push(`${node.name} currencyID ${node.attributes.currencyID}`);
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}

// ------------------------------------------------------------------------------------------------ mutation

/** Applies a mutation to the parsed tree and renders it back. Throws if the input does not round-trip or nothing changed. */
export function mutate(xml: string, change: (root: XmlNode) => void): string {
  const root = parseXml(xml);
  if (renderXml(root) !== xml) throw new Error('the document does not round-trip through the test reader');
  change(root);
  const mutated = renderXml(root);
  if (mutated === xml) throw new Error('the mutation changed nothing');
  return mutated;
}

/** The element holding the text of a header, BG-22 or party field (for a CII date, its DateTimeString). */
export function valueNode(root: XmlNode, syntax: Syntax, term: string): XmlNode {
  const table = TABLES[syntax];
  const field = table.header[term] ?? table.totals[term];
  if (field !== undefined) return field.kind === 'date102' ? one(one(root, field.path), 'udt:DateTimeString') : one(root, field.path);
  const buyerTerm = Object.entries(BUYER_TERMS).find(([, buyer]) => buyer === term)?.[0];
  const partyField = table.party[buyerTerm ?? term];
  if (partyField === undefined) throw new Error(`no path for ${term}`);
  return one(one(root, buyerTerm ? table.buyer : table.seller), partyField.path);
}

export function lineNodes(root: XmlNode, syntax: Syntax): XmlNode[] {
  return select(root, TABLES[syntax].lines);
}

export function lineValueNode(line: XmlNode, syntax: Syntax, term: string): XmlNode {
  const field = TABLES[syntax].line[term];
  if (field === undefined) throw new Error(`no line path for ${term}`);
  return one(line, field.path);
}

export function bucketNodes(root: XmlNode, syntax: Syntax): XmlNode[] {
  return select(root, TABLES[syntax].buckets).filter(TABLES[syntax].bucketFilter);
}

export function bucketValueNode(root: XmlNode, syntax: Syntax, key: string, term: string): XmlNode {
  const bucket = bucketNodes(root, syntax).find((node) => {
    const values = readAll(node, TABLES[syntax].bucket, '', [], {});
    return `${values['BT-118']}|${values['BT-119']}` === key;
  });
  const field = TABLES[syntax].bucket[term];
  if (bucket === undefined || field === undefined) throw new Error(`no bucket ${key} ${term}`);
  return one(bucket, field.path);
}

/** Replaces the children of `parent` that are in `items` by `reordered`, keeping all other children in place. */
export function reorderChildren(parent: XmlNode, items: readonly XmlNode[], reordered: readonly XmlNode[]): void {
  const queue = [...reordered];
  parent.children = parent.children.map((child) => (items.includes(child) ? (queue.shift() as XmlNode) : child));
}

export function parentOf(root: XmlNode, child: XmlNode): XmlNode {
  const search = (node: XmlNode): XmlNode | undefined => (node.children.includes(child) ? node : node.children.map(search).find(Boolean));
  const parent = search(root);
  if (parent === undefined) throw new Error('no parent');
  return parent;
}
