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
    'Rechnung (Typ 380) oder kaufmännische Gutschrift (Typ 381) im implementierten Profil erfassen und als UBL- oder CII-XML erzeugen. Die Eingaben bleiben in Ihrem Browser.',
    'Enter an invoice (type 380) or a credit note (type 381) in the implemented profile and generate UBL or CII XML. Your input stays in your browser.',
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
  // Credit note 381 (MDR-49). Labels checked against XRechnung 3.0.2 section 13.1 and § 14 Abs. 2 UStG on 2026-11-27 (AI-assisted); professional verification is pending (oq-cn-label-statutory-verification).
  'doctype.legend': m('Dokumenttyp', 'Document type'),
  'doctype.380': m('Rechnung (380)', 'Invoice (380)'),
  'doctype.381': m('Kaufmännische Gutschrift (381)', 'Credit note (381)'),
  'doctype.hint': m(
    'Ihre Wahl ist der Dokumenttyp (BT-3); er wird nie aus Beträgen abgeleitet. Eingaben des nicht gewählten Typs bleiben im Formular, werden aber nicht verwendet.',
    'Your choice is the document type (BT-3); it is never derived from amounts. Entries of the type not chosen stay in the form but are not used.',
  ),
  'doctype.to381': m(
    'Kaufmännische Gutschrift (381) gewählt: Bezug auf die ursprüngliche Rechnung und Verrechnung statt Bankverbindung.',
    'Credit note (381) chosen: reference to the preceding invoice, and clearing instead of bank details.',
  ),
  'doctype.to380': m(
    'Rechnung (380) gewählt: Bankverbindung statt Verrechnung, kein Bezug auf eine ursprüngliche Rechnung.',
    'Invoice (380) chosen: bank details instead of clearing, no reference to a preceding invoice.',
  ),
  'sec.cnDocument': m('Gutschriftdaten', 'Credit note details'),
  'sheet.cnTitle': m('Kaufmännische Gutschrift', 'Credit note'),
  'sheet.cnMeta': m('Typ 381 · EUR · Deutschland', 'Type 381 · EUR · Germany'),
  'sheet.short_cnDocument': m('Gutschriftdaten', 'Details'),
  'grp.preceding': m('Bezug auf die ursprüngliche Rechnung (BG-3)', 'Preceding invoice (BG-3)'),
  'grp.precedingHint': m(
    'Die Nummer ist nach dem Profil dieses Werkzeugs Pflicht, nicht als allgemeine Anforderung von EN 16931. Das Werkzeug ruft die Rechnung nicht ab und prüft weder, ob es sie gibt, noch ob die gutgeschriebenen Beträge zu ihr passen.',
    'The number is required by this tool’s profile, not as a general requirement of EN 16931. The tool does not retrieve the invoice and checks neither that it exists nor that the credited amounts match it.',
  ),
  precedingDateHint: m('Angeben, wenn die Nummer allein die Rechnung nicht eindeutig bezeichnet.', 'Give it when the number alone does not identify the invoice uniquely.'),
  'grp.supplyHintCn': m(
    'Bei der Gutschrift: die gutgeschriebene Lieferung oder Leistung, so wie Sie sie angeben; nichts wird aus der ursprünglichen Rechnung übernommen.',
    'On a credit note: the credited supply as you state it; nothing is taken from the preceding invoice.',
  ),
  'grp.clearing': m('Abwicklung: Verrechnung (Code 97)', 'Settlement: clearing (code 97)'),
  'grp.clearingHint': m(
    'Für eine Gutschrift unterstützt dieses Werkzeug nur die Verrechnung mit einer bestehenden Gegenforderung zwischen Verkäufer und Käufer. Eine Erstattung per Überweisung wird nicht unterstützt; eine Bankverbindung wird nicht angegeben.',
    'For a credit note this tool supports only clearing against an existing reciprocal obligation between seller and buyer. A refund by credit transfer is not supported; no bank details are given.',
  ),
  'clearing.confirm': m(
    'Ich bestätige, dass zwischen Verkäufer und Käufer eine Gegenforderung besteht, mit der diese Gutschrift verrechnet werden soll.',
    'I confirm that a reciprocal obligation exists between the seller and the buyer, against which this credit note is to be cleared.',
  ),
  'clearing.note': m(
    'Das ist Ihre Erklärung; das Werkzeug prüft sie nicht und führt selbst keine Verrechnung durch. Sie ist nie vorausgewählt und wird bei jedem Wechsel des Dokumenttyps zurückgesetzt.',
    'This is your declaration; the tool does not check it and does not carry out the clearing itself. It is never preselected and is withdrawn whenever the document type changes.',
  ),
  'grp.paymentDue': m('Fälligkeit', 'Payment due'),
  'grp.paymentDueHint': m(
    'Bei einem offenen Betrag: Fälligkeitsdatum oder Zahlungsbedingungen angeben (mindestens eines).',
    'With an amount due: give a due date or payment terms (at least one).',
  ),
  // On a 380 a Skonto tier is BT-20 content too, so it also satisfies BR-CO-25.
  'grp.paymentDueHintSkonto': m(
    'Bei einem offenen Betrag: Fälligkeitsdatum, Zahlungsbedingungen oder strukturiertes Skonto angeben (mindestens eines).',
    'With an amount due: give a due date, payment terms or structured Skonto (at least one).',
  ),
  'sheet.oneOfPayment': m('eine Angabe davon', 'one of these'),
  'grp.skonto': m('Skonto (strukturiert)', 'Early-payment discount (Skonto)'),
  'skonto.hint': m(
    'Optional. Je Stufe Tage und Prozent, Tage aufsteigend, bis zu 10 Stufen. Das Werkzeug berechnet keinen Skontobetrag und kein Zahlungsdatum.',
    'Optional. Days and percent per tier, days ascending, up to 10 tiers. The tool calculates no discount amount and no payment date.',
  ),
  'skonto.tier': m('Skontostufe {n}', 'Discount tier {n}'),
  'f.skontoDays': m('Tage', 'Days'),
  'f.skontoPercent': m('Prozent', 'Percent'),
  'skonto.add': m('Skontostufe hinzufügen', 'Add discount tier'),
  'skonto.remove': m('Skontostufe {n} entfernen', 'Remove discount tier {n}'),
  'skonto.undo': m('Skontostufe {n} entfernt – rückgängig machen', 'Discount tier {n} removed – undo'),
  'skonto.limit': m('10 Stufen erreicht: mehr erlaubt dieses Werkzeug nicht.', '10 tiers reached: this tool allows no more.'),
  'skonto.cnNote': m(
    'Strukturiertes Skonto ist für eine Gutschrift (381) in diesem Werkzeug nicht verfügbar. Bei der Rechnung (380) eingetragene Stufen bleiben erhalten, werden hier aber nicht übernommen.',
    'Structured Skonto is not available for a credit note (381) in this tool. Tiers entered on the invoice (380) are kept but not used here.',
  ),

  'f.invoiceNumber': m('Rechnungsnummer', 'Invoice number'),
  'f.cnNumber': m('Gutschriftnummer', 'Credit note number'),
  'f.cnIssueDate': m('Gutschriftdatum', 'Credit note date'),
  'f.precedingNumber': m('Nummer der ursprünglichen Rechnung', 'Preceding invoice number'),
  'f.precedingDate': m('Datum der ursprünglichen Rechnung', 'Preceding invoice date'),
  'f.clearingConfirmation': m('Bestätigung der Verrechnung', 'Clearing confirmation'),
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
    'Die Prüfung in diesem Werkzeug ist keine externe XRechnung-Validierung und keine Prüfung der steuerlichen Richtigkeit oder der Annahme durch den Empfänger. Keine Steuer- oder Rechtsberatung.',
    'The check in this tool is not an external XRechnung validation, nor a check of tax correctness or of acceptance by the recipient. No tax or legal advice.',
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
    'Gemeint ist stets der Umfang dieses Werkzeugs. Es ist keine Aussage, dass das Recht, EN 16931 oder XRechnung solche Fälle verbieten. Das Werkzeug prüft weder die Voraussetzungen des § 19 UStG noch die Anwendbarkeit des § 13b UStG; die Wahl der Behandlung bleibt Ihre.',
    'This always describes the scope of this tool. It does not say that the law, EN 16931 or XRechnung prohibit such cases. The tool checks neither the conditions of § 19 UStG nor the applicability of § 13b UStG; choosing the treatment remains yours.',
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
  // Rechnungsblatt (MDR-46): the document-first workspace.
  'sheet.checkLong': m('Rechnung prüfen', 'Check invoice'),
  'sheet.cnCheckLong': m('Gutschrift prüfen', 'Check credit note'),
  'sheet.nextOpen': m('Nächster offener Punkt', 'Next open point'),
  'sheet.allDone': m('Keine offenen Punkte', 'No open points'),
  'sheet.oneOf': m('eine von beiden', 'one of the two'),
  'sheet.secTodo': m('{n} Angaben', '{n} entries'),
  'sheet.secDone': m('vollständig', 'complete'),
  'sheet.outline': m('Abschnitte', 'Sections'),
  'sheet.linesBlockingOne': m('Beträge erscheinen, sobald Position {list} vollständig und gültig ist.', 'Amounts appear once line {list} is complete and valid.'),
  'sheet.linesBlockingMany': m('Beträge erscheinen, sobald die Positionen {list} vollständig und gültig sind.', 'Amounts appear once lines {list} are complete and valid.'),
  'sheet.colHelp': m('Hilfe zu den Spalten', 'Help for the columns'),
  'sheet.totalsTitle': m('Summen', 'Totals'),
  'sheet.scopeCan': m('Was dieses Werkzeug derzeit kann', 'What this tool can currently do'),
  'sheet.scopeCannot': m('Was noch nicht möglich ist', 'What is not possible yet'),
  'sheet.scopeCannotLead': m(
    'Aus verschiedenen Gründen – keiner davon ist eine Aussage über das Recht:',
    'For different reasons – none of them is a statement about the law:',
  ),
  'sheet.scopeBuilt': m('Fachlich vorbereitet, in der Oberfläche noch nicht bedienbar', 'Prepared in the calculation core, not yet operable in the interface'),
  'sheet.scopeOut': m('Außerhalb des Profils dieses Werkzeugs', 'Outside this tool’s profile'),
  'sheet.scopeTool': m('Funktionen, die das Werkzeug nicht hat', 'Features this tool does not have'),
  'sheet.done': m('Fertig', 'Done'),
  'sheet.nextBlock': m('Weiter: {section}', 'Next: {section}'),
  'sheet.sheetTitle': m('Rechnung', 'Invoice'),
  'sheet.sheetMeta': m('Typ 380 · EUR · Deutschland', 'Type 380 · EUR · Germany'),
  'sheet.barLabel': m('Status und Export', 'Status and export'),
  // PR-11: confirmation before a navigation would discard the in-memory document. Nothing is stored, so leaving loses it.
  'leave.title': m('Seite verlassen?', 'Leave this page?'),
  'leave.body': m(
    'Ihre Eingaben werden nirgends gespeichert. Wenn Sie die Seite verlassen, gehen sie verloren. Eine exportierte XML-Datei lässt sich hier nicht wieder einlesen.',
    'Your input is not stored anywhere. If you leave this page, it is lost. An exported XML file cannot be read back in here.',
  ),
  'leave.language': m('Auch beim Wechsel der Sprache werden die Eingaben nicht übernommen.', 'Switching the language does not carry your input over either.'),
  'leave.stay': m('Auf der Seite bleiben', 'Stay on this page'),
  'leave.go': m('Verlassen und Eingaben verwerfen', 'Leave and discard input'),
  'sheet.pos': m('Pos.', 'No.'),
  'sheet.missingShort': m('fehlt', 'missing'),
  'sheet.lineOpen': m('Noch offen: {list}', 'Still open: {list}'),
  'sheet.lineUndo': m('Position {n} entfernt – rückgängig machen', 'Line {n} removed – undo'),
  'sheet.soloNet': m('Einzelwert', 'line value only'),
  'sheet.soloNote': m(
    'Die Netto-Beträge an einzelnen Positionen sind Einzelwerte dieser Positionen – keine Rechnungssumme und keine Zwischensumme.',
    'The net amounts shown on individual lines are those lines’ own figures – not an invoice total and not a subtotal.',
  ),
  'sheet.totalsNone': m('noch nicht verfügbar', 'not available yet'),
  'sheet.stampDraft': m('Entwurf', 'Draft'),
  'sheet.stampOpen': m('Entwurf · {n} offen', 'Draft · {n} open'),
  'sheet.stampReady': m('Lokal geprüft · exportbereit', 'Checked locally · ready to export'),
  'sheet.begin': m('Rechnung beginnen', 'Start the invoice'),
  'sheet.nextShort': m('Weiter', 'Next'),
  'sheet.menu': m('Prüfen & Export', 'Check & export'),
  'sheet.intro': m(
    'Dieses Blatt ist Ihre Rechnung. Klicken Sie auf eine Angabe, um sie zu schreiben – oder gehen Sie mit „Rechnung beginnen“ und Enter von Punkt zu Punkt.',
    'This sheet is your invoice. Click any entry to write it – or use “Start the invoice” and Enter to go from point to point.',
  ),
  'sheet.keys': m('Enter: nächster offener Punkt · F1: Hilfe zum Feld · Esc: Abschnitt schließen', 'Enter: next open point · F1: help for the field · Esc: close section'),
  // The line cells have no F1 shortcut; their help is the column-help links above the table (reachable with Tab).
  'sheet.keysLines': m('Enter: nächster offener Punkt, in der Beschreibung: weiter zur Menge · Hilfe: Links über der Tabelle · Esc: Abschnitt schließen', 'Enter: next open point, in a description: on to the quantity · Help: links above the table · Esc: close section'),
  'sheet.lineBreak': m(
    '{field}: Ein Zeilenumbruch ist hier nicht möglich. Entfernen Sie den Umbruch, damit der Text in einer Zeile steht; der Text wird nicht automatisch verändert.',
    '{field}: a line break is not possible here. Remove the line break so that the text is on one line; the text is not changed automatically.',
  ),
  'sheet.limitLine': m('Verringern Sie Menge oder Einzelpreis (netto) dieser Position.', 'Reduce the quantity or the unit price (net) of this line.'),
  'sheet.limitAllLines': m('Das betrifft die Beträge über alle Positionen; verringern Sie Mengen oder Einzelpreise.', 'This concerns the amounts over all lines; reduce quantities or unit prices.'),
  'sheet.documentIssues': m('Zu korrigieren', 'To correct'),
  'sheet.short_seller': m('Verkäufer', 'Seller'),
  'sheet.short_document': m('Rechnungsdaten', 'Details'),
  'sheet.short_buyer': m('Käufer', 'Buyer'),
  'sheet.short_lines': m('Positionen', 'Lines'),
  'sheet.short_payment': m('Zahlung', 'Payment'),
  'sheet.short_notes': m('Hinweise', 'Notes'),
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

