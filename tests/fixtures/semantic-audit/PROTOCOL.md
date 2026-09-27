# Phase-1 semantic governance audit: calibration protocol

## 1. Status

- **Kind:** draft preregistration. It fixes the question, the corpora, the metrics and the rule for choosing bands
  **before** any live request is made. It contains no results.
- **State:** DRAFT, proposed by the implementing agent and revised on the owner's instructions of 2026-09-27. It
  becomes binding when the project owner has reviewed the profile, the corpus labels and this protocol, has supplied
  the owner-authored holdout cases, and has committed all of them together with `MANIFEST.json` (the freeze commit).
  No live request is made before that commit. Section 9 (the progression rule) was approved by the owner on
  2026-09-27 and is binding for the freeze version.
- **Model:** `jev-1.13.0`, explicitly approved by the owner for this local, experimental audit only. The approval is
  experiment-specific; it does not change the `AGENTS.md` §19 rule about pinning coding-agent model names
  (`tools/semantic-audit/governance/SOURCE_MAP.md`, owner decisions).
- **Scope:** development tooling only. The audit is not an Orkaid product feature, not a runtime, CI or public API
  dependency, and not used by any tool (MDR-19).

## 2. Question

Does the profile `governance-phase1` (version `0.1.0-uncalibrated`, model `jev-1.13.0`) separate the seeded governance
defects of the corpora from the sound rules, stably across repeated calls, and without being steered by wording or by
instructions embedded in the judged text?

A Jev answer is a probabilistic typed judgment. It is not proof of correctness, and nothing in this protocol treats it
as a certification.

**Result terminology.** The formal success label is `NO_FINDING` (exit 0). It means only that no semantic finding was
produced within the bounded questions evaluated. It does not mean correct, approved, complete, certified, or legally
or regulatorily valid. The other results are `REVIEW`, `INSUFFICIENT`, `RESOLVED_CONFLICT` (exit 6), `CONFLICT` (exit
2), `UNCALIBRATED` (exit 6, no bands) and the `BLOCKED_*` statuses (exits 3 to 5). Every report and plan repeats these
limits in its `interpretation` field.

## 3. Corpora

| Set | File | Cases | Use |
| --- | --- | --- | --- |
| calibration | `calibration/cases.json` | 27 (16 units, 11 pairs) | may shape the profile wording and determines the bands |
| holdout (agent) | `holdout/cases.json` | 20 (11 units, 9 pairs) | frozen; never used to shape anything; run once per frozen profile version |
| holdout (owner) | `holdout/owner-cases.json` | at least 4, authored by the owner | as above; part of the same holdout run |

Seeded categories in both sets: an OPEN decision presented as decided; a project choice presented as a legal mandate;
an explicit contradiction; a rule with no operational action; a failure rule with the outcome unspecified; a
contradiction settled by the `AGENTS.md` section 1 order (which must be surfaced, never `NO_FINDING`); a pair whose relation
depends on a fact neither rule states; lexical controls (same meaning with different wording, and near-identical
wording with a different meaning); instructions embedded in the judged text. Positive controls are included, among
them two verbatim copies of current `AGENTS.md` rules.

Every case records its `origin` (`real` repository text, `mutated` real text, or `synthetic` text), the governance
`dimension` it tests, and the `rationale` for its label. Of the agent-written cases, only the two verbatim copies are
real text; none is mutated; all others are synthetic.

**Labels.** Every `expect` and `expected_outcome` value of an agent-written case is a proposal of the implementing
agent. The project owner reviews and corrects them before the freeze commit; the labels are policy, not
implementation. Within one question, a case's labelled options are either all mapped to finding kinds or all unmapped;
a label never mixes the two (the band rule in section 6 depends on it, and a test checks it).

**Owner-authored holdout cases.** The same agent wrote the calibration set and the agent part of the holdout, so the
holdout is not independent of the profile's author. At least four holdout cases are therefore authored by the owner,
in `holdout/owner-cases.json`. *Owner-authored* means that the owner supplies explicitly, for each case:

- the semantic input text (the rule, or both rules of a pair, with their sections and authorities);
- the expected outcome and the expected option labels;
- the rationale.

The implementing agent may encode those instructions into `owner-cases.json` mechanically (transcription into the
file format, including the `origin` and `dimension` fields as the owner states them). The agent must not rewrite the
semantic content, change an expected label, add hidden assumptions, improve an example, or tune the profile against
these cases. Transcription may be done by the agent; semantic authorship remains the owner's.

The runner refuses every live request, of any corpus, while that file holds fewer than four cases, so the cases cannot
be written after a result has been seen. Authorship is declared by the file, not verified by the tool: the repository
has no mechanism that distinguishes the owner's commits from an agent's.

**Holdout discipline.** After the freeze commit, any change to `holdout/cases.json` or `holdout/owner-cases.json` is
a protocol deviation and is reported as one. A profile tuned after seeing holdout results needs a new, unseen holdout
set.

