---
mdlTitle: "Orkaid — Engineering & Product Decisions"
mdlGuid: mdl_vdsmjzk105a8jv8e
---

# Increment 3: preregistered CII experiment protocol

## 1. Status

- **Kind:** preregistration. It fixes the question, the oracles, the controls and the interpretation rules **before**
  any CII serializer exists. It contains no experimental results.
- **Frozen on:** 2026-09-26, against repository `main` after `04761f9`.
- **Decision record:** the staged Increment 3 decision record, whose need is to establish whether the semantic model
  and the exact monetary engine support an independently validated second syntax binding without hidden
  syntax-specific assumptions or monetary-policy drift. It receives its number when it is sealed. Until then it is
  referred to only by this paraphrase.
- **Order:**
  1. This package is committed and its manifest is hashed.
  2. The commit is published.
  3. The decision record is sealed with the public commit SHA and the manifest SHA-256.
  4. Only then may CII implementation begin.
  No CII implementation may be used to tune this package. Any later change to a file listed in `MANIFEST.json` is a
  protocol deviation and is reported as one.
- **Builds on:** the V1 scope and syntax-independent model (MDR-12), the exact-money policy (MDR-13), number notation
  and the XML decimal form (MDR-14), and the UBL serializer and bounded profile (MDR-15). Evidence semantics follow
  analysis an_b1kwb2. The static R120 finding is world fact wf_fa1kxd.

## 2. Question and claim

**Question.** Can the existing validated `Invoice` be serialized to CII for the implemented profile without changing
the semantic model, without changing the monetary policy, and without any arithmetic in the serializer, so that the
UBL and CII output are semantically equivalent and exact?

**The strongest claim this experiment can support:**

> For the fixtures in this package, the same validated `Invoice` serializes to UBL and CII. The BT/BG values exercised
> by the current profile are identical in the normalized projection and equal the independent MDR-13 oracle exactly.
> Both outputs are assessed by the KoSIT validator 1.6.3 with configuration 2026-08-31, in mechanically selected
> scenarios.

It does **not** support:
- a general CII conformance claim;
- exhaustive EN 16931 syntax independence;
- conformance to CEN/TS 16931-3-3, which is licensed and not available;
- any statement about tax correctness or recipient acceptance;
- settlement of any open question of MDR-13 or MDR-14.

## 3. Exclusions

Each exclusion is checkable from the change set of the experiment.

1. No UI, PDF, server, API, service, authentication or persistence.
2. No change to the implemented profile, the semantic model (`document.ts`), the monetary engine (`invoice.ts`,
   `decimal.ts`) or the notation module (`number-notation.ts`). The diff against this commit must be empty for these
   files.
3. No new monetary policy, and no arithmetic in the CII serializer: amounts are only formatted with
   `formatXmlDecimal`.
4. No widening of the profile to make CII easier.
5. No silent model change to fit CII. A needed change is a finding (section 9), never an edit.
6. No production deployment.
7. No general CII or EN 16931 claim beyond section 2.

## 4. Evidence layers and fixtures

There are three independent layers:

| Layer | Oracle |
| --- | --- |
| 1. Validator | KoSIT, per section 10; messages are interpreted, not only exit codes. KoSIT is **not** the monetary oracle. |
| 2. Money | `expected-money.json`, derived by exact decimal arithmetic independently of the Orkaid engine. |
| 3. Semantics | `expected-projections.json`. Each fixture is compared three ways: expected = UBL projection = CII projection. |

**Fixtures:**
- `s1-interleaved-vat.json`, `s2-date-roles.json`, `s4a-rounded-zero-line.json`, `s4b-half-up.json` (new);
- the baseline fixtures `a-simple`, `b-ten-lines`, `c-rounded-line-net` and `d-mixed-rates`, pinned by hash in
  `MANIFEST.json`.

All inputs use canonical notation. The new fixtures take their parties, payment and BT-10 from `a-simple`.

## 5. Normalized projection

The projection holds only what the profile exercises. Paths come from the SeMoX CIUS model in the pinned bundle:
binding `ubl-inv` for UBL and `cii` for CII.

**Confidence codes:**
- **S** = SeMoX
- **K** = KoSIT XSD or Schematron
- **B** = binding ambiguity
- **L** = limitation of available sources

No path is confirmed against CEN/TS 16931-3-2 or -3-3.

**Normalization rules:**
- **Decimals:** exact value in minimal form, with no trailing fractional zeros and no binary floating point
  (`1.50` → `1.5`, `0.00` → `0`). The lexical form is recorded separately as MDR-14 evidence and is not part of
  equivalence.
