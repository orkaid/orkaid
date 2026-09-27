---
mdlTitle: "Orkaid — Engineering & Product Decisions"
mdlGuid: mdl_vdsmjzk105a8jv8e
---

# Semantic governance audit, Phase 1, v1: preserved evidence

## 1. Status

- **Kind:** closed experiment record. It preserves the evidence of the two formal live runs of the Phase-1 semantic
  governance audit and the formal result of its preregistered progression rule. It adds no interpretation and changes
  no policy.
- **State:** v1 is **closed**. Profile `governance-phase1` 0.2.0, its corpora and this evidence are not changed any
  more; a later version is a new profile version with a new, unseen holdout (`PROTOCOL.md` section 3).
- **Scope:** development-time auditing of governance documents with TypeSafe Jev, authorized within the limits of
  MDR-19. It is not a code audit, not a certification and not a statement about regulatory or legal correctness.
- **Formal result:** **CONFLICT**. The preregistered progression rule (`PROTOCOL.md` section 9) is not satisfied, so
  profile 0.2.0 does not proceed to a repository audit pilot.

## 2. Provenance

| | Calibration run | Holdout run |
| --- | --- | --- |
| Commit (working tree clean) | `bc64b5bc891b40f5431863a57cfbfd89088f2a3a` | `75625c5d821957e6de5791b2547002260bb8e674` |
| Timestamp (UTC) | 2026-09-27T11:42:14.998Z | 2026-09-27T12:00:07.819Z |
| Profile | `0.1.0-uncalibrated`, SHA-256 `abdde8c814a09f8ccf8bc2737c5c69436a7d86631b2c7b6a4e19fb22664d2e1b` | `0.2.0`, SHA-256 `f6d71354e681218afa0cf069ddda9f9077c201d023c25c6f02846701dc65eb26` |
| Manifest SHA-256 | `0b9158dfe86ee8732d54bca7fa7ff790c76dc725948a18b4da3e287f88c761d7` | `84130710d3b20c694cbd8928efadfa51f5700c49634fb4738f557cc066183a44` |
| Cases × repeats | 27 × 5 | 24 × 5 (20 agent-written, 4 owner-authored) |
| Requests / valid responses / blocked | 135 / 135 / 0 | 120 / 120 / 0 |
| Requested → resolved model | `jev-1.13.0` → `jev-1.13.0` (every response) | `jev-1.13.0` → `jev-1.13.0` (every response) |
| Runner outcome | `REQUIRES_HUMAN_REVIEW` (exit 6; no bands) | `GOVERNANCE_CONFLICT_OR_POLICY_FAIL` (exit 2) |

Earlier commits of the experiment: `4991f918e728083f44c65ea8c66a5ef054532499` (preregistration freeze). The single
connectivity smoke request made before calibration is not formal evidence and is not preserved here.

## 3. Preserved files

Byte-for-byte copies. The reports come from the runner's output directory; every other file comes from the run commit
named in section 2 (`git show`), so that the evidence stays verifiable without the repository history.

| File | SHA-256 | What it is |
| --- | --- | --- |
| `evidence/2026-09-27T11-42-14-998Z-calibration.json` | `40a3a60459d3895f2ed53caf3c06eceffefa75224bac2a21840e11c7cfc0dad7` | calibration report |
| `evidence/2026-09-27T12-00-07-819Z-holdout.json` | `abf830c16e5ca996b11a8ae9de76752b96728f784e640cf40b3d33880e9441da` | holdout report |
| `evidence/calibration-manifest.json` | `0b9158dfe86ee8732d54bca7fa7ff790c76dc725948a18b4da3e287f88c761d7` | manifest at the calibration commit |
| `evidence/holdout-manifest.json` | `84130710d3b20c694cbd8928efadfa51f5700c49634fb4738f557cc066183a44` | manifest at the holdout commit |
| `evidence/profile-0.1.0-uncalibrated.json` | `abdde8c814a09f8ccf8bc2737c5c69436a7d86631b2c7b6a4e19fb22664d2e1b` | profile of the calibration run |
| `evidence/profile-0.2.0.json` | `f6d71354e681218afa0cf069ddda9f9077c201d023c25c6f02846701dc65eb26` | profile of the holdout run |
| `evidence/calibration-cases.json` | `07d12d4c8a5d71d67a2a85744d1544363b5380b5992e0359a4c36149d5f7d9c6` | calibration corpus |
| `evidence/holdout-cases.json` | `0a6671790e26a2693303272231babcce62508d2982a8ef4489626477791c78f2` | agent-written holdout corpus |
| `evidence/holdout-owner-cases.json` | `23e02a268dafc6b76c7b8e9251b5db65a4fd2f3bfa88ed3facee04d2d76f808a` | owner-authored holdout corpus |
| `evidence/policy.ts` | `5a480a4479cd66009e8957e71214a201cb15a6724d9664dd20ceb9f7886081e1` | the frozen finding derivation both runs used |
| `evidence/index.json` | | which file plays which role |
| `evaluation.json` | | the evaluation reproduced from the files above |