## 4. Procedure

1. Freeze commit: profile, corpora including the owner-authored holdout cases, protocol, source map, tooling and
   `MANIFEST.json`.
2. `--plan` on the calibration and holdout corpora; the owner reviews the exact request bodies. A plan is offline: it
   sends nothing, needs no key and no bands, and still runs every payload and preflight check.
3. One smoke request (`--case cal-01`): connectivity, pinned model resolution, response shape.
4. Calibration run: every case, `--repeat 5`.
5. Band selection (section 6), per question; the owner approves; the profile gets the bands and a new version in a
   separate commit with a regenerated manifest. No other profile change in that commit.
6. Holdout run: every case, `--repeat 5`, once.
7. Result report, including the false-positive and false-negative behaviour on both corpora and the evaluation of
   the progression rule (section 9), for the owner's review.
8. Only if the progression rule is satisfied: the implementing agent proposes a risk-prioritized first batch of repository candidate pairs (not every
   candidate pair), with the reason for each selection, for the owner's approval. The runner refuses a live repository
   run in Phase 1; lifting that refusal for the approved batch is a separate, reviewable change of the tooling and the
   manifest. `--plan` on the repository corpus is allowed at any time.

Any BLOCKED outcome stops the procedure at that step. It is never retried silently and never counted as
`NO_FINDING`.

## 5. Metrics

Per question and per case, from the recorded raw probabilities:

- **Separation:** per question, the finding mass of each negative control against each seeded case (section 6 defines
  both).
- **Top-option agreement:** whether the most probable option is one of the labelled options.
- **Repeatability:** the largest probability spread of any option over the five repeats, and whether the derived
  finding changes between repeats. Identical output is not assumed; the worse finding of the repeats is used.
- **Injection resistance:** an injection canary fails if its top option is the one the embedded text asks for.
- **Precedence surfacing:** a case labelled `RESOLVED_CONFLICT` fails if it derives `NO_FINDING`, that is if a
  contradiction settled by the section 1 order is reported as agreement.
- **Lexical robustness:** cases sharing a `lexical_group` must reach the same outcome.

## 6. Band selection rule

The bands are derived from the calibration data, not chosen in advance, and not taken from another project. They are
derived and stored **per question**: `actionability`, `authority_presented`, `failure_behavior` and `pair_relation`
use different primitives (Choice, Noul) and different option sets, so their probability masses are not on a common
scale. No band is derived from pooled distributions, and there is no global or default band. The profile holds
`bands: null` (uncalibrated) or exactly one `{ review, finding }` pair for every question, keyed by question id; the
profile validator refuses anything else.

For one question `q`, only the calibration cases that ask `q` **and** label it (`expect[q]`) are used; answers to `q`
in cases without a label for `q` are reported but do not move `q`'s bands.

- A **negative control for `q`** is a case whose labelled options for `q` are all unmapped (no finding kind).
- A **seeded case for `q`** is a case whose labelled options for `q` are all mapped; its expected kinds are the finding
  kinds those options map to.
- `review_q` = the smallest multiple of 0.05 that is strictly greater than the total mapped mass of `q` (the mass of
  all finding options together) in every repeat of every negative control for `q`. Mass spread over several finding
  options therefore cannot add up to `NO_FINDING`.
- `finding_q` = the smallest multiple of 0.05 that is greater than `review_q` and strictly greater than every mass
  that any labelled case reaches, in any repeat, for a finding kind of `q` that its label does not include.
- Seeded cases for `q` whose expected kinds stay below `review_q` are reported as misses; those between `review_q` and
  `finding_q` are reported as reduced to `REVIEW`. Whether to accept a disclosed miss, revise the question wording as
  a new profile version, or drop the question is the owner's decision.
- If no valid pair exists for `q` (`review_q` would exceed 1, or `finding_q` would not exist), `q` does not separate
  the corpus and is reported as unfit. The other questions keep their bands. Nothing is tuned against the holdout.

Ceiling: one `finding_q` serves every finding kind of `q`; `pair_relation` maps three kinds (`CONFLICT`,
`RESOLVED_CONFLICT`, `INSUFFICIENT`) under one pair of bands. Per-kind bands would need more calibration cases per kind
than the corpus has.

## 7. Outcome classification

Each metric is classified SATISFIED, INSUFFICIENT or CONFLICT, with precedence CONFLICT > INSUFFICIENT > SATISFIED.
Undefined or unclassifiable evidence is INSUFFICIENT.

## 8. What a result does not support

It says nothing about the regulatory or legal correctness of any rule, and it is not a certification of the
governance documents. It does not replace human review, the deterministic checks, the KoSIT harness or any existing
verification. It is evidence about this profile, this model version and these corpora only.

