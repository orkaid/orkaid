// Platform content registry (PR-06): the one available tool and the knowledge resources, shared by the home page, the tool
// hub, the knowledge index and the guides, so their facts and links cannot drift apart. Copy only; no behaviour.
import type { Locale } from './ui';
import type { Msg } from './xrechnung';

export const LINKS = {
  github: 'https://github.com/orkaid/orkaid',
  issues: 'https://github.com/orkaid/orkaid/issues',
  substack: 'https://orkaid.substack.com',
  youtube: 'https://www.youtube.com/@orkaidbuilds',
} as const;

export type ResourceId = 'e-rechnung' | 'xrechnung-erstellen' | 'xrechnung-pruefen';
export type ResourceKind = 'foundations' | 'guide';

export interface Resource {
  readonly id: ResourceId;
  readonly path: `/knowledge/${ResourceId}/`;
  readonly kind: ResourceKind;
  readonly title: Msg;
  readonly summary: Msg;
  readonly audience: Msg;
  /** ISO date of the content state; set when the content was last checked against the tool and its sources. */
  readonly updated: string;
}

export const resourceKinds: Record<ResourceKind, Msg> = {
  foundations: { de: 'Grundlagen', en: 'Foundations' },
  guide: { de: 'Anleitung', en: 'Guide' },
};

export const resources: readonly Resource[] = [
  {
    id: 'e-rechnung',
    path: '/knowledge/e-rechnung/',
    kind: 'foundations',
    title: { de: 'E-Rechnung verstehen', en: 'Understanding electronic invoices' },
    summary: {
      de: 'Was eine strukturierte Rechnung von einer PDF unterscheidet, was XRechnung ist und wie UBL und CII zusammenhängen.',
      en: 'How a structured invoice differs from a PDF, what XRechnung is, and how UBL and CII relate.',
    },
    audience: { de: 'Alle, die Rechnungen schreiben oder empfangen; keine technischen Vorkenntnisse nötig', en: 'Anyone who issues or receives invoices; no technical background needed' },
    updated: '2026-11-27',
  },
  {
    id: 'xrechnung-erstellen',
    path: '/knowledge/xrechnung-erstellen/',
    kind: 'guide',
    title: { de: 'Eine XRechnung mit Orkaid erstellen', en: 'Creating an XRechnung with Orkaid' },
    summary: {
      de: 'Welche Angaben Sie vorher brauchen und wie Sie im Werkzeug Schritt für Schritt zu einer XML-Datei kommen.',
      en: 'What to have ready, and how to get step by step from the form to an XML file.',
    },
    audience: { de: 'Selbstständige und kleine Unternehmen mit Geschäftskunden in Deutschland', en: 'Freelancers and small businesses invoicing business customers in Germany' },
    updated: '2026-11-27',
  },
  {
    id: 'xrechnung-pruefen',
    path: '/knowledge/xrechnung-pruefen/',
    kind: 'guide',
    title: { de: 'Eine XRechnung prüfen und weitergeben', en: 'Checking and sending an XRechnung' },
    summary: {
      de: 'Was Orkaid prüft und was nicht, wie Sie die exportierte Datei selbst validieren und was danach noch offen bleibt.',
      en: 'What Orkaid checks and what it does not, how to validate the exported file yourself, and what remains open afterwards.',
    },
    audience: { de: 'Alle, die eine exportierte XRechnung versenden wollen', en: 'Anyone about to send an exported XRechnung' },
    updated: '2026-11-27',
  },
];

export const resource = (id: ResourceId): Resource => resources.find((r) => r.id === id)!;

/** The tool catalog. Only tools that exist are listed; the scope lists themselves live with the tool (xrechnung.ts scopeLists). */
export interface Tool {
  readonly id: 'xrechnung';
  readonly path: '/tools/xrechnung/';
  readonly area: Msg;
  readonly name: Msg;
  readonly facts: readonly { readonly label: Msg; readonly value: Msg }[];
  readonly guide: ResourceId;
  readonly check: ResourceId;
}

export const tools: readonly Tool[] = [
  {
    id: 'xrechnung',
    path: '/tools/xrechnung/',
    area: { de: 'E-Rechnung', en: 'E-invoicing' },
    name: { de: 'XRechnung-Generator', en: 'XRechnung generator' },
    facts: [
      { label: { de: 'Dokumente', en: 'Documents' }, value: { de: 'Rechnung (380), kaufmännische Gutschrift (381)', en: 'Invoice (380), credit note (381)' } },
      { label: { de: 'Formate', en: 'Formats' }, value: { de: 'XRechnung 3.0.2 als UBL 2.1 oder UN/CEFACT CII', en: 'XRechnung 3.0.2 as UBL 2.1 or UN/CEFACT CII' } },
      { label: { de: 'Version', en: 'Version' }, value: { de: 'v0.1.0', en: 'v0.1.0' } },
      { label: { de: 'Profil', en: 'Profile' }, value: { de: 'Verkäufer und Käufer in Deutschland, EUR, 19\u00a0% und 7\u00a0%, Kleinunternehmer oder Reverse Charge', en: 'Seller and buyer in Germany, EUR, 19% and 7%, Kleinunternehmer or Reverse Charge' } },
      { label: { de: 'Ihre Daten', en: 'Your data' }, value: { de: 'Bleiben im Browser. Kein Konto, keine Speicherung.', en: 'Stay in your browser. No account, nothing stored.' } },
      { label: { de: 'Prüfung', en: 'Checks' }, value: { de: 'Gegen die Regeln des Werkzeugs; die externe Validierung der Datei liegt bei Ihnen.', en: 'Against the tool’s rules; external validation of the file is up to you.' } },
    ],
    guide: 'xrechnung-erstellen',
    check: 'xrechnung-pruefen',
  },
];

const months = {
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
/** 2026-11-26 → "26. November 2026" / "26 November 2026" (no Intl dependency on the build host's locale data). */
export function longDate(iso: string, locale: Locale): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return locale === 'de' ? `${day}. ${months.de[month - 1]} ${year}` : `${day} ${months.en[month - 1]} ${year}`;
}