- **Dates:** ISO `YYYY-MM-DD`. In CII they are accepted only with `@format="102"` and an 8-digit value; any other form
  is an extraction failure and is never guessed.
- **Text:** exact code-point equality after XML parsing and entity decoding. No trimming, no Unicode normalization,
  no whitespace folding.
- **Currency:** BT-5 is projected once. `currencyID` on amounts is checked as validity, not projected.
- **BG-25** is a map keyed by BT-126. Order is not significant, and a duplicate key is a comparator error. Separately,
  BT-126 must equal `i + 1` for input line `i` in both syntaxes.
- **BG-23** is a map keyed by `category|rate` (for example `S|19`). Order is not significant, and a duplicate key is a
  comparator error.
- **BT-23 and BT-24** are protocol constants (XRechnung 3.0.2 §11.27). They are not carried by `Invoice`.

In the table below, UBL paths start at `/Invoice`. CII paths use `HA`, `HS` and `HD` for
`rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTrade{Agreement,Settlement,Delivery}` and `LI` for
`ram:IncludedSupplyChainTradeLineItem`.

| Field | UBL | CII | Confidence |
| --- | --- | --- | --- |
| BT-1, BT-3 | `cbc:ID`, `cbc:InvoiceTypeCode` | `rsm:ExchangedDocument/ram:ID`, `/ram:TypeCode` | S |
| BT-5, BT-10 | `cbc:DocumentCurrencyCode`, `cbc:BuyerReference` | `HS/ram:InvoiceCurrencyCode`, `HA/ram:BuyerReference` | S |
| BT-23, BT-24 | `cbc:ProfileID`, `cbc:CustomizationID` | `rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID`, `…/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` | S |
| BT-2 | `cbc:IssueDate` | `rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString[@format='102']` | S + K |
| BT-9 | `cbc:DueDate` | `HS/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString[@format='102']` | S + K |
| BT-72 | `cac:Delivery/cbc:ActualDeliveryDate` | `HD/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString[@format='102']` | S + K |
| BT-27, BT-44 | `cac:Accounting{Supplier,Customer}Party/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | `HA/ram:{Seller,Buyer}TradeParty/ram:Name` | S |
| BT-31 | `…/cac:PartyTaxScheme[cac:TaxScheme/cbc:ID='VAT']/cbc:CompanyID` | `HA/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']` | S |
| BT-34, BT-49 | `…/cac:Party/cbc:EndpointID` | `HA/ram:{Seller,Buyer}TradeParty/ram:URIUniversalCommunication/ram:URIID` | S |
| BT-34-1, BT-49-1 | `…/cbc:EndpointID/@schemeID` | `…/ram:URIUniversalCommunication/ram:URIID/@schemeID` | S + K |
| BT-35/37/38/40, BT-50/52/53/55 | `…/cac:PostalAddress/cbc:StreetName`, `cbc:CityName`, `cbc:PostalZone`, `cac:Country/cbc:IdentificationCode` | `…/ram:PostalTradeAddress/ram:LineOne`, `ram:CityName`, `ram:PostcodeCode`, `ram:CountryID` | S |
| BT-41 | `…/cac:Contact/cbc:Name` | `HA/ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonName` | B; project choice |
| BT-42, BT-43 | `…/cac:Contact/cbc:Telephone`, `cbc:ElectronicMail` | `…/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber`, `…/ram:EmailURIUniversalCommunication/ram:URIID` | S |
| BT-81 | `cac:PaymentMeans/cbc:PaymentMeansCode` | `HS/ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode` | S |
| BT-84 | `cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID` | `HS/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID` | B; project choice |
| BG-25: BT-126 (key), BT-153, BT-129, BT-130, BT-146, BT-151, BT-152, BT-131 | `cac:InvoiceLine/cbc:ID`, `cac:Item/cbc:Name`, `cbc:InvoicedQuantity` (`@unitCode`), `cac:Price/cbc:PriceAmount`, `cac:Item/cac:ClassifiedTaxCategory/cbc:ID`, `…/cbc:Percent`, `cbc:LineExtensionAmount` | `LI/ram:AssociatedDocumentLineDocument/ram:LineID`, `LI/ram:SpecifiedTradeProduct/ram:Name`, `LI/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity` (`@unitCode`), `LI/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount`, `LI/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode`, `…/ram:RateApplicablePercent`, `LI/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount` | S |
| BG-23: BT-118 + BT-119 (key), BT-116, BT-117 | `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:ID`, `…/cbc:Percent`, `…/cbc:TaxableAmount`, `…/cbc:TaxAmount` | `HS/ram:ApplicableTradeTax[ram:TypeCode='VAT']/ram:CategoryCode`, `…/ram:RateApplicablePercent`, `…/ram:BasisAmount`, `…/ram:CalculatedAmount` | S |
| BG-22: BT-106, 109, 110, 112, 115 | `cac:LegalMonetaryTotal/cbc:LineExtensionAmount`, `cbc:TaxExclusiveAmount`, `cac:TaxTotal/cbc:TaxAmount`, `cbc:TaxInclusiveAmount`, `cbc:PayableAmount` | `HS/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount`, `ram:TaxBasisTotalAmount`, `ram:TaxTotalAmount[@currencyID]`, `ram:GrandTotalAmount`, `ram:DuePayableAmount` | S |

