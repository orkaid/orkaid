// Semantic governance audit runner (Phase 1). Development tooling only: not part of the Orkaid product, not a
// runtime or CI dependency, and not used by any tool. It is never called by `npm test`.
//
//   node tools/semantic-audit/run.ts --corpus calibration|holdout|repository --plan            # no network
//   node tools/semantic-audit/run.ts --corpus calibration|holdout|repository [--repeat N] [--case id,id]
//
// Order of a live run, every step fail-closed (exit codes in policy.ts):
//   1. profile, corpus and tooling must match the committed MANIFEST.json (4 otherwise);
//   2. live holdout runs need a calibrated profile, and the owner-authored holdout cases must be present before any
//      live request of any corpus; a live repository run is not authorized in Phase 1 at all (4 otherwise);
//   3. every audited file must be git-tracked and unchanged against HEAD (5 otherwise);
//   4. every request is built and passes the egress preflight before the first one is sent (5 otherwise);
//   5. the API key comes from the environment, else from the ignored .env.semantic-audit (3 when missing);
//   6. each response is validated against exactly the questions asked (3 or 4 otherwise);
//   7. findings are derived by the profile's policy and written with their provenance to .cache/semantic-audit/.
// `--plan` skips the live-only gates of steps 2, 3 and 5, stops after step 4 and writes the exact request bodies
// instead of sending them (exit 6: a person reviews). It never makes a network request and needs no bands and no key.
//
// The key is only ever placed in the Authorization header. It is never logged, stored, or accepted as an argument.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import { extractUnits, loadSources, ROOT, sha256, SOURCES_PATH, tagsFor, type Authority, type GovernanceUnit } from './extract-governance.ts';
import { buildManifest, MANIFEST_PATH } from './manifest.ts';
import {
  Blocked,
  deriveFinding,
  EXIT,
  exitCodeFor,
  exitCodeForBlocked,
  optionProbabilities,
  toApiQuestions,
  validateProfile,
  validateResponse,
  worseFinding,
  type Answer,
  type Bands,
  type Finding,
  type Profile,
  type Question,
} from './policy.ts';

export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const API_HOST = 'api.typesafe.ai';
export const ENV_FILE = '.env.semantic-audit';
export const PROFILE_PATH = 'tools/semantic-audit/profiles/governance-phase1.json';
export const CORPUS_PATHS = {
  calibration: 'tests/fixtures/semantic-audit/calibration/cases.json',
  holdout: 'tests/fixtures/semantic-audit/holdout/cases.json',
} as const;
// Holdout cases the project owner authored: input, label and rationale are the owner's; an agent may only transcribe
// them (PROTOCOL.md section 3). Part of the holdout corpus.
export const OWNER_HOLDOUT_PATH = 'tests/fixtures/semantic-audit/holdout/owner-cases.json';
export const OWNER_HOLDOUT_MINIMUM = 4;
const ORIGINS = new Set(['real', 'mutated', 'synthetic']);
const OUTPUT_DIR = '.cache/semantic-audit';
const REQUEST_TIMEOUT_MS = 30_000;
// Provisional guard, not a vendor figure: the documented context limit is 32k tokens for state plus the longest
// question; a request body this large is refused before it is sent rather than truncated.
const MAX_REQUEST_BYTES = 60_000;
const MAX_REPEAT = 10;

export type Corpus = 'calibration' | 'holdout' | 'repository';

// Written into every report and plan, so the evidence carries its own limits.
export const INTERPRETATION = [
  'NO_FINDING means only that no semantic finding was produced within the bounded questions evaluated. It does not mean correct, approved, complete, certified, or legally or regulatorily valid.',
  'Findings are probabilistic typed judgments for human review, not proof. They never override a deterministic check.',
  'Cross-document pairs are chosen by shared topic tags, a bounded heuristic: rules that share no tag are never compared, so NO_FINDING is not evidence that the repository has no governance conflicts.',
] as const;

type Rule = { readonly document: string; readonly section: string; readonly authority: Authority; readonly text: string };
type Subject = { readonly document: string; readonly rule_id: string; readonly section: string; readonly authority_rank: number; readonly text_sha256: string };

