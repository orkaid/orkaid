# AGENTS.md — Orkaid Engineering Contract

Standing instructions for AI coding agents working in the Orkaid repository. Treat these as constraints, not suggestions.

Orkaid is a free/open-source hub of professional tools at the intersection of finance, accounting, compliance, and software. The project is practitioner-led. Correctness, professional usefulness, transparency, auditability, verification, maintainability, privacy, and controlled scope outrank novelty or speed. XRechnung is the first flagship, not the permanent scope boundary. AI/coding agents are engineering leverage, never product authority.

## 1. Authority and decision states

When instructions conflict, apply this order:

1. Current explicit instruction from Mihai.
2. System/platform safety and permission rules.
3. Nearest applicable repo instruction (`AGENTS.override.md`, nested `AGENTS.md`, tool-native equivalent).
4. This root `AGENTS.md`.
5. Current task-relevant specs/decision records.
6. Existing implementation patterns.
7. Historical docs/comments/branches/model memory.

Never silently reconcile a conflict. Follow the higher authority and surface the conflict.

Preserve project states exactly:

- **IMPLEMENTED** — exists and has been verified.
- **DECIDED** — approved direction.
- **OPEN** — human decision required; do not guess.
- **PROPOSED / RECOMMENDED** — analysis only.
- **DEFERRED UNTIL TRIGGER** — do not build speculatively.
- **FUTURE IDEA** — not active scope.
- **STALE** — superseded by newer authority.

Do not turn an implementation convenience into a project decision.

## 2. Reconnaissance before mutation

Before changing code/config:

- verify repo identity, cwd, branch/worktree, HEAD/upstream where relevant;
- read applicable instruction files and the smallest current spec set;
- inspect the exact files you will touch;
- run `git status --short`;
- identify any OPEN decision;
- define success criteria and verification commands.

Never speculate about code you have not opened.

Before using another local repo as evidence, verify remote identity, branch, HEAD, upstream tracking, and divergence.

## 3. Public/private boundary

The public repository contains only intentionally publishable material.

Never commit or expose credentials, tokens, cookies, private URLs, `.env*`, `.dev.vars*`, SSH/cloud credentials, private strategy/orchestration, employment context, private legal/tax notes, unpublished commercial terms, unnecessary private infrastructure details, agent scratchpads, hidden ledgers, or private prompts.

When working from local/private material, extract only the public-safe implementation facts required by the task. Before a public commit, inspect the diff for publication safety.

## 4. Greenfield rule

Orkaid is greenfield. Reference implementations may teach patterns, domain behavior, tests, failure modes, and operational lessons.

Do **not** wholesale-copy another project's:

- package manifest/lockfile;
- framework config;
- CI/release tooling;
- repository scaffold;
- dependency baseline;
- historical workarounds/governance scripts;
- large UI components;
- product-specific infrastructure.

Reuse concepts intentionally. Every dependency, abstraction, config, and service must earn its place.

## 5. Approved platform baseline

Current bootstrap baseline:

- Astro `7.3.2`
- Svelte `5.57.0`
- `@astrojs/svelte` `9.0.1`
- `@astrojs/sitemap` `3.7.4`
- TypeScript `6.0.3`
- Node `24.20.0`
- npm `11.19.0`

Standing rules:

- single package; no monorepo;
- npm package manager;
- exact-pin core platform dependencies;
- commit `package-lock.json`; reproducible installs use `npm ci`;
- `.node-version` is the sole Node-version source;
- TypeScript strict;
- Astro `output: 'static'`;
- Svelte only for interactive islands;
- Cloudflare Pages target;
- no `@astrojs/cloudflare` or Wrangler project dependency until a concrete server trigger;
- CSS custom properties/design tokens + native Svelte scoped CSS;
- no Tailwind;
- browser/local-first by default.

Do not upgrade, replace, or broaden this baseline without explicit approval. Re-verify current versions when a deferred dependency is actually introduced.

## 6. Capability ladder / YAGNI

Use the lowest sufficient capability:

- **Level 0:** browser/static/local-first — default.
- **Level 1:** narrow server function — only for a real server-only need.
- **Level 2:** managed persistence/async infrastructure — only for concrete saved/shared state, files, durable jobs, queues, etc.
- Higher levels (external DB/service, VPS, containers, persistent processes) require an explicit technical trigger and approval.

Do not add "for later": D1/R2/KV, Durable Objects, Queues/Workflows, auth, DB, AI providers, PDF/XML libs, KoSIT/Java runtime, Docker, VPS tooling, monitoring stacks, or advanced release/provenance/SBOM machinery.

## 7. Architecture boundaries

Expected structure:

- `src/pages/` — Astro routes/page composition.
- `src/layouts/` — shared shells.
- `src/components/` — UI and islands.
- `src/components/tools/` — tool-facing interactive components.
- `src/lib/domain/` — deterministic framework-independent domain logic.
- `src/styles/` — tokens/global baseline.
- `src/i18n/` — minimal DE/EN dictionaries/helpers.
- `tests/` — meaningful verification.
- `public/` — approved static assets/self-hosted fonts.

