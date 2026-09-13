export type Locale = 'de' | 'en';

export const ui = {
  de: {
    home: 'Startseite',
    tools: 'Werkzeuge',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    language: 'English',
    descriptor: 'Open-Source-Werkzeuge für Finanzen, Buchhaltung und Compliance',
    disclaimer: 'Keine Steuer- oder Rechtsberatung',
  },
  en: {
    home: 'Home',
    tools: 'Tools',
    imprint: 'Legal notice',
    privacy: 'Privacy',
    language: 'Deutsch',
    descriptor: 'open-source tools for finance, accounting and compliance',
    disclaimer: 'No tax or legal advice',
  },
} as const;

export function localePath(locale: Locale, pathname: string): string {
  return locale === 'en' ? `/en${pathname}` : pathname;
}