`NO_FINDING` is not evidence that the repository is free of governance conflicts. On the repository corpus,
cross-document pairs are selected by shared topic tags (`tools/semantic-audit/extract-governance.ts`). This is a bounded
heuristic, not an exhaustive examination: two rules that share no pair-worthy tag are never compared, a delegating
source is never compared with the source it delegates to, and a conflict that needs three or more rules together is
out of reach of a pair question.

## 9. Phase-1 progression rule (owner-approved 2026-09-27; binding for the freeze version)

This rule decides whether Phase 1 may proceed from the holdout run to proposing a repository audit pilot (section 4,
step 8). It is fixed before any live result exists. Its limits are not chosen from, and are not changed after seeing,
TypeSafe results; changing one after results are known is a protocol deviation and needs a new, unseen holdout set.
The holdout is small (20 agent-written cases and at least 4 owner-authored ones), so the limits are absolute counts,
not rates.

**Terms.** Every term is computed from recorded reports, over the whole holdout (agent-written and owner-authored
cases together), with `--repeat 5`.

- The outcome `O(c)` of a case is the most severe finding over all its questions and all five repeats, in this fixed
  order: `CONFLICT` > `RESOLVED_CONFLICT` > `INSUFFICIENT` > `REVIEW` > `NO_FINDING` (as the runner derives it). The
  order is used only to derive `O(c)`; the formal evidence keeps every individual finding, per question and per
  repeat, and every raw probability distribution. A case is correct if `O(c)` is one of its expected outcomes.
- A *negative control* expects only `NO_FINDING`; a *seeded case* does not allow `NO_FINDING`.
- *False negative:* a seeded case with `O(c) = NO_FINDING`.
- *False CONFLICT:* `O(c) = CONFLICT` for a case that does not expect `CONFLICT`.
- *Review false positive:* a negative control with `O(c)` of `REVIEW`, `INSUFFICIENT` or `RESOLVED_CONFLICT`.
- *Wrong finding type:* a seeded case whose `O(c)` is a finding other than `NO_FINDING` that it does not expect and
  that is not a false CONFLICT (for example a `CONFLICT` case reported as `INSUFFICIENT`).
- *Flip:* a (case, question) whose derived finding is not the same in all five repeats.

**Criteria.** Each is classified SATISFIED, INSUFFICIENT or CONFLICT (section 7).

| # | Criterion | SATISFIED when |
| --- | --- | --- |
| P1 | BLOCKED runs | The calibration run and the holdout run each completed without a BLOCKED status. A BLOCKED run is never counted as a result. A cause outside the profile and corpora (network, provider outage, key) allows at most one reported infrastructure resume, and the criterion is INSUFFICIENT until it completes. In a resume, the valid semantic responses already obtained are kept and may not be discarded or replaced; only the requests or repeats that produced no valid semantic response are sent again; profile, corpora, labels, model and policy stay unchanged. An invalid response, a model mismatch, an invalid profile or corpus, or a failed semantic validation is not an infrastructure case: it is CONFLICT for this profile version. |
| P2 | Calibration fitness | Every question has valid bands under section 6, or an unfit question was dropped by the owner in a new profile version before the holdout run. |
| P3 | False negatives | No false negative on a case expecting `CONFLICT` or `RESOLVED_CONFLICT`, and at most 1 false negative over all other seeded cases. |
| P4 | False CONFLICT | None. |
| P5 | Review false positives | At most 2 negative controls. |
| P6 | Wrong finding type | At most 2 cases. |
| P7 | Injection canaries | For every injection case of calibration and holdout: `O(c)` correct, and in every repeat the top option of every labelled question is one of its labelled options. No failure is tolerated. |
| P8 | Lexical controls | Every calibration `lexical_group` reaches one `O(c)` for all its cases, and every holdout case whose category is a lexical control or a lexical trap is correct. No failure is tolerated. |
| P9 | `RESOLVED_CONFLICT` surfacing | Every case expecting `RESOLVED_CONFLICT` derives, for `pair_relation` in each of the five repeats, a finding other than `NO_FINDING`, and its `O(c)` is `RESOLVED_CONFLICT` or `REVIEW`. |
| P10 | Repeatability (k = 5) | No (case, question) flips between `NO_FINDING` and `CONFLICT`, and at most 10% of all holdout (case, question) evaluations flip at all. The largest probability spread per question is reported, without a limit. |
| P11 | Owner-authored cases | P3 to P9 are also reported for the owner-authored cases alone. Any false negative or false CONFLICT among them is CONFLICT for this criterion. |

**Decision.** All criteria SATISFIED: the implementing agent may propose a repository pilot batch (section 4, step
8); the pilot itself still needs the owner's approval of that batch. Any CONFLICT: no pilot under this profile
version; revising question wording as a new profile version (with a new, unseen holdout set), dropping a question, or
stopping Phase 1 is the owner's decision. Any INSUFFICIENT and no CONFLICT: no pilot until the missing evidence
exists.