/** Labels that name the document itself, and so differ on a credit note 381 (MDR-49). */
const CREDIT_NOTE_LABEL_KEYS: Readonly<Record<string, CopyKey>> = { invoiceNumber: 'f.cnNumber', issueDate: 'f.cnIssueDate' };

/**
 * Normalizes `lines[3].quantity` to its label key; group paths and unknown paths fall back to a section name. `documentType`
 * '381' names the credit note's own number and date as such.
 */
export function labelFor(path: string, locale: Locale, documentType: '380' | '381' = '380'): string {
  const tier = SKONTO_FIELD.exec(path);
  if (tier) return `${fill(copy['skonto.tier'][locale], { n: Number(tier[1]) + 1 })}: ${copy[tier[2] === 'days' ? 'f.skontoDays' : 'f.skontoPercent'][locale]}`;
  if (path === 'payment.skonto') return copy['grp.skonto'][locale];
  const normalized = path.replace(/^lines\[\d+\]/, 'lines');
  const key = (documentType === '381' ? CREDIT_NOTE_LABEL_KEYS[normalized] : undefined) ?? LABEL_KEYS[normalized];
  if (key !== undefined) return copy[key][locale];
  if (path === 'seller') return copy['sec.seller'][locale];
  if (path === 'buyer') return copy['sec.buyer'][locale];
  if (path === 'payment') return copy['sec.payment'][locale];
  if (path === 'lines') return copy['sec.lines'][locale];
  return path;
}

