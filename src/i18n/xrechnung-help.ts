// Contextual help of the XRechnung workspace. Every entry must name its sources; a statement without a source in hand is
// left out, not filled in. Three kinds of statement are kept apart, as in the domain README: external rules (EN 16931,
// XRechnung, UStG), restrictions of this tool's profile (never presented as law), and what is not verified.
// Examples are fictional. Sources: src/lib/domain/xrechnung/README.md and the validation code in document.ts / invoice.ts.

import type { DocumentErrorCode } from '../lib/domain/xrechnung/document.ts';
import type { Locale } from './ui.ts';

export type HelpStatus = 'required' | 'optional' | 'conditional';

export type HelpText = {
  readonly title: string;
  /** Level 1: one sentence of meaning. */
  readonly short: string;
  readonly enter: string;
  readonly status: HelpStatus;
  /** The condition, when the status is conditional. */
  readonly condition?: string;
  readonly format?: string;
  readonly valid?: string;
  readonly invalid?: readonly { readonly value: string; readonly note: string }[];
  readonly external?: readonly string[];
  readonly profile?: readonly string[];
  readonly unverified?: readonly string[];
  /** Section overview: one row per field. */
  readonly fields?: readonly { readonly name: string; readonly status: HelpStatus; readonly format: string }[];
};

export type HelpEntry = {
  readonly bt: string;
  /** DOM id of the field to jump to (undefined for a section: its first field). */
  readonly fieldId?: string;
  /** Diagnostics this field can produce; their texts become the "common mistakes". */
  readonly mistakes?: readonly DocumentErrorCode[];
  readonly sources: readonly [string, ...string[]];
  readonly de: HelpText;
  readonly en: HelpText;
};

const README = 'src/lib/domain/xrechnung/README.md';
const DOC = 'src/lib/domain/xrechnung/document.ts';

