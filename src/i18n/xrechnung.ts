// German and English copy of the XRechnung workspace. German accounting terms are kept exactly (USt-IdNr., Steuernummer,
// Leistungsdatum); a view never mixes the two languages. Error texts are keyed by the domain's own diagnostic codes.

import type { DocumentErrorCode } from '../lib/domain/xrechnung/document.ts';
import type { VatBreakdown } from '../lib/domain/xrechnung/invoice.ts';
import type { Locale } from './ui.ts';

export type Msg = { readonly de: string; readonly en: string };
const m = (de: string, en: string): Msg => ({ de, en });

/** `{name}` placeholders. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export const copy = {
  pageTitle: m('XRechnung-Generator', 'XRechnung generator'),
  pageIntro: m(
    'Rechnung (Typ 380) im implementierten Profil erfassen und als UBL- oder CII-XML erzeugen. Die Eingaben bleiben in Ihrem Browser.',
    'Enter an invoice (type 380) in the implemented profile and generate UBL or CII XML. Your input stays in your browser.',
  ),
  noscript: m(
    'Dieses Werkzeug rechnet vollständig in Ihrem Browser und benötigt JavaScript. Es werden keine Rechnungsdaten übertragen.',
    'This tool runs entirely in your browser and needs JavaScript. No invoice data is transmitted.',
  ),
  loading: m('Wird geladen …', 'Loading …'),
  required: m('Pflicht', 'required'),
  optional: m('optional', 'optional'),
  requiredLegend: m('* Pflichtangabe', '* required'),
  choose: m('Bitte wählen', 'Please choose'),
  helpFor: m('Hilfe: {field}', 'Help: {field}'),
  more: m('Mehr dazu', 'More'),
  close: m('Schließen', 'Close'),
  jump: m('Zum Feld', 'Jump to field'),
  check: m('Prüfen', 'Check'),
  addLine: m('Position hinzufügen', 'Add line'),
  removeLine: m('Position {n} entfernen', 'Remove line {n}'),
  lineLegend: m('Position {n}', 'Line {n}'),
  fixedDE: m('Deutschland (DE)', 'Germany (DE)'),
  fixedEUR: m('Euro (EUR)', 'Euro (EUR)'),
  fixed380: m('380 – Rechnung', '380 – Commercial invoice'),
  country: m('Land', 'Country'),
  currency: m('Währung', 'Currency'),
  documentType: m('Rechnungsart', 'Document type'),

  'sec.document': m('Rechnungsdaten', 'Invoice details'),
  'sec.seller': m('Verkäufer (Rechnungssteller)', 'Seller (invoice issuer)'),
  'sec.buyer': m('Käufer (Rechnungsempfänger)', 'Buyer (invoice recipient)'),
  'sec.lines': m('Rechnungspositionen', 'Invoice lines'),
  'sec.payment': m('Zahlung', 'Payment'),
  'sec.notes': m('Hinweise', 'Notes'),
  'sec.general': m('Allgemein', 'General'),
  secOpen: m('{n} offen', '{n} open'),
  secErrors: m('{n} zu korrigieren', '{n} to correct'),
  secUntouched: m('nicht geprüft', 'not checked'),

  'grp.sellerTax': m('Steuerliche Kennung des Verkäufers (mindestens eine)', 'Seller tax identification (at least one)'),
  'grp.sellerTaxHint': m(
    'USt-IdNr. oder Steuernummer ist erforderlich. Ohne USt-IdNr. wird zusätzlich eine Kennung oder Registernummer benötigt.',
    'A VAT ID or a tax number is required. Without a VAT ID, an identifier or registration number is needed as well.',
  ),
  'grp.buyerId': m('Kennung des Käufers (bei Reverse Charge mindestens eine)', 'Buyer identification (at least one with Reverse Charge)'),
  'grp.buyerIdHint': m(
    'Optional, solange keine Position Reverse Charge ist. Die beiden Angaben sind unabhängig voneinander; keine wird aus der anderen abgeleitet.',
    'Optional as long as no line is Reverse Charge. The two entries are independent of each other; neither is derived from the other.',
  ),
  'grp.buyerIdHintRc': m(
    'Mindestens eine Position ist Reverse Charge: USt-IdNr. des Käufers (BT-48) oder Registernummer (BT-47) ist erforderlich, eine der beiden genügt. Keine wird aus der anderen abgeleitet.',
    'At least one line is Reverse Charge: the buyer’s VAT ID (BT-48) or legal registration ID (BT-47) is required; one of the two is enough. Neither is derived from the other.',
  ),
  'vatRegime.legend': m('Umsatzsteuerliche Behandlung der Rechnung', 'VAT treatment of the invoice'),
  'vatRegime.regular': m('Reguläre Besteuerung / Reverse Charge', 'Regular taxation / Reverse Charge'),
  'vatRegime.kleinunternehmer': m('Kleinunternehmer (§ 19 UStG)', 'Kleinunternehmer (§ 19 UStG)'),
  'vatRegime.hint': m(
    'Ihre Auswahl für die ganze Rechnung. Das Werkzeug prüft weder, ob § 19 UStG auf Sie zutrifft, noch ob § 13b UStG auf eine Leistung anzuwenden ist. Die Vorauswahl „Reguläre Besteuerung / Reverse Charge“ setzt nur den bisherigen Ablauf fort und stellt keine Feststellung Ihres Steuerstatus dar. Kleinunternehmer lässt sich in diesem Werkzeug nicht mit 19 %, 7 % oder Reverse Charge in einer Rechnung mischen.',
    'Your choice for the whole invoice. The tool does not check whether § 19 UStG applies to you or whether § 13b UStG applies to a supply. The preselected “Regular taxation / Reverse Charge” only continues the previous workflow and is not a determination of your tax status. In this tool Kleinunternehmer cannot be mixed with 19 %, 7 % or Reverse Charge in one invoice.',
  ),
  'vatRegime.kuSellerHint': m(
    'Verkäuferkennung: Es gelten zwei getrennte Bedingungen, beide müssen erfüllt sein. (1) USt-IdNr. (BT-31) oder Steuernummer (BT-32). (2) USt-IdNr. (BT-31), Registernummer (BT-30) oder Kennung (BT-29). BT-31 allein erfüllt beide; BT-32 allein nur die erste; BT-29 oder BT-30 allein nur die zweite. Das Werkzeug gibt keine Empfehlung für Verkäufer, die nur eine Steuernummer haben.',
    'Seller identification: two separate conditions apply and both must be met. (1) VAT ID (BT-31) or tax number (BT-32). (2) VAT ID (BT-31), legal registration ID (BT-30) or identifier (BT-29). BT-31 alone meets both; BT-32 alone only the first; BT-29 or BT-30 alone only the second. The tool gives no recommendation for a seller who holds only a tax number.',
  ),
  'vat.reverseCharge': m('Reverse Charge (§ 13b UStG)', 'Reverse Charge (§ 13b UStG)'),
  'vat.fixedKu': m('Ohne USt-Ausweis (Kleinunternehmer)', 'No VAT shown (Kleinunternehmer)'),
  'reason.title': m('Feste Texte im XML (nicht editierbar)', 'Fixed texts in the XML (not editable)'),
  'reason.ku': m('Wird als BT-120 und als BT-33 ausgegeben; BT-121 wird nicht verwendet.', 'Written as BT-120 and as BT-33; BT-121 is not used.'),
  'reason.rc': m('Wird als BT-120 ausgegeben; BT-121 wird nicht verwendet.', 'Written as BT-120; BT-121 is not used.'),
  'grp.sellerId': m('Weitere Kennung des Verkäufers', 'Further seller identification'),
  'grp.supply': m('Zeitpunkt der Leistung', 'Time of supply'),
  'grp.supplyHint': m(
    'Genau eines von beiden. Eingaben der nicht gewählten Alternative bleiben im Formular, werden aber nicht verwendet.',
    'Exactly one of the two. Entries of the alternative not chosen stay in the form but are not used.',
  ),
  'supply.date': m('Einzelnes Leistungsdatum', 'Single date of supply'),
  'supply.period': m('Abrechnungszeitraum', 'Invoicing period'),
  'grp.references': m('Weitere Referenzen', 'Further references'),
  'grp.referencesHint': m(
    'Alle drei sind optional und unabhängig voneinander; nichts wird aus der Käuferreferenz übernommen.',
    'All three are optional and independent of each other; nothing is taken from the buyer reference.',
  ),
  leitwegCheck: m('Käuferreferenz als Leitweg-ID prüfen', 'Check the buyer reference as a Leitweg-ID'),
  leitwegNote: m(
    'Optional und standardmäßig aus. Geprüft werden nur Aufbau und Prüfziffern; der Text wird nie verändert. Ein bestandener Test belegt nicht, dass die Leitweg-ID zugeteilt ist, für das Routing taugt oder ein Empfänger die Rechnung annimmt.',
    'Optional and off by default. Only the structure and check digits are checked; the text is never changed. Passing does not show that the Leitweg-ID is assigned, works for routing, or that a recipient accepts the invoice.',
  ),
  'lines.numberHint': m('Zahlen mit Komma als Dezimaltrennzeichen, ohne Tausenderpunkt, z. B. 125,50.', 'Numbers with a comma as the decimal separator and no thousands separator, e.g. 125,50.'),
  'grp.paymentDue': m('Fälligkeit', 'Payment due'),
  'grp.paymentDueHint': m(
    'Bei einem offenen Betrag: Fälligkeitsdatum oder Zahlungsbedingungen angeben (mindestens eines).',
    'With an amount due: give a due date or payment terms (at least one).',
  ),

  'f.invoiceNumber': m('Rechnungsnummer', 'Invoice number'),
  'f.issueDate': m('Rechnungsdatum', 'Issue date'),
  'f.deliveryDate': m('Leistungsdatum', 'Date of supply'),
  'f.periodStart': m('Beginn des Abrechnungszeitraums', 'Invoicing period start'),
  'f.periodEnd': m('Ende des Abrechnungszeitraums', 'Invoicing period end'),
  'f.buyerReference': m('Käuferreferenz', 'Buyer reference'),
  'f.projectReference': m('Projektnummer', 'Project reference'),
  'f.contractReference': m('Vertragsnummer', 'Contract reference'),
  'f.orderReference': m('Bestellnummer', 'Purchase order reference'),
  'f.name': m('Name', 'Name'),
  'f.street': m('Straße und Hausnummer', 'Street and number'),
  'f.postCode': m('PLZ', 'Post code'),
  'f.city': m('Ort', 'City'),
  'f.schemeId': m('Adressschema', 'Address scheme'),
  'f.addressValue': m('Elektronische Adresse', 'Electronic address'),
  'f.contactName': m('Ansprechpartner', 'Contact name'),
  'f.contactTelephone': m('Telefon', 'Telephone'),
  'f.contactEmail': m('E-Mail', 'E-mail'),
  'f.vatId': m('USt-IdNr.', 'VAT ID'),
  'f.taxRegistrationId': m('Steuernummer', 'Tax number'),
  'f.legalRegistrationId': m('Registernummer', 'Legal registration ID'),
  'f.sellerIdentifier': m('Kennung des Verkäufers', 'Seller identifier'),
  'f.lines.name': m('Beschreibung', 'Description'),
  'f.lines.unitCode': m('Einheit', 'Unit'),
  'f.lines.quantity': m('Menge', 'Quantity'),
  'f.lines.unitPrice': m('Einzelpreis (netto)', 'Unit price (net)'),
  'f.lines.vat.rate': m('USt-Behandlung', 'VAT treatment'),
  'f.lines.net': m('Netto', 'Net'),
  'f.meansCode': m('Zahlungsart', 'Payment means'),
  'f.iban': m('IBAN', 'IBAN'),
  'ibanHint': m('Durchgehend, Großbuchstaben, ohne Leerzeichen. Die Prüfziffern müssen stimmen.', 'Continuous, capital letters, no spaces. The check digits must be correct.'),
  'f.accountName': m('Kontoinhaber', 'Account holder'),
  'f.bic': m('BIC', 'BIC'),
  'f.dueDate': m('Fälligkeitsdatum', 'Due date'),
  'f.termsText': m('Zahlungsbedingungen', 'Payment terms'),
  'f.note': m('Hinweistext', 'Note'),
  vat19: m('19 %', '19 %'),
  vat7: m('7 %', '7 %'),
  'rail.vatKu': m('Kleinunternehmer (§ 19 UStG), Bemessungsgrundlage {base}', 'Kleinunternehmer (§ 19 UStG), taxable amount {base}'),
  'rail.vatRc': m('Reverse Charge (§ 13b UStG), Bemessungsgrundlage {base}', 'Reverse Charge (§ 13b UStG), taxable amount {base}'),

  means30: m('30 – Überweisung', '30 – Credit transfer'),
  means58: m('58 – SEPA-Überweisung', '58 – SEPA credit transfer'),
  meansHint: m(
    '30: Überweisung allgemein. 58: SEPA-Überweisung. Beide werden mit IBAN angegeben; die IBAN wird in diesem Werkzeug immer geprüft.',
    '30: credit transfer in general. 58: SEPA credit transfer. Both are given with an IBAN; this tool always checks the IBAN.',
  ),
  schemeEM: m('EM – E-Mail-Adresse', 'EM – e-mail address'),
  scheme0204: m('0204', '0204'),
  scheme0088: m('0088', '0088'),
  schemeHint: m(
    'Schemakennung aus der EAS-Liste; ohne Routing-Bedeutung in diesem Werkzeug.',
    'Scheme identifier from the EAS list; no routing meaning in this tool.',
  ),

  // Rail
  'rail.amounts': m('Beträge', 'Amounts'),
  'rail.preview': m('Vorschau (nur Positionen)', 'Preview (lines only)'),
  'rail.calculated': m('Berechnet', 'Calculated'),
  'rail.noAmounts': m('Beträge erscheinen, sobald alle Positionen vollständig und gültig sind.', 'Amounts appear once every line is complete and valid.'),
  'rail.vatLine': m('USt {rate} % auf {base}', 'VAT {rate} % on {base}'),
  'rail.net': m('Summe netto', 'Total net'),
  'rail.vat': m('Umsatzsteuer', 'VAT'),
  'rail.gross': m('Gesamtbetrag brutto', 'Total gross'),
  'rail.due': m('Zahlbetrag', 'Amount due'),
  'rail.status': m('Status', 'Status'),
  'ladder.input': m('Eingaben vollständig', 'Input complete'),
  'ladder.local': m('Gegen die Regeln dieses Werkzeugs geprüft', "Checked against this tool's rules"),
  'ladder.xml': m('XML erzeugt', 'XML generated'),
  'ladder.external': m('Externer Validator / Empfänger', 'External validator / recipient'),
  'ladder.external.state': m('nicht Teil dieses Werkzeugs', 'not part of this tool'),
  'state.yes': m('ja', 'yes'),
  'state.no': m('nein', 'no'),
  'state.notChecked': m('noch nicht geprüft', 'not checked yet'),
  'state.pending': m('noch nicht möglich', 'not yet possible'),
  'status.pristine': m('Noch nicht geprüft', 'Not checked yet'),
  'status.local': m('Gegen die Regeln dieses Werkzeugs geprüft', "Checked against this tool's rules"),
  'status.generated': m('{format}-XML erzeugt, {time}', '{format} XML generated, {time}'),
  'status.changed': m('Formular seit dem letzten Export geändert.', 'Form changed since the last export.'),
  'notice.external': m(
    'Kein externer Validator und kein Empfänger hat dieses Dokument geprüft. Keine Steuer- oder Rechtsberatung.',
    'No external validator and no recipient has checked this document. No tax or legal advice.',
  ),
  'scope.title': m('Was dieses Werkzeug nicht kann', 'What this tool cannot do'),
  'scope.summary': m(
    'Derzeit: Rechnung Typ 380, deutsches Inlandsprofil, EUR. Weitere Fälle sind im Fachkern vorhanden oder liegen außerhalb des Profils.',
    'Currently: invoice type 380, German domestic profile, EUR. Further cases exist in the domain core or lie outside the profile.',
  ),
  'scope.nowTitle': m('In dieser Oberfläche möglich', 'Available in this interface'),
  'scope.coreTitle': m('Im Fachkern vorhanden, hier noch nicht bedienbar', 'In the domain core, not yet available here'),
  'scope.outTitle': m('Außerhalb des Profils dieses Werkzeugs', 'Outside this tool’s profile'),
  'scope.toolTitle': m('Nicht verfügbare Werkzeugfunktionen', 'Unavailable tool features'),
  'scope.disclaimer': m(
    'Gemeint ist stets der Umfang dieses Werkzeugs. Es ist keine Aussage, dass das Recht, EN 16931 oder XRechnung solche Fälle verbieten.',
    'This always describes the scope of this tool. It does not say that the law, EN 16931 or XRechnung prohibit such cases.',
  ),
  'date.calendar': m('Kalender öffnen: {field}', 'Open calendar: {field}'),
  'date.pick': m('Datum im Kalender wählen: {field}', 'Choose a date in the calendar: {field}'),
  'date.done': m('Fertig', 'Done'),
  'date.format': m('Format: TT.MM.JJJJ, z. B. 07.11.2026', 'Format: DD.MM.YYYY, e.g. 07.11.2026'),
  'diag.heading': m('Prüfergebnis', 'Check result'),
  'diag.none': m('Keine offenen Punkte.', 'No open points.'),
  'diag.truncated': m('Weitere Probleme können nach der Korrektur erscheinen.', 'More problems may appear after these are fixed.'),
  'diag.internal': m('Interner Fehler des Werkzeugs (Code {code}). Bitte melden; es wurde nichts exportiert.', 'Internal error of the tool (code {code}). Please report it; nothing was exported.'),
  'export.heading': m('Export', 'Export'),
  'export.ubl': m('UBL 2.1 XML herunterladen', 'Download UBL 2.1 XML'),
  'export.cii': m('CII XML herunterladen', 'Download CII XML'),
  'export.blocked': m('Der Export ist erst möglich, wenn die Prüfung ohne offene Punkte besteht.', 'Export is possible once the check has no open points.'),
  'export.hint': m('Das XML wird lokal erzeugt; es verlässt Ihren Browser nicht.', 'The XML is generated locally and does not leave your browser.'),
  'dock.summary': m('Zusammenfassung & Export', 'Summary & export'),
  'dock.preview': m('(Vorschau)', '(preview)'),

  'help.heading': m('Hilfe zu diesem Feld', 'Help for this field'),
  'help.headingSection': m('Hilfe zu diesem Abschnitt', 'Help for this section'),
  'help.enter': m('Was ist einzutragen', 'What to enter'),
  'help.status': m('Status', 'Status'),
  'help.required': m('Pflicht', 'Required'),
  'help.optional': m('Optional', 'Optional'),
  'help.conditional': m('Bedingt', 'Conditional'),
  'help.format': m('Format', 'Format'),
  'help.valid': m('Gültiges Beispiel (fiktiv)', 'Valid example (fictional)'),
  'help.invalid': m('Ungültig', 'Invalid'),
  'help.mistakes': m('Häufige Fehler (Meldungen dieses Werkzeugs)', 'Common mistakes (messages of this tool)'),
  'help.external': m('Externe Regeln (Norm, XRechnung, Gesetz)', 'External rules (standard, XRechnung, statute)'),
  'help.profile': m('Einschränkung dieses Werkzeugs (kein Gesetz)', 'Restriction of this tool (not law)'),
  'help.unverified': m('Nicht geklärt', 'Not established'),
  'help.sources': m('Quellen', 'Sources'),
  'help.fields': m('Feldübersicht', 'Field overview'),
  'help.colField': m('Feld', 'Field'),
  'help.colStatus': m('Status', 'Status'),
  'help.colFormat': m('Format', 'Format'),
  'help.noExternal': m('Keine zusätzliche externe Regel in den ausgewerteten Quellen.', 'No further external rule in the sources consulted.'),
} as const satisfies Record<string, Msg>;

export type CopyKey = keyof typeof copy;

/** Caption of one VAT bucket of the summary rail: by treatment, so Kleinunternehmer (E) and Reverse Charge (AE) are never shown as "0 %". */
export function vatBucketLabel(bucket: Pick<VatBreakdown, 'treatment' | 'rate'>, base: string, locale: Locale): string {
  const key = bucket.treatment === 'kleinunternehmer' ? 'rail.vatKu' : bucket.treatment === 'reverse-charge' ? 'rail.vatRc' : 'rail.vatLine';
  return fill(copy[key][locale], { rate: bucket.rate, base });
}
export const t = (key: CopyKey, locale: Locale, values: Record<string, string | number> = {}): string => fill(copy[key][locale], values);