**Binding choices** (`binding-choices.json`) are verified structurally on the generated CII, **in addition to** the
projection:
- BT-41 is emitted as `DefinedTradeContact/ram:PersonName`; `DepartmentName` must be absent.
- BT-84 is emitted as `ram:IBANID`; `ram:ProprietaryID` must be absent.
- The electronic-address schemes are `@schemeID` on `URIID`.
- The dates carry `@format="102"`.

Generated CII that violates one of these choices is **SER** (section 9, step 2), never BIND or SRC. If later evidence
shows that a frozen choice was itself based on ambiguous or insufficient sources, that is recorded separately as a
preregistration deviation, and the evidence problem is classified BIND or SRC. The serializer mismatch is not
reclassified.

**Basis for BT-34-1 and BT-49-1:**
- SeMoX components `scheme-id-bt-34` and `scheme-id-bt-49` bind to `URIID/@schemeID` (S).
- The CII XSD declares `schemeID` on `udt:IDType`, the type of `URIID` (K).
- EN16931-CII rules BR-62 and BR-63 (fatal) require a non-empty `@schemeID` on `URIUniversalCommunication[1]/URIID`
  (K).
- BR-CL-25 lists `EM` (K).

## 6. Oracle pack

All inputs are accepted by the current `buildInvoice`. This was checked on Node 24.20.0 for acceptance only; no amount
was taken from the engine.

**S1: interleaved VAT (7, 19, 7, 19).** It detects:

| Bug | Wrong result |
| --- | --- |
| Grouping by adjacency | 4 buckets instead of 2 |
| A line placed in the wrong bucket | different bucket values |
| Per-line VAT summing | 7% gives 2.59 + 0.93 = 3.52 instead of 3.53 |
| Truncation | 191.22 and 13.31, so BT-112 = 1267.11 |
| Rounding up (ceiling) | 37.05, so BT-112 = 1267.16 |
| Order dependence | lines are interleaved; buckets are emitted in the order 19 then 7 |

It contains no exact ties.

**S2: date roles and format 102.**
- BT-2 = 2028-03-01, BT-72 = 2028-02-29 (leap day), BT-9 = 2029-01-02 (year boundary). All three are distinct.
- A month/day swap of BT-2 or BT-9 gives another valid but different date.
- CII values are `20280301`, `20280229` and `20290102`, each with `@format="102"`.
- It detects role swaps, a wrong CII binding, a wrong format representation and reuse of one date for another.

**S4a: rounded zero line net.** Line 1 is 0.001 × 0.40 = 0.0004, which rounds to BT-131 = 0.00 and must stay in the
document with 0.00. Line 3 (1.6 × 6.253 = 10.0048 → 10.00) separates rounding per line from summing raw values and
then rounding: the raw sum 20.0052 would give 20.01 and BT-112 = 23.81. The pack has no ties, so HALF_UP,
HALF_EVEN and truncation agree and S4a does not confound S4b.

**S4b: HALF_UP.**
- 0.285 → 0.29 and 0.105 → 0.11. HALF_EVEN and truncation give 0.28 and 0.10, and BT-112 = 3.38.
- Rounding up is indistinguishable from HALF_UP here; S1 and S4a detect it.
- Binary floating point also yields 0.29 (`1.5*0.19` is `0.28500000000000003`), so S4b alone does not detect float
  use; the static checks of MDR-13 cover that.
- A line-level tie is covered by the baseline `c` (3 × 0.335 = 1.005 → 1.01).