export type AuditRequest = {
  readonly request_id: string;
  readonly kind: 'unit' | 'pair';
  readonly subjects: readonly Subject[];
  readonly precedence_sha256: string | null;
  readonly questions: Readonly<Record<string, Question>>;
  readonly body: { readonly model: string; readonly state: unknown; readonly questions: unknown };
  readonly expect?: Readonly<Record<string, readonly string[]>>;
  readonly expected_outcome?: readonly string[];
  readonly lexical_group?: string;
};

// ------------------------------------------------------------------------------------------------ credentials

/**
 * The API key: a non-empty TYPESAFE_API_KEY already in the environment wins; otherwise the ignored local file is read
 * with Node's own parser, without touching process.env. Only TYPESAFE_API_KEY is taken from the file.
 */
export function resolveApiKey(env: Readonly<Record<string, string | undefined>>, root = ROOT): string | undefined {
  const fromEnv = env.TYPESAFE_API_KEY;
  let key = fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : undefined;
  if (key === undefined) {
    const path = join(root, ENV_FILE);
    if (existsSync(path)) {
      const fromFile = parseEnv(readFileSync(path, 'utf8')).TYPESAFE_API_KEY;
      if (fromFile !== undefined && fromFile.trim() !== '') key = fromFile;
    }
  }
  // A key with whitespace or control characters would corrupt the header; refuse it without echoing it.
  if (key !== undefined && /[\s\u0000-\u001f\u007f]/.test(key)) throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', 'TYPESAFE_API_KEY is malformed');
  return key;
}

export function redact(text: string, key: string | undefined): string {
  return key ? text.split(key).join('[REDACTED]') : text;
}

// ------------------------------------------------------------------------------------------------ egress preflight

const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/],
  ['sk- style API key', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['bearer credential', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i],
  ['assigned secret', /\b[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*\S{8,}/],
];
const LOCAL_PATH = /(^|[\s'"`(=])(\/home\/|\/Users\/|\/root\/|[A-Za-z]:\\)/;

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) stringLeaves(item, out);
  return out;
}

/**
 * Every string in the body must be one of the `permitted` strings (allowlisted governance text, its provenance
 * labels, the profile's own question text), and none may look like a secret, a local path, or contain the key.
 * Returns the violations; an empty list means the body may be sent.
 */
export function preflight(body: unknown, permitted: ReadonlySet<string>, apiKey?: string): string[] {
  const violations: string[] = [];
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) violations.push(`request body exceeds ${MAX_REQUEST_BYTES} bytes`);
  if (apiKey && serialized.includes(apiKey)) violations.push('request body contains the API key');
  for (const leaf of stringLeaves(body)) {
    const label = `string sha256:${sha256(leaf).slice(0, 12)}`;
    if (!permitted.has(leaf)) violations.push(`${label} is not from an allowlisted source`);
    for (const [name, pattern] of SECRET_PATTERNS) if (pattern.test(leaf)) violations.push(`${label} looks like a ${name}`);
    if (LOCAL_PATH.test(leaf)) violations.push(`${label} contains a local absolute path`);
  }
  return violations;
}

// ------------------------------------------------------------------------------------------------ requests

type CorpusCase = {
  readonly id: string;
  readonly category: string;
  readonly kind: 'unit' | 'pair';
  readonly unit?: Rule;
  readonly rule_a?: Rule;
  readonly rule_b?: Rule;
  readonly expect: Readonly<Record<string, readonly string[]>>;
  readonly expected_outcome: readonly string[];
  readonly origin: 'real' | 'mutated' | 'synthetic'; // where the judged text came from
  readonly dimension: string; // the governance dimension the case tests
  readonly rationale: string; // why the label is what it is, for the owner's review
  readonly lexical_group?: string;
};
type CorpusFile = { readonly set: string; readonly precedence_rule: string; readonly cases: readonly CorpusCase[] };

function isRule(value: unknown): value is Rule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Record<string, unknown>;
  const authority = rule.authority as Record<string, unknown> | undefined;
  return ['document', 'section', 'text'].every((k) => typeof rule[k] === 'string' && (rule[k] as string) !== '')
    && typeof authority === 'object' && authority !== null && Number.isInteger(authority.rank) && typeof authority.label === 'string';
}

