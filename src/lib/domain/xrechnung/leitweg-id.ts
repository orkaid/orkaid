// Leitweg-ID validation for the buyer reference BT-10, an opt-in policy of buildInvoice (MDR-38). Pure: no I/O, no lookup.
//
// Four layers are kept apart, because only the first is a sentence of the specification:
//   OFFICIAL    Leitweg-ID Format-Spezifikation v2.0.2 (28.07.2021): Grob (2-12 digits) and check digits
//               are mandatory, Fein (up to 30 characters A-Z, 0-9, "nicht case-sensitiv") is optional, "-" (U+002D)
//               separates the parts, the total length is 5-46, the hyphens are excluded from the checksum, and the Grob
//               starts with a code 01-16 or 99 (sections 2.1 Table 1, 2.2.1, 2.3, 2.4).
//   DERIVED     a reading of Table 1's cardinalities and section 2.2.4, not a sentence of the specification: the Grob is
//               2, 3, 5, 8, 9 or 12 digits, and an empty Fein between two hyphens is invalid.
//   PROFILE     Orkaid choices: the check digits must equal the canonical pair, 98 minus the remainder modulo 97 (the
//               specification's separate remainder-1 verification statement would also admit 00, 01 and 99); letters are
//               read as their ASCII uppercase for the calculation only, and the caller's text is never changed.
//   UNVERIFIED  whether any recipient platform assigns, routes or accepts a value that passes, and how it treats case.
// Provenance: the OFFICIAL and DERIVED rules come from the research recorded with MDR-38, whose source check was made on
// 2026-10-30. An independent review reported re-verifying the same sources on 2026-10-31 and found no normative mismatch.
// The session that wrote this code did not repeat the primary-source research.
// Passing proves local structure and check digits only. Known limit: the checksum ignores hyphens, so a hyphen moved
// between Grob and Fein that still forms a valid Grob composition is not detectable.

export type LeitwegIdViolation = 'invalid_leitweg_id_format' | 'invalid_leitweg_id_checksum';

const STRUCTURE = /^([0-9]{2,12})(?:-([0-9A-Za-z]{1,30}))?-([0-9]{2})$/; // ASCII only; the length 5-46 follows from it
const GROB_LENGTHS: readonly number[] = [2, 3, 5, 8, 9, 12];
const GROB_CODE = /^(?:0[1-9]|1[0-6]|99)/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // the index of a character is its value: A = 10 ... Z = 35

/** Undefined when `value` is a structurally valid Leitweg-ID with its canonical check digits. Expects BT-10 text that already passed the ordinary text rules. */
export function checkLeitwegId(value: string): LeitwegIdViolation | undefined {
  const match = STRUCTURE.exec(value);
  if (match === null) return 'invalid_leitweg_id_format';
  const [, grob = '', fein = '', checkDigits = ''] = match;
  if (!GROB_LENGTHS.includes(grob.length) || !GROB_CODE.test(grob)) return 'invalid_leitweg_id_format';
  // Up to 12 + 60 + 2 = 74 decimal digits: beyond exact Number arithmetic, so the remainder is taken on a BigInt.
  const expanded = [...grob + fein].map((character) => String(ALPHABET.indexOf(character.toUpperCase()))).join('');
  const canonical = String(98n - (BigInt(`${expanded}00`) % 97n)).padStart(2, '0');
  return checkDigits === canonical ? undefined : 'invalid_leitweg_id_checksum';
}
