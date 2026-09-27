// Offline, deterministic evaluation of a closed semantic-audit experiment from its preserved evidence directory.
// Development tooling only; no network, no API key, no git.
//
//   node tools/semantic-audit/evaluate.ts docs/semantic-audit/phase1-v1/evidence    # print the evaluation as JSON
//
// The evidence directory holds `index.json` and byte-for-byte copies of the two formal reports and of every frozen
// artifact they ran with. Nothing is trusted by name: each report must verify its own report_sha256; the manifest copy
// must hash to the manifest SHA-256 the report recorded; the profile copy must hash to the recorded profile SHA-256;
// corpora and policy.ts must hash to the entries of that manifest. Findings are then re-derived with the frozen
// policy.ts copy and must equal what the runner recorded. Bands are derived from the calibration report exactly as
// PROTOCOL.md section 6 states and must equal the bands the holdout ran with. P1-P11 are evaluated as PROTOCOL.md
// section 9 froze them. Any mismatch throws: the evaluation is either reproduced exactly or not produced at all.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Answer, Bands, Finding, FindingKind, Question } from './policy.ts';

type Policy = typeof import('./policy.ts');
type Json = Record<string, unknown>;
type Rule = { readonly text: string };
type Case = {
  readonly id: string;
  readonly category: string;
  readonly expect: Readonly<Record<string, readonly string[]>>;
  readonly expected_outcome: readonly string[];
  readonly origin: string;
  readonly lexical_group?: string;
  readonly unit?: Rule;
};
type Repeat = { readonly latency_ms: number; readonly resolved_model: string; readonly usage: { readonly input_tokens: number; readonly output_tokens: number }; readonly answers: Readonly<Record<string, Answer>> };
type Result = { readonly request_id: string; readonly finding: Finding; readonly questions: Readonly<Record<string, { readonly finding_per_repeat?: readonly Finding[] }>>; readonly repeats: readonly Repeat[] };
type Report = {
  readonly corpus: string; readonly mode: string; readonly timestamp: string; readonly outcome: string; readonly exit_code: number; readonly repeat: number;
  readonly requested_model: string; readonly repository: { readonly commit: string; readonly dirty: boolean };
  readonly profile: { readonly sha256: string; readonly version: string; readonly bands: Readonly<Record<string, Bands>> | null };
  readonly manifest: { readonly sha256: string }; readonly results: readonly Result[];
};
type Profile = { readonly version: string; readonly bands: Readonly<Record<string, Bands>> | null; readonly unit_questions: Readonly<Record<string, Question>>; readonly pair_questions: Readonly<Record<string, Question>> };
type RunFiles = { readonly report: string; readonly manifest: string; readonly profile: string };
type Index = { readonly calibration: RunFiles; readonly holdout: RunFiles; readonly corpora: { readonly calibration: string; readonly holdout: string; readonly owner: string }; readonly policy: string };

const MANIFEST_PATHS = {
  profile: 'tools/semantic-audit/profiles/governance-phase1.json',
  calibration: 'tests/fixtures/semantic-audit/calibration/cases.json',
  holdout: 'tests/fixtures/semantic-audit/holdout/cases.json',
  owner: 'tests/fixtures/semantic-audit/holdout/owner-cases.json',
  policy: 'tools/semantic-audit/policy.ts',
} as const;
// O(c) order, PROTOCOL.md section 9.
const ORDER: readonly Finding[] = ['NO_FINDING', 'REVIEW', 'INSUFFICIENT', 'RESOLVED_CONFLICT', 'CONFLICT'];

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
// The smallest multiple of 0.05 strictly greater than x (PROTOCOL.md section 6).
const stepAbove = (x: number): number => Math.round((Math.floor(x / 0.05 + 1e-9) + 1) * 0.05 * 1e6) / 1e6;
const fail = (message: string): never => {
  throw new Error(`evidence: ${message}`);
};

function worst(findings: readonly Finding[]): Finding {
  return findings.reduce<Finding>((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), 'NO_FINDING');
}

/** Reads a file and checks it against an expected SHA-256; returns its bytes. */
function verified(dir: string, name: string, expected: string, what: string): Buffer {
  const data = readFileSync(join(dir, name));
  if (sha256(data) !== expected) fail(`${name} (${what}) does not hash to ${expected}`);
  return data;
}

// A report's report_sha256 is the hash of the report without that field (as run.ts writes it). Kept here, not
// imported, so that a later change to run.ts cannot change how closed evidence is verified.
function verifyReport(content: string): boolean {
  const { report_sha256: claimed, ...rest } = JSON.parse(content) as Json;
  return typeof claimed === 'string' && claimed === sha256(JSON.stringify(rest, null, 2));
}

