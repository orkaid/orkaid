// Display-only helper: shows the ISO value of a native date input in an unambiguous, locale-aware form. It parses nothing
// and validates nothing; the value that reaches the domain stays the browser's ISO string.

import type { Locale } from '../../../i18n/ui.ts';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-07` → `07.11.2026` (de) or `7 Nov 2026` (en); `undefined` for anything that is not a plain ISO date string. */
export function displayDate(iso: string, locale: Locale): string | undefined {
  const match = ISO.exec(iso);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11 || Number(day) < 1 || Number(day) > 31) return undefined;
  return locale === 'de' ? `${day}.${month}.${year}` : `${Number(day)} ${MONTHS_EN[monthIndex]} ${year}`;
}
