// Real-code semantic audit pilot v1 (MDR-20). Development tooling only: not part of the Orkaid product, not a CI or
// runtime dependency. One committed source file (document.ts) is judged by TypeSafe Jev against five frozen
// invariants, as a byte-for-byte baseline, one semantics-preserving control and four single-defect mutants. The
// preregistration is tests/fixtures/semantic-audit/code-pilot-v1/PROTOCOL.md.
//
//   node tools/semantic-audit/code-pilot.ts --write-manifest       # regenerate the pilot manifest (a policy change)
//   node tools/semantic-audit/code-pilot.ts --check-manifest
//   node tools/semantic-audit/code-pilot.ts --deterministic        # typecheck + domain tests per target, offline
//   node tools/semantic-audit/code-pilot.ts --plan                 # exact request bodies, nothing sent
//   node tools/semantic-audit/code-pilot.ts --run [--resume <blocked report>]   # live: 6 targets x 5 repeats
//   node tools/semantic-audit/code-pilot.ts --evaluate <evidence dir>          # preregistered result, offline
//
// Fail-closed like the Phase-1 runner, whose transport, preflight and response validation it reuses unchanged: the
// manifest must match, every pilot file must be committed and unchanged, every body passes the preflight before the
// first request, every response must answer exactly the questions asked from the requested model, and any failure
// blocks without producing a semantic result.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Blocked, exitCodeForBlocked, optionProbabilities, validateResponse, type Answer, type Question } from './policy.ts';
import { preflight, realGit, redact, resolveApiKey, send, type FetchLike, type Git } from './run.ts';

export const ROOT = resolve(import.meta.dirname, '../..');
export const PILOT_DIR = 'tests/fixtures/semantic-audit/code-pilot-v1';
export const PROFILE_PATH = 'tools/semantic-audit/profiles/code-audit-document-pilot-v1.json';
export const MANIFEST_PATH = `${PILOT_DIR}/MANIFEST.json`;
export const TARGET_IDS = ['REAL', 'CONTROL', 'MUTANT-01', 'MUTANT-02', 'MUTANT-03', 'MUTANT-04'] as const;
export const REPEATS = 5;
const OUTPUT_DIR = '.cache/semantic-audit/code-pilot';
const TOOL_PATH = 'tools/semantic-audit/code-pilot.ts';
const SOURCE_PATH = 'src/lib/domain/xrechnung/document.ts';

export const MANIFEST_FILES = [
  PROFILE_PATH,
  TOOL_PATH,
  `${PILOT_DIR}/PROTOCOL.md`,
  `${PILOT_DIR}/targets.json`,
  `${PILOT_DIR}/deterministic.json`,
  ...TARGET_IDS.map((id) => `${PILOT_DIR}/targets/${id}.ts.txt`),
] as const;

export const INTERPRETATION = [
  'Jev answers are probabilistic typed judgments about one source file against stated invariants: evidence for human review, not proof of code correctness.',
  'This pilot concerns one file, five invariants, one baseline, one control and four constructed mutants. It says nothing about the rest of the repository, about regulatory correctness or about production readiness, and certifies nothing.',
];

type TargetId = (typeof TARGET_IDS)[number];
type Label = 'satisfies_invariant' | 'violates_invariant' | 'insufficient_evidence' | 'UNKNOWN_BASELINE';
type Target = { readonly id: TargetId; readonly file: string; readonly intended_invariant: string | null; readonly expected: Readonly<Record<string, Label>> };
type Profile = { readonly profile_id: string; readonly version: string; readonly model: string; readonly target_path: string; readonly options: readonly string[]; readonly questions: Readonly<Record<string, { readonly type: 'choice'; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }>> };
type Repeat = { readonly repeat: number; readonly latency_ms: number; readonly resolved_model: string; readonly usage: unknown; readonly answers: Readonly<Record<string, Answer>> };

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');

// ------------------------------------------------------------------------------------------------ frozen inputs

export function buildManifest(root = ROOT): string {
  const files = MANIFEST_FILES.map((path) => {
    const data = readFileSync(join(root, path));
    return { path, bytes: data.length, sha256: sha256(data) };
  });
  return `${JSON.stringify({ purpose: 'Real-code semantic audit pilot v1 manifest. See PROTOCOL.md next to it.', algorithm: 'sha256', files }, null, 2)}\n`;
}