**Unit codes** (`unit-codes.json`):
- The seven positive profile cases are C62, HUR, DAY, MON, KGM, LTR and MTR.
- The three boundary-negative cases are `H87`, `c62` and the empty string. `H87` is rejected by the profile only; it
  is in the validator's BR-CL-23 list.
- This verifies the current profile and does not widen it.

## 7. Manual arithmetic sheet

All rounding is to two decimals with HALF_UP (MDR-13). BT-131 is rounded per line, BT-116 is the sum of rounded
nets per category and rate, BT-117 is rounded once per bucket, and BT-110 is the sum of BT-117.

```
S1   L1  3 × 12.347      = 37.041     → 37.04   ┐ 7%   37.04 + 13.32   =   50.36   × 0.07 =   3.5252 →   3.53
     L3  1.333 × 9.99    = 13.31667   → 13.32   ┘
     L2  2.25 × 84.99    = 191.2275   → 191.23  ┐ 19%  191.23 + 828.31 = 1019.54   × 0.19 = 193.7126 → 193.71
     L4  7 × 118.33      = 828.31     → 828.31  ┘
     BT-106 = BT-109 = 50.36 + 1019.54 = 1069.90   BT-110 = 3.53 + 193.71 = 197.24   BT-112 = BT-115 = 1267.14

S4a  L1  0.001 × 0.40    = 0.0004     → 0.00    ┐
     L2  2 × 5.00        = 10.00      → 10.00   ├ 19%  0.00 + 10.00 + 10.00 = 20.00 × 0.19 = 3.8000 → 3.80
     L3  1.6 × 6.253     = 10.0048    → 10.00   ┘
     BT-106 = BT-109 = 20.00   BT-110 = 3.80   BT-112 = BT-115 = 23.80

S4b  L1  1 × 1.50        = 1.50       → 1.50      19%  1.50 × 0.19 = 0.285 → 0.29
     L2  1 × 1.50        = 1.50       → 1.50       7%  1.50 × 0.07 = 0.105 → 0.11
     BT-106 = BT-109 = 3.00   BT-110 = 0.40   BT-112 = BT-115 = 3.40

S2   (lines of a-simple) 2 × 49.90 = 99.80; 1.5 × 80.00 = 120.00; 19% 219.80 × 0.19 = 41.762 → 41.76; BT-112 = 261.56
```

`expected-money.json` holds every value of every fixture, with the raw products and the raw VAT. The S1, S4a and S4b
values were also reviewed by hand, independently, before freezing.

## 8. Controls

`controls.json` holds exact mutations and expectations:
- **Validator:** V1 (BT-10 removed; BR-DE-15, reject), V2 (generic EN 16931 identifier; wrong scenario, never
  acceptance), V3 (unknown identifier; no scenario).
- **Money:** M1 (the 7% BT-117 is raised by 0.01 and the totals are kept coherent). The monetary oracle must reject
  it; the KoSIT result is only an observation.
- **Semantics:** N1 (BT-2 ↔ BT-72), N2 (BT-27 ↔ BT-44), N3 (lines reordered and renumbered). Each must fail.
- **Order-preserving control:** O1 (line and bucket order changed, identities kept) must pass.

`controls.json` also holds the R120 probe (section 11) and the MDR-14 lexical probes L1–L3.

## 9. Finding taxonomy

Every discrepancy gets exactly one class, by the first question that matches:

1. **ORACLE:** the preregistered expectation or extraction path is wrong on independent re-derivation. It is
   reported as a deviation and never silently corrected.
2. **SER (frozen binding):** generated serializer output deviates from an explicit Orkaid project binding frozen by
   this protocol: BT-41 → `PersonName`, BT-84 → `IBANID`, BT-34-1 and BT-49-1 → `URIID/@schemeID`, and the exercised
   CII dates → `udt:DateTimeString[@format="102"]` (section 5, `binding-choices.json`). This step comes before source
   or binding ambiguity is considered. If new evidence shows that a frozen choice was itself ambiguous or
   unsupported, that is recorded separately as a preregistration deviation with a BIND or SRC finding; it does not
   turn the mismatch into success.
3. **SRC:** the available artifacts do not determine the binding, or contradict each other.
4. **BIND:** the available artifacts allow more than one binding.
5. **MODEL-M:** CII needs syntax-neutral information that `Invoice` does not carry.
6. **MODEL-U:** a syntax-neutral value needed by both syntaxes lives only in a serializer. Known candidates before
   the experiment: the BT-23 and BT-24 constants, the BT-126 rule `index + 1`, and the VAT tax-scheme code. Moving
   them is a model change, so they are reported, not moved.