/** `payment.skonto[i].days` / `.percent`: a tier field is named with its tier number (counted from 1). */
export const SKONTO_FIELD = /^payment\.skonto\[(\d+)\]\.(days|percent)$/;

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
  'precedingInvoice.number': 'f.precedingNumber', 'precedingInvoice.issueDate': 'f.precedingDate',
  'payment.settlement.reciprocalObligationConfirmed': 'f.clearingConfirmation',
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
  // Structured Skonto (profile limits of this tool, not rules of XRechnung; the pinned validator does not check them).
  unsupported_skonto_tier_count: m('{field}: höchstens 10 Stufen (Grenze dieses Werkzeugs).', '{field}: at most 10 tiers (a limit of this tool).'),
  unsupported_skonto_days: m(
    '{field}: bitte eine ganze Zahl von 1 bis 365 eingeben, nur Ziffern (Grenze dieses Werkzeugs).',
    '{field}: please enter a whole number from 1 to 365, digits only (a limit of this tool).',
  ),
  unsupported_skonto_tier_order: m(
    '{field}: die Tage müssen größer sein als bei der vorherigen Stufe (Grenze dieses Werkzeugs). Die Stufen werden nicht automatisch sortiert.',
    '{field}: the days must be greater than on the previous tier (a limit of this tool). Tiers are not sorted automatically.',
  ),
  unsupported_skonto_percent: m('{field}: mehr als 0 und höchstens 100 (Grenze dieses Werkzeugs).', '{field}: above 0 and at most 100 (a limit of this tool).'),
  unsupported_skonto_base_amount: m('{field}: ein Basisbetrag (BASISBETRAG) wird von diesem Werkzeug nicht unterstützt.', '{field}: a base amount (BASISBETRAG) is not supported by this tool.'),
  unsupported_skonto_on_credit_note: m(
    'Strukturiertes Skonto ist für eine Gutschrift (381) in diesem Werkzeug nicht verfügbar.',
    'Structured Skonto is not available for a credit note (381) in this tool.',
  ),
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
  missing_clearing_confirmation: m(
    'Bestätigen Sie die Verrechnung mit einer bestehenden Gegenforderung, oder wählen Sie den Dokumenttyp Rechnung (380). Die Bestätigung wird nie vorausgewählt.',
    'Confirm the clearing against an existing reciprocal obligation, or choose the document type Invoice (380). The confirmation is never preselected.',
  ),
  missing_payment_due_information: m(
    'Bei einem Zahlbetrag über null ist ein Fälligkeitsdatum oder eine Zahlungsbedingung erforderlich; bei der Rechnung (380) genügt auch strukturiertes Skonto.',
    'With an amount due above zero, a due date or payment terms are required; on an invoice (380) structured Skonto also counts.',
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
  const skontoPercent = SKONTO_FIELD.exec(path)?.[2] === 'percent';
  const example = skontoPercent ? '2,5' : '12,50';
  // The Skonto percentage allows two fractional digits, not the six of quantity and unit price; same code, its own limit.
  const message = code === 'fraction_digits_limit' && skontoPercent ? skontoPercentDigits : errorMessages[code];
  return fill(message[locale], { field: label ?? labelFor(path, locale), sep, example });
}
const skontoPercentDigits = m('{field}: höchstens 2 Nachkommastellen (ohne nachgestellte Nullen).', '{field}: at most 2 fractional digits (trailing zeros not counted).');

