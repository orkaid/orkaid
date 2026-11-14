// Where the Rechnungsblatt shows each domain diagnostic and where guided navigation takes the user (MDR-46). Every
// diagnostic has exactly one place; one that fits no field, group or line goes to the document's issue list, so none is
// ever dropped for lack of a matching field. Pure: no DOM, no Svelte. It decides presentation only, never validity.
import type { DiagnosticItem } from './form-adapter.ts';

export type Placement =
  | { readonly at: 'field'; readonly id: string }
  | { readonly at: 'group'; readonly group: string }
  | { readonly at: 'line'; readonly line: number }
  | { readonly at: 'lines' }
  | { readonly at: 'document' };

// Group requirements the sheet states inside their own group of fields (by group path and code).
const GROUP_CODES: Readonly<Record<string, readonly string[]>> = {
  seller: ['missing_seller_tax_identifier', 'missing_seller_identification'],
  buyer: ['missing_buyer_identifier'],
  payment: ['missing_payment_due_information'],
  'payment.skonto': ['unsupported_skonto_tier_count', 'unsupported_skonto_on_credit_note'],
};

export function placementOf(item: DiagnosticItem): Placement {
  if (item.kind === 'internal') return { at: 'document' };
  if (item.fieldId !== undefined && item.fieldId === item.path) return { at: 'field', id: item.path };
  if (GROUP_CODES[item.path]?.includes(item.code)) return { at: 'group', group: item.path };
  // A line as a whole, for example its calculated net reaching the tool's ceiling.
  const line = /^lines\[(\d+)\]$/.exec(item.path);
  if (line) return { at: 'line', line: Number(line[1]) };
  // The line table as a whole: no line at all, or an amount computed over all lines reaching the ceiling.
  if (item.path === 'lines') return { at: 'lines' };
  return { at: 'document' };
}

/** The control navigation focuses for a diagnostic; undefined means the document's issue list. */
export function navigationTarget(item: DiagnosticItem): string | undefined {
  const place = placementOf(item);
  if (place.at === 'document') return undefined;
  // The quantity is the first of the values a line's own amount is computed from.
  if (place.at === 'line') return `lines[${place.line}].quantity`;
  return item.fieldId;
}

/**
 * True when the line-break explanation is the right one for an `invalid_text`: only a line description, which is one line
 * (MDR-47), refuses every CR/LF. Payment terms and notes admit an internal LF, so there a break is never named as the cause.
 */
export function lineBreakRefused(item: DiagnosticItem, value: string): boolean {
  return item.code === 'invalid_text' && /^lines\[\d+\]\.name$/.test(item.path) && /[\r\n]/.test(value);
}