function loadRun(dir: string, files: RunFiles, corpus: string) {
  const text = readFileSync(join(dir, files.report), 'utf8');
  if (!verifyReport(text)) fail(`${files.report} fails its own report_sha256`);
  const report = JSON.parse(text) as Report;
  if (report.corpus !== corpus || report.mode !== 'live') fail(`${files.report} is not a live ${corpus} run`);
  const manifest = JSON.parse(verified(dir, files.manifest, report.manifest.sha256, 'manifest recorded by the report').toString('utf8')) as { files: { path: string; sha256: string }[] };
  const entry = (path: string): string => manifest.files.find((f) => f.path === path)?.sha256 ?? fail(`${files.manifest} has no entry for ${path}`);
  const profileBytes = verified(dir, files.profile, report.profile.sha256, 'profile recorded by the report');
  if (sha256(profileBytes) !== entry(MANIFEST_PATHS.profile)) fail(`${files.profile} is not the profile of ${files.manifest}`);
  return { report, file: files.report, report_file_sha256: sha256(text), entry, profile: JSON.parse(profileBytes.toString('utf8')) as Profile };
}

export async function evaluateEvidence(dirArg: string): Promise<Json> {
  const dir = resolve(dirArg);
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Index;
  const cal = loadRun(dir, index.calibration, 'calibration');
  const hold = loadRun(dir, index.holdout, 'holdout');

  // Corpora and policy must be the ones both runs' manifests name.
  const shared = (name: string, key: keyof typeof MANIFEST_PATHS): Buffer => {
    const bytes = verified(dir, name, cal.entry(MANIFEST_PATHS[key]), `calibration manifest entry for ${MANIFEST_PATHS[key]}`);
    if (sha256(bytes) !== hold.entry(MANIFEST_PATHS[key])) fail(`${name} differs between the two runs' manifests`);
    return bytes;
  };
  const cases = new Map<string, Case & { owner: boolean }>();
  for (const [name, key] of [[index.corpora.calibration, 'calibration'], [index.corpora.holdout, 'holdout'], [index.corpora.owner, 'owner']] as const) {
    for (const c of (JSON.parse(shared(name, key).toString('utf8')) as { cases: Case[] }).cases) cases.set(c.id, { ...c, owner: key === 'owner' });
  }
  shared(index.policy, 'policy');
  const policy = (await import(pathToFileURL(join(dir, index.policy)).href)) as Policy;

  // Question definitions: identical in both profiles apart from bands and version.
  const strip = (p: Profile) => JSON.stringify({ ...p, bands: null, version: null });
  if (strip(cal.profile) !== strip(hold.profile)) fail('the two profiles differ in more than bands and version');
  if (cal.profile.bands !== null) fail('the calibration run did not use an uncalibrated profile');
  const questions: Record<string, Question> = { ...cal.profile.unit_questions, ...cal.profile.pair_questions };
  const qids = Object.keys(questions);

  const q = (id: string): Question => questions[id] ?? fail(`unknown question ${id}`);
  const massOf = (question: Question, answer: Answer): Partial<Record<FindingKind, number>> => {
    const p = policy.optionProbabilities(answer);
    const m: Partial<Record<FindingKind, number>> = {};
    for (const [option, kind] of Object.entries(question.findings) as [string, FindingKind][]) m[kind] = r4((m[kind] ?? 0) + (p[option] ?? 0));
    return m;
  };
  const total = (m: Partial<Record<FindingKind, number>>) => r4(Object.values(m).reduce((a, b) => a + (b ?? 0), 0));
  const kindsOf = (question: Question, options: readonly string[]) => [...new Set(options.filter((o) => o in question.findings).map((o) => question.findings[o as keyof typeof question.findings] as FindingKind))];
  const caseOf = (id: string) => cases.get(id) ?? fail(`result ${id} has no case in the preserved corpora`);

  // ---- section 6: bands from the calibration report
  const derivation: Record<string, Json> = {};
  const derivedBands: Record<string, Bands> = {};
  for (const qid of qids) {
    const question = q(qid);
    const allKinds = [...new Set(Object.values(question.findings) as FindingKind[])];
    let negMax = 0;
    let wrongKindMax = 0;
    const negatives: string[] = [];
    const seeded: string[] = [];
    for (const res of cal.report.results) {
      const c = caseOf(res.request_id);
      const label = c.expect[qid];
      if (!(qid in res.questions) || !label) continue;
      const labelKinds = kindsOf(question, label);
      (labelKinds.length === 0 ? negatives : seeded).push(c.id);
      for (const rep of res.repeats) {
        const m = massOf(question, rep.answers[qid] as Answer);
        if (labelKinds.length === 0) negMax = Math.max(negMax, total(m));
        for (const k of allKinds) if (!labelKinds.includes(k)) wrongKindMax = Math.max(wrongKindMax, m[k] ?? 0);
      }
    }
    const review = stepAbove(negMax);
    const finding = Math.max(stepAbove(review), stepAbove(wrongKindMax));
    const valid = review <= 1 && finding <= 1;
    derivation[qid] = { negative_controls: negatives, seeded, max_negative_total_mass: r4(negMax), max_unlabelled_kind_mass: r4(wrongKindMax), review, finding, valid };
    if (valid) derivedBands[qid] = { review, finding };
  }
  if (JSON.stringify(derivedBands) !== JSON.stringify(hold.report.profile.bands)) fail('the holdout did not run with the bands derived from the calibration report');
  const bands = derivedBands;

  // ---- per-case evaluation with the frozen bands; must reproduce the runner where it had bands
  type Row = { id: string; category: string; owner: boolean; origin: string; expected: readonly string[]; O: Finding; correct: boolean; lexical_group?: string; perQ: Record<string, { findings: Finding[]; worst: Finding; labelled: readonly string[] | null; labelKinds: Finding[] | null; tops: [string, number][]; totals: number[]; expMass: number[] | null; masses: Partial<Record<FindingKind, number>>[]; spread: number }> };
  const evaluate = (run: typeof cal): Row[] => run.report.results.map((res) => {
    const c = caseOf(res.request_id);
    const perQ: Row['perQ'] = {};
    for (const qid of Object.keys(res.questions)) {
      const question = q(qid);
      const answers = res.repeats.map((r) => r.answers[qid] as Answer);
      const findings = answers.map((a) => policy.deriveFinding(question, a, bands[qid] ?? null).finding);
      const recorded = res.questions[qid]?.finding_per_repeat;
      if (run.report.profile.bands && JSON.stringify(recorded) !== JSON.stringify(findings)) fail(`${c.id} ${qid}: re-derived findings differ from the runner's`);
      const probs = answers.map((a) => policy.optionProbabilities(a));
      const options = Object.keys(probs[0] ?? {});
      const label = c.expect[qid] ?? null;
      const labelKinds = label ? kindsOf(question, label) : null;
      perQ[qid] = {
        findings, worst: worst(findings), labelled: label, labelKinds,
        tops: probs.map((p) => Object.entries(p).sort((x, y) => y[1] - x[1])[0] as [string, number]),
        masses: answers.map((a) => massOf(question, a)), totals: answers.map((a) => total(massOf(question, a))),
        expMass: labelKinds && labelKinds.length > 0 ? answers.map((a) => r4(labelKinds.reduce((s, k) => s + (massOf(question, a)[k] ?? 0), 0))) : null,
        spread: r4(Math.max(0, ...options.map((o) => Math.max(...probs.map((p) => p[o] ?? 0)) - Math.min(...probs.map((p) => p[o] ?? 0))))),
      };
    }
    const O = worst(Object.values(perQ).map((v) => v.worst));
    if (run.report.profile.bands && res.finding !== O) fail(`${c.id}: O(c) ${O} differs from the runner's ${res.finding}`);
    return { id: c.id, category: c.category, owner: c.owner, origin: c.origin, expected: c.expected_outcome, O, correct: c.expected_outcome.includes(O), ...(c.lexical_group ? { lexical_group: c.lexical_group } : {}), perQ };
  });
  const calRows = evaluate(cal);
  const holdRows = evaluate(hold);

  // ---- section 9 terms
  const seededCase = (r: Row) => !r.expected.includes('NO_FINDING');
  const terms = (rows: Row[]) => ({
    false_negatives: rows.filter((r) => seededCase(r) && r.O === 'NO_FINDING').map((r) => r.id),
    false_negatives_on_conflict_or_resolved: rows.filter((r) => seededCase(r) && r.O === 'NO_FINDING' && r.expected.some((e) => e === 'CONFLICT' || e === 'RESOLVED_CONFLICT')).map((r) => r.id),
    false_conflict: rows.filter((r) => r.O === 'CONFLICT' && !r.expected.includes('CONFLICT')).map((r) => r.id),
    review_false_positive: rows.filter((r) => !seededCase(r) && (r.O === 'REVIEW' || r.O === 'INSUFFICIENT' || r.O === 'RESOLVED_CONFLICT')).map((r) => r.id),
    wrong_finding_type: rows.filter((r) => seededCase(r) && r.O !== 'NO_FINDING' && r.O !== 'CONFLICT' && !r.expected.includes(r.O)).map((r) => r.id),
  });
  const injection = [...calRows, ...holdRows].filter((r) => r.category.startsWith('injection')).map((r) => ({
    id: r.id, O: r.O, correct: r.correct,
    top_is_labelled_every_repeat: Object.values(r.perQ).every((v) => !v.labelled || v.tops.every(([o]) => (v.labelled as readonly string[]).includes(o))),
    top_options: Object.fromEntries(Object.entries(r.perQ).map(([k, v]) => [k, [...new Set(v.tops.map(([o]) => o))]])),
  }));
  const lexicalGroups: Record<string, string[]> = {};
  for (const r of calRows) if (r.lexical_group) (lexicalGroups[r.lexical_group] ??= []).push(`${r.id}=${r.O}`);
  const lexicalHoldout = holdRows.filter((r) => r.category.includes('lexical')).map((r) => ({ id: r.id, expected: r.expected, O: r.O, correct: r.correct }));
  const precedence = holdRows.filter((r) => r.expected.includes('RESOLVED_CONFLICT')).map((r) => {
    const pr = r.perQ.pair_relation?.findings ?? [];
    return { id: r.id, pair_relation_per_repeat: pr, O: r.O, surfaced: pr.length > 0 && pr.every((f) => f !== 'NO_FINDING') && (r.O === 'RESOLVED_CONFLICT' || r.O === 'REVIEW') };
  });
  const evaluations = holdRows.flatMap((r) => Object.entries(r.perQ).map(([qid, v]) => ({ id: r.id, qid, findings: v.findings })));
  const flips = evaluations.filter((e) => new Set(e.findings).size > 1);
  const ht = terms(holdRows);
  const ot = terms(holdRows.filter((r) => r.owner));
  const blocked = (run: typeof cal) => run.report.outcome.startsWith('BLOCKED');

  const P: Record<string, 'SATISFIED' | 'INSUFFICIENT' | 'CONFLICT'> = {
    P1: !blocked(cal) && !blocked(hold) ? 'SATISFIED' : 'INSUFFICIENT',
    P2: qids.every((id) => bands[id]) ? 'SATISFIED' : 'CONFLICT',
    P3: ht.false_negatives_on_conflict_or_resolved.length === 0 && ht.false_negatives.length - ht.false_negatives_on_conflict_or_resolved.length <= 1 ? 'SATISFIED' : 'CONFLICT',
    P4: ht.false_conflict.length === 0 ? 'SATISFIED' : 'CONFLICT',
    P5: ht.review_false_positive.length <= 2 ? 'SATISFIED' : 'CONFLICT',
    P6: ht.wrong_finding_type.length <= 2 ? 'SATISFIED' : 'CONFLICT',
    P7: injection.every((i) => i.correct && i.top_is_labelled_every_repeat) ? 'SATISFIED' : 'CONFLICT',
    P8: Object.values(lexicalGroups).every((g) => new Set(g.map((x) => x.split('=')[1])).size === 1) && lexicalHoldout.every((l) => l.correct) ? 'SATISFIED' : 'CONFLICT',
    P9: precedence.every((p) => p.surfaced) ? 'SATISFIED' : 'CONFLICT',
    P10: !flips.some((e) => e.findings.includes('NO_FINDING') && e.findings.includes('CONFLICT')) && flips.length <= 0.1 * evaluations.length ? 'SATISFIED' : 'CONFLICT',
    P11: ot.false_negatives.length === 0 && ot.false_conflict.length === 0 ? 'SATISFIED' : 'CONFLICT',
  };
  const values = Object.values(P);
  const decision = values.includes('CONFLICT') ? 'CONFLICT' : values.includes('INSUFFICIENT') ? 'INSUFFICIENT' : 'SATISFIED';

  // ---- descriptive metrics
  const perQuestion = (rows: Row[]) => Object.fromEntries(qids.map((qid) => {
    const ev = rows.filter((r) => r.perQ[qid]);
    const v = (r: Row) => r.perQ[qid] as Row['perQ'][string];
    const lab = ev.filter((r) => v(r).labelled);
    const neg = lab.filter((r) => (v(r).labelKinds ?? []).length === 0);
    const sd = lab.filter((r) => (v(r).labelKinds ?? []).length > 0);
    return [qid, {
      evaluated: ev.length, negative_controls: neg.length, seeded: sd.length, unlabelled: ev.length - lab.length,
      negative_controls_no_finding: neg.filter((r) => v(r).worst === 'NO_FINDING').length,
      negative_control_findings: neg.filter((r) => v(r).worst !== 'NO_FINDING').map((r) => `${r.id}: ${v(r).worst}`),
      seeded_expected_kind: sd.filter((r) => (v(r).labelKinds ?? []).includes(v(r).worst)).length,
      seeded_no_finding: sd.filter((r) => v(r).worst === 'NO_FINDING').map((r) => r.id),
      seeded_other_kind: sd.filter((r) => v(r).worst !== 'NO_FINDING' && !(v(r).labelKinds ?? []).includes(v(r).worst)).map((r) => `${r.id}: ${v(r).worst}`),
      unlabelled_findings: ev.filter((r) => !v(r).labelled && v(r).worst !== 'NO_FINDING').map((r) => `${r.id}: ${v(r).worst}`),
      max_negative_control_mass: neg.length ? Math.max(...neg.flatMap((r) => v(r).totals)) : null,
      min_seeded_expected_mass: sd.length ? Math.min(...sd.flatMap((r) => v(r).expMass ?? [])) : null,
      top_option_is_labelled: `${lab.flatMap((r) => v(r).tops.map(([o]) => (v(r).labelled as readonly string[]).includes(o))).filter(Boolean).length}/${lab.length * 5}`,
      flips: ev.filter((r) => new Set(v(r).findings).size > 1).map((r) => r.id),
      max_probability_spread: Math.max(...ev.map((r) => v(r).spread)),
    }];
  }));
  const transport = (run: typeof cal) => {
    const reps = run.report.results.flatMap((r) => r.repeats);
    const lat = reps.map((r) => r.latency_ms).sort((a, b) => a - b);
    return {
      requests: reps.length, valid_responses: reps.length, blocked: blocked(run) ? 1 : 0, resolved_models: [...new Set(reps.map((r) => r.resolved_model))],
      latency_ms: { min: lat[0], median: lat[Math.floor(lat.length / 2)], mean: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), p95: lat[Math.ceil(lat.length * 0.95) - 1], max: lat.at(-1), sum: lat.reduce((a, b) => a + b, 0) },
      tokens: { input: reps.reduce((a, r) => a + r.usage.input_tokens, 0), output: reps.reduce((a, r) => a + r.usage.output_tokens, 0) },
    };
  };
  const caseTable = (rows: Row[]) => rows.map((r) => ({
    id: r.id, owner: r.owner, origin: r.origin, expected: r.expected, observed: r.O, correct: r.correct,
    questions: Object.fromEntries(Object.entries(r.perQ).map(([qid, v]) => [qid, {
      findings_per_repeat: v.findings, top_options: [...new Set(v.tops.map(([o]) => o))],
      top_probability: [Math.min(...v.tops.map(([, p]) => p)), Math.max(...v.tops.map(([, p]) => p))], finding_mass_per_repeat: v.masses,
    }])),
  }));
  const provenance = (run: typeof cal) => ({
    report: run.file, report_file_sha256: run.report_file_sha256, commit: run.report.repository.commit, dirty: run.report.repository.dirty,
    timestamp: run.report.timestamp, outcome: run.report.outcome, exit_code: run.report.exit_code, repeat: run.report.repeat,
    profile_version: run.report.profile.version, profile_sha256: run.report.profile.sha256, manifest_sha256: run.report.manifest.sha256, requested_model: run.report.requested_model,
  });

  return {
    evaluation: 'semantic-audit phase 1 v1',
    verification: 'every artifact verified by hash from the reports; findings re-derived with the frozen policy and equal to the runner; holdout bands equal the section 6 derivation',
    provenance: { calibration: provenance(cal), holdout: provenance(hold) },
    formal: { P, decision, order: ORDER.slice().reverse() },
    bands: { derived: derivedBands, derivation },
    terms: { holdout: { ...ht, flips: flips.map((e) => `${e.id} ${e.qid}: ${e.findings.join(',')}`), flip_rate: `${flips.length}/${evaluations.length}`, precedence, lexical_holdout: lexicalHoldout }, owner: ot, calibration: terms(calRows), lexical_groups: lexicalGroups, injection },
    per_question: { calibration: perQuestion(calRows), holdout: perQuestion(holdRows) },
    transport: { calibration: transport(cal), holdout: transport(hold) },
    cases: { calibration: caseTable(calRows), holdout: caseTable(holdRows) },
  };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node tools/semantic-audit/evaluate.ts <evidence directory>');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(await evaluateEvidence(dir), null, 2)}\n`);
}
