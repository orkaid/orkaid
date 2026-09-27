---
mdlTitle: "Orkaid — Engineering & Product Decisions"
mdlGuid: mdl_vdsmjzk105a8jv8e
---

# Real-code semantic audit pilot v1: preserved evidence

## 1. Status

- **Kind:** closed experiment record of one exploratory code-audit pilot, authorized by MDR-20 (which does not broaden
  MDR-19). It preserves the evidence of the single live run and its preregistered result. It changes no policy and no
  product code.
- **Question:** does TypeSafe Jev's probability distribution move in the expected direction when a known violation of
  an explicit engineering invariant is introduced into real committed source code, while a semantics-preserving change
  leaves it where it was?
- **Result:** **3 of 4 mutants DETECTED** (MUTANT-01, MUTANT-02, MUTANT-03); **MUTANT-04 NOT DETECTED**; **CONTROL
  stable**. No false positive on the baseline or the control for any labelled invariant.
- **Scope:** one file (`src/lib/domain/xrechnung/document.ts`), five invariants, one control, four constructed
  mutants, `jev-1.13.0`. Not a certification, not a repository audit, not a statement about code correctness in
  general or about regulatory correctness.

## 2. Provenance

| | |
| --- | --- |
| Target | `src/lib/domain/xrechnung/document.ts`, SHA-256 `9fc10b758a4206f32e63ec5ba2bf50dc6b526c8322ad7d20ce068c58757ba7f5` (unchanged before and after the run) |
| Preregistration freeze commit | `dd63b64e8381d050737e830b7adfabe88121d65f` (working tree clean at the run) |
| Profile | `code-audit-document-pilot-v1` 1.0.0, SHA-256 `2a22cd066b17f0a3aa62dac4236ef73a9071092256ab1633e502d3f7e9c9667b` |
| Pilot manifest | SHA-256 `3fba1f75d178070089737394f9ee8b11a93af02a6ed0767bb0128b9968ee079f` |
| Run | 2026-09-27T12:56:56.456Z; 6 targets × 5 repeats = 30 requests, 30 valid, 0 blocked, no resume |
| Model | requested `jev-1.13.0`, resolved `jev-1.13.0` on every response |
| Latency / usage | 294–477 ms (median 331, p95 391); 249 610 input and 9 255 output tokens |

## 3. Preserved files

Byte-for-byte copies: the report from the runner's output directory, everything else from the freeze commit.
TypeScript sources are stored as `.ts.txt` so that they are not compiled here.

| File | SHA-256 |
| --- | --- |
| `evidence/report.json` | `20dc04808394bdba6caa627e8fc4fb04e5b02f8a24eb6673c3086f6ab4ffe69e` |
| `evidence/MANIFEST.json` | `3fba1f75d178070089737394f9ee8b11a93af02a6ed0767bb0128b9968ee079f` |
| `evidence/PROTOCOL.md` (preregistration, invariant provenance) | `fde64de464e47c027da05cec9d4eb6faa50a399392b340217370d801b077a06a` |
| `evidence/targets.json` (targets, expected labels) | `0449c19c448b8e9883d40af78abd58a5f576de92aa1c8dc24a30983ba34eade1` |
| `evidence/deterministic.json` (typecheck and tests per target) | `019025b5222186eb7ed26d1ea90aa9d27c958a985ee0bd68e1f85795379d35a2` |
| `evidence/code-audit-document-pilot-v1.json` (profile) | `2a22cd066b17f0a3aa62dac4236ef73a9071092256ab1633e502d3f7e9c9667b` |
| `evidence/code-pilot.ts.txt` (the tool that ran) | `c26cf4663c58336204f132a794f5770ffbeb51300781709b96fab57ed866b0d2` |
| `evidence/targets/REAL.ts.txt` | `9fc10b758a4206f32e63ec5ba2bf50dc6b526c8322ad7d20ce068c58757ba7f5` |
| `evidence/targets/CONTROL.ts.txt` | `4c6b18e72a83865cc394d74fc5bed62dee8bbb36045deb15d8e4f834a685e275` |
| `evidence/targets/MUTANT-01.ts.txt` | `1dd27d6949cd98c139479d604f479563d80312aaae90b3773157c6e2a053fd36` |
| `evidence/targets/MUTANT-02.ts.txt` | `88a81d6a2636e061f12f9173126cb643ef713028f9cb2ebb74fea86c7bde8016` |
| `evidence/targets/MUTANT-03.ts.txt` | `2209fdba249a3497d037ba32d0ca793aa00fec2c313f6d9dc61fe3f7468d9f51` |
| `evidence/targets/MUTANT-04.ts.txt` | `c9c34f0cecac22ac609181c7ddea34eb51f6f6c2f720733b1a1eced617da5d1f` |
| `evaluation.json` | reproduced from the files above |

