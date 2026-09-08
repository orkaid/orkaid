export type Locale = 'de' | 'en';

export const ui = {
  de: {
    home: 'Startseite',
    tools: 'Werkzeuge',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    language: 'English',
  },
  en: {
    home: 'Home',
    tools: 'Tools',
    imprint: 'Legal notice',
    privacy: 'Privacy',
    language: 'Deutsch',
  },
} as const;

export function localePath(locale: Locale, pathname: string): string {
  return locale === 'en' ? `/en${pathname}` : pathname;
}