7. **SER:** the model has the information and the binding is unique, but the serializer emits something different.
8. **MON:** the value is correct under the model and the binding, but a binding or validator requirement demands an
   amount other than MDR-13 gives.
9. **VAL:** validator behaviour (severity, tolerance, custom level, accepting a wrong amount) differs from the rule
   text or the expectation, without conflict with the monetary policy.

This merges the five classes of an_b1kwb2 as follows:
- serializer bug → SER
- model insufficiency → MODEL-M or MODEL-U
- binding ambiguity → BIND
- validator constraint → VAL
- source limitation → SRC

It adds MON and ORACLE. There is no residual class: a case that fits none is INSUFFICIENT and a deviation.

## 10. KoSIT selection and interpretation

1. **Pinned tooling:** bundle, validator 1.6.3 and configuration 2026-08-31, by the hashes in
   `tools/kosit/kosit-manifest.json`. None may be substituted after results are seen.
2. **Scenario:** it is determined only by the root element and BT-24
   (`urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`).
   - UBL → `EN16931 XRechnung (UBL Invoice)`
   - CII → `EN16931 XRechnung (CII)`
3. **Recorded for every run:** process exit code, report `valid`, every step and its validity (XSD, EN 16931
   Schematron, XRechnung Schematron, mapped to the scenario resources), every message (id, code, level, location,
   text), assessment, matched scenario, document hash and engine. A missing step is INSUFFICIENT.
4. **Classes** (all require the intended scenario and identical bytes):

   | Class | Condition |
   | --- | --- |
   | ACCEPT | assessment `accept`, no error, no warning |
   | ACCEPT-W | assessment `accept` with warnings. The report is then `valid=false` by design. Neither pass nor fail: each warning is classified per section 9. |
   | REJECT | assessment `reject` |

   Information messages are recorded and triaged.
5. **Invalid runs:**
   - **NO-SCENARIO:** no scenario matched;
   - **WRONG-SCENARIO:** a different scenario matched;
   - **RUN-INVALID:** processing error, missing report or hash mismatch.
   All three are INSUFFICIENT and never count as acceptance.
6. **MDR-14 rule inventory:** `rule-inventory.json` is generated by `tools/kosit/rule-inventory.ts` from the pinned
   artifacts. It lists, for every exercised decimal term, the SeMoX UBL and CII paths, the XSD type chain and
   attributes, and the ids of every Schematron assertion of the two scenarios that mention the term. Only ids, paths,
   types and hashes are included. Its selection rule is stated in the file, and it must reproduce byte for byte.

## 11. R120 probe

- **Base:** S4b, in UBL and CII.
- **Documents:**
  - **P0:** unchanged.
  - **P1:** line 1 BT-131 1.50 → 1.53, totals recomputed coherently. The rule's difference is 0.03, above the 0.02
    tolerance.
  - **P2:** 1.50 → 1.52. The difference is 0.02, inside the inclusive tolerance.
  All expected values are in `controls.json`.
- **UBL** is the positive twin: R120 is present in the XRechnung UBL Schematron as well.

| Result | Condition |
| --- | --- |
| **ENFORCED** (per syntax) | R120 in P1, and absent in P0 and P2 |
| **NOT ENFORCED** (CII) | no R120 in CII P1, while UBL P1 shows it and UBL P0/P2 do not, with the intended scenario, all steps run and no processing error. The report does not expose fired rules, so this means "not observed in the report". |
| **INCONCLUSIVE** | the UBL twin does not show R120 in P1; R120 appears in P0 or P2 (also recorded as VAL); wrong or no scenario; XSD failure or processing error |

The result may not change this design.

## 12. Preregistration and manifest

`MANIFEST.json` is written by `tools/cii-experiment/manifest.ts`:
- `files` gives the path, byte size and SHA-256 of every preregistration artifact: this directory, the baseline
  fixtures a–d, and the generating tools. `npm test` checks it byte for byte.
- `recorded` gives the Node version, the `package-lock.json` hash, the hashes of the code under test and the KoSIT
  identities. The experiment run compares against these; `npm test` does not enforce them.

**What establishes the preregistration:**

| Mechanism | Proves | Does not prove |
| --- | --- | --- |
| Commit SHA and manifest hash | the exact content | when it was written |
| The public push | existence no later than GitHub's server-side receipt of the commit | – |
| Sealing the decision record with the public commit SHA and the manifest hash | a second, independent timestamp (Memolok server) | – |
| Any of the three | – | that no private CII attempt came earlier |