export const unitLabels: Readonly<Record<string, Msg>> = {
  C62: m('Einheit', 'one (unit)'),
  H87: m('Stück', 'piece'),
  HUR: m('Stunde', 'hour'),
  DAY: m('Tag', 'day'),
  MON: m('Monat', 'month'),
  KGM: m('Kilogramm', 'kilogram'),
  LTR: m('Liter', 'litre'),
  MTR: m('Meter', 'metre'),
};

/** Count texts with the singular where German and English need it. */
export function openCountText(missing: number, invalid: number, locale: Locale): string {
  if (missing === 0 && invalid === 0) return '';
  const parts: string[] = [];
  if (locale === 'de') {
    if (missing > 0) parts.push(missing === 1 ? '1 Pflichtangabe fehlt' : `${missing} Pflichtangaben fehlen`);
    if (invalid > 0) parts.push(invalid === 1 ? '1 Angabe korrigieren' : `${invalid} Angaben korrigieren`);
  } else {
    if (missing > 0) parts.push(missing === 1 ? '1 required entry missing' : `${missing} required entries missing`);
    if (invalid > 0) parts.push(invalid === 1 ? '1 entry to correct' : `${invalid} entries to correct`);
  }
  return parts.join(', ');
}

/** Normalizes `lines[3].quantity` to its label key; group paths and unknown paths fall back to a section name. */
export function labelFor(path: string, locale: Locale): string {
  const normalized = path.replace(/^lines\[\d+\]/, 'lines');
  const key = LABEL_KEYS[normalized];
  if (key !== undefined) return copy[key][locale];
  if (path === 'seller') return copy['sec.seller'][locale];
  if (path === 'buyer') return copy['sec.buyer'][locale];
  if (path === 'payment') return copy['sec.payment'][locale];
  if (path === 'lines') return copy['sec.lines'][locale];
  return path;
}