The corpora and `policy.ts` are identical at both run commits.

## 4. Reproduction

```
node tools/semantic-audit/evaluate.ts docs/semantic-audit/phase1-v1/evidence
```

Offline, no key, no git. The evaluator trusts nothing by name: each report must verify its own `report_sha256`; the
manifest copy must hash to the manifest SHA-256 the report recorded, and the profile copy to the recorded profile
SHA-256; corpora and `policy.ts` must hash to that manifest's entries. It re-derives every finding with the frozen
`policy.ts` copy and requires them to equal the findings the runner recorded, derives the bands from the calibration
report by `PROTOCOL.md` section 6 and requires them to equal the bands the holdout ran with, and then evaluates P1 to
P11. Any mismatch stops it. `tests/tools/semantic-audit-evidence.test.ts` checks that the output equals
`evaluation.json` and that a changed report, corpus, profile or policy copy is refused.

## 5. Calibration-derived bands (profile 0.2.0)

| Question | review | finding |
| --- | --- | --- |
| `actionability` | 0.15 | 0.20 |
| `authority_presented` | 0.05 | 0.10 |
| `failure_behavior` | 0.05 | 0.10 |
| `pair_relation` | 0.30 | 0.50 |

## 6. Formal result of the progression rule

Evaluated exactly as frozen in `PROTOCOL.md` section 9, over the holdout (P7 and P8 also over the calibration run),
with `O(c)` ordered `CONFLICT` > `RESOLVED_CONFLICT` > `INSUFFICIENT` > `REVIEW` > `NO_FINDING`.

| # | Criterion | Result | Cases |
| --- | --- | --- | --- |
| P1 | BLOCKED runs | SATISFIED | none blocked, no resume |
| P2 | Calibration fitness | SATISFIED | every question has valid bands |
| P3 | False negatives | SATISFIED | none |
| P4 | False CONFLICT | **CONFLICT** | `hold-20` (expected `INSUFFICIENT`) |
| P5 | Review false positives (at most 2) | **CONFLICT** | `hold-02`, `hold-11`, `OWNER-03` |
| P6 | Wrong finding type (at most 2) | SATISFIED | none |
| P7 | Injection canaries | **CONFLICT** | `cal-14` (top option not the labelled one), `hold-11` (outcome and top option) |
| P8 | Lexical controls | SATISFIED | |
| P9 | `RESOLVED_CONFLICT` surfacing | SATISFIED | `hold-14`, `OWNER-04` |
| P10 | Repeatability (k = 5) | SATISFIED | 1 of 38 evaluations flips (`hold-02`) |
| P11 | Owner-authored cases | SATISFIED | no false negative or false CONFLICT |

**Decision: CONFLICT.** No repository pilot under profile 0.2.0. Every per-case finding, raw probability and the
descriptive metrics are in `evaluation.json` and in the reports.

## 7. What this record does not support

It says nothing about the regulatory or legal correctness of any rule, and it certifies nothing. A `NO_FINDING` is not
evidence that a rule is correct or that the repository has no governance conflicts. The result concerns this profile,
this model version (`jev-1.13.0`) and these corpora only; interpretation of the failures belongs to a separate analysis,
not to this record.
