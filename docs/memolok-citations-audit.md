---
mdlTitle: "Orkaid — Engineering & Product Decisions"
mdlGuid: mdl_vdsmjzk105a8jv8e
---

# Memolok citations audit and pilot

- **Audit date:** 2026-09-26
- **Repository state audited:** local `main` after Increment 1 (`3ead5b6`), Increment 2 (`82e3c12`) and the tracked `.memolok/mdl.yml` were integrated.
- **Status:** audit and provenance record. **It is not a project decision** and does not change, settle or reinterpret any decision record.
- **Scope:** the XRechnung decision set, MDR-12, MDR-13, MDR-14 and MDR-15, and only these. These four were anchored as cited from the project before any citation to them was written. Broader provenance backfill is deferred until each further record is deliberately selected and anchored.

## Purpose

Decision provenance means linking a claim in a durable Orkaid artifact to the admitted Memolok entry that actually supports it: a Decision Record, a World Fact or an Observed Outcome. It answers *why Orkaid makes or implements this project, product or engineering choice*.

It is **not regulatory or standards evidence**. A claim about German law, XRechnung, EN 16931, KoSIT or any other standard still needs its authoritative source. A Memolok record can only document how Orkaid decided to act on such a source.

## Method

1. Read the current public artifacts of the XRechnung domain: `src/lib/domain/xrechnung/` and `tools/kosit/`.
2. For each claim, identify the admitted entry that supports that exact claim. Relatedness of topic is not enough.
3. Classify each claim as decision provenance, implementation evidence (an Observed Outcome) or an external normative claim.
4. Keep multiple Observed Outcomes individual rather than collapsing them into one status.

Commit history is out of scope. The bare decision numbers in this document are bound to the ledger named in the frontmatter.

## Mappings (XRechnung scope)

| Artifact / location | Claim | Kind | Source | Assessment |
| --- | --- | --- | --- | --- |
| `invoice.ts` header | V1 scope (domestic German B2B, EUR, BT-3 = 380, VAT category S at 19%/7%, non-negative); syntax-independent; out of scope fails explicitly, never falls back | decision | MDR-12 | Maps exactly. **Cited in the pilot** |
| `invoice.ts` calculation contract | BT-131 rounded per line, BT-117 once per bucket, BT-110 sum; HALF_UP is project policy, not a mandate | mixed | MDR-13; external: BR-CO-17 (XRechnung 3.0.2 §12.3) | Maps exactly. **Cited in the pilot** |
| `number-notation.ts` header | Localized input, canonical decimal and XML decimal are separate; the notation is chosen and never guessed; no `Number`/`parseFloat` | decision | MDR-14 (amends MDR-13) | Maps exactly. **Cited in the pilot** |
| `ubl.ts` header | Only UBL-aware file; no arithmetic; amounts come from the calculation and are only formatted | mixed | MDR-15; external: SeMoX CIUS model, UBL 2.1 XSD | Maps. **Cited in the pilot** |
| `invoice.ts` rate normalization | Equivalent spellings of a supported VAT rate normalize to one rate; the category is never inferred from the rate | decision | MDR-14 | Maps exactly. Candidate |
| `decimal.ts` and `invoice.ts` guards | Input-length and error-count guards are provisional, not product limits | decision | MDR-14 | Maps exactly. Candidate |
| `document.ts` `PROVISIONAL_MAX_TEXT_LENGTH` | A defensive bound, not a product rule | decision | uncertain | MDR-15 requires proportionate runtime protection but does not name this guard. MDR-14 covers numeric input only. **Mapping uncertain** |
| xrechnung `README.md`, "Implemented profile" | The profile, and the separation of external, conditional and profile rules | mixed | MDR-15; external: the BR-* rules and § 14 UStG already cited there | Maps. Candidate (Markdown without frontmatter needs a full link, see below) |
| xrechnung `README.md`, "Runtime protection" | Only `buildInvoice` creates an `Invoice`; a branded type is not a security boundary | decision | MDR-15; implementation evidence: `oo_rderws`, and its wording correction `oo_cdtkbw` | Maps. Candidate |
| xrechnung `README.md`, "Not part of the current implementation" | Exclusions; nothing abandoned | decision | MDR-15, MDR-12 | Maps. Candidate |
| xrechnung `README.md`, CII sentence | A CII serializer would consume the same `Invoice` without changing the monetary engine | mixed | none | The claim was stronger than the evidence: MDR-15 leaves CII sufficiency to later CII work, and `oo_wmpmry` confirms only that UBL is confined to the serializer. **Corrected**: the sentence now states the design intent and that CII sufficiency is untested |
| xrechnung `README.md`, "Sources and limits" | The validator tolerates amount differences (BR-CO-17, one currency unit); one validator/configuration combination only | external | KoSIT validator configuration 2026-08-31 (EN 16931 UBL stylesheet) | External source only |
| `tools/kosit/README.md` | Development only; exit code 0 alone is never acceptance; validator jars are not committed | decision | MDR-15 | Maps. Candidate |
| `tools/kosit/kosit-manifest.json` | Pinned artefact hashes | implementation evidence | `wf_fa1kxd` records the same bundle and configuration hashes | No citation needed: the manifest carries its own evidence, and JSON has no place for a citation |