export function loadProfile(root = ROOT): Profile {
  const invalid = (m: string): never => {
    throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `pilot profile: ${m}`);
  };
  const p = JSON.parse(read(root, PROFILE_PATH)) as Profile;
  if (!/^jev-\d+\.\d+\.\d+$/.test(p.model)) invalid('model must be a pinned release id');
  if (p.target_path !== SOURCE_PATH) invalid('target_path is not the file MDR-20 names');
  const ids = Object.keys(p.questions);
  if (ids.length < 4 || ids.length > 6) invalid('needs 4 to 6 invariant questions');
  for (const [id, q] of Object.entries(p.questions)) {
    if (q.type !== 'choice' || !q.instructions.trim()) invalid(`${id} is not a choice question with instructions`);
    if (JSON.stringify(Object.keys(q.criteria)) !== JSON.stringify(p.options)) invalid(`${id} does not offer exactly the profile options`);
  }
  if (!p.options.includes('violates_invariant')) invalid('no violates_invariant option');
  return p;
}

export function loadTargets(root = ROOT, profile = loadProfile(root)): Target[] {
  const targets = JSON.parse(read(root, `${PILOT_DIR}/targets.json`)).targets as Target[];
  if (JSON.stringify(targets.map((t) => t.id)) !== JSON.stringify(TARGET_IDS)) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'targets.json must list exactly the six targets in order');
  for (const t of targets) {
    if (JSON.stringify(Object.keys(t.expected).sort()) !== JSON.stringify(Object.keys(profile.questions).sort())) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${t.id} must label every invariant`);
  }
  return targets;
}

/** Questions in the policy module's shape, so the Phase-1 response validation applies unchanged. */
function asQuestions(profile: Profile): Record<string, Question> {
  return Object.fromEntries(Object.entries(profile.questions).map(([id, q]) => [id, { ...q, findings: { violates_invariant: 'CONFLICT' as const } }]));
}

export function buildBodies(root = ROOT, profile = loadProfile(root)) {
  const permitted = new Set<string>([profile.model, profile.target_path, 'choice']);
  for (const q of Object.values(profile.questions)) {
    permitted.add(q.instructions);
    for (const text of Object.values(q.criteria)) permitted.add(text);
  }
  const bodies = loadTargets(root, profile).map((t) => {
    const text = read(root, `${PILOT_DIR}/targets/${t.id}.ts.txt`);
    permitted.add(text);
    // The same path for every target: nothing in the body says which fixture it is.
    return { id: t.id, source_sha256: sha256(text), body: { model: profile.model, state: { source_file: { path: profile.target_path, text } }, questions: profile.questions } };
  });
  return { bodies, permitted };
}

// ------------------------------------------------------------------------------------------------ deterministic

/** Typecheck and the domain tests with each target in place of document.ts, in a throwaway copy of HEAD. */
export function runDeterministic(root = ROOT): unknown {
  const results = TARGET_IDS.map((id) => {
    const dir = mkdtempSync(join(tmpdir(), 'code-pilot-'));
    try {
      execFileSync('sh', ['-c', `git -C "${root}" archive HEAD | tar -x -C "${dir}"`]);
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
      writeFileSync(join(dir, SOURCE_PATH), readFileSync(join(root, PILOT_DIR, 'targets', `${id}.ts.txt`)));
      const runIn = (cmd: string[]): { exit: number; out: string } => {
        try {
          return { exit: 0, out: execFileSync(cmd[0] as string, cmd.slice(1), { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
        } catch (error) {
          const e = error as { status?: number; stdout?: string; stderr?: string };
          return { exit: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
        }
      };
      const tsc = runIn([join(dir, 'node_modules/.bin/tsc'), '--noEmit']);
      const tests = readdirSync(join(dir, 'tests/domain')).filter((f) => f.endsWith('.test.ts')).sort().map((f) => `tests/domain/${f}`);
      const node = runIn([process.execPath, '--test', ...tests]);
      const count = (label: string) => Number(new RegExp(`^ℹ ${label} (\\d+)$`, 'm').exec(node.out)?.[1] ?? NaN);
      return {
        id,
        typecheck: { exit: tsc.exit, errors: tsc.out.split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.replace(dir, '<copy>')) },
        domain_tests: { files: tests, exit: node.exit, tests: count('tests'), pass: count('pass'), fail: count('fail'), failing: [...node.out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i && n !== 'failing tests:') },
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return { scope: 'tsc --noEmit on the whole project and node --test tests/domain/*.test.ts (includes the AST static checks), with the target in place of document.ts in a copy of HEAD', results };
}

// ------------------------------------------------------------------------------------------------ live run

const writeAtomically = (path: string, content: string) => {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
};
const finalize = (report: Record<string, unknown>) => `${JSON.stringify({ ...report, report_sha256: sha256(JSON.stringify(report, null, 2)) }, null, 2)}\n`;
export function verifyReport(content: string): boolean {
  const { report_sha256: claimed, ...rest } = JSON.parse(content) as Record<string, unknown>;
  return typeof claimed === 'string' && claimed === sha256(JSON.stringify(rest, null, 2));
}

export type PilotOptions = { readonly plan?: boolean; readonly resume?: string; readonly root?: string; readonly env?: Readonly<Record<string, string | undefined>>; readonly fetchImpl?: FetchLike; readonly git?: Git; readonly outDir?: string; readonly now?: () => Date; readonly log?: (l: string) => void };

export async function runPilot(options: PilotOptions = {}): Promise<{ exitCode: number; outcome: string; outputPath?: string }> {
  const root = options.root ?? ROOT;
  const outDir = options.outDir ?? join(root, OUTPUT_DIR);
  const log = options.log ?? ((l: string) => console.log(l));
  let apiKey: string | undefined;
  const provenance: Record<string, unknown> = { report_version: '1', audit: 'code-pilot-v1', mode: options.plan ? 'plan' : 'live', timestamp: (options.now ?? (() => new Date()))().toISOString(), interpretation: INTERPRETATION };
  const completed: { id: TargetId; source_sha256: string; repeats: Repeat[] }[] = [];
  const write = (kind: string, report: Record<string, unknown>) => {
    mkdirSync(join(outDir, kind), { recursive: true });
    const path = join(outDir, kind, `${String(provenance.timestamp).replace(/[:.]/g, '-')}-${kind === 'plans' ? 'plan' : String(report.outcome).toLowerCase()}.json`);
    writeAtomically(path, redact(finalize(report), apiKey));
    return path;
  };
  try {
    // 1. frozen policy
    const manifest = read(root, MANIFEST_PATH);
    if (manifest !== buildManifest(root)) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${MANIFEST_PATH} does not match the pilot files`);
    const profile = loadProfile(root);
    Object.assign(provenance, { profile: { path: PROFILE_PATH, sha256: sha256(read(root, PROFILE_PATH)), profile_id: profile.profile_id, version: profile.version }, manifest: { path: MANIFEST_PATH, sha256: sha256(manifest) }, requested_model: profile.model, repeat: REPEATS });

    // 2. committed only
    const git = options.git ?? realGit(root);
    if (!options.plan) {
      const offending = git.notCleanAndTracked([...MANIFEST_FILES, MANIFEST_PATH]);
      if (offending.length > 0) throw new Blocked('BLOCKED_EGRESS_OR_PREFLIGHT', `not tracked or not committed: ${offending.join(', ')}`);
      Object.assign(provenance, { repository: { commit: git.head(), dirty: git.dirty() } });
    }

    // 3. preflight of every body before anything is sent
    const { bodies, permitted } = buildBodies(root, profile);
    if (!options.plan) apiKey = resolveApiKey(options.env ?? process.env, root);
    const violations = bodies.flatMap((b) => preflight(b.body, permitted, apiKey).map((v) => `${b.id}: ${v}`));
    if (violations.length > 0) throw new Blocked('BLOCKED_EGRESS_OR_PREFLIGHT', `${violations.length} preflight violation(s): ${violations.join('; ')}`);
    if (options.plan) {
      const path = write('plans', { ...provenance, outcome: 'PLAN_ONLY_NO_REQUEST_SENT', requests_planned: bodies.length * REPEATS, targets: bodies.map((b) => ({ id: b.id, source_sha256: b.source_sha256, body: b.body })) });
      log(`PLAN ONLY: ${bodies.length} bodies x ${REPEATS} repeats passed the preflight; nothing was sent. Plan: ${path}`);
      return { exitCode: 6, outcome: 'PLAN_ONLY_NO_REQUEST_SENT', outputPath: path };
    }

    // 4. an infrastructure resume keeps every valid response of one blocked run and sends only what is missing
    let kept: typeof completed = [];
    if (options.resume) {
      const text = readFileSync(options.resume, 'utf8');
      const prior = JSON.parse(text) as { outcome: string; resumed_from?: unknown; manifest: { sha256: string }; completed: typeof completed };
      if (!verifyReport(text) || !prior.outcome.startsWith('BLOCKED') || prior.resumed_from !== undefined || prior.manifest.sha256 !== sha256(manifest)) {
        throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', 'resume needs one verified blocked report of this manifest that is not itself a resume');
      }
      kept = prior.completed;
      Object.assign(provenance, { resumed_from: { file: options.resume.split('/').at(-1), report_sha256: sha256(text) } });
    }
    if (apiKey === undefined) throw new Blocked('BLOCKED_PROVIDER_OR_MODEL', 'TYPESAFE_API_KEY is not set in the environment or in .env.semantic-audit');
    const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    const questions = asQuestions(profile);

    // 5. send, validate
    for (const b of bodies) {
      const prior = kept.find((k) => k.id === b.id);
      if (prior && prior.source_sha256 !== b.source_sha256) throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${b.id}: resumed responses were for another source`);
      const entry = { id: b.id, source_sha256: b.source_sha256, repeats: [...(prior?.repeats ?? [])] };
      completed.push(entry);
      for (let i = 1; i <= REPEATS; i++) {
        if (entry.repeats.some((r) => r.repeat === i)) continue;
        const response = await send(b.body, apiKey, fetchImpl);
        const valid = validateResponse(response.json, profile.model, questions);
        entry.repeats.push({ repeat: i, latency_ms: response.latency_ms, resolved_model: valid.model, usage: valid.usage, answers: valid.answers });
      }
      entry.repeats.sort((x, y) => x.repeat - y.repeat);
    }
    const path = write('reports', { ...provenance, outcome: 'COMPLETED', requests: completed.reduce((n, c) => n + c.repeats.length, 0), results: completed });
    log(`COMPLETED: ${TARGET_IDS.length} targets x ${REPEATS} repeats. Report: ${path}`);
    return { exitCode: 0, outcome: 'COMPLETED', outputPath: path };
  } catch (error) {
    if (!(error instanceof Blocked)) throw error;
    log(redact(`${error.status}: ${error.message}`, apiKey));
    if (options.plan) return { exitCode: exitCodeForBlocked(error.status), outcome: error.status };
    const path = write('reports', { ...provenance, outcome: error.status, reason: error.message, completed });
    return { exitCode: exitCodeForBlocked(error.status), outcome: error.status, outputPath: path };
  }
}

// ------------------------------------------------------------------------------------------------ evaluation

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
// Frozen in PROTOCOL.md section 7 before any live request.
export const DETECTION_MIN_DELTA = 0.3;
export const CONTROL_MAX_INCREASE = 0.15;

/** Preregistered result from a preserved evidence directory; every input is verified by hash first. */
export function evaluatePilot(dirArg: string): Record<string, unknown> {
  const dir = resolve(dirArg);
  const fail = (m: string): never => {
    throw new Error(`evidence: ${m}`);
  };
  const reportText = readFileSync(join(dir, 'report.json'), 'utf8');
  if (!verifyReport(reportText)) fail('report.json fails its own report_sha256');
  const report = JSON.parse(reportText) as { resumed_from?: unknown; outcome: string; mode: string; manifest: { sha256: string }; profile: { sha256: string }; requested_model: string; repository: { commit: string; dirty: boolean }; timestamp: string; results: { id: TargetId; source_sha256: string; repeats: Repeat[] }[] };
  if (report.mode !== 'live' || report.outcome !== 'COMPLETED') fail('report.json is not a completed live run');
  const manifestText = readFileSync(join(dir, 'MANIFEST.json'), 'utf8');
  if (sha256(manifestText) !== report.manifest.sha256) fail('MANIFEST.json is not the manifest the report ran with');
  const entries = (JSON.parse(manifestText) as { files: { path: string; sha256: string }[] }).files;
  // Evidence layout: pilot files keep their place below the pilot directory, others their base name; a TypeScript
  // source is stored as .ts.txt so that the preserved copy is not compiled where its imports do not exist.
  for (const e of entries) {
    const base = e.path.startsWith(`${PILOT_DIR}/`) ? e.path.slice(PILOT_DIR.length + 1) : (e.path.split('/').at(-1) as string);
    const local = base.endsWith('.ts') ? `${base}.txt` : base;
    if (sha256(readFileSync(join(dir, local))) !== e.sha256) fail(`${local} does not match the manifest entry for ${e.path}`);
  }
  const profile = JSON.parse(readFileSync(join(dir, PROFILE_PATH.split('/').at(-1) as string), 'utf8')) as Profile;
  if (sha256(readFileSync(join(dir, PROFILE_PATH.split('/').at(-1) as string))) !== report.profile.sha256) fail('profile is not the one the report recorded');
  const targets = (JSON.parse(readFileSync(join(dir, 'targets.json'), 'utf8')) as { targets: Target[] }).targets;
  const qids = Object.keys(profile.questions);

  const byTarget = new Map(report.results.map((r) => [r.id, r]));
  const cell = (id: TargetId, qid: string) => {
    const result = byTarget.get(id) ?? fail(`no result for ${id}`);
    if (sha256(readFileSync(join(dir, 'targets', `${id}.ts.txt`))) !== result.source_sha256) fail(`${id}: the report judged another source`);
    if (result.repeats.length !== REPEATS) fail(`${id}: ${result.repeats.length} repeats`);
    const probs = result.repeats.map((r) => optionProbabilities(r.answers[qid] as Answer));
    const tops = probs.map((p) => Object.entries(p).sort((x, y) => y[1] - x[1])[0]?.[0] as string);
    const pv = probs.map((p) => r4(p.violates_invariant ?? 0));
    const counts: Record<string, number> = {};
    for (const t of tops) counts[t] = (counts[t] ?? 0) + 1;
    const modal = Object.entries(counts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] as string;
    return { p_violates: pv, median_p_violates: r4(median(pv)), tops, modal_top: modal, top_stable: new Set(tops).size === 1, max_spread: r4(Math.max(...profile.options.map((o) => Math.max(...probs.map((p) => p[o] ?? 0)) - Math.min(...probs.map((p) => p[o] ?? 0))))), probabilities: probs };
  };
  const matrix = Object.fromEntries(TARGET_IDS.map((id) => [id, Object.fromEntries(qids.map((q) => [q, cell(id, q)]))]));
  const at = (id: TargetId, q: string) => (matrix[id] as Record<string, ReturnType<typeof cell>>)[q] as ReturnType<typeof cell>;

  const mutants = targets.filter((t) => t.intended_invariant !== null).map((t) => {
    const q = t.intended_invariant as string;
    const real = at('REAL', q);
    const mutant = at(t.id, q);
    const control = at('CONTROL', q);
    const allTop = mutant.tops.every((o) => o === 'violates_invariant');
    const delta = r4(mutant.median_p_violates - real.median_p_violates);
    return { id: t.id, invariant: q, detected: allTop && delta >= DETECTION_MIN_DELTA, violates_top_in_all_repeats: allTop, median_p_violates: { REAL: real.median_p_violates, CONTROL: control.median_p_violates, MUTANT: mutant.median_p_violates }, delta_mutant_minus_real: delta, tops: { REAL: real.tops, CONTROL: control.tops, MUTANT: mutant.tops } };
  });
  const realTargets = targets.find((t) => t.id === 'REAL') as Target;
  const labelled = qids.filter((q) => realTargets.expected[q] !== 'UNKNOWN_BASELINE');
  const control = labelled.map((q) => {
    const real = at('REAL', q);
    const ctl = at('CONTROL', q);
    const increase = r4(ctl.median_p_violates - real.median_p_violates);
    return { invariant: q, real_modal_top: real.modal_top, control_tops: ctl.tops, same_top: ctl.tops.every((o) => o === real.modal_top), increase, stable: ctl.tops.every((o) => o === real.modal_top) && increase <= CONTROL_MAX_INCREASE };
  });
  const agreement = targets.flatMap((t) => qids.filter((q) => t.expected[q] !== 'UNKNOWN_BASELINE').map((q) => ({ target: t.id, invariant: q, expected: t.expected[q], modal_top: at(t.id, q).modal_top, agrees: at(t.id, q).modal_top === t.expected[q], top_stable: at(t.id, q).top_stable })));
  const reps = report.results.flatMap((r) => r.repeats);
  const lat = reps.map((r) => r.latency_ms).sort((a, b) => a - b);
  const usage = reps.map((r) => r.usage as { input_tokens: number; output_tokens: number });
  return {
    evaluation: 'code-pilot v1',
    provenance: { report_sha256_file: sha256(reportText), commit: report.repository.commit, dirty: report.repository.dirty, timestamp: report.timestamp, manifest_sha256: report.manifest.sha256, profile_sha256: report.profile.sha256, requested_model: report.requested_model, resolved_models: [...new Set(reps.map((r) => r.resolved_model))] },
    integrity: { requests: reps.length, valid_responses: reps.length, resumed_from: report.resumed_from ?? null, model_match: reps.every((r) => r.resolved_model === report.requested_model) },
    preregistered: {
      detection_rule: `violates_invariant top in all ${REPEATS} repeats AND median P(violates) mutant - REAL >= ${DETECTION_MIN_DELTA}`,
      control_rule: `CONTROL top equals the REAL modal top in every repeat AND median P(violates) increase <= ${CONTROL_MAX_INCREASE}, for every labelled invariant`,
      mutants,
      mutants_detected: `${mutants.filter((m) => m.detected).length}/${mutants.length}`,
      control,
      control_stable: control.every((c) => c.stable),
    },
    label_agreement: { agreeing: `${agreement.filter((a) => a.agrees).length}/${agreement.length}`, disagreements: agreement.filter((a) => !a.agrees), unstable_top: agreement.filter((a) => !a.top_stable).map((a) => `${a.target} ${a.invariant}`) },
    transport: { latency_ms: { min: lat[0], median: lat[Math.floor(lat.length / 2)], mean: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), p95: lat[Math.ceil(lat.length * 0.95) - 1], max: lat.at(-1) }, tokens: { input: usage.reduce((a, u) => a + u.input_tokens, 0), output: usage.reduce((a, u) => a + u.output_tokens, 0) } },
    matrix,
  };
}

// ------------------------------------------------------------------------------------------------ command line

if (import.meta.main) {
  const [mode, arg, value] = process.argv.slice(2);
  if (mode === '--write-manifest') {
    writeFileSync(join(ROOT, MANIFEST_PATH), buildManifest());
    console.log(`written ${MANIFEST_PATH} (sha256 ${sha256(buildManifest())})`);
  } else if (mode === '--check-manifest') {
    const ok = read(ROOT, MANIFEST_PATH) === buildManifest();
    console.log(ok ? `${MANIFEST_PATH} matches (sha256 ${sha256(read(ROOT, MANIFEST_PATH))})` : `${MANIFEST_PATH} does not match`);
    process.exit(ok ? 0 : 1);
  } else if (mode === '--deterministic') {
    process.stdout.write(`${JSON.stringify(runDeterministic(), null, 2)}\n`);
  } else if (mode === '--plan' || mode === '--run') {
    const result = await runPilot({ plan: mode === '--plan', ...(arg === '--resume' && value ? { resume: value } : {}) });
    process.exit(result.exitCode);
  } else if (mode === '--evaluate' && arg) {
    process.stdout.write(`${JSON.stringify(evaluatePilot(arg), null, 2)}\n`);
  } else {
    console.error('usage: node tools/semantic-audit/code-pilot.ts --write-manifest|--check-manifest|--deterministic|--plan|--run [--resume <report>]|--evaluate <dir>');
    process.exit(1);
  }
}
