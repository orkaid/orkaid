# XRechnung domain: semantic invoice, monetary calculation, UBL 2.1 serializer

Deterministic, framework-independent domain code for the XRechnung tool. This is an early version. It is **not a
production-ready or fully compliant XRechnung generator**, and an accepted validation result is **not legal
certification**.

```
semantic input (strings)
  -> document.ts  buildInvoice: validates the business data, delegates every amount to invoice.ts
  -> invoice.ts   exact monetary calculation (scaled integers, no binary floating-point)
  -> Invoice      frozen, registered validated invoice
  -> ubl.ts       serializeUblInvoice: pure function to a UBL 2.1 XML string
  -> XML          checked locally with the official KoSIT validator (tools/kosit)
```

| File | Role |
| --- | --- |
| `decimal.ts`, `number-notation.ts`, `invoice.ts` | exact decimals, German/English/canonical input notation, VAT and totals |
| `document.ts` | business fields, the implemented profile, runtime protection |
| `ubl.ts` | the only file that knows UBL element names and namespaces; performs no arithmetic |

The semantic model contains no UBL or CII structures. A later CII serializer would consume the same `Invoice`
(parties, dates, payment, typed lines, totals) and reuse `formatXmlDecimal`; the monetary engine does not change.

## Implemented profile

Scenario: ordinary German domestic commercial B2B invoice, invoice type 380, EUR, VAT category S at 19% and/or 7%,
nonnegative amounts, no document-level allowances or charges, no corrections or credit notes.

Three kinds of rule are kept apart, in the code comments as well:

| Kind | Meaning | Examples in this code |
| --- | --- | --- |
| **External** | imposed by EN 16931, the XRechnung CIUS, the UBL binding or law | BT-10 present (BR-DE-15); seller contact BT-41/42/43 (BR-DE-2, -5, -6, -7); city and post code (BR-DE-3, -4, -8, -9); seller VAT or tax identifier (BR-CO-26, BR-S-02, BR-DE-16); electronic addresses with scheme (BR-62, BR-63); payment instructions (BR-DE-1); document totals and VAT breakdown (BR-CO-10 to BR-CO-17); at most two decimals on BT-131 and the totals (BR-DEC-*); the date of supply is a required invoice particular under § 14 Abs. 4 Satz 1 Nr. 6 UStG (statute text: https://www.gesetze-im-internet.de/ustg_1980/__14.html; § 31 Abs. 4 UStDV also allows stating a calendar month, which this profile does not support), while the validator only reports its absence at information level (BR-DE-TMP-32) |
| **Conditional** | applies only in stated circumstances | valid IBAN when payment means is 58 (BR-DE-19); credit-transfer group when payment means is a credit transfer (BR-DE-23); payment due date or payment terms when the amount due is positive (BR-CO-25 in EN 16931-1, not enforced by the local validator artefacts) |
| **Profile** | chosen for the current implementation only; not a claim that law or XRechnung requires exactly this, and not a permanent limit | seller USt-IdNr (`DE` + 9 digits) required; a complete delivery date (BT-72) required; street addresses of both parties required; both parties in Germany; electronic address scheme `EM` only; payment means 58 only; payment due date (BT-9) required; a small list of unit codes (`UNIT_CODES`) |

Input outside the profile fails with an explicit `unsupported_*` (or field-specific) error. Such an error means "not
supported by this profile", not "legally invalid". BT-10 is buyer-provided business information: it is required and
is never generated or defaulted (it is not necessarily a Leitweg-ID).

## Runtime protection

`Invoice` is created only by `buildInvoice`, which deep-freezes it and registers it in a module-private set.
`serializeUblInvoice` and `isValidatedInvoice` check that registration at runtime. A copy, a clone, a hand-made
object or a type assertion is refused with `unvalidated_invoice` and never yields XML. The branded TypeScript type
alone is not treated as a security boundary.

## Sources and limits of the verification

Bindings, cardinalities and element order come from the official artefacts of the KoSIT bundle of 2026-08-31: the
SeMoX CIUS model, the UBL 2.1 XSD, XRechnung Schematron 2.6.0 and the validator configuration 2026-08-31. The
licensed CEN/TS 16931-3-2 was not available, so **no exhaustive verification against it is claimed**. The validator
tolerates small amount differences by design (for example BR-CO-17 allows one currency unit), so an accepted
document does not prove cent-exact amounts: the tests compare every amount against independently worked values.
The KoSIT check covers one validator and configuration combination on synthetic fixtures. It says nothing about tax
correctness or acceptance by a recipient.

## Not part of the current implementation

CII, a user interface, PDF, any KoSIT service (browser or server), authentication, persistence, further VAT
categories or regimes, corrections and credit notes, deployment. None of these is abandoned; they are simply not
built here.

## Checking it

```
npm test            # headless: calculation, validation, serializer, fixtures, static checks
npm run check       # Astro diagnostics and tsc
npm run test:kosit  # local KoSIT validation, see tools/kosit/README.md
```