/** Domain path (line indices removed) to label key. A test proves every form field id has one. */
export const LABEL_KEYS: Readonly<Record<string, CopyKey>> = {
  invoiceNumber: 'f.invoiceNumber', issueDate: 'f.issueDate', deliveryDate: 'f.deliveryDate', buyerReference: 'f.buyerReference',
  'invoicingPeriod.startDate': 'f.periodStart', 'invoicingPeriod.endDate': 'f.periodEnd',
  projectReference: 'f.projectReference', contractReference: 'f.contractReference', orderReference: 'f.orderReference',
  'seller.name': 'f.name', 'seller.address.street': 'f.street', 'seller.address.postCode': 'f.postCode', 'seller.address.city': 'f.city',
  'seller.electronicAddress.schemeId': 'f.schemeId', 'seller.electronicAddress.value': 'f.addressValue',
  'seller.contact.name': 'f.contactName', 'seller.contact.telephone': 'f.contactTelephone', 'seller.contact.email': 'f.contactEmail',
  'seller.vatId': 'f.vatId', 'seller.taxRegistrationId': 'f.taxRegistrationId', 'seller.legalRegistrationId': 'f.legalRegistrationId',
  'seller.sellerIdentifiers[0]': 'f.sellerIdentifier',
  'buyer.name': 'f.name', 'buyer.address.street': 'f.street', 'buyer.address.postCode': 'f.postCode', 'buyer.address.city': 'f.city',
  'buyer.electronicAddress.schemeId': 'f.schemeId', 'buyer.electronicAddress.value': 'f.addressValue', 'buyer.vatId': 'f.vatId',
  'buyer.legalRegistrationId': 'f.legalRegistrationId',
  'payment.means.code': 'f.meansCode', 'payment.means.account.id.value': 'f.iban', 'payment.means.account.name': 'f.accountName',
  'payment.means.account.bic': 'f.bic', 'payment.dueDate': 'f.dueDate', 'payment.termsText': 'f.termsText',
  'notes[0].text': 'f.note',
  'lines.name': 'f.lines.name', 'lines.unitCode': 'f.lines.unitCode', 'lines.quantity': 'f.lines.quantity',
  'lines.unitPrice': 'f.lines.unitPrice', 'lines.vat.rate': 'f.lines.vat.rate',
};