function readJson(root: string, path: string, invalid: (m: string) => never): unknown {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch {
    return invalid(`${path} is unreadable or not JSON`);
  }
}

/** The owner-authored holdout cases; the file may hold none yet, but it must exist and be well-formed. */
export function loadOwnerHoldout(root = ROOT): readonly CorpusCase[] {
  const invalid = (m: string): never => {
    throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `owner holdout: ${m}`);
  };
  const file = readJson(root, OWNER_HOLDOUT_PATH, invalid) as { set?: unknown; cases?: unknown };
  if (file.set !== 'holdout-owner' || !Array.isArray(file.cases)) invalid('malformed');
  return file.cases as CorpusCase[];
}

export function loadCorpus(corpus: 'calibration' | 'holdout', root = ROOT): CorpusFile {
  const invalid = (m: string): never => {
    throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `corpus ${corpus}: ${m}`);
  };
  const parsed = readJson(root, CORPUS_PATHS[corpus], invalid) as CorpusFile;
  if (parsed.set !== corpus || typeof parsed.precedence_rule !== 'string' || !Array.isArray(parsed.cases) || parsed.cases.length === 0) invalid('malformed');
  const file = corpus === 'holdout' ? { ...parsed, cases: [...parsed.cases, ...loadOwnerHoldout(root)] } : parsed;
  const ids = new Set<string>();
  for (const c of file.cases) {
    if (typeof c.id !== 'string' || ids.has(c.id)) invalid(`duplicate or missing id '${String(c.id)}'`);
    ids.add(c.id);
    const rulesOk = c.kind === 'unit' ? isRule(c.unit) : c.kind === 'pair' ? isRule(c.rule_a) && isRule(c.rule_b) : false;
    if (!rulesOk) invalid(`case ${c.id} is malformed`);
    if (typeof c.expect !== 'object' || !Array.isArray(c.expected_outcome)) invalid(`case ${c.id} has no expectation`);
    if (!ORIGINS.has(c.origin) || typeof c.dimension !== 'string' || c.dimension === '' || typeof c.rationale !== 'string' || c.rationale === '') {
      invalid(`case ${c.id} needs origin, dimension and rationale for review`);
    }
  }
  return file;
}

function subjectOf(rule: Rule, ruleId: string): Subject {
  return { document: rule.document, rule_id: ruleId, section: rule.section, authority_rank: rule.authority.rank, text_sha256: sha256(rule.text) };
}

function unitQuestionsFor(profile: Profile, text: string): Record<string, Question> {
  const tags = tagsFor(text);
  return Object.fromEntries(Object.entries(profile.unit_questions).filter(([, q]) => q.applies_to_tag === undefined || tags.includes(q.applies_to_tag)));
}

function unitRequest(profile: Profile, requestId: string, rule: Rule, ruleId: string): AuditRequest {
  const questions = unitQuestionsFor(profile, rule.text);
  return {
    request_id: requestId,
    kind: 'unit',
    subjects: [subjectOf(rule, ruleId)],
    precedence_sha256: null,
    questions,
    body: {
      model: profile.model,
      state: { governance_unit: { document: rule.document, section: rule.section, text: rule.text } },
      questions: toApiQuestions(questions),
    },
  };
}

function pairRequest(profile: Profile, requestId: string, a: Rule, aId: string, b: Rule, bId: string, precedence: string): AuditRequest {
  const side = (rule: Rule) => ({ document: rule.document, section: rule.section, authority: rule.authority.label, text: rule.text });
  // The precedence rule is only context where the authorities differ; otherwise it would be a distractor.
  const withPrecedence = a.authority.rank !== b.authority.rank;
  return {
    request_id: requestId,
    kind: 'pair',
    subjects: [subjectOf(a, aId), subjectOf(b, bId)],
    precedence_sha256: withPrecedence ? sha256(precedence) : null,
    questions: profile.pair_questions,
    body: {
      model: profile.model,
      state: { rule_a: side(a), rule_b: side(b), ...(withPrecedence ? { precedence_rule: precedence } : {}) },
      questions: toApiQuestions(profile.pair_questions),
    },
  };
}

