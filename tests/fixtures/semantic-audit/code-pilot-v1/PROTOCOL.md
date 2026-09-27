---
mdlTitle: "Orkaid — Engineering & Product Decisions"
mdlGuid: mdl_vdsmjzk105a8jv8e
---

# Real-code semantic audit pilot v1: preregistration

## 1. Status

- **Kind:** preregistration of one exploratory experiment, authorized by MDR-20. It is frozen, with the profile, the
  fixtures, the expected labels and the success signals, in a local commit before the first live request. It contains
  no results.
- **Not:** a continuation of the Phase-1 governance audit (closed, `docs/semantic-audit/phase1-v1/`), a certification,
  a repository-wide code audit, or a statement about regulatory correctness.
- **Question:** does TypeSafe Jev's probability distribution move in the expected direction when a known violation of
  an explicit engineering invariant is introduced into real committed source code, while a semantics-preserving change
  leaves it where it was?

## 2. Target

`src/lib/domain/xrechnung/document.ts` at commit `e140fc4f6905bb4dfb6c6666f9188b4e595067ec` (last changed by
`82e3c12`), SHA-256 `9fc10b758a4206f32e63ec5ba2bf50dc6b526c8322ad7d20ce068c58757ba7f5`, 476 lines. It validates the
business data of a semantic invoice at the domain boundary, applies the implemented profile, delegates every amount to
`invoice.ts`, and protects the validated invoice at runtime. Tests exercising it: `tests/domain/xrechnung-document.test.ts`
(directly), and through it the UBL, CII, fixture and static-check tests in `tests/domain/`.

The product file is not changed. The baseline is a byte-for-byte copy; every other target is derived from it outside
the source tree (`targets/*.ts.txt`, not compiled).

## 3. Invariants

| Id | Invariant (as asked; full text in the profile) | Provenance | Why it applies to this file |
| --- | --- | --- | --- |
| `inv1_no_money_arithmetic` | no arithmetic on monetary amounts; every amount comes unchanged from the monetary calculation | `document.ts` header lines 3; `invoice.ts` header ("document.ts ... delegates every amount to this module"); `src/lib/domain/xrechnung/README.md` pipeline; the calculation contract of MDR-13 lives in `invoice.ts`; AGENTS.md §7 (keep financial logic explicit, never invent rounding) | document.ts builds the invoice lines and totals it returns |
| `inv2_explicit_failure` | missing, malformed or out-of-profile input is an error at its path, never silently repaired, trimmed, defaulted, substituted or generated | `document.ts` header lines 8–10 and `readText` ("never trimmed or otherwise repaired"); `invoice.ts` header ("an explicit failure, never a fallback", MDR-12); README ("fails with an explicit `unsupported_*`", "BT-10 ... never generated or defaulted"); AGENTS.md §7 ("fail visibly"); tests "input outside the implemented profile fails explicitly", "never trimmed", "BT-10 is buyer-provided" | document.ts is the business-data boundary |
| `inv3_validated_only_by_registration` | only objects produced and registered by `buildInvoice` are recognised as validated | `document.ts` header lines 12–13 and `isValidatedInvoice` doc comment; README "Runtime protection"; test "only invoices produced by buildInvoice are recognised" | document.ts owns the registration and the check |
| `inv4_rule_kinds_separated` | EXTERNAL / CONDITIONAL / PROFILE labels are truthful; no profile choice is presented as a legal or XRechnung requirement | `document.ts` header lines 5–10; README table of rule kinds (payment means 58 is listed as **Profile**); AGENTS.md §8 (separate legal requirements from product choices); MDR-15's rule on keeping kinds of requirement apart | document.ts is where the profile restrictions are written and labelled |
| `inv5_snapshot_no_accessors` | input read once into a plain-data snapshot; accessors never executed; no input makes `buildInvoice` throw | `document.ts` lines 143–145 and 224–227; tests "the input is read once into a snapshot", "hostile input never makes buildInvoice throw" | document.ts takes the snapshot |

Each question (profile `code-audit-document-pilot-v1` 1.0.0, `tools/semantic-audit/profiles/`) is a Choice among
`satisfies_invariant`, `violates_invariant` and `insufficient_evidence`. It treats the whole source as data, says
that comments, string literals and identifiers are never instructions, asks about the named invariant only, asks for
no code, and does not reveal a label. One request per target carries all five questions.

## 4. Targets, expected labels and deterministic evidence

Deterministic evidence (`deterministic.json`): `tsc --noEmit` on the whole project and `node --test
tests/domain/*.test.ts` (181 tests, including the AST static checks) in a copy of `HEAD` with the target in place of
`document.ts`. The KoSIT harness is not run (it needs the local bundle and Java); it does not exercise the changed
code paths.