/** Compact scope note (MDR-32 obligation at M3). Mirrors the domain README "Supported and not supported"; tool limits are not legal prohibitions. */
export const scopeLists: Record<'now' | 'core' | 'out' | 'tool', { readonly de: readonly string[]; readonly en: readonly string[] }> = {
  now: {
    de: ['Rechnung Typ 380', 'Kaufmännische Gutschrift Typ 381 mit Bezug auf die ursprüngliche Rechnung (Nummer Pflicht, Datum optional), nur mit bestätigter Verrechnung (Code 97)', 'Deutsches Inlandsprofil für gewöhnliche Geschäftsvorgänge zwischen Unternehmen (B2B): Verkäufer und Käufer in Deutschland, Währung EUR. Ob Ihr Vorgang dazu gehört, prüft das Werkzeug nicht', 'Umsatzsteuer: Normalsatz 19 % und ermäßigter Satz 7 %', 'Reverse Charge (§ 13b UStG) je Position, auch zusammen mit 19 % und 7 % in einer Rechnung', 'Kleinunternehmer (§ 19 UStG) für die ganze Rechnung', 'Zahlung der Rechnung per Überweisung (Code 30 oder 58) mit IBAN', 'Strukturiertes Skonto bei der Rechnung (380): bis zu 10 Stufen mit Tagen und Prozent, ohne Basisbetrag; kein Skontobetrag und kein Zahlungsdatum wird berechnet', 'Projekt-, Vertrags- und Bestellreferenz (BT-11, BT-12, BT-13), jeweils optional', 'Leistungsdatum (BT-72) oder Abrechnungszeitraum (BG-14), genau eines von beiden', 'Optionale Leitweg-ID-Prüfung der Käuferreferenz (nur Aufbau und Prüfziffern)', 'Prüfung im Browser gegen die Regeln dieses Werkzeugs und Export als UBL- oder CII-XML'],
    en: ['Invoice type 380', 'Credit note type 381 with a reference to the preceding invoice (number required, date optional), settled only by confirmed clearing (code 97)', 'German domestic profile for ordinary commercial transactions between businesses (B2B): seller and buyer in Germany, currency EUR. The tool does not check whether your transaction is one of them', 'VAT: standard rate 19% and reduced rate 7%', 'Reverse Charge (§ 13b UStG) per line, also together with 19% and 7% in one invoice', 'Kleinunternehmer (§ 19 UStG) for the whole invoice', 'Payment of an invoice by credit transfer (code 30 or 58) with an IBAN', 'Structured Skonto on an invoice (380): up to 10 tiers with days and percent, no base amount; no discount amount or payment date is calculated', 'Project, contract and purchase order references (BT-11, BT-12, BT-13), each optional', 'Date of supply (BT-72) or invoicing period (BG-14), exactly one of the two', 'Optional Leitweg-ID check of the buyer reference (structure and check digits only)', 'Check in the browser against this tool’s rules and export as UBL or CII XML'],
  },
  // Every capability of the frozen contract is now in the interface; the group is not shown while it is empty.
  core: {
    de: [],
    en: [],
  },
  out: {
    de: ['Andere Dokumenttypen als 380 und 381, zum Beispiel Rechnungsberichtigung (384) oder Gutschrift im Sinne des § 14 Abs. 2 Satz 5 UStG, also Abrechnung durch den Leistungsempfänger (389)', 'Andere Währungen als EUR; Beteiligte außerhalb Deutschlands', 'Andere Steuerkategorien, Steuersätze oder Steuerbehandlungen als im Profil', 'Kleinunternehmer (§ 19 UStG) zusammen mit 19 %, 7 % oder Reverse Charge in einer Rechnung', 'Andere Zahlungsarten als Überweisung (30, 58) bei der Rechnung und Verrechnung (97) bei der Gutschrift; Erstattung einer Gutschrift per Überweisung', 'Nachlässe und Zuschläge, auf Dokumentebene wie je Position', 'Bereits gezahlte Beträge und Anzahlungen (BT-113), Teil- und Ratenrechnungen, strukturierte Zahlungspläne', 'Rechnungsbegründende Unterlagen (BG-24): weder Anhänge noch Verweise auf solche Unterlagen', 'Ein eigenes Datum oder ein Code des Steuerzeitpunkts (BT-7, BT-8)', 'Negative Mengen und Preise'],
    en: ['Document types other than 380 and 381, for example a corrected invoice (384) or self-billing under § 14(2) sentence 5 UStG, where the recipient issues the invoice (389)', 'Currencies other than EUR; parties outside Germany', 'VAT categories, rates or treatments beyond the profile', 'Kleinunternehmer (§ 19 UStG) together with 19%, 7% or Reverse Charge in one invoice', 'Payment means other than credit transfer (30, 58) on an invoice and clearing (97) on a credit note; refunding a credit note by credit transfer', 'Allowances and charges, at document level or per line', 'Amounts already paid and prepayments (BT-113), staged or installment invoices, structured payment schedules', 'Supporting documents (BG-24): neither attachments nor references to such documents', 'A separate tax point date or code (BT-7, BT-8)', 'Negative quantities and prices'],
  },
  tool: {
    de: ['XML-Import (vorhandene XRechnung-, UBL- oder CII-Dateien einlesen)', 'PDF-Erzeugung', 'Versand oder Einreichung der Rechnung, etwa über Peppol', 'Benutzerkonten und Anmeldung'],
    en: ['XML import (reading existing XRechnung, UBL or CII files)', 'PDF generation', 'Sending or submitting the invoice, for example via Peppol', 'User accounts and sign-in'],
  },
};
