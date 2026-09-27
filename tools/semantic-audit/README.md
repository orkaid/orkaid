# Semantic governance audit (development tooling)

A local development tool that asks TypeSafe Jev bounded, typed questions about the project's own governance rules
(authorized within the limits of MDR-19).
It is **not** an Orkaid product feature, not a website capability, not a runtime, CI or public API dependency, and
not used by any tool. Nothing here runs in `npm test`, CI or the build, except the offline tests of the tool itself.

Jev answers are probabilistic typed judgments. A finding is evidence for human review, never authority: the tool
never edits a governance document. The formal success result is `NO_FINDING`: no semantic finding was produced within
the bounded questions evaluated. It does not mean correct, approved, complete, certified, or legally or regulatorily
valid, and it never overrides a deterministic check.

## Phase 1: governance documents

```
governance/sources.json    allowlist and authority map (policy input, owner-controlled)
governance/SOURCE_MAP.md   why each source is or is not audited
extract-governance.ts      deterministic extraction of rule-sized units and candidate pairs
profiles/governance-phase1.json   questions and the finding each answer maps to
policy.ts                  profile and response validation, derivation of findings, exit codes
run.ts                     preflight, credential loading, transport, report
manifest.ts                SHA-256 manifest of all of the above and both corpora
```

Corpora and the calibration protocol are in `tests/fixtures/semantic-audit/`. The profile is uncalibrated
(`bands: null`): until the protocol has been run and the owner has frozen bands, which are derived and stored per
question, no result can be `NO_FINDING` and a live holdout run is refused. No live request of any corpus is made
until the owner has authored at least four holdout cases in `holdout/owner-cases.json`, and a live repository run is
refused in Phase 1 altogether. `--plan` works for every corpus at any time: it is offline, needs no key and no bands,
and still runs every payload and preflight check.

The model `jev-1.13.0` is pinned on the owner's explicit approval for this local, experimental audit only; that does
not change the `AGENTS.md` §19 rule about pinning coding-agent model names (`governance/SOURCE_MAP.md`).

```
node tools/semantic-audit/extract-governance.ts                         # units and candidate pairs, offline
node tools/semantic-audit/run.ts --corpus calibration --plan            # exact request bodies, nothing sent
node tools/semantic-audit/run.ts --corpus holdout --plan                # likewise, before calibration
node tools/semantic-audit/run.ts --corpus calibration --case cal-01     # live: only after owner approval
```

| Exit | Meaning |
| --- | --- |
| 0 | NO_FINDING: no semantic finding within the bounded questions evaluated (not a statement of correctness) |
| 2 | GOVERNANCE_CONFLICT_OR_POLICY_FAIL: an unresolved contradiction |
| 3 | BLOCKED_PROVIDER_OR_MODEL: missing key, HTTP error, timeout, model mismatch |
| 4 | BLOCKED_PROFILE_OR_RESPONSE_INVALID: profile, corpus, manifest, request or response invalid |
| 5 | BLOCKED_EGRESS_OR_PREFLIGHT: preflight violation or uncommitted/untracked source |
| 6 | REQUIRES_HUMAN_REVIEW: review, insufficient, uncalibrated and precedence-resolved (`RESOLVED_CONFLICT`) findings, and every `--plan` run |

A contradiction that the `AGENTS.md` §1 order settles is never `NO_FINDING`: the higher authority decides what an agent
does, and the contradiction is still surfaced, as §1 requires. `CLAUDE.md` is audited but, as a document that
delegates to `AGENTS.md`, is not paired with it (`governance/SOURCE_MAP.md`).

Cross-document pairs are selected by shared topic tags. That is a bounded heuristic, not an exhaustive examination:
rules that share no tag are never compared, so `NO_FINDING` is not evidence that the repository has no governance
conflicts. Every report and plan states these limits in its `interpretation` field.

## Credential

The key is read from `TYPESAFE_API_KEY` in the environment; only when that is unset or empty is the git-ignored
`.env.semantic-audit` in the repository root read, with Node's built-in `util.parseEnv` and without changing
`process.env`. `.env.semantic-audit.example` is the tracked template. There is no key argument, no fallback key, and
no CI secret. The key is only placed in the `Authorization` header; output and reports are redacted against it.

## Egress

Only `https://api.typesafe.ai/v1/systemone` is contacted, with redirects refused. Before the first request, every
request body must pass the preflight: each string in it must come from an allowlisted, committed source, a corpus
case, or the profile's own question text; no string may look like a secret or a local absolute path; the key must not
appear in the body. There is no option to skip the preflight. Live runs also require the audited files, the profile,
the source map and the manifest to be tracked and unchanged against `HEAD`.

## Authority separation

`Authority(TargetCode) ∩ Authority(AuditPolicy) = ∅` is a governance rule here, **not a mechanically enforced
one**: the repository has no branch protection, rulesets or CODEOWNERS, and agents commit under the owner's identity.
What exists is detection: the manifest makes every policy change a visible diff, the runner refuses a manifest that
does not match, and every report records the hashes it ran with. Profile or corpus changes and the changes they judge
belong in separate change sets.

## Open questions

- Whether decision-record text from the Memolok ledger may be sent to the provider, and how a reproducible snapshot
  of it would be taken: a later governance decision. Until then no ledger text is sent and the ledger is not part of
  the audited corpus.
- The provider's data retention terms (its Data Processing Agreement) have not been reviewed.
- The first repository batch: not chosen. After the holdout run a risk-prioritized first batch is proposed for the
  owner's approval (`PROTOCOL.md` section 4, step 8); not every candidate pair is sent.