function permittedStrings(profile: Profile, rules: readonly Rule[], precedence: string): Set<string> {
  const permitted = new Set<string>([profile.model, precedence]);
  for (const q of [...Object.values(profile.unit_questions), ...Object.values(profile.pair_questions)]) {
    permitted.add(q.type);
    permitted.add(q.instructions);
    for (const text of Object.values(q.criteria)) permitted.add(text);
  }
  for (const rule of rules) for (const value of [rule.document, rule.section, rule.text, rule.authority.label]) permitted.add(value);
  return permitted;
}

export function buildRequests(corpus: Corpus, profile: Profile, root = ROOT, caseIds?: readonly string[]): { requests: AuditRequest[]; permitted: Set<string> } {
  if (corpus === 'repository') {
    const sources = loadSources(root);
    const { units, pairs } = extractUnits(root, sources);
    const byId = new Map(units.map((u) => [u.rule_id, u]));
    const precedenceUnit = byId.get(sources.precedence_rule);
    if (!precedenceUnit) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `precedence rule ${sources.precedence_rule} not found`);
    const asRule = (u: GovernanceUnit): Rule => ({ document: u.document, section: u.section, authority: u.authority, text: u.text });
    const requests = [
      ...units.map((u) => unitRequest(profile, u.rule_id, asRule(u), u.rule_id)),
      ...pairs.map((p) => {
        const a = byId.get(p.a) as GovernanceUnit;
        const b = byId.get(p.b) as GovernanceUnit;
        return pairRequest(profile, `${p.a}|${p.b}`, asRule(a), a.rule_id, asRule(b), b.rule_id, precedenceUnit.text);
      }),
    ];
    return { requests, permitted: permittedStrings(profile, units.map(asRule), precedenceUnit.text) };
  }

  const file = loadCorpus(corpus, root);
  const selected = caseIds ? file.cases.filter((c) => caseIds.includes(c.id)) : file.cases;
  if (caseIds && selected.length !== caseIds.length) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'unknown case id');
  const rules: Rule[] = [];
  const requests = selected.map((c) => {
    const base = c.kind === 'unit'
      ? unitRequest(profile, c.id, c.unit as Rule, `${CORPUS_PATHS[corpus]}#${c.id}`)
      : pairRequest(profile, c.id, c.rule_a as Rule, `${CORPUS_PATHS[corpus]}#${c.id}.a`, c.rule_b as Rule, `${CORPUS_PATHS[corpus]}#${c.id}.b`, file.precedence_rule);
    rules.push(...(c.kind === 'unit' ? [c.unit as Rule] : [c.rule_a as Rule, c.rule_b as Rule]));
    return { ...base, expect: c.expect, expected_outcome: c.expected_outcome, ...(c.lexical_group ? { lexical_group: c.lexical_group } : {}) };
  });
  return { requests, permitted: permittedStrings(profile, rules, file.precedence_rule) };
}

// ------------------------------------------------------------------------------------------------ transport

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function send(body: unknown, apiKey: string, fetchImpl: FetchLike, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ json: unknown; latency_ms: number }> {
  if (new URL(API_URL).host !== API_HOST) throw new Blocked('BLOCKED_EGRESS_OR_PREFLIGHT', 'API URL host is not the allowed host');
  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error', // a redirect could carry the request to another host
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', name === 'TimeoutError' ? `request timed out after ${timeoutMs} ms` : `request failed (${name})`);
  }
  if (response.status === 400 || response.status === 422) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `provider rejected the request (HTTP ${response.status})`);
  if (!response.ok) throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', `provider returned HTTP ${response.status}`);
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', 'response body could not be read');
  }
  try {
    return { json: JSON.parse(text), latency_ms: Math.round(performance.now() - started) };
  } catch {
    throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'response body is not JSON');
  }
}

// ------------------------------------------------------------------------------------------------ git

export type Git = { head(): string; dirty(): boolean; notCleanAndTracked(paths: readonly string[]): string[] };