Do not add architectural layers without a real boundary. Prefer clear direct code over one-use abstractions.

Domain logic should not depend on Astro, Svelte, DOM APIs, UI state, network access, `localStorage`, analytics, or presentation formatting. UI orchestrates input/state/accessibility/presentation; it does not own accounting/compliance rules.

For financial/regulatory logic: never invent rounding, tax, validation, or legal semantics. Keep validation distinct from rendering; serialization/export distinct from UI where practical; make edge cases explicit; fail visibly rather than silently degrading correctness.

## 8. Regulated-domain protocol

Treat XRechnung, EN 16931, UBL, CII, KoSIT, German e-invoicing law, GoBD, UStG, AO, HGB, and similar subjects as high-verification domains.

For current regulatory/standards/legal/version/conformance/deadline claims:

1. Verify authoritative primary sources current to the task date.
2. Record exact source/version/date when load-bearing.
3. Separate legal requirements from product choices.
4. Separate EN 16931 from XRechnung-specific rules.
5. Separate internal validation from external conformance validation.
6. Never treat legacy code/tests/docs/blog posts/model memory as authority.
7. Flag ambiguity instead of fabricating certainty.

Passing internal tests is not proof of current regulatory correctness. Public compliance claims require authoritative verification before publication.

## 9. AI boundary

AI output is never authoritative for deterministic finance/accounting/compliance results.

If AI is later approved:

- deterministic results remain authoritative;
- AI may explain/summarize/assist, not override validated results;
- secrets stay server-side;
- calls need a clear user-facing purpose;
- persistence/storage behavior must be deliberate and documented;
- never add AI merely for an "AI-powered" label.

No AI SDK/provider belongs in the baseline without a concrete approved requirement.

## 10. DE/EN contract

- German is unprefixed default.
- English lives under `/en/`.
- Public routes mirror across locales when content exists: `/tools/` ↔ `/en/tools/`.
- Do not mix DE/EN in one view as a substitute for proper routing.
- Preserve exact German accounting/legal terminology where translation loses meaning.
- `@astrojs/sitemap` handles sitemap + locale-aware alternates.
- Verify canonical/hreflang in built output, not only config.
- Do not recreate legacy trilingual/custom i18n machinery without need.

## 11. Brand/UI contract

Core colors:

- `#4FA7A3` primary teal
- `#FFF997` accent warm yellow
- `#FAFAF8` warm off-white background

Semantic implementation neutrals may use `#1D2321` foreground and `#6B7370` muted text; they are not additional core brand colors.

Typography:

- Source Serif 4 — headlines, 400/600
- IBM Plex Sans — body, 400/500
- IBM Plex Mono — labels/UI, 400/500

Rules:

- approved self-hosted fonts/assets only; no runtime Google Fonts;
- CSS tokens + scoped component CSS; no Tailwind;
- left-aligned, editorial, document-like composition;
- accent sparingly;
- avoid generic SaaS card grids, decorative AI cues, and generic "AI startup" aesthetics;
- never estimate/substitute brand colors from screenshots;
- do not redesign unrelated surfaces while implementing a functional task.

## 12. Accessibility

Accessibility is correctness, not polish.

For UI work: semantic HTML first; logical headings; full keyboard access; visible focus; correctly associated labels/descriptions/errors; no color-only meaning; adequate contrast; accessible status/error updates; ARIA only when native semantics are insufficient.

Professional tool validation errors must be specific, actionable, and discoverable.

## 13. Dependency discipline

Before adding a dependency, answer:

- What current requirement does it satisfy?
- Why is platform/standard-library capability insufficient?
- What runtime/security/privacy/maintenance burden does it add?
- Is it compatible with the approved baseline?
- Is the need current rather than hypothetical?

Prefer no dependency over a convenience dependency. Do not add packages because they are popular, familiar, or present in a reference project. Do not upgrade unrelated dependencies during feature work.

For authorized dependency changes: use official sources, verify compatibility, follow pinning policy, inspect lockfile impact, report material transitive changes.

## 14. Coding standards

**TypeScript**
- strict mode mandatory;
- explicit domain types;
- avoid `any`; isolate/justify it at unavoidable external boundaries;
- prefer discriminated unions for finite states;
- pure functions for deterministic calculations;
- side effects at boundaries;
- do not use assertions to hide modeling problems;
- validate untrusted input at system boundaries.

**Astro**
- static-first;
- page files focus on routing/composition/metadata;
- hydrate only genuine interactivity;
- no SSR/server rendering without approved trigger.

**Svelte**
- thin over domain logic;
- native scoped CSS;
- local state stays local;
- no speculative global/cross-tool state infrastructure;
- explicit interfaces over hidden coupling.

**CSS**
- consume semantic tokens;
- avoid arbitrary one-off colors when a token exists;
- keep global CSS foundational;
- component styling stays with the component;
- do not recreate a utility framework by hand.

## 15. Testing, TDD, debugging

Tests prove behavior; they are not checkbox artifacts.

