# Governance source map (Phase 1)

This map says which documents the Phase-1 semantic governance audit may read and send, what authority each one has,
and why the others are left out. It is policy input for the audit and is changed only by the project owner.
`sources.json` next to it is the machine-readable part: the egress allowlist, the authority labels, the source roles,
the precedence rule and the tags that select candidate pairs.

The authority ranks are the order in `AGENTS.md` section 1. This map applies that order; it does not add to it.

## Audited in Phase 1

| Document | Authority | Kind | Relevant sections | Depends on | Precedence already defined |
| --- | --- | --- | --- | --- | --- |
| `AGENTS.md` | rank 4: the root repository instruction file | normative | all; decision states §1, legal vs product §7–§8, failure behavior §7 and §12, evidence §15 and §21, external services §6, §9, §16, §20, agent behavior §2, §17, §19, §20, authority and review §1, §17, §19 | the decision ledger through §1 item 5 and §19 | §1 order; §1 "never silently reconcile a conflict"; §22 nested rules may refine but not contradict |
| `CLAUDE.md` | rank 3: a tool-native repository instruction (§1 item 3); role **delegating** to `AGENTS.md` | normative | whole file (three rules) | `AGENTS.md`, which it names the single maintained source | its own rule: a direct current instruction from the owner wins over `AGENTS.md`, and the conflict is surfaced |

## Source roles: independent and delegating

Authority rank and role are separate properties. The rank says which source wins a conflict (§1). The role says
whether a source can take part in a conflict at all:

- **independent**: the source states policy of its own. Its units are audited one by one and paired with units of
  other sources for the cross-document question.
- **delegating**: a tool-native routing document that points to another source as the maintained project policy, and
  restates or applies that policy for one tool rather than adding standing rules of its own. Its units are still
  audited one by one (a delegating text can be vague too), but they are **never paired with the source they delegate
  to**: restated or delegated policy is not a second, independent policy authority, and treating it as one would
  report the source agreeing or disagreeing with itself.

`CLAUDE.md` is classified **delegating to `AGENTS.md`** (owner decision, 2026-09-27). Its rank stays 3, as §1 item 3
gives it; the classification changes what is paired, not what wins. The classification holds only for the exact
bytes it was made for (`classified_sha256` in `sources.json`, currently the version of commit `f40046d`). Any change
to `CLAUDE.md` blocks extraction (exit 4) until the owner looks at the new text and either confirms the
classification with the new hash or reclassifies the file as independent. A `CLAUDE.md` that one day introduces
standing rules of its own is an independent source and must be classified as one.

## Not audited in Phase 1

| Source | Authority | Kind | Why it is left out |
| --- | --- | --- | --- |
| Current explicit instruction from the owner | rank 1 | normative | not a document |
| System and platform safety rules | rank 2 | normative | not part of the repository |
| `.claude/rules/memolok.md` | rank 3: a tool-native instruction | normative, plugin-owned | excluded locally through `.git/info/exclude`: it is never committed or published, so it may not leave the machine |
| Memolok decision ledger (named by `.memolok/mdl.yml`) | rank 5: accepted records are durable project decisions (§19); staged records are proposals only | normative for accepted records | lives outside the repository. Sending its text to the audit provider, and a reproducible snapshot of it, are open questions (see the tool README). The repository cites MDR-12 to MDR-16, which were anchored first (`docs/memolok-citations-audit.md`), and MDR-19, anchored before it was cited here; other records are not named here |
| `.memolok/mdl.yml` | none | pointer | orientation only; the ledger itself is authoritative |
| `tests/fixtures/xrechnung/cii-experiment/PROTOCOL.md` | rank 5 for its own experiment (MDR-16) | frozen preregistration, now historical | experiment-scoped; changing it is a protocol deviation by its own rules |
| `docs/cii-experiment/REPORT.md` | rank 7 | descriptive, historical | an execution report, not policy |
| `docs/memolok-citations-audit.md` | rank 7 | descriptive | states that it is not a project decision |
| `src/lib/domain/xrechnung/README.md` | rank 6 | descriptive | restates MDR-12 to MDR-15; it is subject to MDR-15's rule on keeping kinds of requirement apart, which makes it a later audit target, not a source of authority |
| `tools/kosit/README.md` | rank 6 | descriptive | describes the KoSIT harness and restates MDR-15's evidence rules |
| `README.md` | none | product copy | not policy |
| `BRAND_ASSETS.md`, `LICENSE` | legal terms | normative for licensing | outside the governance questions of Phase 1 |
| `.github/workflows/*.yml` | rank 6 | implemented configuration | enforce the verification gates; configuration, not policy text |
| Code comments (`EXTERNAL`, `CONDITIONAL`, `PROFILE`, `PROVISIONAL_*`) | rank 6 | implementation annotations | Phase 2 code-audit target |