Observed Outcomes stay individual. For example, MDR-13's expectation of no binary floating-point money has an **Inconclusive** outcome (`oo_tv434w`). The later automated check (`oo_z8he84`, Satisfied) falls under an expectation of MDR-15 which says it does not by itself change the status of any earlier outcome.

**Outside the XRechnung scope**, the platform configuration, the production deployment workflow and parts of `AGENTS.md` also contain claims that map to admitted records. They are deliberately not named or cited here. Each one becomes a candidate only when its record is selected and anchored.

## Citation mechanics (Memolok plugin 0.29.0-beta, server 0.20.4 build e108fcd)

1. **Identifiers.** An admitted record has a stable number (`MDR-n`). World Facts, Observed Outcomes, Matters and Analyses have server-minted ids (`wf_…`, `oo_…`, `mt_…`, `an_…`). A staged record has no number and is never cited outside a working session.
2. **Forms.**
   - In code and in a commit-message body, a bare `MDR-n` in a trailing parenthetical, bound by the repository's tracked `.memolok/mdl.yml`.
   - In Markdown, a bare `MDR-n` needs `mdlGuid` in the frontmatter (as in this document); otherwise each reference must be a full link.
   - Elsewhere, the full address.
   - The identifier never goes in a commit subject.
3. **Address.** `https://www.memolok.ai/mdl/<mdlGuid>/mdr/<n>` (and `/fact/`, `/outcome/` and so on). Documented as the correct, forward-compatible form, with identity in the path. **It does not resolve yet.**
4. **Anchoring.** `anchor_MDR(kind: project)` declares that a project artifact cites a record. After that, the record can never be uncommitted, so its number cannot be reassigned to another decision. The declaration:
   - is permanent;
   - is not verified by the server;
   - records only the kind of place, never the location;
   - creates no link from the record to a file.

   It is required before any citation is written into code, repository documents or commit messages.
5. **Resolution today.**
   - A maintainer with ledger access resolves `MDR-n` exactly through the Memolok tools: `.memolok/mdl.yml` gives the ledger, and the number identifies the record.
   - A public reader sees a stable identifier but cannot open the entry. There is no anonymous read path, and accounts are provisioned by a Memolok administrator.
6. **Exposure.** An anchor stores only its kind inside the ledger. Nothing about the artifact or its location.

## Pilot

The first four citations cite MDR-12 to MDR-15, one each, in the headers of `invoice.ts` (two), `number-notation.ts` and `ubl.ts`. The commit that adds them names the four records in its body.

**Known public limitation:** the citations are stable and resolvable through Memolok tooling for authorized users, but not resolvable by anonymous web readers.

## Open points

- Anonymous public resolution of Memolok addresses is not available.
- The mapping for `PROVISIONAL_MAX_TEXT_LENGTH` is uncertain.
- The remaining XRechnung candidates above are not yet cited.