export const helpEntries = {
  buyerReference: {
    bt: 'BT-10', fieldId: 'buyerReference', mistakes: ['missing_field', 'empty_text', 'invalid_text', 'text_too_long'],
    sources: [`${README} — Implemented profile; Leitweg-ID validation of BT-10`],
    de: {
      title: 'Käuferreferenz', short: 'Die Referenz, die Ihnen Ihr Käufer für diese Rechnung genannt hat. Beispiel (fiktiv): BR-4711.',
      enter: 'Tragen Sie die Referenz ein, die Ihr Käufer vorgibt. Das Werkzeug erzeugt oder ergänzt diesen Wert nie.',
      status: 'required', format: 'Freier Text ohne Leerzeichen am Anfang oder Ende und ohne Steuerzeichen.', valid: 'BR-4711',
      invalid: [{ value: ' BR-4711', note: 'Leerzeichen am Anfang wird nicht automatisch entfernt.' }],
      external: ['BT-10 muss vorhanden sein (BR-DE-15).'],
      profile: ['Die Käuferreferenz ist nicht zwingend eine Leitweg-ID. Die Leitweg-ID-Prüfung ist eine ausdrückliche Option unter dem Feld; sie ist standardmäßig aus und ändert den Text nie.'],
      unverified: ['Welche Empfänger welche Konvention für die Käuferreferenz erwarten, ist nicht geklärt.'],
    },
    en: {
      title: 'Buyer reference', short: 'The reference your buyer gave you for this invoice. Example (fictional): BR-4711.',
      enter: 'Enter the reference your buyer prescribes. The tool never generates or fills in this value.',
      status: 'required', format: 'Free text with no spaces at the start or end and no control characters.', valid: 'BR-4711',
      invalid: [{ value: ' BR-4711', note: 'A leading space is not removed automatically.' }],
      external: ['BT-10 must be present (BR-DE-15).'],
      profile: ['The buyer reference is not necessarily a Leitweg-ID. The Leitweg-ID check is an explicit option below the field; it is off by default and never changes the text.'],
      unverified: ['Which recipients expect which convention for the buyer reference is not established.'],
    },
  },
  deliveryDate: {
    bt: 'BT-72', fieldId: 'deliveryDate', mistakes: ['missing_field', 'invalid_date'],
    sources: [`${README} — Delivery date or invoicing period (BT-72 or BG-14)`, 'UStG § 14 Abs. 4 Satz 1 Nr. 6 (as cited in the README)'],
    de: {
      title: 'Leistungsdatum', short: 'Das Datum der Lieferung oder sonstigen Leistung.',
      enter: 'Wählen Sie das tatsächliche Datum der Lieferung oder Leistung.', status: 'required',
      format: 'Echtes Kalenderdatum, im Datumsfeld wählbar (intern JJJJ-MM-TT).',
      external: ['Der Zeitpunkt der Leistung ist eine Pflichtangabe der Rechnung nach § 14 Abs. 4 Satz 1 Nr. 6 UStG. Der Validator meldet ein Fehlen nur auf Hinweisebene (BR-DE-TMP-32).'],
      profile: ['Dieses Profil verlangt genau eines von beiden: ein Leistungsdatum (BT-72) oder einen Abrechnungszeitraum (BG-14). Ein ganzer Kalendermonat (§ 31 Abs. 4 UStDV) wird nicht unterstützt. Die Auswahl steht über dem Datumsfeld: Leistungsdatum oder Abrechnungszeitraum.'],
      unverified: ['Ob ein vollständiges Datum alle steuerrechtlichen Anforderungen an den Leistungszeitpunkt erfüllt, wurde nicht geprüft.'],
    },
    en: {
      title: 'Date of supply', short: 'The date of the delivery or other supply.',
      enter: 'Choose the actual date of the delivery or service.', status: 'required',
      format: 'A real calendar date, chosen in the date field (internally YYYY-MM-DD).',
      external: ['The time of supply is a required invoice particular under § 14(4) sentence 1 no. 6 UStG. The validator reports its absence only at information level (BR-DE-TMP-32).'],
      profile: ['This profile requires exactly one of the two: a date of supply (BT-72) or an invoicing period (BG-14). A whole calendar month (§ 31(4) UStDV) is not supported. The choice is above the date field: date of supply or invoicing period.'],
      unverified: ['Whether a complete date meets every tax-law requirement on the time of supply was not checked.'],
    },
  },
  invoicingPeriod: {
    bt: 'BG-14', fieldId: 'invoicingPeriod.startDate', mistakes: ['missing_field', 'invalid_date', 'invalid_invoicing_period'],
    sources: [`${README} — Delivery date or invoicing period (BT-72 or BG-14)`, 'XRechnung 3.0.2 (pinned bundle) — BG-14, BT-73, BT-74, BR-29'],
    de: {
      title: 'Abrechnungszeitraum', short: 'Beginn und Ende des Zeitraums, auf den sich die Rechnung bezieht. Er ersetzt in diesem Werkzeug das einzelne Leistungsdatum.',
      enter: 'Wählen Sie oben „Abrechnungszeitraum“ und tragen Sie Beginn und Ende ein.', status: 'conditional',
      condition: 'Nur wenn statt eines einzelnen Leistungsdatums ein Zeitraum angegeben wird; dann sind Beginn und Ende Pflicht.',
      format: 'Zwei echte Kalenderdaten, im Datumsfeld wählbar (intern JJJJ-MM-TT). Gleiche Daten ergeben einen Zeitraum von einem Tag.',
      valid: '2026-10-01 bis 2026-10-31',
      invalid: [{ value: 'Ende 2026-09-30, Beginn 2026-10-01', note: 'Das Ende liegt vor dem Beginn.' }],
      external: ['Liegen Beginn und Ende vor, darf das Ende nicht vor dem Beginn liegen (BR-29).'],
      profile: ['Dieses Profil verlangt genau eines von beiden: Leistungsdatum (BT-72) oder Abrechnungszeitraum (BG-14), und beim Zeitraum Beginn und Ende. Ein einseitiger Zeitraum und Zeiträume je Position werden nicht unterstützt.'],
      unverified: ['Ob ein vollständiger Abrechnungszeitraum alle steuerrechtlichen Anforderungen an den Leistungszeitpunkt erfüllt, wurde nicht geprüft.'],
    },
    en: {
      title: 'Invoicing period', short: 'Start and end of the period the invoice covers. In this tool it replaces the single date of supply.',
      enter: 'Choose “Invoicing period” above and enter the start and the end.', status: 'conditional',
      condition: 'Only when a period is given instead of a single date of supply; then start and end are required.',
      format: 'Two real calendar dates, chosen in the date field (internally YYYY-MM-DD). Equal dates make a one-day period.',
      valid: '2026-10-01 to 2026-10-31',
      invalid: [{ value: 'End 2026-09-30, start 2026-10-01', note: 'The end is before the start.' }],
      external: ['When both start and end are given, the end must not be before the start (BR-29).'],
      profile: ['This profile requires exactly one of the two: date of supply (BT-72) or invoicing period (BG-14), and for a period both start and end. A one-sided period and line-level periods are not supported.'],
      unverified: ['Whether a complete invoicing period meets every tax-law requirement on the time of supply was not checked.'],
    },
  },
  references: {
    bt: 'BT-11 / BT-12 / BT-13', fieldId: 'projectReference', mistakes: ['invalid_text', 'empty_text', 'text_too_long'],
    sources: [`${README} — Project, contract and order references (BT-11, BT-12, BT-13)`, 'XRechnung 3.0.2 (pinned bundle) — BT-11, BT-12, BT-13'],
    de: {
      title: 'Projekt-, Vertrags- und Bestellnummer', short: 'Drei voneinander unabhängige Angaben, die Ihr Käufer ggf. vorgibt. Beispiel (fiktiv): PRJ-2026-17.',
      enter: 'Tragen Sie nur ein, was Ihnen vorliegt. Leere Felder werden nicht exportiert. Nichts wird aus der Käuferreferenz übernommen oder dorthin kopiert.',
      status: 'optional', format: 'Freier Text ohne Leerzeichen am Anfang oder Ende und ohne Steuerzeichen.', valid: 'PRJ-2026-17',
      invalid: [{ value: ' PRJ-2026-17', note: 'Leerzeichen am Anfang wird nicht automatisch entfernt.' }],
      external: ['Jede der drei Angaben ist höchstens einmal zulässig (0..1). Die Spezifikation nennt: Kennung eines Projektes (BT-11), Bezeichnung des Vertrages (BT-12), vom Erwerber ausgegebene Kennung einer Bestellung (BT-13).'],
      profile: ['Die Bezeichnungen „Projektnummer“, „Vertragsnummer“ und „Bestellnummer“ sind gebräuchliche deutsche Begriffe dieses Werkzeugs; die Spezifikation spricht von „Kennung“.'],
      unverified: ['Ob und wie ein Empfänger diese Angaben auswertet, ist nicht geklärt.'],
    },
    en: {
      title: 'Project, contract and purchase order reference', short: 'Three independent entries your buyer may prescribe. Example (fictional): PRJ-2026-17.',
      enter: 'Enter only what you have. Empty fields are not exported. Nothing is taken from or copied to the buyer reference.',
      status: 'optional', format: 'Free text with no spaces at the start or end and no control characters.', valid: 'PRJ-2026-17',
      invalid: [{ value: ' PRJ-2026-17', note: 'A leading space is not removed automatically.' }],
      external: ['Each of the three may occur at most once (0..1). The specification describes: the identifier of a project (BT-11), a unique identification of the contract (BT-12), an identifier issued by the buyer for a referenced order (BT-13).'],
      profile: ['The German view labels these “Projektnummer”, “Vertragsnummer” and “Bestellnummer”, common German terms chosen by this tool; the specification speaks of an identifier.'],
      unverified: ['Whether and how a recipient uses these entries is not established.'],
    },
  },
  leitwegCheck: {
    bt: 'BT-10', fieldId: 'leitwegCheck', mistakes: ['invalid_leitweg_id_format', 'invalid_leitweg_id_checksum'],
    sources: [`${README} — Leitweg-ID validation of BT-10`, 'src/lib/domain/xrechnung/leitweg-id.ts'],
    de: {
      title: 'Leitweg-ID-Prüfung', short: 'Prüft die Käuferreferenz auf den Aufbau einer Leitweg-ID und ihre Prüfziffern. Standardmäßig aus.',
      enter: 'Aktivieren Sie die Prüfung nur, wenn Ihr Käufer eine Leitweg-ID vorgibt. Das Werkzeug erkennt oder aktiviert sie nie von selbst und verändert die Käuferreferenz nie.',
      status: 'optional', format: 'Grobadresse (2, 3, 5, 8, 9 oder 12 Ziffern, beginnend mit 01–16 oder 99), optional „-“ und Feinadresse (bis 30 Buchstaben/Ziffern), „-“ und zwei Prüfziffern.',
      valid: '04011000-12345-03',
      invalid: [{ value: '04011000-12345-00', note: 'Aufbau stimmt, die Prüfziffern nicht.' }, { value: 'BR-4711', note: 'Kein Leitweg-ID-Aufbau.' }],
      profile: ['Geprüft werden lokal nur Aufbau und Prüfziffern (die Prüfziffern müssen dem üblichen Wert „98 minus Rest modulo 97“ entsprechen). Das ist eine Festlegung dieses Werkzeugs. Bei eingeschalteter Prüfung blockiert eine nicht bestandene Käuferreferenz die Prüfung und den Export.'],
      unverified: ['Ob eine Leitweg-ID zugeteilt ist, ob ein Empfänger sie annimmt oder die Rechnung damit zustellbar ist, wird nicht geprüft. Dies ist kein vollständiger Ablauf für Rechnungen an die öffentliche Hand.'],
    },
    en: {
      title: 'Leitweg-ID check', short: 'Checks the buyer reference for the structure of a Leitweg-ID and its check digits. Off by default.',
      enter: 'Turn the check on only if your buyer prescribes a Leitweg-ID. The tool never detects or activates it by itself and never changes the buyer reference.',
      status: 'optional', format: 'A coarse address (2, 3, 5, 8, 9 or 12 digits, starting with 01–16 or 99), optionally “-” and a fine address (up to 30 letters/digits), “-” and two check digits.',
      valid: '04011000-12345-03',
      invalid: [{ value: '04011000-12345-00', note: 'The structure is right, the check digits are not.' }, { value: 'BR-4711', note: 'Not the structure of a Leitweg-ID.' }],
      profile: ['Only the structure and the check digits are checked, locally (the check digits must equal the usual “98 minus remainder modulo 97”). That is a choice of this tool. With the check on, a buyer reference that does not pass blocks the check and the export.'],
      unverified: ['Whether a Leitweg-ID is assigned, whether a recipient accepts it or can be reached with it is not checked. This is not a complete workflow for invoices to public authorities.'],
    },
  },
  sellerVatId: {
    bt: 'BT-31', fieldId: 'seller.vatId', mistakes: ['invalid_vat_id', 'invalid_text', 'missing_seller_tax_identifier', 'missing_seller_identification'],
    sources: [`${README} — Implemented profile (rule table)`, `${DOC} — readSeller`],
    de: {
      title: 'USt-IdNr. des Verkäufers', short: 'Die deutsche Umsatzsteuer-Identifikationsnummer des Verkäufers. Beispiel (fiktiv): DE123456789.',
      enter: 'Tragen Sie die USt-IdNr. des Verkäufers ein, falls vorhanden.', status: 'conditional',
      condition: 'USt-IdNr. oder Steuernummer ist erforderlich (mindestens eine).', format: '„DE“ und genau 9 Ziffern, ohne Leerzeichen.', valid: 'DE123456789',
      invalid: [{ value: '123456789', note: 'Ländercode fehlt.' }, { value: 'DE 123456789', note: 'Leerzeichen.' }],
      external: ['Der Verkäufer braucht BT-31 oder BT-32 (BR-S-02, BR-DE-16). Außerdem braucht er eine Kennung nach BR-CO-26: BT-29, BT-30 oder BT-31.'],
      profile: ['Dieses Profil akzeptiert nur „DE“ plus 9 Ziffern.'],
      unverified: ['Wann das UStG welche Kennung verlangt, wird hier nicht wiedergegeben, solange keine geprüfte Quelle vorliegt.'],
    },
    en: {
      title: 'Seller VAT ID', short: 'The seller’s German VAT identification number. Example (fictional): DE123456789.',
      enter: 'Enter the seller’s VAT ID, if there is one.', status: 'conditional',
      condition: 'A VAT ID or a tax number is required (at least one).', format: '“DE” and exactly 9 digits, no spaces.', valid: 'DE123456789',
      invalid: [{ value: '123456789', note: 'Country code missing.' }, { value: 'DE 123456789', note: 'Contains a space.' }],
      external: ['The seller needs BT-31 or BT-32 (BR-S-02, BR-DE-16). The seller also needs an identification under BR-CO-26: BT-29, BT-30 or BT-31.'],
      profile: ['This profile accepts only “DE” followed by 9 digits.'],
      unverified: ['When the UStG requires which identifier is not restated here until a checked source is in hand.'],
    },
  },
  sellerTaxNumber: {
    bt: 'BT-32', fieldId: 'seller.taxRegistrationId', mistakes: ['invalid_text', 'missing_seller_tax_identifier', 'missing_seller_identification'],
    sources: [`${README} — Implemented profile (rule table)`, `${DOC} — readSeller (BR-CO-26 and the tax-identifier rule are independent)`],
    de: {
      title: 'Steuernummer des Verkäufers', short: 'Die Steuernummer des Verkäufers als Alternative zur USt-IdNr.',
      enter: 'Tragen Sie die Steuernummer ein, wenn keine USt-IdNr. angegeben wird.', status: 'conditional',
      condition: 'USt-IdNr. oder Steuernummer ist erforderlich (mindestens eine).', format: 'Freier Text; über die allgemeinen Textregeln hinaus wird kein Format geprüft.',
      external: ['BT-31 oder BT-32 ist erforderlich (BR-S-02, BR-DE-16).'],
      profile: ['BT-32 allein erfüllt die Verkäuferkennung nach BR-CO-26 nicht: zusätzlich ist BT-29, BT-30 oder BT-31 erforderlich.'],
    },
    en: {
      title: 'Seller tax number', short: 'The seller’s tax number, as an alternative to the VAT ID.',
      enter: 'Enter the tax number when no VAT ID is given.', status: 'conditional',
      condition: 'A VAT ID or a tax number is required (at least one).', format: 'Free text; no format is checked beyond the general text rules.',
      external: ['BT-31 or BT-32 is required (BR-S-02, BR-DE-16).'],
      profile: ['BT-32 alone does not satisfy the seller identification of BR-CO-26: BT-29, BT-30 or BT-31 is also required.'],
    },
  },
  sellerIdentification: {
    bt: 'BT-29 / BT-30', fieldId: 'seller.legalRegistrationId', mistakes: ['missing_seller_identification', 'invalid_text', 'text_too_long'],
    sources: [`${DOC} — readSeller (BR-CO-26)`, `${README} — Implemented profile`],
    de: {
      title: 'Weitere Kennung des Verkäufers', short: 'Registernummer (BT-30) oder eine sonstige Verkäuferkennung (BT-29).',
      enter: 'Tragen Sie eine Registernummer oder eine sonstige Kennung des Verkäufers ein.', status: 'conditional',
      condition: 'Mindestens eines von USt-IdNr. (BT-31), Registernummer (BT-30) oder Kennung (BT-29) ist erforderlich.', format: 'Freier Text, ohne Schema.',
      external: ['BR-CO-26: mindestens eines von BT-29, BT-30, BT-31.'],
      profile: ['Dieses Werkzeug kennt kein Schema für diese Kennungen.'],
      unverified: ['Was ein Verkäufer ohne USt-IdNr. und ohne Registernummer hier eintragen soll, ist durch die ausgewerteten Quellen nicht geklärt. Das Werkzeug gibt dafür keine Empfehlung.'],
    },
    en: {
      title: 'Further seller identification', short: 'A legal registration ID (BT-30) or another seller identifier (BT-29).',
      enter: 'Enter a legal registration ID or another identifier of the seller.', status: 'conditional',
      condition: 'At least one of VAT ID (BT-31), legal registration ID (BT-30) or identifier (BT-29) is required.', format: 'Free text, without a scheme.',
      external: ['BR-CO-26: at least one of BT-29, BT-30, BT-31.'],
      profile: ['This tool has no scheme for these identifiers.'],
      unverified: ['What a seller with neither a VAT ID nor a registration number should enter here is not settled by the sources consulted. The tool gives no recommendation.'],
    },
  },
  electronicAddress: {
    bt: 'BT-34 / BT-49', fieldId: 'seller.electronicAddress.value', mistakes: ['missing_field', 'unsupported_electronic_address_scheme', 'invalid_email', 'invalid_text'],
    sources: [`${README} — Implemented profile (BR-62, BR-63; schemes EM, 0204, 0088)`, `${DOC} — readPartyFields`],
    de: {
      title: 'Elektronische Adresse', short: 'Adresse des Verkäufers oder Käufers mit Schemakennung, z. B. EM und eine E-Mail-Adresse.',
      enter: 'Wählen Sie das Schema und tragen Sie die Adresse ein.', status: 'required', format: 'Bei EM: eine E-Mail-Adresse. Bei 0204 und 0088: Text ohne Leerzeichen am Rand und ohne Steuerzeichen.',
      external: ['Das Schema ist Pflicht (BR-62 für den Verkäufer, BR-63 für den Käufer).'],
      profile: ['Es werden nur die Schemata EM, 0204 und 0088 unterstützt. Die Schemakennung hat in diesem Werkzeug keine Routing- oder Leitweg-ID-Bedeutung; nur bei EM wird der Wert als E-Mail-Adresse geprüft.'],
    },
    en: {
      title: 'Electronic address', short: 'Address of the seller or buyer with a scheme identifier, e.g. EM and an e-mail address.',
      enter: 'Choose the scheme and enter the address.', status: 'required', format: 'For EM: an e-mail address. For 0204 and 0088: text with no spaces at the edges and no control characters.',
      external: ['The scheme is mandatory (BR-62 for the seller, BR-63 for the buyer).'],
      profile: ['Only the schemes EM, 0204 and 0088 are supported. The scheme identifier has no routing or Leitweg-ID meaning in this tool; only for EM is the value checked as an e-mail address.'],
    },
  },
  sellerContact: {
    bt: 'BG-6', fieldId: 'seller.contact.name', mistakes: ['missing_field', 'invalid_email', 'invalid_telephone', 'invalid_text'],
    sources: [`${README} — Implemented profile (BR-DE-2, -5, -6, -7)`, `${DOC} — readContact (telephone and e-mail checks)`],
    de: {
      title: 'Ansprechpartner des Verkäufers', short: 'Name, Telefon und E-Mail einer Kontaktperson des Verkäufers.',
      enter: 'Tragen Sie alle drei Angaben ein.', status: 'required', format: 'Telefon: mindestens 3 Ziffern. E-Mail: ein einfaches Adressformat ohne Leerzeichen.',
      external: ['Kontaktname, Telefon und E-Mail des Verkäufers sind Pflicht (BR-DE-2, BR-DE-5, BR-DE-6, BR-DE-7).'],
      profile: ['Die Prüfung von Telefon und E-Mail ist eine einfache Strukturprüfung dieses Werkzeugs.'],
    },
    en: {
      title: 'Seller contact', short: 'Name, telephone and e-mail of a contact person at the seller.',
      enter: 'Enter all three.', status: 'required', format: 'Telephone: at least 3 digits. E-mail: a simple address format with no spaces.',
      external: ['Contact name, telephone and e-mail of the seller are mandatory (BR-DE-2, BR-DE-5, BR-DE-6, BR-DE-7).'],
      profile: ['The telephone and e-mail checks are a simple structure check of this tool.'],
    },
  },
  unitCode: {
    bt: 'BT-130', mistakes: ['missing_field', 'unsupported_unit_code'],
    sources: [`${DOC} — UNIT_CODES (UN/ECE Recommendation 20/21; present in the KoSIT configuration 2026-08-31)`],
    de: {
      title: 'Einheit', short: 'Maßeinheit der Menge, aus einer kurzen Liste von UN/ECE-Codes.',
      enter: 'Wählen Sie die Einheit der Position.', status: 'required', format: 'Auswahl aus: C62, H87, HUR, DAY, MON, KGM, LTR, MTR.',
      profile: ['Dieses Profil unterstützt nur diese acht Codes; weitere Einheiten gibt es hier nicht.'],
      unverified: ['Die deutschen Bezeichnungen der Codes in der Auswahl sind Anzeigetexte und wurden nicht gegen die Codeliste geprüft.'],
    },
    en: {
      title: 'Unit', short: 'Unit of measure of the quantity, from a short list of UN/ECE codes.',
      enter: 'Choose the unit of the line.', status: 'required', format: 'Choose from: C62, H87, HUR, DAY, MON, KGM, LTR, MTR.',
      profile: ['This profile supports only these eight codes; other units are not available here.'],
      unverified: ['The names shown for the codes are display labels and were not checked against the code list.'],
    },
  },
  quantityPrice: {
    bt: 'BT-129 / BT-146', mistakes: ['invalid_decimal', 'negative_amount', 'fraction_digits_limit', 'magnitude_limit', 'calculated_amount_limit'],
    sources: [`${README} — Implemented profile (limits)`, 'src/lib/domain/xrechnung/number-notation.ts — notations'],
    de: {
      title: 'Menge und Einzelpreis', short: 'Beides als Zahl mit Komma als Dezimaltrennzeichen, z. B. 12,50.',
      enter: 'Tragen Sie die Menge und den Netto-Einzelpreis je Einheit ein.', status: 'required',
      format: 'Ziffern mit Komma als Dezimaltrennzeichen; optional Punkt als Tausendertrennzeichen in Dreiergruppen (1.234,50). Höchstens 6 Nachkommastellen, ohne nachgestellte Nullen gezählt; Wert unter 1.000.000.000.', valid: '12,50',
      invalid: [{ value: '12.5.0', note: 'Gemischte Trennzeichen.' }, { value: '-3', note: 'Negative Werte werden nicht unterstützt.' }],
      profile: ['Die Grenzen sind Schutzgrenzen dieses Werkzeugs (Interoperabilität mit dem Validator), keine Vorgabe der Norm. Berechnet wird ausschließlich vom Domänenmodell.'],
    },
    en: {
      title: 'Quantity and unit price', short: 'Both as a number with a point as decimal separator, e.g. 12.50.',
      enter: 'Enter the quantity and the net unit price per unit.', status: 'required',
      format: 'Digits with a point as decimal separator; optionally a comma as thousands separator in groups of three (1,234.50). At most 6 fractional digits (trailing zeros not counted); value below 1,000,000,000.', valid: '12.50',
      invalid: [{ value: '12.5.0', note: 'Mixed separators.' }, { value: '-3', note: 'Negative values are not supported.' }],
      profile: ['The limits are protective limits of this tool (interoperability with the validator), not a rule of the standard. Only the domain model calculates.'],
    },
  },
  vatRate: {
    bt: 'BT-152', mistakes: ['unsupported_vat_rate', 'missing_field'],
    sources: [`${README} — Implemented profile (standard VAT 19 % and 7 %)`],
    de: {
      title: 'USt-Satz', short: 'Steuersatz der Position: 19 % oder 7 %.',
      enter: 'Wählen Sie den Steuersatz. Es wird keiner vorausgewählt.', status: 'required', format: 'Auswahl: 19 % oder 7 %.',
      profile: ['Dieses Werkzeug unterstützt in dieser Ausbaustufe nur den Regelsteuersatz (19 %) und den ermäßigten Satz (7 %). Es prüft nicht, welcher Satz für Ihre Leistung zutrifft.'],
    },
    en: {
      title: 'VAT rate', short: 'VAT rate of the line: 19 % or 7 %.',
      enter: 'Choose the rate. None is preselected.', status: 'required', format: 'Choose 19 % or 7 %.',
      profile: ['In this stage the tool supports only the standard rate (19 %) and the reduced rate (7 %). It does not check which rate applies to your supply.'],
    },
  },
  paymentMeans: {
    bt: 'BT-81', fieldId: 'payment.means.code', mistakes: ['missing_field', 'unsupported_payment_means'],
    sources: [`${README} — Implemented profile (payment means 30 or 58)`, `${DOC} — readPayment (BR-DE-19, BR-DE-23, BR-CL-16)`],
    de: {
      title: 'Zahlungsart', short: '30 ist eine Überweisung allgemein, 58 eine SEPA-Überweisung.',
      enter: 'Wählen Sie den Code. Es wird keiner vorausgewählt; die Wahl liegt bei Ihnen.', status: 'required', format: 'Auswahl: 30 oder 58, jeweils mit IBAN.',
      external: ['BR-DE-23: 30 und 58 gelten als Überweisung. BR-DE-19: bei 58 wird eine gültige IBAN erwartet.'],
      profile: ['Unterstützt wird ein Konto mit IBAN. Andere Zahlungsarten und Konten ohne IBAN gibt es hier nicht. Die IBAN wird bei beiden Codes geprüft.'],
      unverified: ['Welcher Code für Ihre Rechnung passend ist, entscheiden Sie; das Werkzeug wählt keinen.'],
    },
    en: {
      title: 'Payment means', short: '30 is a credit transfer in general, 58 is a SEPA credit transfer.',
      enter: 'Choose the code. None is preselected; the choice is yours.', status: 'required', format: 'Choose 30 or 58, each with an IBAN.',
      external: ['BR-DE-23: 30 and 58 count as credit transfer. BR-DE-19: with 58 a valid IBAN is expected.'],
      profile: ['One account with an IBAN is supported. Other payment means and accounts without an IBAN are not available here. The IBAN is checked with both codes.'],
      unverified: ['Which code is suitable for your invoice is your decision; the tool chooses none.'],
    },
  },
  iban: {
    bt: 'BT-84', fieldId: 'payment.means.account.id.value', mistakes: ['missing_field', 'invalid_iban', 'invalid_text'],
    sources: [`${DOC} — isValidIban (ISO 13616 mod-97; no per-country length check, like the validator)`],
    de: {
      title: 'IBAN', short: 'Die IBAN des Kontos, auf das gezahlt werden soll. Beispiel (fiktiv): DE79000000001234567890.',
      enter: 'Tragen Sie die IBAN durchgehend, ohne Leerzeichen und in Großbuchstaben ein. Dieses Werkzeug ändert Ihre Eingabe nicht automatisch.', status: 'required', format: 'Zwei Buchstaben, zwei Prüfziffern, danach 11 bis 30 Buchstaben oder Ziffern. Die Prüfziffern (Stellen 3–4) müssen rechnerisch zu den übrigen Zeichen passen (ISO 13616, Modulo 97); richtige Länge und Zeichen allein genügen nicht.', valid: 'DE79000000001234567890',
      invalid: [
        { value: 'DE79 0000 0000 1234 5678 90', note: 'Leerzeichen.' },
        { value: 'de79000000001234567890', note: 'Kleinbuchstaben.' },
        { value: 'DE79000000001234567891', note: 'Aufbau richtig, aber eine Ziffer gegenüber dem gültigen Beispiel geändert: Die Prüfsumme stimmt nicht mehr.' },
      ],
      profile: ['Die Länge je Land wird nicht geprüft (wie im Validator).'],
    },
    en: {
      title: 'IBAN', short: 'The IBAN of the account to be paid. Example (fictional): DE79000000001234567890.',
      enter: 'Enter the IBAN as one continuous string in capital letters without spaces. This tool does not change your input automatically.', status: 'required', format: 'Two letters, two check digits, then 11 to 30 letters or digits. The check digits (positions 3–4) must be mathematically consistent with the remaining characters (ISO 13616, mod 97); correct length and characters alone are not enough.', valid: 'DE79000000001234567890',
      invalid: [
        { value: 'DE79 0000 0000 1234 5678 90', note: 'Contains spaces.' },
        { value: 'de79000000001234567890', note: 'Lower case.' },
        { value: 'DE79000000001234567891', note: 'Well-formed, but one digit differs from the valid example: the checksum no longer matches.' },
      ],
      profile: ['The per-country length is not checked (like the validator).'],
    },
  },
  bic: {
    bt: 'BT-86', fieldId: 'payment.means.account.bic', mistakes: ['invalid_bic', 'invalid_text'],
    sources: [`${DOC} — BIC structure check (ISO 9362)`],
    de: {
      title: 'BIC', short: 'Optional: der BIC der Bank.', enter: 'Tragen Sie den BIC ein, wenn Sie ihn angeben möchten.', status: 'optional',
      format: '8 oder 11 Zeichen: 4 Buchstaben, 2 Buchstaben (Land), 2 Zeichen (Ort), optional 3 Zeichen (Filiale); Großbuchstaben.',
      profile: ['Der BIC ist hier optional (im Gegensatz zu manchen Vorlagen).'],
    },
    en: {
      title: 'BIC', short: 'Optional: the BIC of the bank.', enter: 'Enter the BIC if you want to give it.', status: 'optional',
      format: '8 or 11 characters: 4 letters, 2 letters (country), 2 characters (location), optional 3 characters (branch); capital letters.',
      profile: ['The BIC is optional here (unlike in some templates).'],
    },
  },
  paymentDue: {
    bt: 'BT-9 / BT-20', fieldId: 'payment.dueDate', mistakes: ['missing_payment_due_information', 'invalid_date', 'unsupported_hash_in_payment_terms', 'invalid_text'],
    sources: [`${README} — Implemented profile (BR-CO-25; BT-9 and BT-20 independent)`],
    de: {
      title: 'Fälligkeit', short: 'Fälligkeitsdatum (BT-9) und/oder Zahlungsbedingungen als Text (BT-20).',
      enter: 'Geben Sie ein Fälligkeitsdatum, Zahlungsbedingungen oder beides an.', status: 'conditional',
      condition: 'Bei einem Zahlbetrag über null ist mindestens eines von beiden erforderlich.', format: 'Datum im Datumsfeld wählen. Zahlungsbedingungen: freier Text, Zeilenumbrüche erlaubt, kein „#“.',
      external: ['BR-CO-25: bei positivem Zahlbetrag ist BT-9 oder BT-20 erforderlich. Der gepinnte Validator setzt die Regel nicht um; dieses Werkzeug prüft sie nach der Berechnung.'],
      profile: ['Es gibt keine Voreinstellungen für Zahlungsbedingungen. Strukturiertes Skonto ist in dieser Ausbaustufe nicht bedienbar.'],
    },
    en: {
      title: 'Payment due', short: 'Due date (BT-9) and/or payment terms as text (BT-20).',
      enter: 'Give a due date, payment terms, or both.', status: 'conditional',
      condition: 'With an amount due above zero, at least one of the two is required.', format: 'Choose the date in the date field. Payment terms: free text, line breaks allowed, no “#”.',
      external: ['BR-CO-25: with a positive amount due, BT-9 or BT-20 is required. The pinned validator does not implement this rule; this tool checks it after the calculation.'],
      profile: ['There are no presets for payment terms. Structured Skonto cannot be used in this stage.'],
    },
  },
  'sec.seller': {
    bt: 'BG-4', fieldId: 'seller.name', sources: [`${README} — Implemented profile`, `${DOC} — readSeller`],
    de: {
      title: 'Verkäufer (Rechnungssteller)', short: 'Angaben zum Rechnungssteller.', enter: 'Name, Anschrift, elektronische Adresse, Ansprechpartner und steuerliche Kennung.', status: 'required',
      fields: [
        { name: 'Name', status: 'required', format: 'Text' },
        { name: 'Anschrift (Land: DE)', status: 'required', format: 'Straße, PLZ, Ort' },
        { name: 'Elektronische Adresse', status: 'required', format: 'Schema und Adresse' },
        { name: 'Ansprechpartner', status: 'required', format: 'Name, Telefon, E-Mail' },
        { name: 'USt-IdNr. oder Steuernummer', status: 'conditional', format: 'DE + 9 Ziffern, oder Text' },
        { name: 'Registernummer oder Kennung', status: 'conditional', format: 'Text (mindestens eine Kennung insgesamt)' },
      ],
      profile: ['Der Verkäufer muss in Deutschland sitzen (Profil dieses Werkzeugs).'],
    },
    en: {
      title: 'Seller (invoice issuer)', short: 'Details of the invoice issuer.', enter: 'Name, address, electronic address, contact and tax identification.', status: 'required',
      fields: [
        { name: 'Name', status: 'required', format: 'Text' },
        { name: 'Address (country: DE)', status: 'required', format: 'Street, post code, city' },
        { name: 'Electronic address', status: 'required', format: 'Scheme and address' },
        { name: 'Contact', status: 'required', format: 'Name, telephone, e-mail' },
        { name: 'VAT ID or tax number', status: 'conditional', format: 'DE + 9 digits, or text' },
        { name: 'Registration ID or identifier', status: 'conditional', format: 'Text (at least one identification overall)' },
      ],
      profile: ['The seller must be located in Germany (profile of this tool).'],
    },
  },
  'sec.buyer': {
    bt: 'BG-7', fieldId: 'buyer.name', sources: [`${README} — Implemented profile`, `${DOC} — readBuyer`],
    de: {
      title: 'Käufer (Rechnungsempfänger)', short: 'Angaben zum Rechnungsempfänger.', enter: 'Name, Anschrift und elektronische Adresse; die USt-IdNr. ist optional.', status: 'required',
      fields: [
        { name: 'Name', status: 'required', format: 'Text' },
        { name: 'Anschrift (Land: DE)', status: 'required', format: 'Straße, PLZ, Ort' },
        { name: 'Elektronische Adresse', status: 'required', format: 'Schema und Adresse' },
        { name: 'USt-IdNr.', status: 'optional', format: 'DE + 9 Ziffern' },
      ],
      profile: ['Der Käufer muss in Deutschland sitzen (Profil dieses Werkzeugs). Die Käuferreferenz (BT-10) steht bei den Rechnungsdaten.'],
    },
    en: {
      title: 'Buyer (invoice recipient)', short: 'Details of the invoice recipient.', enter: 'Name, address and electronic address; the VAT ID is optional.', status: 'required',
      fields: [
        { name: 'Name', status: 'required', format: 'Text' },
        { name: 'Address (country: DE)', status: 'required', format: 'Street, post code, city' },
        { name: 'Electronic address', status: 'required', format: 'Scheme and address' },
        { name: 'VAT ID', status: 'optional', format: 'DE + 9 digits' },
      ],
      profile: ['The buyer must be located in Germany (profile of this tool). The buyer reference (BT-10) is part of the invoice details.'],
    },
  },
  'sec.lines': {
    bt: 'BG-25', fieldId: 'lines[0].name', sources: [`${README} — Implemented profile`],
    de: {
      title: 'Rechnungspositionen', short: 'Mindestens eine Position mit Menge, Einzelpreis und Steuersatz.', enter: 'Je Position: Beschreibung, Einheit, Menge, Netto-Einzelpreis, USt-Satz.', status: 'required',
      fields: [
        { name: 'Beschreibung', status: 'required', format: 'Text' },
        { name: 'Einheit', status: 'required', format: 'Auswahl' },
        { name: 'Menge', status: 'required', format: 'Zahl' },
        { name: 'Einzelpreis (netto)', status: 'required', format: 'Zahl' },
        { name: 'USt-Satz', status: 'required', format: '19 % oder 7 %' },
      ],
      profile: ['Beträge werden ausschließlich vom Domänenmodell berechnet; der Nettobetrag je Position ist eine Anzeige.'],
    },
    en: {
      title: 'Invoice lines', short: 'At least one line with quantity, unit price and VAT rate.', enter: 'Per line: description, unit, quantity, net unit price, VAT rate.', status: 'required',
      fields: [
        { name: 'Description', status: 'required', format: 'Text' },
        { name: 'Unit', status: 'required', format: 'Choice' },
        { name: 'Quantity', status: 'required', format: 'Number' },
        { name: 'Unit price (net)', status: 'required', format: 'Number' },
        { name: 'VAT rate', status: 'required', format: '19 % or 7 %' },
      ],
      profile: ['Amounts are calculated only by the domain model; the net amount per line is a display.'],
    },
  },
  'sec.payment': {
    bt: 'BG-16', fieldId: 'payment.means.code', sources: [`${README} — Implemented profile`],
    de: {
      title: 'Zahlung', short: 'Zahlungsart, Konto und Fälligkeit.', enter: 'Code, IBAN und mindestens Fälligkeitsdatum oder Zahlungsbedingungen.', status: 'required',
      fields: [
        { name: 'Zahlungsart', status: 'required', format: '30 oder 58' },
        { name: 'IBAN', status: 'required', format: 'ohne Leerzeichen' },
        { name: 'Kontoinhaber', status: 'optional', format: 'Text' },
        { name: 'BIC', status: 'optional', format: '8 oder 11 Zeichen' },
        { name: 'Fälligkeitsdatum / Zahlungsbedingungen', status: 'conditional', format: 'mindestens eines bei offenem Betrag' },
      ],
    },
    en: {
      title: 'Payment', short: 'Payment means, account and due information.', enter: 'Code, IBAN and at least a due date or payment terms.', status: 'required',
      fields: [
        { name: 'Payment means', status: 'required', format: '30 or 58' },
        { name: 'IBAN', status: 'required', format: 'no spaces' },
        { name: 'Account holder', status: 'optional', format: 'Text' },
        { name: 'BIC', status: 'optional', format: '8 or 11 characters' },
        { name: 'Due date / payment terms', status: 'conditional', format: 'at least one with an amount due' },
      ],
    },
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof helpEntries;
export const helpFor = (id: HelpId, locale: Locale): HelpText => helpEntries[id][locale];