const outside = m('Außerhalb des unterstützten Funktionsumfangs dieses Werkzeugs: {field}.', 'Outside what this tool supports: {field}.');
const notReachable = outside;

/**
 * One text per domain diagnostic code (compile-time exhaustive). Wording: what is wrong, what to do, the format.
 * "unsupported" means outside this tool's profile, never "legally invalid".
 */
export const errorMessages: Readonly<Record<DocumentErrorCode, Msg>> = {
  missing_field: m('Pflichtangabe fehlt: {field}.', 'Required entry missing: {field}.'),
  empty_text: m('{field} enthält nur Leerzeichen. Bitte einen Wert eintragen.', '{field} contains only spaces. Please enter a value.'),
  invalid_text: m(
    '{field}: Entfernen Sie Leerzeichen am Anfang oder Ende sowie Steuerzeichen. Der Text wird nicht automatisch verändert.',
    '{field}: remove spaces at the start or end, and control characters. The text is not changed automatically.',
  ),
  text_too_long: m('{field} ist zu lang. Bitte kürzen.', '{field} is too long. Please shorten it.'),
  invalid_date: m('{field}: kein gültiges Kalenderdatum. Bitte TT.MM.JJJJ eingeben, z. B. 07.11.2026.', '{field}: not a valid calendar date. Please enter DD.MM.YYYY, e.g. 07.11.2026.'),
  invalid_vat_id: m('{field}: in diesem Werkzeug nur „DE“ und genau 9 Ziffern, ohne Leerzeichen.', '{field}: this tool accepts only “DE” and exactly 9 digits, no spaces.'),
  invalid_email: m('{field}: keine gültige E-Mail-Adresse.', '{field}: not a valid e-mail address.'),
  invalid_telephone: m('{field}: mindestens 3 Ziffern erforderlich.', '{field}: at least 3 digits are required.'),
  invalid_iban: m(
    '{field}: keine gültige IBAN. Bitte Zeichen, Leerzeichen und Prüfziffern prüfen. Details über die Hilfe (?) zu diesem Feld.',
    '{field}: not a valid IBAN. Please check the characters, spaces and check digits. Details are in the help (?) for this field.',
  ),
  invalid_bic: m('{field}: kein gültiger BIC (8 oder 11 Zeichen).', '{field}: not a valid BIC (8 or 11 characters).'),
  unsupported_country: m('{field}: nur Deutschland (DE) wird unterstützt.', '{field}: only Germany (DE) is supported.'),
  unsupported_electronic_address_scheme: m('{field}: dieses Schema wird nicht unterstützt. Bitte aus der Liste wählen.', '{field}: this scheme is not supported. Please choose from the list.'),
  unsupported_payment_means: m('{field}: nur 30 und 58 werden unterstützt.', '{field}: only 30 and 58 are supported.'),
  unsupported_payment_account_scheme: outside,
  unsupported_hash_in_payment_terms: m('{field}: das Zeichen „#“ ist im freien Text nicht zulässig.', '{field}: the character “#” is not allowed in the free text.'),
  unsupported_skonto_tier_count: notReachable,
  unsupported_skonto_days: notReachable,
  unsupported_skonto_tier_order: notReachable,
  unsupported_skonto_percent: notReachable,
  unsupported_skonto_base_amount: notReachable,
  unsupported_skonto_on_credit_note: notReachable,
  invalid_leitweg_id_format: m(
    '{field}: kein Leitweg-ID-Aufbau. Erwartet: Grobadresse (Ziffern, beginnt mit 01–16 oder 99), optional „-“ und Feinadresse (Buchstaben/Ziffern), dann „-“ und zwei Prüfziffern, z. B. 04011000-12345-03. Ist das keine Leitweg-ID, schalten Sie die Prüfung ab.',
    '{field}: not the structure of a Leitweg-ID. Expected: a coarse address (digits, starting 01–16 or 99), optionally “-” and a fine address (letters/digits), then “-” and two check digits, e.g. 04011000-12345-03. If this is not a Leitweg-ID, switch the check off.',
  ),
  invalid_leitweg_id_checksum: m(
    '{field}: Die letzten zwei Ziffern (Prüfziffern) passen nicht zum übrigen Wert. Bitte die Leitweg-ID beim Empfänger erfragen und exakt übernehmen; der Wert wird nicht automatisch korrigiert.',
    '{field}: the last two digits (check digits) do not match the rest of the value. Please get the Leitweg-ID from the recipient and enter it exactly; the value is not corrected automatically.',
  ),
  invalid_invoicing_period: m(
    '{field}: Das Ende liegt vor dem Beginn. Bitte ein Enddatum am oder nach dem Beginn wählen.',
    '{field}: the end is before the start. Please choose an end date on or after the start date.',
  ),
  unsupported_delivery_date_with_invoicing_period: notReachable,
  unsupported_preceding_invoice_reference: notReachable,
  unsupported_settlement_on_invoice: notReachable,
  unsupported_credit_note_payment_means: notReachable,
  unsupported_credit_note_refund_transfer: notReachable,
  unsupported_credit_note_settlement: notReachable,
  missing_clearing_confirmation: notReachable,
  missing_payment_due_information: m(
    'Bei einem offenen Betrag ist ein Fälligkeitsdatum oder eine Zahlungsbedingung erforderlich.',
    'With an amount due, a due date or payment terms are required.',
  ),
  unsupported_unit_code: m('{field}: diese Einheit wird nicht unterstützt. Bitte aus der Liste wählen.', '{field}: this unit is not supported. Please choose from the list.'),
  missing_seller_identification: m(
    'Der Verkäufer braucht mindestens eine Kennung: USt-IdNr., Registernummer oder eine weitere Kennung.',
    'The seller needs at least one identification: VAT ID, legal registration ID or another identifier.',
  ),
  missing_seller_tax_identifier: m(
    'Der Verkäufer braucht eine USt-IdNr. oder eine Steuernummer.',
    'The seller needs a VAT ID or a tax number.',
  ),
  missing_buyer_identifier: m(
    'Bei einer Reverse-Charge-Position braucht der Käufer mindestens eine Kennung: USt-IdNr. (BT-48) oder Registernummer (BT-47).',
    'With a Reverse Charge line the buyer needs at least one identification: VAT ID (BT-48) or legal registration ID (BT-47).',
  ),
  unsupported_mixed_vat_treatments: notReachable,
  internal_inconsistency: m('Interner Fehler.', 'Internal error.'),
  // Monetary codes (invoice.ts)
  invalid_decimal: m('{field}: keine gültige Zahl. Bitte Ziffern mit {sep} als Dezimaltrennzeichen eingeben, ohne Punkt oder Tausendertrennzeichen, z. B. {example}.', '{field}: not a valid number. Please enter digits with a {sep} as the decimal separator, with no point or thousands separator, e.g. {example}.'),
  negative_amount: m('{field}: negative Werte werden nicht unterstützt.', '{field}: negative values are not supported.'),
  input_length_guard: m('{field}: Eingabe zu lang.', '{field}: input too long.'),
  invalid_type: m('Interner Fehler: ungültiger Datentyp ({field}).', 'Internal error: invalid data type ({field}).'),
  unknown_field: m('Interner Fehler: unbekanntes Feld ({field}).', 'Internal error: unknown field ({field}).'),
  no_lines: m('Mindestens eine Rechnungsposition ist erforderlich.', 'At least one invoice line is required.'),
  error_list_truncated: m('Die Fehlerliste wurde gekürzt.', 'The error list was truncated.'),
  fraction_digits_limit: m('{field}: höchstens 6 Nachkommastellen (ohne nachgestellte Nullen).', '{field}: at most 6 fractional digits (trailing zeros not counted).'),
  magnitude_limit: m('{field}: Wert zu groß (unter 1.000.000.000).', '{field}: value too large (below 1,000,000,000).'),
  calculated_amount_limit: m('Ein berechneter Betrag überschreitet die Grenze dieses Werkzeugs (unter 10.000.000.000 EUR).', 'A calculated amount exceeds this tool’s limit (below 10,000,000,000 EUR).'),
  unsupported_document_type: outside,
  unsupported_currency: outside,
  unsupported_vat_treatment: outside,
  unsupported_vat_category: outside,
  unsupported_vat_rate: m('{field}: Bitte 19 %, 7 % oder Reverse Charge wählen. Eine Vorauswahl gibt es nicht.', '{field}: please choose 19 %, 7 % or Reverse Charge. There is no preselection.'),
};