## 4. Reproduction

```
node tools/semantic-audit/code-pilot.ts --evaluate docs/semantic-audit/code-pilot-v1/evidence
```

Offline, no key, no git. The report must verify its own `report_sha256`; `MANIFEST.json` must hash to the manifest
SHA-256 the report recorded; every other file must hash to its manifest entry; the profile to the recorded profile
SHA-256; and each target to the source SHA-256 the report recorded for the body it sent. Any mismatch stops it.
`tests/tools/code-pilot-evidence.test.ts` checks that the output equals `evaluation.json` and that a changed report,
fixture, label or profile is refused.

## 5. Preregistered result

Detection rule: `violates_invariant` top in all 5 repeats **and** median P(violates) of the mutant − median of REAL
≥ 0.30. Control rule: CONTROL top equals REAL's most frequent top in every repeat **and** its median P(violates)
rises by at most 0.15, for every invariant labelled on REAL.

| Mutant | Change | Invariant | Tests (181) | Median P(violates): REAL / CONTROL / MUTANT | Δ | Top option (5 repeats) | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MUTANT-01 | line net amount computed locally with `multiply`/`roundHalfUp` | inv1 no money arithmetic | pass (not caught) | 0.00 / 0.00 / 0.93 | +0.93 | violates ×5 | **DETECTED** |
| MUTANT-02 | out-of-profile value replaced by the first allowed one | inv2 explicit failure | **4 fail** | 0.35 / 0.35 / 0.94 | +0.59 | violates ×5 | **DETECTED** |
| MUTANT-03 | any frozen object accepted as validated | inv3 validated only by registration | pass (not caught) | 0.02 / 0.02 / 0.92 | +0.90 | violates ×5 | **DETECTED** |
| MUTANT-04 | profile restriction commented as an XRechnung requirement | inv4 rule kinds separated | pass (not caught) | 0.22 / 0.23 / 0.33 | +0.11 | satisfies ×5 | **NOT DETECTED** |

CONTROL (semantics-preserving rewrite of the telephone digit count): stable on all four labelled invariants (top
`satisfies_invariant` in every repeat; median P(violates) change 0.00 to +0.01).

Labelled cells: 24 of 25 agree with the expected label; the one disagreement is MUTANT-04 on inv4. inv4 is
`UNKNOWN_BASELINE` on the other five targets and not counted. Every labelled cell had the same top option in all five
repeats; the largest probability spread of any option over the five repeats was 0.15 (MUTANT-04, inv4).

Median P(violates) per target and invariant (all 30 raw distributions are in `evaluation.json` and the report):

| Target | inv1 | inv2 | inv3 | inv4 | inv5 |
| --- | --- | --- | --- | --- | --- |
| REAL | 0.00 | 0.35 | 0.02 | 0.22 | 0.09 |
| CONTROL | 0.00 | 0.35 | 0.02 | 0.23 | 0.10 |
| MUTANT-01 | **0.93** | 0.38 | 0.02 | 0.24 | 0.12 |
| MUTANT-02 | 0.01 | **0.94** | 0.03 | 0.35 | 0.12 |
| MUTANT-03 | 0.01 | 0.36 | **0.92** | 0.23 | 0.13 |
| MUTANT-04 | 0.00 | 0.35 | 0.02 | **0.33** | 0.11 |

## 6. What this record does not support

Not general code correctness, not regulatory correctness, not production readiness, not prompt-injection resistance
(no injection was tested), not repository-wide compliance, and no certification of any kind. It is evidence about this
file, these five invariants, these constructed mutants, this profile and `jev-1.13.0` only. Interpretation of the
result belongs to a separate analysis, not to this record.
