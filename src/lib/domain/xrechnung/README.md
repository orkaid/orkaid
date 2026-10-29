# XRechnung domain: semantic invoice and credit note, monetary calculation, UBL 2.1 and CII serializers

Deterministic, framework-independent domain code for the XRechnung tool. This is an early version. It is **not a
production-ready or fully compliant XRechnung generator**, and an accepted validation result is **not legal
certification**.

```
semantic input (strings)
  -> document.ts  buildInvoice: validates the business data, delegates every amount to invoice.ts
  -> invoice.ts   exact monetary calculation (scaled integers, no binary floating-point)
  -> Invoice      frozen, registered validated invoice
  -> ubl.ts       serializeUblInvoice: pure function to a UBL 2.1 XML string
  -> cii.ts       serializeCiiInvoice: pure function to a CII (UN/CEFACT D16B) XML string
  -> XML          checked locally with the official KoSIT validator (tools/kosit)
```

| File | Role |
| --- | --- |
| `decimal.ts`, `number-notation.ts`, `invoice.ts` | exact decimals, German/English/canonical input notation, VAT and totals |
| `document.ts` | business fields, the implemented profile, runtime protection |
| `ubl.ts` | the only file that knows UBL element names and namespaces; performs no arithmetic |
| `cii.ts` | the only file that knows CII element names and namespaces; performs no arithmetic |

The semantic model contains no UBL or CII structures, and the semantic model and the monetary engine are
syntax-independent. Both serializers consume the same validated `Invoice`; neither recalculates an amount.

## Implemented profile

Scenario: ordinary German domestic commercial B2B invoice, invoice type 380, EUR, VAT category S at 19% and/or 7%, or
the Kleinunternehmer treatment (§ 19 UStG: category E, rate 0, fixed XRechnung 3.0.2 section 13.3 wording in BT-120 and
BT-33, no BT-121) or the reverse-charge treatment (§ 13b UStG: category AE, rate 0, the § 14a Abs. 5 UStG phrase in BT-120, no BT-121, buyer BT-47 or BT-48; an invoice is all-standard, all-Kleinunternehmer, all-reverse-charge, or standard combined with reverse charge; Kleinunternehmer is never combined), nonnegative amounts, no document-level allowances or charges, no corrections (384) and no self-billing (389). Credit note 381 is supported in a bounded form, described in the next section.

Three kinds of rule are kept apart, in the code comments as well:

| Kind | Meaning | Examples in this code |
| --- | --- | --- |
| **External** | imposed by EN 16931, the XRechnung CIUS, the UBL binding or law | BT-10 present (BR-DE-15); seller contact BT-41/42/43 (BR-DE-2, -5, -6, -7); city and post code (BR-DE-3, -4, -8, -9); seller identification by BT-29, BT-30 or BT-31 (BR-CO-26); seller VAT or tax identifier BT-31 or BT-32 (BR-S-02, BR-E-02, BR-AE-02, BR-DE-16); electronic addresses with scheme (BR-62, BR-63); payment instructions (BR-DE-1); document totals and VAT breakdown (BR-CO-10 to BR-CO-17); at most two decimals on BT-131 and the totals (BR-DEC-*); the date of supply is a required invoice particular under § 14 Abs. 4 Satz 1 Nr. 6 UStG (statute text: https://www.gesetze-im-internet.de/ustg_1980/__14.html; § 31 Abs. 4 UStDV also allows stating a calendar month, which this profile does not support), while the validator only reports its absence at information level (BR-DE-TMP-32) |
| **Conditional** | applies only in stated circumstances | valid IBAN when payment means is 58 (BR-DE-19); credit-transfer group with an account identifier when payment means is 30 or 58 (BR-DE-23, BR-50, BR-61); payment due date (BT-9) or payment terms (BT-20) when the amount due (BT-115) is positive (BR-CO-25; the pinned validator artefacts do not implement it, so `buildInvoice` enforces it after the monetary calculation; BT-9 and BT-20 are otherwise both optional) |
| **Profile** | chosen for the current implementation only; not a claim that law or XRechnung requires exactly this, and not a permanent limit | a seller or buyer USt-IdNr, when given, is `DE` + 9 digits; a complete delivery date (BT-72) required; street addresses of both parties required; both parties in Germany; electronic address schemes `EM`, `0204` and `0088` only (a scheme identifier, with no routing or Leitweg-ID meaning); payment means 30 or 58 (credit transfer) only, with one account (BG-17) identified by an IBAN (no non-IBAN BT-84) and BT-86, when given, a BIC; no `#` in payment terms (BT-20), because structured Skonto (BR-DE-18) is not supported; a small list of unit codes (`UNIT_CODES`); quantity (BT-129) and unit price (BT-146) with at most 6 effective fractional digits (trailing zeros not counted, the written scale kept) and below 10^9; every calculated amount (BT-131, BT-116, BT-117, BT-106, BT-109, BT-110, BT-112, BT-115) below 10^10 EUR, an interoperability guard for the pinned validator, not an EN 16931, XRechnung or XSD maximum |

Input outside the profile fails with an explicit `unsupported_*` (or field-specific) error. Such an error means "not
supported by this profile", not "legally invalid". BT-10 is buyer-provided business information: it is required and
is never generated or defaulted (it is not necessarily a Leitweg-ID).

## Credit note 381 (first bounded slice)

A credit note reverses part or all of an earlier ordinary invoice. The document kind is the explicit BT-3 value (`380` or
`381`); it is never inferred from the sign of an amount, and a credit note is not an invoice with every value negated.

| Aspect | Behaviour |
| --- | --- |
| Amounts | positive, calculated exactly like a 380 (same rounding, same VAT buckets); a full and a partial reversal are the same calculation with different quantities or lines |
| Preceding invoice (BG-3) | **PROFILE restriction.** Exactly one reference with BT-25 is required on a 381; BT-26 is optional and should be given when BT-25 alone does not identify the invoice. XRechnung 3.0.2 section 13.1 does not require a reference for a 381. A 380 with a reference is refused. The domain holds no original invoice, so it cannot check that the reference exists or that the credited amounts stay within the original: that is the caller's responsibility |
| Payment | only an explicit **clearing** (`payment.settlement` with `kind: 'clearing'` and `reciprocalObligationConfirmed: true`): UNCL4461 code 97, clearing between partners, written without BG-17. Nothing defaults to it. The caller confirms that the credit is offset against an existing reciprocal obligation |
| Refused | a refund by credit transfer (`unsupported_credit_note_refund_transfer`), any other settlement (`unsupported_credit_note_settlement`), 380-style payment means on a 381 (`unsupported_credit_note_payment_means`), a clearing that is not confirmed (`missing_clearing_confirmation`) and a clearing on a 380. Code 97 is never substituted automatically |
| BR-CO-25 | applied to a 381 as to a 380: a positive amount due needs BT-9 or BT-20 (the pinned validator does not implement the rule). Its applicability to credit notes is read from the SeMoX rule context and is not confirmed against the licensed EN 16931 text |
| UBL | a `CreditNote` document (`CreditNoteTypeCode`, `CreditNoteLine`, `CreditedQuantity`); BT-9 is `PaymentMeans/PaymentDueDate`; BG-3 is `BillingReference`. A 381 under an `Invoice` root is rejected by BR-CL-01 |
| CII | the same root with `TypeCode` 381; BG-3 is `InvoiceReferencedDocument`; the `qdt` namespace is declared only on a 381 |

Not supported in this slice, and not abandoned: refund scenarios (the sources consulted do not say whose account BG-17
designates on a credit note), correction 384, self-billing 389, negative amounts and lines, allowances and charges.
**Recipient compatibility is limited.** XRechnung section 13.1 distinguishes a commercial credit note (381) from a
correction of an invoice (384), and its change history carries the entry XRG-v1.2.0-23, titled not to use a credit
note with reference to cancellation invoices. Orkaid does not claim that every recipient, in particular in the public
sector, accepts cancellation of an invoice by a 381.

## Runtime protection

`Invoice` is created only by `buildInvoice`, which deep-freezes it and registers it in a module-private set.
`serializeUblInvoice`, `serializeCiiInvoice` and `isValidatedInvoice` check that registration at runtime. A copy, a
clone, a hand-made object or a type assertion is refused with `unvalidated_invoice` and never yields XML. The branded
TypeScript type alone is not treated as a security boundary.

## Sources and limits of the verification

Bindings, cardinalities and element order come from the official artefacts of the KoSIT bundle of 2026-08-31: the
SeMoX CIUS model, the UBL 2.1 XSD, XRechnung Schematron 2.6.0 and the validator configuration 2026-08-31. The
licensed CEN/TS 16931-3-2 was not available, so **no exhaustive verification against it is claimed**. The validator
tolerates small amount differences by design (for example BR-CO-17 allows one currency unit), so an accepted
document does not prove cent-exact amounts: the tests compare every amount against independently worked values.
The KoSIT check covers one validator and configuration combination on synthetic fixtures. It says nothing about tax
correctness or acceptance by a recipient.

## Not part of the current implementation

A user interface, PDF, any KoSIT service (browser or server), authentication, persistence, further VAT
categories or regimes (other than the three above; Orkaid never decides whether a caller may use § 19 UStG or § 13b UStG), corrections (384, 389), credit-note refunds, deployment. None of these is abandoned; they are simply not
built here.

## Checking it

```
npm test            # headless: calculation, validation, serializer, fixtures, static checks
npm run check       # Astro diagnostics and tsc
npm run test:kosit  # local KoSIT validation, see tools/kosit/README.md
```