/** Text of one diagnostic for the page locale. `{sep}` and `{example}` name the German input notation, the same on both routes. */
export function describeError(code: DocumentErrorCode, path: string, locale: Locale, label?: string): string {
  const sep = locale === 'de' ? 'Komma' : 'comma';
  const example = '12,50';
  return fill(errorMessages[code][locale], { field: label ?? labelFor(path, locale), sep, example });
}

/** Compact scope note (MDR-32 obligation at M3). Mirrors the domain README "Supported and not supported"; tool limits are not legal prohibitions. */
export const scopeLists: Record<'now' | 'core' | 'out' | 'tool', { readonly de: readonly string[]; readonly en: readonly string[] }> = {
  now: {
    de: ['Rechnung Typ 380', 'Deutsches Inlandsprofil (Verkäufer und Käufer in Deutschland), Währung EUR', 'Umsatzsteuer: Normalsatz 19 % und ermäßigter Satz 7 %', 'Reverse Charge (§ 13b UStG) je Position, auch zusammen mit 19 % und 7 % in einer Rechnung', 'Kleinunternehmer (§ 19 UStG) für die ganze Rechnung; nicht mit anderen Behandlungen kombinierbar (Einschränkung dieses Profils). Das Werkzeug prüft weder die Voraussetzungen des § 19 UStG noch die Anwendbarkeit des § 13b UStG', 'Zahlung per Überweisung (Code 30 oder 58) mit IBAN', 'Projekt-, Vertrags- und Bestellreferenz (BT-11, BT-12, BT-13), jeweils optional', 'Leistungsdatum (BT-72) oder Abrechnungszeitraum (BG-14), genau eines von beiden', 'Optionale Leitweg-ID-Prüfung der Käuferreferenz (nur Aufbau und Prüfziffern)', 'Prüfung im Browser gegen die Regeln dieses Werkzeugs und Export als UBL- oder CII-XML'],
    en: ['Invoice type 380', 'German domestic profile (seller and buyer in Germany), currency EUR', 'VAT: standard rate 19% and reduced rate 7%', 'Reverse Charge (§ 13b UStG) per line, also together with 19% and 7% in one invoice', 'Kleinunternehmer (§ 19 UStG) for the whole invoice; not combinable with other treatments (a restriction of this profile). The tool checks neither the conditions of § 19 UStG nor the applicability of § 13b UStG', 'Payment by credit transfer (code 30 or 58) with an IBAN', 'Project, contract and purchase order references (BT-11, BT-12, BT-13), each optional', 'Date of supply (BT-72) or invoicing period (BG-14), exactly one of the two', 'Optional Leitweg-ID check of the buyer reference (structure and check digits only)', 'Check in the browser against this tool’s rules and export as UBL or CII XML'],
  },
  core: {
    de: ['Gutschrift 381 (nur bestätigte Verrechnung)', 'Strukturiertes Skonto'],
    en: ['Credit note 381 (confirmed clearing only)', 'Structured Skonto'],
  },
  out: {
    de: ['Andere Dokumenttypen als 380 und 381 (zum Beispiel 384, 389)', 'Andere Währungen als EUR; Beteiligte außerhalb Deutschlands', 'Andere Steuerkategorien, Steuersätze oder Steuerbehandlungen als im Profil', 'Andere Zahlungsarten als Überweisung (30, 58); Erstattung einer Gutschrift per Überweisung', 'Nachlässe und Zuschläge, Anzahlungen, Teil- und Ratenrechnungen, Anhänge, negative Mengen und Preise'],
    en: ['Document types other than 380 and 381 (for example 384, 389)', 'Currencies other than EUR; parties outside Germany', 'VAT categories, rates or treatments beyond the profile', 'Payment means other than credit transfer (30, 58); refunding a credit note by credit transfer', 'Allowances and charges, prepayments, staged or installment invoices, attachments, negative quantities and prices'],
  },
  tool: {
    de: ['XML-Import (vorhandene XRechnung-, UBL- oder CII-Dateien einlesen)', 'PDF-Erzeugung'],
    en: ['XML import (reading existing XRechnung, UBL or CII files)', 'PDF generation'],
  },
};
