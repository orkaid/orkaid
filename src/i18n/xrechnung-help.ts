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
  /** The field whose wording the common mistakes use when it is not `fieldId` (a code whose limit depends on the field). */
  readonly mistakesFieldId?: string;
  readonly sources: readonly [string, ...string[]];
  readonly de: HelpText;
  readonly en: HelpText;
};

const README = 'src/lib/domain/xrechnung/README.md';
const DOC = 'src/lib/domain/xrechnung/document.ts';
const INV = 'src/lib/domain/xrechnung/invoice.ts';
// Wording of the statutory titles and the § 14a Abs. 5 phrase read on gesetze-im-internet.de on 2026-11-09 (the pages carry no Stand date).
const USTG = 'UStG § 19 „Besteuerung der Kleinunternehmer“, § 13b „Leistungsempfänger als Steuerschuldner“, § 14a Abs. 5 (gesetze-im-internet.de, gelesen 2026-11-09)';
// Terminology reconciliation of 2026-11-27 (AI-assisted source reading, not professional verification).
const USTG_1127 = 'UStG § 13b Abs. 5, § 14 Abs. 2 Satz 5, § 17 Abs. 1, § 19 Abs. 1 (gesetze-im-internet.de, gelesen 2026-11-27)';
const BGB_1127 = 'BGB §§ 387–389 (gesetze-im-internet.de, gelesen 2026-11-27)';
const XR302 = 'XRechnung 3.0.2 (KoSIT, veröffentlicht 20.06.2024), Abschnitte 13.1–13.3 und BR-DE-18';
const BMF_FAQ = 'BMF, FAQ zur E-Rechnung, Frage 7b (Seite vom 29.10.2026, gelesen 2026-11-27)';
const UNCL4461 = 'UNTDID 4461 D.16B, Code 97 „Clearing between partners“ (OpenPeppol BIS Billing 3.0 code list, gelesen 2026-11-27)';

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
      enter: 'Tragen Sie das tatsächliche Datum der Lieferung oder Leistung ein.', status: 'required',
      format: 'Echtes Kalenderdatum als TT.MM.JJJJ, z. B. 07.11.2026.',
      external: ['Der Zeitpunkt der Leistung ist eine Pflichtangabe der Rechnung nach § 14 Abs. 4 Satz 1 Nr. 6 UStG. Der Validator meldet ein Fehlen nur auf Hinweisebene (BR-DE-TMP-32).'],
      profile: ['Dieses Profil verlangt genau eines von beiden: ein Leistungsdatum (BT-72) oder einen Abrechnungszeitraum (BG-14). Ein ganzer Kalendermonat (§ 31 Abs. 4 UStDV) wird nicht unterstützt. Die Auswahl steht über dem Datumsfeld: Leistungsdatum oder Abrechnungszeitraum.'],
      unverified: ['Ob ein vollständiges Datum alle steuerrechtlichen Anforderungen an den Leistungszeitpunkt erfüllt, wurde nicht geprüft.'],
    },
    en: {
      title: 'Date of supply', short: 'The date of the delivery or other supply.',
      enter: 'Enter the actual date of the delivery or service.', status: 'required',
      format: 'A real calendar date as DD.MM.YYYY, e.g. 07.11.2026 (the same format on the German and the English page).',
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
      format: 'Zwei echte Kalenderdaten als TT.MM.JJJJ, z. B. 01.10.2026 und 31.10.2026. Gleiche Daten ergeben einen Zeitraum von einem Tag.',
      valid: '01.10.2026 bis 31.10.2026',
      invalid: [{ value: 'Ende 30.09.2026, Beginn 01.10.2026', note: 'Das Ende liegt vor dem Beginn.' }],
      external: ['Liegen Beginn und Ende vor, darf das Ende nicht vor dem Beginn liegen (BR-29).'],
      profile: ['Dieses Profil verlangt genau eines von beiden: Leistungsdatum (BT-72) oder Abrechnungszeitraum (BG-14), und beim Zeitraum Beginn und Ende. Ein einseitiger Zeitraum und Zeiträume je Position werden nicht unterstützt.'],
      unverified: ['Ob ein vollständiger Abrechnungszeitraum alle steuerrechtlichen Anforderungen an den Leistungszeitpunkt erfüllt, wurde nicht geprüft.'],
    },
    en: {
      title: 'Invoicing period', short: 'Start and end of the period the invoice covers. In this tool it replaces the single date of supply.',
      enter: 'Choose “Invoicing period” above and enter the start and the end.', status: 'conditional',
      condition: 'Only when a period is given instead of a single date of supply; then start and end are required.',
      format: 'Two real calendar dates as DD.MM.YYYY, e.g. 01.10.2026 and 31.10.2026 (the same format on the German and the English page). Equal dates make a one-day period.',
      valid: '01.10.2026 to 31.10.2026',
      invalid: [{ value: 'End 30.09.2026, start 01.10.2026', note: 'The end is before the start.' }],
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
      profile: ['BT-32 allein erfüllt die zweite Gruppe (BR-CO-26: BT-29, BT-30 oder BT-31) nicht; zusätzlich ist BT-29, BT-30 oder BT-31 erforderlich. Für Verkäufer, die nur eine Steuernummer haben, gibt das Werkzeug keine Empfehlung.'],
    },
    en: {
      title: 'Seller tax number', short: 'The seller’s tax number, as an alternative to the VAT ID.',
      enter: 'Enter the tax number when no VAT ID is given.', status: 'conditional',
      condition: 'A VAT ID or a tax number is required (at least one).', format: 'Free text; no format is checked beyond the general text rules.',
      external: ['BT-31 or BT-32 is required (BR-S-02, BR-DE-16).'],
      profile: ['BT-32 alone does not satisfy the second group (BR-CO-26: BT-29, BT-30 or BT-31); BT-29, BT-30 or BT-31 is also required. The tool gives no recommendation for a seller who holds only a tax number.'],
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
      profile: ['Dieses Werkzeug kennt kein Schema für diese Kennungen. BT-29 oder BT-30 allein erfüllt die erste Gruppe (BT-31 oder BT-32) nicht.'],
      unverified: ['Was ein Verkäufer ohne USt-IdNr. und ohne Registernummer hier eintragen soll, ist durch die ausgewerteten Quellen nicht geklärt. Das Werkzeug gibt dafür keine Empfehlung.'],
    },
    en: {
      title: 'Further seller identification', short: 'A legal registration ID (BT-30) or another seller identifier (BT-29).',
      enter: 'Enter a legal registration ID or another identifier of the seller.', status: 'conditional',
      condition: 'At least one of VAT ID (BT-31), legal registration ID (BT-30) or identifier (BT-29) is required.', format: 'Free text, without a scheme.',
      external: ['BR-CO-26: at least one of BT-29, BT-30, BT-31.'],
      profile: ['This tool has no scheme for these identifiers. BT-29 or BT-30 alone does not satisfy the first group (BT-31 or BT-32).'],
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
      title: 'Menge und Einzelpreis', short: 'Beides als Zahl mit Komma als Dezimaltrennzeichen, z. B. 12,50. Dieselbe Schreibweise auf der deutschen und der englischen Seite.',
      enter: 'Tragen Sie die Menge und den Netto-Einzelpreis je Einheit ein.', status: 'required',
      format: 'Ziffern mit Komma als Dezimaltrennzeichen, ohne Tausendertrennzeichen (1234,50, nicht 1.234,50). Höchstens 6 Nachkommastellen, ohne nachgestellte Nullen gezählt; Wert unter 1.000.000.000.', valid: '12,50',
      invalid: [{ value: '12.50', note: 'Der Punkt wird nicht als Komma gelesen; bitte 12,50 eingeben.' }, { value: '1.234,50', note: 'Tausendertrennzeichen werden nicht akzeptiert; bitte 1234,50 eingeben.' }, { value: '-3', note: 'Negative Werte werden nicht unterstützt.' }],
      profile: ['Die Grenzen sind Schutzgrenzen dieses Werkzeugs (Interoperabilität mit dem Validator), keine Vorgabe der Norm. Berechnet wird ausschließlich vom Domänenmodell.'],
    },
    en: {
      title: 'Quantity and unit price', short: 'Both as a number with a comma as decimal separator, e.g. 12,50. The same notation on the German and the English page.',
      enter: 'Enter the quantity and the net unit price per unit.', status: 'required',
      format: 'Digits with a comma as decimal separator and no thousands separator (1234,50, not 1.234,50). At most 6 fractional digits (trailing zeros not counted); value below 1,000,000,000.', valid: '12,50',
      invalid: [{ value: '12.50', note: 'A point is not read as a comma; please enter 12,50.' }, { value: '1.234,50', note: 'Thousands separators are not accepted; please enter 1234,50.' }, { value: '-3', note: 'Negative values are not supported.' }],
      profile: ['The limits are protective limits of this tool (interoperability with the validator), not a rule of the standard. Only the domain model calculates.'],
    },
  },
  vatRate: {
    bt: 'BT-151 / BT-152', mistakes: ['unsupported_vat_rate', 'missing_field'],
    sources: [`${README} — Implemented profile (standard VAT 19 % and 7 %; reverse charge)`, `${INV} — InvoiceLineVat`, USTG, USTG_1127],
    de: {
      title: 'USt-Behandlung der Position', short: 'Ihre Wahl je Position: 19 %, 7 % oder Reverse Charge (§ 13b UStG).',
      enter: 'Wählen Sie je Position die Behandlung. Es wird keine vorausgewählt. Bei „Kleinunternehmer“ (Auswahl darüber) gibt es keine Wahl je Position.', status: 'required', format: 'Auswahl: 19 %, 7 % oder Reverse Charge.',
      external: ['Bei Anwendung des § 13b UStG schuldet der Leistungsempfänger die Umsatzsteuer (§ 13b Abs. 5 UStG). Reverse Charge wird als Steuerkategorie AE mit dem Satz 0 übertragen. Führt der Unternehmer eine Leistung im Sinne des § 13b Abs. 2 UStG aus, für die der Leistungsempfänger nach § 13b Abs. 5 UStG die Steuer schuldet, ist er zur Ausstellung einer Rechnung mit der Angabe „Steuerschuldnerschaft des Leistungsempfängers“ verpflichtet (§ 14a Abs. 5 UStG).'],
      profile: ['Dieses Profil kennt 19 %, 7 % und Reverse Charge. Jede nichtleere Auswahl davon darf in einer Rechnung zusammen vorkommen. Kleinunternehmer lässt sich nicht damit mischen. Der Text zu Reverse Charge ist fest und nicht editierbar.'],
      unverified: ['Das Werkzeug prüft nicht, welcher Satz für Ihre Leistung zutrifft und ob § 13b UStG auf sie anzuwenden ist. Diese Entscheidung und ihre Verantwortung liegen bei Ihnen.'],
    },
    en: {
      title: 'VAT treatment of the line', short: 'Your choice per line: 19 %, 7 % or Reverse Charge (§ 13b UStG).',
      enter: 'Choose the treatment per line. None is preselected. With “Kleinunternehmer” (the choice above) there is no choice per line.', status: 'required', format: 'Choose 19 %, 7 % or Reverse Charge.',
      external: ['In the cases covered by § 13b UStG, the recipient is liable for the VAT (§ 13b(5) UStG). Reverse Charge is transmitted as tax category AE with rate 0. Where the supplier performs a supply within the meaning of § 13b(2) UStG for which the recipient owes the tax under § 13b(5) UStG, the supplier must issue an invoice with the statement “Steuerschuldnerschaft des Leistungsempfängers” (§ 14a(5) UStG).'],
      profile: ['This profile knows 19 %, 7 % and Reverse Charge. Any nonempty selection of them may appear together in one invoice. Kleinunternehmer cannot be mixed with them. The Reverse Charge text is fixed and not editable.'],
      unverified: ['The tool does not check which rate applies to your supply or whether § 13b UStG applies to it. That decision and its responsibility are yours.'],
    },
  },
  vatRegime: {
    bt: 'BT-151 / BT-152 / BT-120 / BT-33', fieldId: 'vatRegime.regular', sources: [`${README} — Implemented profile (Kleinunternehmer; reverse charge)`, `${INV} — KLEINUNTERNEHMER_EXEMPTION_TEXT, REVERSE_CHARGE_TEXT`, `${DOC} — readSeller, readBuyer`, USTG, USTG_1127, XR302],
    de: {
      title: 'Umsatzsteuerliche Behandlung der Rechnung', short: 'Ihre Auswahl für die ganze Rechnung: „Reguläre Besteuerung / Reverse Charge“ oder „Kleinunternehmer (§ 19 UStG)“.',
      enter: 'Bei „Reguläre Besteuerung / Reverse Charge“ wählen Sie je Position 19 %, 7 % oder Reverse Charge. Bei „Kleinunternehmer (§ 19 UStG)“ erhalten alle Positionen die Kategorie E mit dem Satz 0 und es gibt keine Wahl je Position. Eingaben je Position bleiben beim Wechsel im Formular, werden aber in dieser Einstellung nicht verwendet.', status: 'required',
      format: 'Auswahl: eine von zwei. Vorausgewählt ist „Reguläre Besteuerung / Reverse Charge“ nur, damit der bisherige Ablauf unverändert bleibt.',
      external: [
        'Gesetzliche Titel: § 19 UStG „Besteuerung der Kleinunternehmer“, § 13b UStG „Leistungsempfänger als Steuerschuldner“. Für eine Leistung im Sinne des § 13b Abs. 2 UStG, für die der Leistungsempfänger nach § 13b Abs. 5 UStG die Steuer schuldet, verlangt § 14a Abs. 5 UStG die Angabe „Steuerschuldnerschaft des Leistungsempfängers“.',
        'Steuerbefreiung für Kleinunternehmer: Nach § 19 Abs. 1 UStG sind die Umsätze unter den dort genannten Voraussetzungen steuerfrei. XRechnung 3.0.2 bildet das in Abschnitt 13.3 mit der Kategorie E und dem festen Text ab.',
        'Kleinunternehmer: Kategorie E, Satz 0, der Verkäufer braucht BT-31 oder BT-32 (BR-E-02, BR-DE-16). Außerdem gilt BR-CO-26: BT-29, BT-30 oder BT-31.',
        'Reverse Charge: Kategorie AE, Satz 0; der Käufer braucht BT-47 oder BT-48 (BR-AE-02).',
      ],
      profile: [
        'Die feste Begründung steht nicht zur Bearbeitung offen. Kleinunternehmer: derselbe Text als BT-120 und als BT-33, ohne BT-121. Reverse Charge: „Steuerschuldnerschaft des Leistungsempfängers“ als BT-120, ohne BT-121. Beide Texte sind unter den Positionen angezeigt.',
        'Kleinunternehmer lässt sich in diesem Profil nicht mit 19 %, 7 % oder Reverse Charge in einer Rechnung mischen; das ist eine Einschränkung dieses Werkzeugs, keine Aussage zum Recht.',
        'Verkäuferkennung (beide Gruppen müssen erfüllt sein): (BT-31 oder BT-32) und (BT-29, BT-30 oder BT-31). BT-31 allein erfüllt beide Gruppen. BT-32 allein erfüllt die zweite Gruppe nicht. BT-29 oder BT-30 allein erfüllt die erste Gruppe nicht. BT-32 zusammen mit BT-29 oder BT-30 erfüllt beide. Für Verkäufer, die nur eine Steuernummer haben, gibt das Werkzeug keine Empfehlung.',
      ],
      unverified: [
        'Das Werkzeug prüft nicht, ob § 19 UStG auf Sie zutrifft, und nicht, ob § 13b UStG auf eine Leistung anzuwenden ist. Es wählt nichts für Sie aus und bestätigt keines von beiden. Dass ein Validator das XML annimmt, belegt weder das eine noch das andere.',
        'Ob die festen Texte rechtlich ausreichen, ist nicht geklärt; das Werkzeug gibt den Text wieder, den die Spezifikation bzw. das Gesetz nennt.',
      ],
    },
    en: {
      title: 'VAT treatment of the invoice', short: 'Your choice for the whole invoice: “Regular taxation / Reverse Charge” or “Kleinunternehmer (§ 19 UStG)”.',
      enter: 'With “Regular taxation / Reverse Charge” you choose 19 %, 7 % or Reverse Charge per line. With “Kleinunternehmer (§ 19 UStG)” every line gets category E with rate 0 and there is no choice per line. Per-line entries stay in the form when you switch but are not used in this setting.', status: 'required',
      format: 'Choose one of two. “Regular taxation / Reverse Charge” is preselected only so that the previous workflow stays unchanged.',
      external: [
        'Statutory titles: § 19 UStG “Besteuerung der Kleinunternehmer”, § 13b UStG “Leistungsempfänger als Steuerschuldner”. For a supply within the meaning of § 13b(2) UStG for which the recipient owes the tax under § 13b(5) UStG, § 14a(5) UStG requires the statement “Steuerschuldnerschaft des Leistungsempfängers”.',
        'Small business VAT exemption (Kleinunternehmer): under § 19(1) UStG, the supplies are exempt from VAT where the conditions stated there are met. XRechnung 3.0.2 represents this in section 13.3 with category E and the fixed text.',
        'Kleinunternehmer: category E, rate 0; the seller needs BT-31 or BT-32 (BR-E-02, BR-DE-16). BR-CO-26 also applies: BT-29, BT-30 or BT-31.',
        'Reverse Charge: category AE, rate 0; the buyer needs BT-47 or BT-48 (BR-AE-02).',
      ],
      profile: [
        'The fixed reason is not open to editing. Kleinunternehmer: the same text as BT-120 and as BT-33, without BT-121. Reverse Charge: “Steuerschuldnerschaft des Leistungsempfängers” as BT-120, without BT-121. Both texts are shown below the lines.',
        'In this profile Kleinunternehmer cannot be mixed with 19 %, 7 % or Reverse Charge in one invoice; that is a restriction of this tool, not a statement about the law.',
        'Seller identification (both groups must be met): (BT-31 or BT-32) and (BT-29, BT-30 or BT-31). BT-31 alone meets both groups. BT-32 alone does not satisfy the second group. BT-29 or BT-30 alone does not satisfy the first group. BT-32 together with BT-29 or BT-30 meets both. The tool gives no recommendation for a seller who holds only a tax number.',
      ],
      unverified: [
        'The tool does not check whether § 19 UStG applies to you and does not check whether § 13b UStG applies to a supply. It selects nothing for you and confirms neither. That a validator accepts the XML shows neither.',
        'Whether the fixed texts are legally sufficient is not established; the tool reproduces the text that the specification or the statute names.',
      ],
    },
  },
  buyerIdentification: {
    bt: 'BT-47 / BT-48', fieldId: 'buyer.vatId', mistakes: ['missing_buyer_identifier', 'invalid_vat_id', 'invalid_text', 'text_too_long'],
    sources: [`${DOC} — readBuyer (BR-AE-02)`, `${README} — Implemented profile (reverse charge)`],
    de: {
      title: 'Kennung des Käufers', short: 'USt-IdNr. des Käufers (BT-48) und Registernummer des Käufers (BT-47), zwei unabhängige Angaben.',
      enter: 'Tragen Sie ein, was Ihnen vorliegt. Das Werkzeug übernimmt keinen Wert aus dem anderen Feld und denkt sich keine Kennung aus.', status: 'conditional',
      condition: 'Ist mindestens eine Position Reverse Charge, ist mindestens eine der beiden Angaben erforderlich. Sonst sind beide optional.', format: 'USt-IdNr.: „DE“ und genau 9 Ziffern. Registernummer: freier Text ohne Leerzeichen am Anfang oder Ende, ohne Schema.', valid: 'DE987654321',
      external: ['BR-AE-02: bei Reverse Charge ist BT-47 oder BT-48 erforderlich.'],
      profile: ['Dieses Profil akzeptiert für BT-48 nur „DE“ plus 9 Ziffern. Wenn alle Positionen 19 % oder 7 % sind, fordert es keine der beiden Angaben.'],
      unverified: ['Ob für Ihren Fall die Angabe einer USt-IdNr. des Käufers nach UStG verlangt wird, wird nicht geprüft und hier nicht wiedergegeben.'],
    },
    en: {
      title: 'Buyer identification', short: 'The buyer’s VAT ID (BT-48) and the buyer’s legal registration ID (BT-47), two independent entries.',
      enter: 'Enter what you have. The tool copies no value from the other field and invents no identifier.', status: 'conditional',
      condition: 'If at least one line is Reverse Charge, at least one of the two entries is required. Otherwise both are optional.', format: 'VAT ID: “DE” and exactly 9 digits. Legal registration ID: free text with no spaces at the start or end, no scheme.', valid: 'DE987654321',
      external: ['BR-AE-02: with Reverse Charge, BT-47 or BT-48 is required.'],
      profile: ['For BT-48 this profile accepts only “DE” followed by 9 digits. When every line is 19 % or 7 % it requires neither entry.'],
      unverified: ['Whether the UStG requires the buyer’s VAT ID in your case is not checked and not restated here.'],
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
      enter: 'Geben Sie ein Fälligkeitsdatum, Zahlungsbedingungen oder beides an. Bei der Rechnung (380) genügt auch strukturiertes Skonto allein.', status: 'conditional',
      condition: 'Bei einem Zahlbetrag über null ist mindestens eines erforderlich (bei der Rechnung auch strukturiertes Skonto).', format: 'Datum als TT.MM.JJJJ, z. B. 05.12.2026. Zahlungsbedingungen: freier Text, Zeilenumbrüche erlaubt, kein „#“.',
      external: ['BR-CO-25: bei positivem Zahlbetrag ist BT-9 oder BT-20 erforderlich. Der gepinnte Validator setzt die Regel nicht um; dieses Werkzeug prüft sie nach der Berechnung.'],
      profile: ['Es gibt keine Voreinstellungen für Zahlungsbedingungen. Bei der Rechnung (380) zählt strukturiertes Skonto ebenfalls als Zahlungsbedingung (BT-20) und genügt allein für BR-CO-25; es steht im Feld darunter.'],
    },
    en: {
      title: 'Payment due', short: 'Due date (BT-9) and/or payment terms as text (BT-20).',
      enter: 'Give a due date, payment terms, or both. On an invoice (380) structured Skonto alone is also enough.', status: 'conditional',
      condition: 'With an amount due above zero, at least one is required (on an invoice, structured Skonto counts too).', format: 'Date as DD.MM.YYYY, e.g. 05.12.2026. Payment terms: free text, line breaks allowed, no “#”.',
      external: ['BR-CO-25: with a positive amount due, BT-9 or BT-20 is required. The pinned validator does not implement this rule; this tool checks it after the calculation.'],
      profile: ['There are no presets for payment terms. On an invoice (380) structured Skonto also counts as payment terms (BT-20) and alone satisfies BR-CO-25; it is entered below.'],
    },
  },
  skonto: {
    bt: 'BT-20 (Skonto)', fieldId: 'payment.skonto[0].days', mistakesFieldId: 'payment.skonto[0].percent',
    mistakes: ['unsupported_skonto_days', 'unsupported_skonto_tier_order', 'unsupported_skonto_percent', 'fraction_digits_limit', 'invalid_decimal', 'missing_field'],
    sources: [`${README} — Structured Skonto in BT-20`, `${DOC} — readSkonto, paymentTermsText`, XR302, USTG_1127],
    de: {
      title: 'Skonto (strukturiert)', short: 'Skontobedingungen als Stufen aus Tagen und Prozent, im Rechnungsdokument als strukturierte Zahlungsbedingungen (BT-20).',
      enter: 'Je Stufe die Anzahl Tage und den Prozentsatz. Mehrere Stufen mit aufsteigenden Tagen.', status: 'optional',
      format: 'Tage: ganze Zahl von 1 bis 365. Prozent: mit Komma, höchstens 2 Nachkommastellen (nachgestellte Nullen zählen nicht), z. B. 2,5.',
      external: [
        'XRechnung 3.0.2 sieht für Skonto strukturierte Angaben in den Zahlungsbedingungen (BT-20) vor. Das Werkzeug schreibt sie aus Ihren Stufen; freier Text steht davor.',
        'Ohne Basisbetrag bezieht sich der Prozentsatz auf den gesamten Zahlbetrag (BT-115).',
      ],
      profile: [
        'Grenzen dieses Werkzeugs, keine Regeln von XRechnung: 1 bis 10 Stufen, Tage 1 bis 365 und streng aufsteigend, Prozent über 0 und höchstens 100, kein Basisbetrag (BASISBETRAG), nicht bei der Gutschrift (381).',
        'Das Werkzeug berechnet keinen Skontobetrag, keinen gekürzten Betrag und kein Zahlungsdatum. Die Stufen ändern keinen Rechnungsbetrag. Die Stufen werden nicht sortiert.',
        'Ob ein Skonto vereinbart ist und in Anspruch genommen werden darf, prüft das Werkzeug nicht; es überträgt nur Ihre Angaben.',
        'Ändert sich später die Bemessungsgrundlage, weil Skonto in Anspruch genommen wird (§ 17 UStG), bildet das Werkzeug das nicht ab.',
      ],
      unverified: [
        'XRechnung 3.0.2 legt nicht eindeutig fest, ab welchem Zeitpunkt die Tage zählen. Das Werkzeug nimmt keinen Bezugszeitpunkt an.',
        'Wie Empfänger die Stufen lesen und verarbeiten, ist nicht getestet. Die Prüfung in diesem Werkzeug ist eine eigene lokale Prüfung, keine externe Validierung Ihrer Datei.',
      ],
    },
    en: {
      title: 'Early-payment discount (Skonto)', short: 'Skonto conditions as tiers of days and percent, carried in the document as structured payment terms (BT-20).',
      enter: 'For each tier the number of days and the percentage. Several tiers with ascending days.', status: 'optional',
      format: 'Days: whole number from 1 to 365. Percent: with a comma, at most 2 fractional digits (trailing zeros not counted), e.g. 2,5.',
      external: [
        'XRechnung 3.0.2 provides structured Skonto entries in the payment terms (BT-20). The tool writes them from your tiers; free text comes first.',
        'Without a base amount the percentage refers to the whole amount due (BT-115).',
      ],
      profile: [
        'Limits of this tool, not rules of XRechnung: 1 to 10 tiers, days 1 to 365 and strictly ascending, percent above 0 and at most 100, no base amount (BASISBETRAG), not on a credit note (381).',
        'The tool calculates no discount amount, no reduced amount and no payment date. The tiers change no invoice amount. The tiers are not sorted.',
        'Whether a discount was agreed and may be taken is not checked by the tool; it only carries your entries.',
        'If the taxable amount later changes because a discount is taken (§ 17 UStG), the tool does not reflect that.',
      ],
      unverified: [
        'XRechnung 3.0.2 does not unequivocally define from which point the days are counted. The tool assumes no reference point.',
        'How recipients read and process the tiers has not been tested. The check in this tool is its own local check, not an external validation of your file.',
      ],
    },
  },
  precedingInvoice: {
    bt: 'BG-3 (BT-25, BT-26)', fieldId: 'precedingInvoice.number', mistakes: ['missing_field', 'empty_text', 'invalid_text', 'text_too_long', 'invalid_date'],
    sources: [`${README} — Credit note 381 (first bounded slice): Preceding invoice (BG-3); Recipient compatibility`, `${DOC} — readPrecedingInvoice`, USTG_1127, XR302, BMF_FAQ],
    de: {
      title: 'Bezug auf die ursprüngliche Rechnung', short: 'Nummer (BT-25) und, wenn nötig, Datum (BT-26) der Rechnung, auf die sich diese Gutschrift bezieht.',
      enter: 'Tragen Sie die Nummer der ursprünglichen Rechnung genau so ein, wie sie dort steht. Das Datum geben Sie an, wenn die Nummer allein die Rechnung nicht eindeutig bezeichnet.',
      status: 'required', format: 'Nummer: freier Text ohne Leerzeichen am Anfang oder Ende. Datum: TT.MM.JJJJ, z. B. 05.11.2026.', valid: 'RE-2026-0001',
      profile: [
        'Die Nummer ist nach dem Profil dieses Werkzeugs Pflicht; das ist keine allgemeine Anforderung von EN 16931. Bei einer Rechnung (380) wird kein Bezug übermittelt.',
        'Das Werkzeug speichert keine Rechnungen, ruft die ursprüngliche Rechnung nicht ab und prüft weder, ob es sie gibt, noch ob die gutgeschriebenen Beträge zu ihr passen. Das liegt in Ihrer Verantwortung.',
        'Die Gutschrift ist in diesem Werkzeug eine kaufmännische Gutschrift (381) mit Bezug auf eine zuvor ausgestellte Rechnung. Eine Gutschrift im Sinne des § 14 Abs. 2 Satz 5 UStG, also die Abrechnung durch den Leistungsempfänger (389), und eine Rechnungsberichtigung (384) unterstützt dieses Werkzeug nicht.',
      ],
      unverified: [
        'XRechnung 3.0.2 (Abschnitt 13.1) unterscheidet die kaufmännische Gutschrift (381) von der Rechnungsberichtigung (384) und der Gutschrift nach dem UStG (389). Nach den FAQ des BMF zur E-Rechnung (Frage 7b) ist technisch noch nicht festgelegt, mit welchem Rechnungstyp eine kaufmännische Gutschrift darzustellen ist.',
        'Ob und wie sich die Gutschrift umsatzsteuerlich auswirkt, beurteilt das Werkzeug nicht.',
        'Ob Empfänger, insbesondere im öffentlichen Sektor, eine Gutschrift mit diesem Bezug als Aufhebung einer Rechnung annehmen, ist nicht geklärt.',
      ],
    },
    en: {
      title: 'Preceding invoice', short: 'Number (BT-25) and, where needed, date (BT-26) of the invoice this credit note refers to.',
      enter: 'Enter the number of the preceding invoice exactly as it appears there. Give the date when the number alone does not identify the invoice uniquely.',
      status: 'required', format: 'Number: free text without spaces at the start or end. Date: DD.MM.YYYY, e.g. 05.11.2026.', valid: 'RE-2026-0001',
      profile: [
        'The number is required by this tool’s profile; it is not a general requirement of EN 16931. On an invoice (380) no reference is sent.',
        'The tool stores no invoices, does not retrieve the preceding invoice and checks neither that it exists nor that the credited amounts match it. That is your responsibility.',
        'In this tool a credit note is a commercial credit note (381, kaufmännische Gutschrift) referring to a previously issued invoice. Self-billing under § 14(2) sentence 5 UStG, where the recipient issues the invoice (389), and a corrected invoice (384) are not supported by this tool.',
      ],
      unverified: [
        'XRechnung 3.0.2 (section 13.1) distinguishes the commercial credit note (381) from the corrected invoice (384) and from the self-billed invoice under the UStG (389). According to the German Federal Ministry of Finance’s FAQ on electronic invoicing (question 7b), it is not yet technically settled which invoice type represents a commercial credit note.',
        'Whether and how the credit note affects VAT is not assessed by the tool.',
        'Whether recipients, in particular in the public sector, accept a credit note with this reference as cancelling an invoice is not established.',
      ],
    },
  },
  clearing: {
    bt: 'BG-16 (code 97)', fieldId: 'payment.settlement.reciprocalObligationConfirmed', mistakes: ['missing_clearing_confirmation', 'missing_payment_due_information'],
    sources: [`${README} — Credit note 381 (first bounded slice): Payment; Refused; BR-CO-25`, `${DOC} — readCreditNotePayment, readClearing`, UNCL4461, BGB_1127],
    de: {
      title: 'Zahlung bei der Gutschrift', short: 'Nur Verrechnung mit einer bestehenden Gegenforderung (Zahlungsart 97), von Ihnen ausdrücklich bestätigt.',
      enter: 'Bestätigen Sie die Verrechnung. Bei einem Zahlbetrag über null geben Sie außerdem ein Fälligkeitsdatum oder Zahlungsbedingungen an; strukturiertes Skonto gibt es bei der Gutschrift nicht.', status: 'required',
      fields: [
        { name: 'Bestätigung der Verrechnung', status: 'required', format: 'Ihre Erklärung, nie vorausgewählt' },
        { name: 'Fälligkeitsdatum / Zahlungsbedingungen', status: 'conditional', format: 'mindestens eines bei offenem Betrag' },
      ],
      external: ['Zahlungsart 97 (UNTDID 4461, „Clearing between partners“): Beträge, die sich zwei Partner gegenseitig schulden, werden verrechnet, um Zahlungen zu vermeiden.'],
      profile: [
        'Andere Abwicklungen, insbesondere eine Erstattung per Überweisung, unterstützt dieses Werkzeug für Gutschriften nicht. Das ist eine Grenze dieses Werkzeugs, keine Aussage, dass XRechnung oder EN 16931 eine Erstattung ausschließen.',
        'Die Verrechnung wird nie vorausgewählt, und die Bestätigung wird bei jedem Wechsel des Dokumenttyps zurückgesetzt. Eine Bankverbindung (BG-17) wird nicht geschrieben.',
        'Wie bei der Rechnung verlangt das Werkzeug bei positivem Zahlbetrag ein Fälligkeitsdatum oder Zahlungsbedingungen (BR-CO-25).',
      ],
      unverified: [
        'Das Werkzeug prüft nicht, ob die rechtlichen Voraussetzungen einer Verrechnung vorliegen, etwa einer Aufrechnung nach §§ 387 ff. BGB oder einer vereinbarten Verrechnung, und führt selbst keine Verrechnung durch.',
        'Dass BR-CO-25 auch für Gutschriften gilt, ist aus dem Regelkontext von SeMoX gelesen und nicht am lizenzierten Text von EN 16931 bestätigt.',
      ],
    },
    en: {
      title: 'Payment on a credit note', short: 'Only clearing against an existing reciprocal obligation (payment means 97), explicitly confirmed by you.',
      enter: 'Confirm the clearing. With an amount due above zero, also give a due date or payment terms; structured Skonto is not available on a credit note.', status: 'required',
      fields: [
        { name: 'Clearing confirmation', status: 'required', format: 'your declaration, never preselected' },
        { name: 'Due date / payment terms', status: 'conditional', format: 'at least one with an amount due' },
      ],
      external: ['Payment means 97 (UNTDID 4461, “Clearing between partners”): amounts that two partners owe each other are offset so that no payment is needed.'],
      profile: [
        'This tool does not support any other settlement of a credit note, in particular no refund by credit transfer. That is a limit of this tool, not a statement that XRechnung or EN 16931 exclude a refund.',
        'Clearing is never preselected, and the confirmation is withdrawn whenever the document type changes. No bank details (BG-17) are written.',
        'As on an invoice, the tool requires a due date or payment terms when the amount due is positive (BR-CO-25).',
      ],
      unverified: [
        'The tool does not check whether the legal requirements for offsetting are met, for example a set-off under §§ 387 ff. BGB or an agreed clearing, and does not carry out the clearing itself.',
        'That BR-CO-25 applies to credit notes is read from the SeMoX rule context and is not confirmed against the licensed EN 16931 text.',
      ],
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
      title: 'Käufer (Rechnungsempfänger)', short: 'Angaben zum Rechnungsempfänger.', enter: 'Name, Anschrift und elektronische Adresse; USt-IdNr. und Registernummer sind optional, bei Reverse Charge ist eine der beiden erforderlich.', status: 'required',
      fields: [
        { name: 'Name', status: 'required', format: 'Text' },
        { name: 'Anschrift (Land: DE)', status: 'required', format: 'Straße, PLZ, Ort' },
        { name: 'Elektronische Adresse', status: 'required', format: 'Schema und Adresse' },
        { name: 'USt-IdNr. (BT-48)', status: 'conditional', format: 'DE + 9 Ziffern' },
        { name: 'Registernummer (BT-47)', status: 'conditional', format: 'Text (bei Reverse Charge mindestens eine der beiden Kennungen)' },
      ],
      profile: ['Der Käufer muss in Deutschland sitzen (Profil dieses Werkzeugs). Die Käuferreferenz (BT-10) steht bei den Rechnungsdaten.'],
    },
    en: {
      title: 'Buyer (invoice recipient)', short: 'Details of the invoice recipient.', enter: 'Name, address and electronic address; VAT ID and legal registration ID are optional, with Reverse Charge one of the two is required.', status: 'required',
      fields: [
        { name: 'Name', status: 'required', format: 'Text' },
        { name: 'Address (country: DE)', status: 'required', format: 'Street, post code, city' },
        { name: 'Electronic address', status: 'required', format: 'Scheme and address' },
        { name: 'VAT ID (BT-48)', status: 'conditional', format: 'DE + 9 digits' },
        { name: 'Legal registration ID (BT-47)', status: 'conditional', format: 'Text (with Reverse Charge at least one of the two identifications)' },
      ],
      profile: ['The buyer must be located in Germany (profile of this tool). The buyer reference (BT-10) is part of the invoice details.'],
    },
  },
  'sec.lines': {
    bt: 'BG-25', fieldId: 'lines[0].name', sources: [`${README} — Implemented profile`],
    de: {
      title: 'Rechnungspositionen', short: 'Mindestens eine Position mit Menge, Einzelpreis und USt-Behandlung.', enter: 'Zuerst die Behandlung der Rechnung wählen, dann je Position: Beschreibung, Einheit, Menge, Netto-Einzelpreis und (außer bei Kleinunternehmer) 19 %, 7 % oder Reverse Charge.', status: 'required',
      fields: [
        { name: 'Beschreibung', status: 'required', format: 'Text' },
        { name: 'Einheit', status: 'required', format: 'Auswahl' },
        { name: 'Menge', status: 'required', format: 'Zahl' },
        { name: 'Einzelpreis (netto)', status: 'required', format: 'Zahl' },
        { name: 'USt-Behandlung', status: 'required', format: '19 %, 7 % oder Reverse Charge; bei Kleinunternehmer fest' },
      ],
      profile: ['Beträge werden ausschließlich vom Domänenmodell berechnet; der Nettobetrag je Position ist eine Anzeige.'],
    },
    en: {
      title: 'Invoice lines', short: 'At least one line with quantity, unit price and VAT treatment.', enter: 'First choose the treatment of the invoice, then per line: description, unit, quantity, net unit price and (except with Kleinunternehmer) 19 %, 7 % or Reverse Charge.', status: 'required',
      fields: [
        { name: 'Description', status: 'required', format: 'Text' },
        { name: 'Unit', status: 'required', format: 'Choice' },
        { name: 'Quantity', status: 'required', format: 'Number' },
        { name: 'Unit price (net)', status: 'required', format: 'Number' },
        { name: 'VAT treatment', status: 'required', format: '19 %, 7 % or Reverse Charge; fixed with Kleinunternehmer' },
      ],
      profile: ['Amounts are calculated only by the domain model; the net amount per line is a display.'],
    },
  },
  'sec.payment': {
    bt: 'BG-16', fieldId: 'payment.means.code', sources: [`${README} — Implemented profile`],
    de: {
      title: 'Zahlung', short: 'Zahlungsart, Konto und Fälligkeit.', enter: 'Code und IBAN; bei einem Zahlbetrag über null außerdem Fälligkeitsdatum, Zahlungsbedingungen oder strukturiertes Skonto (mindestens eines).', status: 'required',
      fields: [
        { name: 'Zahlungsart', status: 'required', format: '30 oder 58' },
        { name: 'IBAN', status: 'required', format: 'ohne Leerzeichen' },
        { name: 'Kontoinhaber', status: 'optional', format: 'Text' },
        { name: 'BIC', status: 'optional', format: '8 oder 11 Zeichen' },
        { name: 'Fälligkeitsdatum / Zahlungsbedingungen / Skonto', status: 'conditional', format: 'mindestens eines bei offenem Betrag' },
      ],
    },
    en: {
      title: 'Payment', short: 'Payment means, account and due information.', enter: 'Code and IBAN; with an amount due above zero also a due date, payment terms or structured Skonto (at least one).', status: 'required',
      fields: [
        { name: 'Payment means', status: 'required', format: '30 or 58' },
        { name: 'IBAN', status: 'required', format: 'no spaces' },
        { name: 'Account holder', status: 'optional', format: 'Text' },
        { name: 'BIC', status: 'optional', format: '8 or 11 characters' },
        { name: 'Due date / payment terms / Skonto', status: 'conditional', format: 'at least one with an amount due' },
      ],
    },
  },
} as const satisfies Record<string, HelpEntry>;

export type HelpId = keyof typeof helpEntries;
export const helpFor = (id: HelpId, locale: Locale): HelpText => helpEntries[id][locale];