## Owner decisions of 2026-09-27

The owner reviewed the tensions below and decided the following for Phase 1. These are the owner's instructions
(rank 1 in §1); they are recorded here and are not agent choices.

1. **`CLAUDE.md`** keeps rank 3 and is classified as delegating to `AGENTS.md` (section above).
2. **Model pin.** `jev-1.13.0` is explicitly approved by the owner for this local, experimental semantic-governance
   audit. The approval is experiment-specific owner authority. It does not change, reinterpret or create an exception
   to the standing `AGENTS.md` §19 rule about pinning coding-agent model names in repository policy, and it approves
   no other model or use. A different Jev version needs a new owner approval and a new profile version.
3. **TypeSafe Jev as external tooling** is authorized for local, development-time semantic auditing of committed,
   allowlisted governance text only: no product, runtime or CI use, no ledger text, no user, private or uncommitted
   data, and a `NO_FINDING` never overrides a deterministic failure (MDR-19).
4. **Precedence-resolved conflicts** are surfaced, never `NO_FINDING`. The pair question separates `no_conflict`,
   `no_semantic_relation`, `conflict_resolved_by_precedence`, `unresolved_contradiction` and `insufficient_context`.
   A contradiction that the §1 order settles is the finding `RESOLVED_CONFLICT` (exit 6): the higher authority decides
   what an agent does, and the contradicting lower-authority rule is still reported, because §1 says to surface a
   conflict rather than silently reconcile it. An unresolved contradiction is `CONFLICT` (exit 2).
5. **The Memolok ledger stays out of Phase 1.** No ledger text is sent to the provider. A reproducible export or
   snapshot of decision records, and the provider authorization for that text, are a later governance decision.
6. **Repository pair budget.** No budget is chosen for the repository candidate pairs. Tag-based pairing is a bounded
   heuristic, not an exhaustive examination of cross-document conflicts, so a `NO_FINDING` result is not evidence that
   the repository has none. A live repository run is refused
   by the runner in Phase 1; after the holdout run the implementing agent proposes a risk-prioritized first batch
   for the owner's approval instead of sending every candidate pair.

## Tensions observed while building this map

These are observations for the owner's review. The audit does not resolve them, and they are not findings of a
Jev run. Each is kept as it was written; the owner decisions above say how each was settled.

1. `CLAUDE.md` is rank 3 if read literally as a "tool-native equivalent" (§1 item 3), yet it names `AGENTS.md` the
   single maintained source and adds no standing rules of its own. The map uses rank 3 because that is what §1 says.
2. `AGENTS.md` §19 says not to pin model names in repository policy, while this audit pins `jev-1.13.0` on the owner's
   explicit instruction (rank 1). §19 plausibly concerns the coding agents' own models, but the text does not say so.
3. `AGENTS.md` §6, §9 and §20 require a concrete approved requirement before an AI provider or a new external service
   is added. The owner's instruction of 2026-09-27 approves TypeSafe Jev for local development tooling only; it is not
   yet recorded as a decision record.
4. The Phase-1 profile treats a pair that the §1 order settles as no finding. §1 also says "follow the higher authority
   and surface the conflict", which could mean such a pair should be surfaced for review instead.