export function realGit(root = ROOT): Git {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return {
    head: () => git(['rev-parse', 'HEAD']).trim(),
    dirty: () => git(['status', '--porcelain']).trim() !== '',
    notCleanAndTracked: (paths) => paths.filter((path) => {
      try {
        git(['ls-files', '--error-unmatch', '--', path]);
        return git(['status', '--porcelain', '--', path]).trim() !== '';
      } catch {
        return true;
      }
    }),
  };
}

// ------------------------------------------------------------------------------------------------ run

type Repeat = { readonly latency_ms: number; readonly resolved_model: string; readonly usage: unknown; readonly answers: Readonly<Record<string, Answer>> };

export type RunOptions = {
  readonly corpus: Corpus;
  readonly plan?: boolean;
  readonly repeat?: number;
  readonly caseIds?: readonly string[];
  readonly root?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: FetchLike;
  readonly git?: Git;
  readonly outDir?: string;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
};

export type RunResult = { readonly exitCode: number; readonly outcome: string; readonly outputPath?: string };

function writeAtomically(path: string, content: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function finalize(report: Record<string, unknown>): string {
  const withoutHash = JSON.stringify(report, null, 2);
  return `${JSON.stringify({ ...report, report_sha256: sha256(withoutHash) }, null, 2)}\n`;
}

/** Checks a written report: its report_sha256 must equal the hash of the report without that field. */
export function verifyReport(content: string): boolean {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const { report_sha256: claimed, ...rest } = parsed;
  return typeof claimed === 'string' && claimed === sha256(JSON.stringify(rest, null, 2));
}

function expectationOf(request: AuditRequest, id: string, answer: Answer): unknown {
  const expected = request.expect?.[id];
  if (!expected) return undefined;
  const probabilities = optionProbabilities(answer);
  const top = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]?.[0];
  return { expected, top_option: top, expected_mass: expected.reduce((sum, option) => sum + (probabilities[option] ?? 0), 0), top_matches: top !== undefined && expected.includes(top) };
}

function spread(repeats: readonly Repeat[], id: string): number {
  const all = repeats.map((r) => optionProbabilities(r.answers[id] as Answer));
  const options = Object.keys(all[0] ?? {});
  return Math.max(0, ...options.map((o) => Math.max(...all.map((p) => p[o] ?? 0)) - Math.min(...all.map((p) => p[o] ?? 0))));
}