Baseline verification includes: TypeScript/static checks, Astro diagnostics, Node native tests for deterministic logic, production build, dependency audit, route/i18n checks when relevant, sitemap/canonical/hreflang checks when relevant.

For domain work: test externally meaningful behavior; positive/negative fixtures where appropriate; boundary/rounding/error cases explicitly; authoritative vectors when available; never hard-code implementation to current tests.

Behavior-change workflow:

1. Understand expected behavior.
2. Add/identify a test that fails for the right reason.
3. Implement the smallest correct change.
4. Run focused verification.
5. Run relevant broader verification.
6. Refactor only after correctness.

Unexpected behavior: reproduce → gather evidence → isolate cause → test hypotheses → fix root cause → verify regression coverage. Do not shotgun-edit.

## 16. Security/privacy

Default posture:

- no secrets in browser code;
- no analytics by default;
- no unnecessary third-party runtime scripts;
- no user-data egress without explicit product need;
- browser-local processing where practical;
- no speculative persistence;
- no production credentials in tests/fixtures;
- validate external boundaries; render/escape safely;
- never weaken CSP/privacy/validation/security just to make a test pass.

## 17. Git, worktrees, external mutations

Before mutation: inspect branch/worktree/status.

For substantial work, prefer isolated worktree/feature branch. Do not work directly on `main` without explicit authorization. Keep authorized commits small and meaningful; do not rewrite unrelated history or mix drive-by cleanup.

Explicit current human authorization is required before:

- push;
- merge;
- PR creation;
- release/tag publication;
- deployment;
- Cloudflare/DNS mutation;
- GitHub settings/integration mutation;
- destructive data/infrastructure changes.

A local implementation request is not deployment permission. If only local work is authorized, stop with a reviewable local branch/worktree.

Any production/reference system used for Orkaid is read-only unless explicitly authorized. Never "fix the reference project while here."

## 18. Documentation/public claims

Repository docs are English by default unless the target surface is German/bilingual.

Write precise, professional, non-hype copy. Preserve decision states and history. Separate current fact from proposal/inference. Current regulatory claims must be source-backed. Update only affected docs; do not rewrite unrelated files "for consistency."

Historical decision logs preserve history even when old wording is superseded.

## 19. Skills, plugins, subagents

Tools are subordinate to project rules.

- **Superpowers:** when installed/relevant, default process framework for planning, isolation, TDD, debugging, verification, and review. Do not use it to re-litigate DECIDED architecture.
- **Ponytail:** capability-triggered only; use when it materially improves the task and does not duplicate the active workflow.
- **Ledger:** execution evidence/checkpoints only. Ledger rulings are not project decisions. Keep scratch/ledger/orchestration artifacts out of the public repo unless intentionally public.
- **Subagents:** use for genuinely parallel work, isolated context, or independent review; not for trivial grep/one-file/sequential work. High-risk/regulated changes should receive independent review by an agent that did not author the implementation.
- Do not pin model names in repository policy; select current task-appropriate models.

## 20. Scope control and stop conditions

Implement the task, not a hypothetical future platform.

Do not broaden product scope, solve FUTURE IDEAS, add speculative infrastructure, refactor unrelated code, change brand positioning, invent public claims, resolve OPEN decisions, or mutate external systems without authorization. Report adjacent work as observations only.

Stop and ask before a step that would:

- resolve a genuine OPEN product/architecture decision;
- change a canonical decision;
- materially alter public positioning;
- make a current regulatory claim without adequate primary evidence;
- add a new external/paid service or unapproved server/stateful infrastructure;
- expose private/internal information;
- perform irreversible/destructive work;
- push/merge/deploy/publish without authorization;
- mutate production/reference systems;
- choose between materially different product behaviors absent from the spec.

Do not ask questions already answered by the repository or current authoritative spec.

## 21. Definition of done

Never claim completion from code inspection alone.

Before "done":

1. Re-read task + acceptance criteria.
2. Review `git diff`.
3. Review `git status --short`.
4. Run relevant checks/tests/build.
5. Verify dependency/version rules when touched.
6. Verify no forbidden dependency/service appeared.
7. Scan for secrets/private material.
8. Verify no unintended route/copy/brand change.
9. Verify no unauthorized external mutation.
10. State unverified items/limitations explicitly.

Final report should include: changes, files, key rulings, commands, test/check/build results, dependency/audit result when relevant, git status, local commits if any, deferred work, unresolved risk, and explicit external-mutation statement.

Evidence before assertion.

## 22. Nested instructions

Add a nested `AGENTS.md` only when a subtree develops durable, genuinely more-specific rules. Do not repeat this file.

Potential future examples: XRechnung modules with mandatory validator commands; server-only code with stronger secret/privacy rules; publication areas with source-verification rules.

Nested rules may refine this file but must not silently contradict approved project decisions.

## Core maxim

Build the smallest system that satisfies the current professional requirement. Make important rules explicit. Verify them against independent evidence. Leave the code easier to audit than you found it.

**Future-capable. Not future-built.**