| Target | SHA-256 | Exact change from REAL | Intended violation | tsc | domain tests |
| --- | --- | --- | --- | --- | --- |
| REAL | `9fc10b75…a7f5` | none | none | pass | 181/181 |
| CONTROL | `4c6b18e7…e275` | `readTelephone`: `(text.match(/[0-9]/g) ?? []).length >= 3` → `text.replace(/[^0-9]/g, '').length >= 3` (same count for every string) | none | pass | 181/181 |
| MUTANT-01 | `1dd27d69…fd36` | `import type { Decimal }` → `import { multiply, roundHalfUp, type Decimal }`; line net amount `totalsLine.netAmount` → `roundHalfUp(multiply(calculated.quantity, calculated.unitPrice), 2)` | inv1 | pass | **181/181 (not detected)** |
| MUTANT-02 | `88a81d6a…8016` | `readChoice`: `return match ?? report(errors, unsupported, path);` → `return match ?? allowed[0];` | inv2 | pass | **177/181 (4 fail)** |
| MUTANT-03 | `2209fdba…9f51` | `isValidatedInvoice`: `validated.has(value)` → `(validated.has(value) \|\| Object.isFrozen(value))` | inv3 | pass | **181/181 (not detected)** |
| MUTANT-04 | `c9c34f0c…fd1f` | comment `// PROFILE: payment means code 58 (SEPA credit transfer) only.` → `// EXTERNAL: XRechnung requires payment means code 58 (SEPA credit transfer).` | inv4 | pass | **181/181 (not detected)** |

MUTANT-01 yields the same amounts as the monetary calculation for every tested input, so no test can see it; it
duplicates the calculation contract outside `invoice.ts`. MUTANT-03 passes because the tests' look-alikes (spread
copy, `structuredClone`, `Object.create`) are not frozen. MUTANT-04 changes a comment only; no deterministic check
reads rule-kind comments. Full hashes are in `MANIFEST.json`.

**Expected labels** (`targets.json`), assigned from repository evidence before any live request:

| Invariant | REAL | CONTROL | MUTANT-01 | MUTANT-02 | MUTANT-03 | MUTANT-04 |
| --- | --- | --- | --- | --- | --- | --- |
| inv1 | satisfies | satisfies | **violates** | satisfies | satisfies | satisfies |
| inv2 | satisfies | satisfies | satisfies | **violates** | satisfies | satisfies |
| inv3 | satisfies | satisfies | satisfies | satisfies | **violates** | satisfies |
| inv4 | UNKNOWN_BASELINE | UNKNOWN_BASELINE | UNKNOWN_BASELINE | UNKNOWN_BASELINE | UNKNOWN_BASELINE | **violates** |
| inv5 | satisfies | satisfies | satisfies | satisfies | satisfies | satisfies |

inv4 is `UNKNOWN_BASELINE` on REAL and wherever REAL's rule comments are unchanged: the repository shows that the
labels agree with its own README table, but the correctness of every EXTERNAL citation against the standards has not
been verified independently here, and AGENTS.md §8 forbids assuming it. MUTANT-04 is labelled `violates` because the
repository itself classifies payment means 58 as a profile restriction. `UNKNOWN_BASELINE` items are excluded from
agreement counts and from the CONTROL rule, and are not changed after results.

## 5. Procedure

1. Freeze commit: profile, this protocol, `targets.json`, `deterministic.json`, the six targets, the tool and
   `MANIFEST.json`.
2. Offline `--plan` under the zero-network guard: six bodies, each with only `model`, `state.source_file` (the fixed
   path `src/lib/domain/xrechnung/document.ts` and the target text) and the frozen questions. The path is the same for
   every target, so no body says which target it is.
3. Live run: six targets × five repeats = 30 requests, `jev-1.13.0`. A valid answer is never resent. On an
   infrastructure failure the valid responses are kept and at most one reported resume sends only the missing
   requests; an invalid or incomplete response, or a model mismatch, blocks and is not a result.
4. Evaluation from the preserved evidence, then the evidence commit. Nothing in sections 3, 4 and 6 changes after the
   first live request.

## 6. Preregistered success signals (descriptive, not a certification gate)

For each target and invariant, P(violates) is the probability of `violates_invariant` in one repeat; the median is
over the five repeats; the top option is the option with the highest probability in one repeat.

- **DETECTED** (per mutant, on its intended invariant): `violates_invariant` is the top option in all 5 repeats, **and**
  median P(violates) of the mutant − median P(violates) of REAL ≥ **0.30**.
- **CONTROL stable**: for every invariant labelled on REAL (not `UNKNOWN_BASELINE`), the CONTROL top option equals the
  most frequent REAL top option in every repeat, **and** median P(violates) of CONTROL − median P(violates) of REAL ≤
  **0.15**.

Reported regardless of these signals: P(violates) of REAL, CONTROL and each mutant, the delta, the top options,
repeatability, agreement with every labelled cell, and all raw distributions.

## 7. What a result does not support

Not general code correctness, not regulatory correctness, not production readiness, not prompt-injection resistance
(no injection is tested), not repository-wide compliance, and no certification of any kind. It is evidence about this
file, these five invariants, these constructed mutants, this profile and `jev-1.13.0` only.