export async function runAudit(options: RunOptions): Promise<RunResult> {
  const root = options.root ?? ROOT;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  const repeat = options.repeat ?? 1;
  const outDir = options.outDir ?? join(root, OUTPUT_DIR);
  let apiKey: string | undefined;
  const say = (line: string) => log(redact(line, apiKey));

  const provenance: Record<string, unknown> = { report_version: '1', audit: 'governance-phase1', corpus: options.corpus, mode: options.plan ? 'plan' : 'live', timestamp: now().toISOString(), interpretation: INTERPRETATION };
  const blocked = (error: Blocked, extra: Record<string, unknown> = {}): RunResult => {
    const exitCode = exitCodeForBlocked(error.status);
    say(`${error.status}: ${error.message}`);
    if (options.plan) return { exitCode, outcome: error.status };
    mkdirSync(join(outDir, 'reports'), { recursive: true });
    const path = join(outDir, 'reports', `${String(provenance.timestamp).replace(/[:.]/g, '-')}-${options.corpus}-blocked.json`);
    writeAtomically(path, redact(finalize({ ...provenance, outcome: error.status, exit_code: exitCode, reason: error.message, ...extra }), apiKey));
    return { exitCode, outcome: error.status, outputPath: path };
  };

  try {
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `--repeat must be 1 to ${MAX_REPEAT}`);

    // 1. Everything the policy consists of must be what the manifest records.
    const manifest = readFileSync(join(root, MANIFEST_PATH), 'utf8');
    if (manifest !== buildManifest(root)) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${MANIFEST_PATH} does not match the profile, corpus and tooling`);
    const profileText = readFileSync(join(root, PROFILE_PATH), 'utf8');
    let profileJson: unknown;
    try {
      profileJson = JSON.parse(profileText);
    } catch {
      throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'profile is not JSON');
    }
    const profile = validateProfile(profileJson);
    Object.assign(provenance, {
      profile: { path: PROFILE_PATH, sha256: sha256(profileText), profile_id: profile.profile_id, version: profile.version, bands: profile.bands },
      manifest: { path: MANIFEST_PATH, sha256: sha256(manifest) },
      requested_model: profile.model,
    });

    // 2. The holdout is only judged live by a frozen, calibrated profile. The repository is not judged live in Phase 1:
    //    that needs a completed calibration, frozen bands, one holdout run and an owner-reviewed error analysis, and
    //    then an owner-approved first batch (PROTOCOL.md section 4). No live request of any corpus is made before the
    //    owner's holdout cases exist, so they cannot be written after seeing a result. A plan sends nothing, so it
    //    needs none of these.
    if (!options.plan && options.corpus !== 'calibration' && profile.bands === null) {
      throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `the ${options.corpus} corpus needs a calibrated profile (bands are null)`);
    }
    if (!options.plan && options.corpus === 'repository') {
      throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'a live repository run is not authorized in Phase 1; only --plan is (PROTOCOL.md section 4, step 8)');
    }
    const ownerCases = loadOwnerHoldout(root).length;
    if (!options.plan && ownerCases < OWNER_HOLDOUT_MINIMUM) {
      throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${OWNER_HOLDOUT_PATH} has ${ownerCases} owner-authored case(s); ${OWNER_HOLDOUT_MINIMUM} are required before any live request`);
    }

    // 3. Only committed, tracked text may leave the machine.
    const git = options.git ?? realGit(root);
    if (!options.plan) {
      const audited = options.corpus === 'repository' ? loadSources(root).audited.map((s) => s.path) : [CORPUS_PATHS[options.corpus]];
      const offending = git.notCleanAndTracked([...audited, OWNER_HOLDOUT_PATH, SOURCES_PATH, PROFILE_PATH, MANIFEST_PATH]);
      if (offending.length > 0) throw new Blocked('BLOCKED_EGRESS_OR_PREFLIGHT', `not tracked or not committed: ${offending.join(', ')}`);
      Object.assign(provenance, { repository: { commit: git.head(), dirty: git.dirty() } });
    }

    // 4. Every request passes the preflight before anything is sent.
    const { requests, permitted } = buildRequests(options.corpus, profile, root, options.caseIds);
    if (requests.length === 0) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'no requests to send');
    if (!options.plan) apiKey = resolveApiKey(options.env ?? process.env, root);
    const violations = requests.flatMap((r) => preflight(r.body, permitted, apiKey).map((v) => `${r.request_id}: ${v}`));
    if (violations.length > 0) {
      apiKey = undefined;
      return blocked(new Blocked('BLOCKED_EGRESS_OR_PREFLIGHT', `${violations.length} preflight violation(s)`), { violations });
    }

    if (options.plan) {
      mkdirSync(join(outDir, 'plans'), { recursive: true });
      const path = join(outDir, 'plans', `${String(provenance.timestamp).replace(/[:.]/g, '-')}-${options.corpus}.json`);
      writeAtomically(path, finalize({ ...provenance, outcome: 'PLAN_ONLY_NO_REQUEST_SENT', api_url: API_URL, requests: requests.map((r) => ({ request_id: r.request_id, subjects: r.subjects, body: r.body })) }));
      say(`PLAN ONLY: ${requests.length} request(s) passed the preflight; nothing was sent. Plan: ${path}`);
      return { exitCode: EXIT.REQUIRES_HUMAN_REVIEW, outcome: 'PLAN_ONLY_NO_REQUEST_SENT', outputPath: path };
    }

    // 5. No key, no egress.
    if (apiKey === undefined) throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', `TYPESAFE_API_KEY is not set in the environment or in ${ENV_FILE}`);
    const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));

    // 6. Send, validate, derive.
    const results: Record<string, unknown>[] = [];
    const findings: Finding[] = [];
    for (const request of requests) {
      const repeats: Repeat[] = [];
      for (let i = 0; i < repeat; i++) {
        let response: { json: unknown; latency_ms: number };
        try {
          response = await send(request.body, apiKey, fetchImpl);
          const valid = validateResponse(response.json, profile.model, request.questions);
          repeats.push({ latency_ms: response.latency_ms, resolved_model: valid.model, usage: valid.usage, answers: valid.answers });
        } catch (error) {
          if (error instanceof Blocked) return blocked(error, { failed_request: request.request_id, completed_requests: results });
          throw error;
        }
      }
      const perQuestion: Record<string, unknown> = {};
      let requestFinding: Finding = 'NO_FINDING';
      for (const [id, question] of Object.entries(request.questions)) {
        let finding: Finding = 'NO_FINDING';
        const bands = profile.bands === null ? null : (profile.bands[id] as Bands); // validateProfile: one per question
        const derived = repeats.map((r) => deriveFinding(question, r.answers[id] as Answer, bands));
        for (const d of derived) finding = worseFinding(finding, d.finding);
        requestFinding = worseFinding(requestFinding, finding);
        perQuestion[id] = {
          finding, // the most severe of the repeats (PROTOCOL.md section 9); every individual one is kept below
          finding_per_repeat: derived.map((d) => d.finding),
          mass_per_repeat: derived.map((d) => d.mass),
          ...(repeat > 1 ? { max_probability_spread: spread(repeats, id) } : {}),
          ...(request.expect?.[id] ? { expectation: expectationOf(request, id, repeats[0]?.answers[id] as Answer) } : {}),
        };
      }
      findings.push(requestFinding);
      results.push({
        request_id: request.request_id,
        kind: request.kind,
        subjects: request.subjects,
        precedence_sha256: request.precedence_sha256,
        finding: requestFinding,
        ...(request.expected_outcome ? { expected_outcome: request.expected_outcome, outcome_matches: request.expected_outcome.includes(requestFinding) } : {}),
        ...(request.lexical_group ? { lexical_group: request.lexical_group } : {}),
        questions: perQuestion,
        repeats,
      });
    }

    // 7. Aggregate and persist.
    const exitCode = exitCodeFor(findings);
    const outcome = Object.entries(EXIT).find(([, code]) => code === exitCode)?.[0] ?? 'UNKNOWN';
    mkdirSync(join(outDir, 'reports'), { recursive: true });
    const path = join(outDir, 'reports', `${String(provenance.timestamp).replace(/[:.]/g, '-')}-${options.corpus}.json`);
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f] = (counts[f] ?? 0) + 1;
    writeAtomically(path, redact(finalize({ ...provenance, outcome, exit_code: exitCode, repeat, finding_counts: counts, results }), apiKey));
    say(`${outcome} (exit ${exitCode}): ${JSON.stringify(counts)}. Report: ${path}`);
    return { exitCode, outcome, outputPath: path };
  } catch (error) {
    if (error instanceof Blocked) return blocked(error);
    throw error;
  }
}

const USAGE = 'usage: node tools/semantic-audit/run.ts --corpus calibration|holdout|repository [--plan] [--repeat N] [--case id,id]';

/** Parses the command line. There is deliberately no option that takes a key or disables the preflight. */
export function parseArgs(argv: readonly string[]): RunOptions | undefined {
  let corpus: Corpus | undefined;
  let plan = false;
  let repeat = 1;
  let caseIds: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--corpus') {
      const value = next();
      if (value !== 'calibration' && value !== 'holdout' && value !== 'repository') return undefined;
      corpus = value;
    } else if (arg === '--plan') plan = true;
    else if (arg === '--repeat') {
      const value = next();
      if (value === undefined || !/^\d+$/.test(value)) return undefined;
      repeat = Number.parseInt(value, 10);
    } else if (arg === '--case') {
      const value = next();
      if (!value) return undefined;
      caseIds = value.split(',');
    } else return undefined;
  }
  return corpus ? { corpus, plan, repeat, ...(caseIds ? { caseIds } : {}) } : undefined;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    process.exit(EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
  }
  const result = await runAudit(options);
  process.exit(result.exitCode);
}