Two more mitigations:
- Every CII implementation commit must descend from the preregistration commit.
- The run re-verifies the manifest.

## 13. Evidence interpretation for MDR-13 and MDR-14

The outcomes are SATISFIED, INSUFFICIENT and CONFLICT (an_b1kwb2):
- **SATISFIED** means an evidence package sufficient for a later settlement decision within the stated scope.
- **INSUFFICIENT** means evidence is missing or not interpretable.
- **CONFLICT** means a real contradiction between the approved policy, the emitted value, a binding or validator
  requirement, or the cross-syntax evidence.

Precedence is **CONFLICT > INSUFFICIENT > SATISFIED**, taken over the components; an undefined case is
INSUFFICIENT and a deviation. **No result settles an open question.** Settlement needs a later Accepted record
(MDR-15, `oq-validator-questions-of-mdr-13-and-14-not-settled`).

**MDR-13 `oq-validator-acceptance-of-rounded-line-net`** is assessed as two separate claims.

- **(a) Acceptance.**
  - SATISFIED: S1, S4a, S4b and `c`, in both syntaxes, are ACCEPT or ACCEPT-W with no R120 and no warning on a
    monetary term, and match layer 2 exactly.
  - CONFLICT: any R120 or other message asserting a different monetary relation on a document that is correct in
    layer 2. A purely informational message is recorded but is not a conflict.
  - INSUFFICIENT: an invalid run.
- **(b) Enforcement.**
  - SATISFIED only if the R120 probe is ENFORCED in both syntaxes.
  - CII NOT ENFORCED or INCONCLUSIVE gives INSUFFICIENT, with a VAL or SRC finding.

**MDR-14 `oq-xml-decimal-syntax-binding-conformance`.**

- **Level (a), available artifacts.**
  - SATISFIED: every emitted decimal passes XSD and every rule in the inventory for its term; L1 and L2 fail XSD and
    L3 triggers BR-DEC-23, in both syntaxes.
  - CONFLICT: a form emitted per MDR-14 is rejected, or a probe is accepted where rejection was established.
- **Level (b), CEN/TS 16931-3-x:** always **INSUFFICIENT (SRC)** in this increment.

## 14. Proposed Expected Outcomes (drafts for the decision record, not yet created)

1. **Same `Invoice`:** CII is produced by a pure function from the same validated `Invoice` as UBL. The diff against
   this commit is empty for `document.ts`, `invoice.ts`, `decimal.ts` and `number-notation.ts`, and the CII
   serializer performs no arithmetic.
2. **Exact money:** every BT-106/109/110/112/115/116/117/131 value extracted from UBL and CII equals
   `expected-money.json` exactly, for all eight fixtures.
3. **Equivalence:** expected = UBL = CII for every field of section 5, and the structural binding choices hold.
   Structural binding choices are never exempt from the comparison: any mismatch in a frozen structural binding
   fails the structural part of this outcome. A finding classified BIND or SRC is reported explicitly and makes the
   affected outcome INSUFFICIENT, not SATISFIED.
4. **Sensitivity:** V1, V2, V3, M1, N1, N2 and N3 fail in their intended layer, and O1 passes.
5. **Validator:** every positive fixture is ACCEPT or ACCEPT-W in the intended scenario, with every message
   classified. The R120 probe yields one of its three classes, with evidence.
6. **Limitations:** the result report lists every SRC and BIND item, makes no claim beyond section 2, and records
   MDR-14 level (b) as INSUFFICIENT.
7. **No hidden UBL assumptions:**
   - (a) prediction: zero MODEL-M findings;
   - (b) every MODEL-U item is enumerated and classified.

Results are intended to inform MDR-12 `eo-semantic-model-syntax-independent`, MDR-15
`eo-syntax-independent-model-cii-ready`, and these Expected Outcomes once they exist.

## 15. Known source limitations

- **CEN/TS 16931-3-2 and 16931-3-3 are not available.** Every binding here rests on SeMoX, the KoSIT XSD and
  Schematron, and the UBL goldens already accepted by KoSIT.
- **R120 is described inconsistently:** SeMoX says it could not yet be implemented for CII, while the XRechnung CII
  Schematron contains it (wf_fa1kxd). Only observation can decide runtime behaviour.
- **BT-41 and BT-84** have two admissible CII bindings (B). The project choices are in section 5.
- **KoSIT tolerates small amount differences** (for example BR-CO-17), so acceptance never proves cent-exact amounts.
