import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { extractUnits, hasOpenMarker, parseMarkdownUnits, ROOT, sha256, SOURCES_PATH, tagsFor } from '../../tools/semantic-audit/extract-governance.ts';
import { buildManifest, MANIFEST_PATH, POLICY_FILES } from '../../tools/semantic-audit/manifest.ts';
import {
  Blocked,
  deriveFinding,
  EXIT,
  exitCodeFor,
  validateProfile,
  validateResponse,
  type Question,
} from '../../tools/semantic-audit/policy.ts';
import {
  API_URL,
  buildRequests,
  CORPUS_PATHS,
  OWNER_HOLDOUT_MINIMUM,
  OWNER_HOLDOUT_PATH,
  parseArgs,
  preflight,
  PROFILE_PATH,
  resolveApiKey,
  runAudit,
  send,
  verifyReport,
  type FetchLike,
  type Git,
} from '../../tools/semantic-audit/run.ts';

// Offline tests of the semantic-audit tooling. No test makes a network request: every fetch is injected, and no test
// reads the real .env.semantic-audit (runs either pass the key in `env` or use a temporary root without the file).

const KEY = 'test-key-not-a-real-credential-0001';
const PROFILE = validateProfile(JSON.parse(readFileSync(join(ROOT, PROFILE_PATH), 'utf8')));
const CLEAN_GIT: Git = { head: () => 'f'.repeat(40), dirty: () => false, notCleanAndTracked: () => [] };

const choice = (options: Record<string, string>, findings: Record<string, 'CONFLICT' | 'INSUFFICIENT' | 'REVIEW'>): Question => ({
  type: 'choice',
  instructions: 'x',
  criteria: options,
  findings,
});
const RELATION = PROFILE.pair_questions.pair_relation as Question;

/** A valid answer set for the given questions, putting `mass` on `pick(question)` and the rest on another option. */
function answersFor(questions: Readonly<Record<string, Question>>, pick: (id: string, q: Question) => string | undefined = () => undefined, mass = 0.9) {
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    const options = q.type === 'noul' ? ['true', 'false'] : Object.keys(q.criteria);
    const chosen = pick(id, q) ?? options.find((o) => !(o in q.findings)) as string;
    if (q.type === 'noul') answers[id] = { type: 'noul', noul: chosen === 'true' ? mass : 1 - mass };
    else {
      const other = options.find((o) => o !== chosen) as string;
      const probabilities = Object.fromEntries(options.map((o) => [o, o === chosen ? mass : o === other ? 1 - mass : 0]));
      answers[id] = { type: 'choice', choice: chosen, probabilities, confidence: 0.8 };
    }
  }
  return answers;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake API: answers exactly the questions of each request unless `mutate` changes the body. */
function fakeApi(options: { model?: string; pick?: (id: string, q: Question) => string | undefined; mass?: number; mutate?: (body: Record<string, unknown>) => void } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const request = JSON.parse(String(init.body)) as { model: string; questions: Record<string, { type: string; criteria: Record<string, string> }> };
    const questions = Object.fromEntries(Object.keys(request.questions).map((id) => [id, { ...PROFILE.unit_questions[id], ...PROFILE.pair_questions[id] } as Question]));
    const body: Record<string, unknown> = { model: options.model ?? request.model, answers: answersFor(questions, options.pick, options.mass), usage: { input_tokens: 100, output_tokens: 5 } };
    options.mutate?.(body);
    return jsonResponse(body);
  };
  return { calls, fetchImpl };
}

/** A temporary copy of everything the runner reads, with an optional change applied and the manifest regenerated. */
function tempRoot(change?: (root: string) => void, options: { regenerateManifest?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'semantic-audit-'));
  for (const path of [...POLICY_FILES, MANIFEST_PATH, 'AGENTS.md', 'CLAUDE.md']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(ROOT, path), join(root, path));
  }
  change?.(root);
  if (options.regenerateManifest ?? true) writeFileSync(join(root, MANIFEST_PATH), buildManifest(root));
  return root;
}

function editJson(root: string, path: string, edit: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
  edit(value);
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

/** A temporary root whose owner holdout file holds the required number of (test-only) owner cases. */
function readyRoot(change?: (root: string) => void): string {
  return tempRoot((root) => {
    editJson(root, OWNER_HOLDOUT_PATH, (file) => {
      file.cases = Array.from({ length: OWNER_HOLDOUT_MINIMUM }, (_, i) => ({
        id: `owner-test-${i + 1}`,
        category: 'test',
        kind: 'unit',
        unit: { document: 'synthetic governance document', section: 'Test', authority: { rank: 4, label: 'test authority' }, text: `Owner test rule number ${i + 1} forbids pushing on Sundays.` },
        expect: {},
        expected_outcome: ['NO_FINDING'],
        origin: 'synthetic',
        dimension: 'test',
        rationale: 'test fixture',
      }));
    });
    change?.(root);
  });
}

/** Test bands for every question of a profile (values are arbitrary, not calibrated). */
function perQuestionBands(profile: Record<string, any>): Record<string, { review: number; finding: number }> {
  return Object.fromEntries([...Object.keys(profile.unit_questions), ...Object.keys(profile.pair_questions)].map((id) => [id, { review: 0.3, finding: 0.7 }]));
}

const quiet = () => {};
const outDir = () => mkdtempSync(join(tmpdir(), 'semantic-audit-out-'));

// ------------------------------------------------------------------------------------------------ manifest

test('the semantic-audit policy files match their committed SHA-256 manifest', () => {
  assert.equal(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8'), buildManifest());
});

// ------------------------------------------------------------------------------------------------ credentials

test('credentials: a non-empty key in the environment wins and the file is not needed', () => {
  const root = tempRoot();
  writeFileSync(join(root, '.env.semantic-audit'), 'TYPESAFE_API_KEY=from-file-0000\n');
  assert.equal(resolveApiKey({ TYPESAFE_API_KEY: KEY }, root), KEY);
});

test('credentials: an unset or empty environment value falls back to the local file, without changing the environment', () => {
  const root = tempRoot();
  writeFileSync(join(root, '.env.semantic-audit'), '# comment\nOTHER=1\nTYPESAFE_API_KEY=from-file-0000\n');
  const env: Record<string, string | undefined> = { TYPESAFE_API_KEY: '' };
  assert.equal(resolveApiKey(env, root), 'from-file-0000');
  assert.equal(resolveApiKey({}, root), 'from-file-0000');
  assert.deepEqual(env, { TYPESAFE_API_KEY: '' });
});

test('credentials: no key anywhere, or an empty template value, is no key', () => {
  const root = tempRoot();
  assert.equal(resolveApiKey({}, root), undefined);
  writeFileSync(join(root, '.env.semantic-audit'), 'TYPESAFE_API_KEY=\n');
  assert.equal(resolveApiKey({ TYPESAFE_API_KEY: '   ' }, root), undefined);
});

test('credentials: a malformed key is refused without echoing it', () => {
  const secret = 'abc def-secret-part';
  assert.throws(() => resolveApiKey({ TYPESAFE_API_KEY: secret }, tempRoot()), (error: unknown) => {
    assert.ok(error instanceof Blocked);
    assert.equal(error.status, 'BLOCKED_PROVIDER_OR_MODEL');
    assert.ok(!error.message.includes('secret-part'));
    return true;
  });
});

test('credentials: the local key file is git-ignored and only the template is trackable', () => {
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '.env.semantic-audit'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(ignored, '.env.semantic-audit');
  assert.throws(() => execFileSync('git', ['check-ignore', '--no-index', '.env.semantic-audit.example'], { cwd: ROOT, stdio: 'ignore' }));
  const template = readFileSync(join(ROOT, '.env.semantic-audit.example'), 'utf8');
  assert.match(template, /^TYPESAFE_API_KEY=$/m);
  assert.ok(!/TYPESAFE_API_KEY=\S/.test(template));
});

test('command line: there is no key option and no way to skip the preflight', () => {
  assert.equal(parseArgs(['--corpus', 'calibration', '--api-key', KEY]), undefined);
  assert.equal(parseArgs(['--corpus', 'calibration', '--skip-preflight']), undefined);
  assert.equal(parseArgs(['--corpus', 'nope']), undefined);
  assert.equal(parseArgs([]), undefined);
  assert.deepEqual(parseArgs(['--corpus', 'holdout', '--repeat', '5', '--case', 'a,b']), { corpus: 'holdout', plan: false, repeat: 5, caseIds: ['a', 'b'] });
});

// ------------------------------------------------------------------------------------------------ extraction

test('extraction: lead-ins, ordered lists, sub-labels, fences, frontmatter and import lines', () => {
  const units = parseMarkdownUnits([
    '---', 'title: x', '---', '# Title', '@AGENTS.md', '', 'Intro paragraph.', '', '## 3. Rules', '', 'Before acting:', '',
    '- check one;', '- check two', '  continued.', '', 'Apply this order:', '', '1. First.', '2. Second.', '', '```', 'code: ignored', '```', '',
    '**Sub**', '- item', '', '## Maxim', '', '**Bold statement.**',
  ].join('\n'));
  assert.deepEqual(units.map((u) => [u.sectionKey, u.text]), [
    ['preamble', 'Intro paragraph.'],
    ['3', 'Before acting:\n- check one;'],
    ['3', 'Before acting:\n- check two continued.'],
    ['3', 'Apply this order:\n1. First.\n2. Second.'],
    ['3-sub', '- item'],
    ['maxim', '**Bold statement.**'],
  ]);
});

test('extraction: the repository units are deterministic, unique, hashed and only from allowlisted documents', () => {
  const first = extractUnits();
  const second = extractUnits();
  assert.deepEqual(first, second);
  const ids = first.units.map((u) => u.rule_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const unit of first.units) {
    assert.equal(unit.text_sha256, sha256(unit.text));
    assert.ok(['AGENTS.md', 'CLAUDE.md'].includes(unit.document), unit.document);
  }
  const precedence = first.units.find((u) => u.rule_id === 'AGENTS.md#1.1');
  assert.match(precedence?.text ?? '', /^When instructions conflict, apply this order:\n1\. /);
  assert.ok(first.pairs.length > 0);
});

test('extraction: CLAUDE.md delegates to AGENTS.md, so its units are audited but never paired with AGENTS.md', () => {
  const { units, pairs } = extractUnits();
  assert.ok(units.some((u) => u.document === 'CLAUDE.md'));
  const documentOf = new Map(units.map((u) => [u.rule_id, u.document]));
  for (const pair of pairs) {
    const documents = new Set([documentOf.get(pair.a), documentOf.get(pair.b)]);
    assert.ok(!(documents.has('CLAUDE.md') && documents.has('AGENTS.md')), `${pair.a} | ${pair.b}`);
  }
  // As an independent source it would be paired: the exclusion comes from the owner's classification, not from tags.
  const root = tempRoot((r) => editJson(r, SOURCES_PATH, (file: any) => { file.audited[1].role = { kind: 'independent' }; }));
  assert.ok(extractUnits(root).pairs.some((p) => p.a.startsWith('AGENTS.md#') && p.b.startsWith('CLAUDE.md#')));
});

test('extraction: a delegating source that changed since the owner classified it blocks until reclassified', () => {
  const root = tempRoot((r) => writeFileSync(join(r, 'CLAUDE.md'), `${readFileSync(join(r, 'CLAUDE.md'), 'utf8')}\nAlways push after every commit.\n`));
  assert.throws(() => extractUnits(root), (e: unknown) => e instanceof Blocked && e.status === 'BLOCKED_PROFILE_OR_RESPONSE_INVALID' && /reclassify/.test(e.message));
});

test('extraction: OPEN is a marker only as the capitalised decision state', () => {
  assert.equal(hasOpenMarker('a free/open-source hub'), false);
  assert.equal(tagsFor('a free/open-source hub').includes('decision-state'), false);
  assert.equal(hasOpenMarker('the real limit is an OPEN decision'), true);
  assert.equal(hasOpenMarker('this limit is provisional'), true);
});

// ------------------------------------------------------------------------------------------------ corpora

test('corpora: labels name questions that are actually asked and options that exist; the sets do not overlap', () => {
  const texts = new Map<string, string>();
  for (const corpus of ['calibration', 'holdout'] as const) {
    const file = JSON.parse(readFileSync(join(ROOT, CORPUS_PATHS[corpus]), 'utf8')) as { cases: { id: string; origin: string; dimension: string; rationale: string }[] };
    const owner = corpus === 'holdout' ? (JSON.parse(readFileSync(join(ROOT, OWNER_HOLDOUT_PATH), 'utf8')) as { cases: unknown[] }).cases : [];
    const { requests } = buildRequests(corpus, PROFILE);
    assert.equal(requests.length, file.cases.length + owner.length);
    for (const c of file.cases) {
      assert.ok(['real', 'mutated', 'synthetic'].includes(c.origin), c.id);
      assert.ok(c.dimension && c.rationale, c.id);
    }
    for (const request of requests) {
      for (const [id, expected] of Object.entries(request.expect ?? {})) {
        const question = request.questions[id];
        assert.ok(question, `${request.request_id}: '${id}' is not asked`);
        const options = question.type === 'noul' ? ['true', 'false'] : Object.keys(question.criteria);
        for (const option of expected) assert.ok(options.includes(option), `${request.request_id}: unknown option '${option}'`);
        // PROTOCOL.md section 6: a label is all finding options or all non-finding options, never a mix.
        const mapped = expected.filter((option) => option in question.findings).length;
        assert.ok(mapped === 0 || mapped === expected.length, `${request.request_id}: '${id}' mixes finding and non-finding options`);
      }
      for (const outcome of request.expected_outcome ?? []) assert.ok(['NO_FINDING', 'REVIEW', 'INSUFFICIENT', 'RESOLVED_CONFLICT', 'CONFLICT'].includes(outcome));
    }
    for (const request of requests) {
      for (const subject of request.subjects) {
        const seen = texts.get(subject.text_sha256);
        assert.ok(seen === undefined || seen === corpus, `${request.request_id}: text also in ${seen}`);
        texts.set(subject.text_sha256, corpus);
      }
    }
  }
});

// ------------------------------------------------------------------------------------------------ preflight

test('preflight: every planned request of both corpora and the repository passes', () => {
  for (const corpus of ['calibration', 'holdout', 'repository'] as const) {
    const { requests, permitted } = buildRequests(corpus, PROFILE);
    for (const request of requests) assert.deepEqual(preflight(request.body, permitted, KEY), [], request.request_id);
  }
});

test('preflight: foreign text, secrets, local paths, the key itself and oversize bodies are blocked', () => {
  const { requests, permitted } = buildRequests('calibration', PROFILE);
  const body = requests[0]?.body as { state: { governance_unit: { text: string } } };
  const withText = (text: string) => {
    const allowed = new Set(permitted).add(text);
    return preflight({ ...body, state: { governance_unit: { ...body.state.governance_unit, text } } }, allowed, KEY);
  };
  assert.match(preflight({ ...body, extra: 'not allowlisted' }, permitted, KEY).join(), /not from an allowlisted source/);
  assert.match(withText('-----BEGIN RSA PRIVATE KEY-----').join(), /private key block/);
  assert.match(withText(`token ghp_${'a'.repeat(36)}`).join(), /GitHub token/);
  assert.match(withText('DB_PASSWORD = hunter2hunter2').join(), /assigned secret/);
  assert.match(withText('see /home/someone/private/notes.md').join(), /local absolute path/);
  assert.match(withText(`the key is ${KEY}`).join(), /contains the API key/);
  assert.match(withText('x'.repeat(70_000)).join(), /exceeds/);
});

// ------------------------------------------------------------------------------------------------ profile

test('profile: the Phase-1 profile is valid, pinned and uncalibrated', () => {
  assert.equal(PROFILE.model, 'jev-1.13.0');
  assert.equal(PROFILE.bands, null);
});

test('profile: a contradiction settled by precedence is surfaced, never a pass; an unresolved one is a CONFLICT', () => {
  assert.equal(RELATION.type, 'choice');
  assert.deepEqual(Object.keys(RELATION.criteria).sort(), ['conflict_resolved_by_precedence', 'insufficient_context', 'no_conflict', 'no_semantic_relation', 'unresolved_contradiction']);
  assert.deepEqual(RELATION.findings, { conflict_resolved_by_precedence: 'RESOLVED_CONFLICT', unresolved_contradiction: 'CONFLICT', insufficient_context: 'INSUFFICIENT' });
  const bands = { review: 0.3, finding: 0.7 };
  const outcome = (option: string) => {
    const probabilities = Object.fromEntries(Object.keys(RELATION.criteria).map((o) => [o, o === option ? 0.92 : 0.02]));
    return exitCodeFor([deriveFinding(RELATION, { type: 'choice', choice: option, probabilities, confidence: 0.9 }, bands).finding]);
  };
  assert.equal(outcome('no_conflict'), EXIT.NO_FINDING);
  assert.equal(outcome('no_semantic_relation'), EXIT.NO_FINDING);
  assert.equal(outcome('conflict_resolved_by_precedence'), EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(outcome('insufficient_context'), EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(outcome('unresolved_contradiction'), EXIT.GOVERNANCE_CONFLICT_OR_POLICY_FAIL);
});

test('profile: empty, aliased, unknown-typed or never-failing/never-passing profiles are invalid', () => {
  const base = JSON.parse(readFileSync(join(ROOT, PROFILE_PATH), 'utf8')) as Record<string, unknown>;
  const invalid = (edit: (p: Record<string, any>) => void) => {
    const copy = structuredClone(base) as Record<string, any>;
    edit(copy);
    assert.throws(() => validateProfile(copy), (e: unknown) => e instanceof Blocked && e.status === 'BLOCKED_PROFILE_OR_RESPONSE_INVALID');
  };
  invalid((p) => { p.unit_questions = {}; p.pair_questions = {}; });
  invalid((p) => { p.model = 'jev-latest'; });
  invalid((p) => { p.unit_questions.actionability.type = 'score'; });
  invalid((p) => { p.unit_questions.actionability.findings = {}; });
  invalid((p) => { p.unit_questions.actionability.findings = { made_up: 'CONFLICT' }; });
  invalid((p) => { p.pair_questions.pair_relation.findings = Object.fromEntries(Object.keys(p.pair_questions.pair_relation.criteria).map((o) => [o, 'REVIEW'])); });
  invalid((p) => { p.bands = { review: 0.3, finding: 0.7 }; }); // a global band is not accepted
  invalid((p) => { p.bands = perQuestionBands(p); delete p.bands.failure_behavior; });
  invalid((p) => { p.bands = { ...perQuestionBands(p), made_up: { review: 0.3, finding: 0.7 } }; });
  invalid((p) => { p.bands = perQuestionBands(p); p.bands.pair_relation = { review: 0.8, finding: 0.5 }; });
  invalid((p) => { p.threshold = 3.5; });
  invalid((p) => { p.unit_questions.actionability.findings.concrete_obligation = 'NO_FINDING'; });
});

test('profile: bands are stored per question, one pair for every question and no global band', () => {
  const base = JSON.parse(readFileSync(join(ROOT, PROFILE_PATH), 'utf8')) as Record<string, any>;
  const calibrated = validateProfile({ ...base, bands: perQuestionBands(base) });
  assert.deepEqual(Object.keys(calibrated.bands ?? {}).sort(), ['actionability', 'authority_presented', 'failure_behavior', 'pair_relation']);
});

// ------------------------------------------------------------------------------------------------ response

test('response: exactly the asked questions, typed as asked, from the requested model', () => {
  const questions = PROFILE.pair_questions;
  const ok = { model: 'jev-1.13.0', answers: answersFor(questions), usage: { input_tokens: 1, output_tokens: 1 } };
  assert.ok(validateResponse(ok, 'jev-1.13.0', questions));

  const blockedWith = (status: string, body: unknown) =>
    assert.throws(() => validateResponse(body, 'jev-1.13.0', questions), (e: unknown) => e instanceof Blocked && e.status === status);
  const invalid = (edit: (b: any) => void) => {
    const body = structuredClone(ok) as any;
    edit(body);
    blockedWith('BLOCKED_PROFILE_OR_RESPONSE_INVALID', body);
  };
  invalid((b) => { delete b.answers.pair_relation; });
  invalid((b) => { b.answers.surprise = b.answers.pair_relation; });
  invalid((b) => { b.answers.pair_relation.type = 'noul'; });
  invalid((b) => { b.answers.pair_relation.type = 'score'; });
  invalid((b) => { b.answers.pair_relation.choice = 'maybe'; });
  invalid((b) => { delete b.answers.pair_relation.probabilities.no_semantic_relation; });
  invalid((b) => { b.answers.pair_relation.probabilities.no_semantic_relation = 0.5; });
  invalid((b) => { b.answers.pair_relation.confidence = 2; });
  invalid((b) => { b.answers.pair_relation.note = 'extra'; });
  invalid((b) => { b.usage = {}; });
  invalid((b) => { b.extra = true; });
  blockedWith('BLOCKED_PROFILE_OR_RESPONSE_INVALID', null);
  blockedWith('BLOCKED_PROFILE_OR_RESPONSE_INVALID', []);
  blockedWith('BLOCKED_PROVIDER_OR_MODEL', { ...ok, model: 'jev-1.14.0' });

  const noul = { failure_behavior: PROFILE.unit_questions.failure_behavior as Question };
  assert.throws(() => validateResponse({ ...ok, answers: { failure_behavior: { type: 'noul', noul: 1.2 } } }, 'jev-1.13.0', noul), Blocked);
});

// ------------------------------------------------------------------------------------------------ findings

test('findings: without bands nothing is NO_FINDING; an empty run is not NO_FINDING', () => {
  const answer = answersFor({ pair_relation: RELATION })['pair_relation'] as any;
  assert.equal(deriveFinding(RELATION, answer, null).finding, 'UNCALIBRATED');
  assert.equal(exitCodeFor(['UNCALIBRATED']), EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(exitCodeFor([]), EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
  assert.equal(exitCodeFor(['NO_FINDING', 'NO_FINDING']), EXIT.NO_FINDING);
  assert.equal(exitCodeFor(['NO_FINDING', 'REVIEW']), EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(exitCodeFor(['INSUFFICIENT', 'CONFLICT']), EXIT.GOVERNANCE_CONFLICT_OR_POLICY_FAIL);
});

test('findings: probability mass on mapped options against the bands, the most severe kind first', () => {
  const bands = { review: 0.3, finding: 0.7 };
  const q = choice({ ok: 'a', odd: 'b', bad: 'c' }, { bad: 'CONFLICT', odd: 'REVIEW' });
  const with_ = (p: Record<string, number>) => deriveFinding(q, { type: 'choice', choice: 'ok', probabilities: p, confidence: 0.5 }, bands).finding;
  assert.equal(with_({ ok: 0.1, odd: 0.1, bad: 0.8 }), 'CONFLICT');
  assert.equal(with_({ ok: 0.5, odd: 0.1, bad: 0.4 }), 'REVIEW');
  assert.equal(with_({ ok: 0.2, odd: 0.75, bad: 0.05 }), 'REVIEW');
  assert.equal(with_({ ok: 0.8, odd: 0.1, bad: 0.1 }), 'NO_FINDING');
  // The finding does not depend on the reported top choice, only on the distribution.
  assert.equal(deriveFinding(q, { type: 'choice', choice: 'bad', probabilities: { ok: 0.9, odd: 0.05, bad: 0.05 }, confidence: 0.9 }, bands).finding, 'NO_FINDING');

  // Mass split over several finding options counts together for REVIEW, so it cannot add up to NO_FINDING.
  assert.equal(with_({ ok: 0.6, odd: 0.2, bad: 0.2 }), 'REVIEW');

  const noul: Question = { type: 'noul', instructions: 'x', criteria: { true: 'y', false: 'n' }, findings: { false: 'REVIEW' } };
  assert.equal(deriveFinding(noul, { type: 'noul', noul: 0.1 }, bands).finding, 'REVIEW');
  assert.equal(deriveFinding(noul, { type: 'noul', noul: 0.95 }, bands).finding, 'NO_FINDING');
});

// ------------------------------------------------------------------------------------------------ transport

test('transport: fixed URL, bearer header, no redirects; every HTTP or network failure blocks', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const ok: FetchLike = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ fine: true });
  };
  assert.deepEqual((await send({ a: 1 }, KEY, ok)).json, { fine: true });
  assert.equal(seen?.url, API_URL);
  assert.equal((seen?.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.equal(seen?.init.redirect, 'error');
  assert.ok(seen?.init.signal instanceof AbortSignal);

  const statusOf = async (fetchImpl: FetchLike) => {
    try {
      await send({}, KEY, fetchImpl, 50);
      return 'NOT_BLOCKED';
    } catch (error) {
      assert.ok(error instanceof Blocked);
      assert.ok(!error.message.includes(KEY));
      return error.status;
    }
  };
  for (const status of [401, 403, 429, 500, 529]) assert.equal(await statusOf(async () => jsonResponse({}, status)), 'BLOCKED_PROVIDER_OR_MODEL', String(status));
  for (const status of [400, 422]) assert.equal(await statusOf(async () => jsonResponse({}, status)), 'BLOCKED_PROFILE_OR_RESPONSE_INVALID', String(status));
  assert.equal(await statusOf(async () => new Response('not json', { status: 200 })), 'BLOCKED_PROFILE_OR_RESPONSE_INVALID');
  assert.equal(await statusOf(async () => { throw new TypeError('fetch failed'); }), 'BLOCKED_PROVIDER_OR_MODEL');
  assert.equal(await statusOf((_url, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))), 'BLOCKED_PROVIDER_OR_MODEL');
});

// ------------------------------------------------------------------------------------------------ runs

test('run: a missing key blocks before any request', async () => {
  const api = fakeApi();
  const result = await runAudit({ corpus: 'calibration', root: readyRoot(), env: {}, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(result.exitCode, EXIT.BLOCKED_PROVIDER_OR_MODEL);
  assert.equal(api.calls.length, 0);
});

test('run: --plan sends nothing, needs no key and writes the exact bodies for review', async () => {
  const api = fakeApi();
  const result = await runAudit({ corpus: 'calibration', plan: true, root: tempRoot(), env: {}, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(result.exitCode, EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(api.calls.length, 0);
  const plan = readFileSync(result.outputPath as string, 'utf8');
  assert.ok(verifyReport(plan));
  assert.equal(JSON.parse(plan).requests.length, 27);
});

test('run: no live request of any corpus before the owner-authored holdout cases exist; --plan still works', async () => {
  const api = fakeApi();
  const withoutOwnerCases = tempRoot((r) => editJson(r, OWNER_HOLDOUT_PATH, (file: any) => { file.cases = file.cases.slice(0, OWNER_HOLDOUT_MINIMUM - 1); }));
  const live = await runAudit({ corpus: 'calibration', root: withoutOwnerCases, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(live.exitCode, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
  assert.match(readFileSync(live.outputPath as string, 'utf8'), /owner-authored case/);
  const plan = await runAudit({ corpus: 'calibration', plan: true, root: withoutOwnerCases, env: {}, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(plan.exitCode, EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(api.calls.length, 0);
});

test('run: --plan on the holdout works before calibration, offline, with the exact future bodies; live stays blocked', async () => {
  const api = fakeApi();
  const root = tempRoot();
  const plan = await runAudit({ corpus: 'holdout', plan: true, root, env: {}, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(plan.exitCode, EXIT.REQUIRES_HUMAN_REVIEW);
  const written = JSON.parse(readFileSync(plan.outputPath as string, 'utf8'));
  assert.equal(written.outcome, 'PLAN_ONLY_NO_REQUEST_SENT');
  assert.equal(written.profile.bands, null);
  const ownerCases = (JSON.parse(readFileSync(join(ROOT, OWNER_HOLDOUT_PATH), 'utf8')) as { cases: unknown[] }).cases.length;
  assert.equal(written.requests.length, 20 + ownerCases);
  const { requests } = buildRequests('holdout', PROFILE, root);
  assert.deepEqual(written.requests.map((r: any) => r.body), requests.map((r) => r.body));

  // The preflight still runs: a secret in a holdout case blocks the plan.
  const leaky = tempRoot((r) => editJson(r, CORPUS_PATHS.holdout, (c: any) => { c.cases[0].unit.text = 'Set SERVICE_TOKEN = abcdefghijklmnop in the shell.'; }));
  const refused = await runAudit({ corpus: 'holdout', plan: true, root: leaky, env: {}, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(refused.exitCode, EXIT.BLOCKED_EGRESS_OR_PREFLIGHT);

  const live = await runAudit({ corpus: 'holdout', root: readyRoot(), env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(live.exitCode, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
  assert.equal(api.calls.length, 0);
});

test('run: a live repository run is refused in Phase 1 even with bands and owner cases; --plan is allowed', async () => {
  const root = readyRoot((r) => editJson(r, PROFILE_PATH, (p) => { p.bands = perQuestionBands(p); }));
  const api = fakeApi();
  const live = await runAudit({ corpus: 'repository', root, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(live.exitCode, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
  const plan = await runAudit({ corpus: 'repository', plan: true, root, env: {}, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(plan.exitCode, EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(api.calls.length, 0);
});

test('run: an uncalibrated calibration run records full provenance, never passes and never contains the key', async () => {
  const api = fakeApi();
  const result = await runAudit({ corpus: 'calibration', caseIds: ['cal-01', 'cal-17'], repeat: 2, root: readyRoot(), env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(result.exitCode, EXIT.REQUIRES_HUMAN_REVIEW);
  assert.equal(api.calls.length, 4);
  const content = readFileSync(result.outputPath as string, 'utf8');
  assert.ok(!content.includes(KEY));
  assert.ok(verifyReport(content));
  const report = JSON.parse(content);
  assert.equal(report.requested_model, 'jev-1.13.0');
  assert.deepEqual(report.repository, { commit: 'f'.repeat(40), dirty: false });
  assert.match(report.profile.sha256, /^[0-9a-f]{64}$/);
  assert.match(report.manifest.sha256, /^[0-9a-f]{64}$/);
  const pair = report.results.find((r: any) => r.request_id === 'cal-17');
  assert.equal(pair.subjects.length, 2);
  assert.match(pair.subjects[0].text_sha256, /^[0-9a-f]{64}$/);
  assert.equal(pair.repeats[0].resolved_model, 'jev-1.13.0');
  assert.equal(pair.questions.pair_relation.finding, 'UNCALIBRATED');
  assert.deepEqual(pair.questions.pair_relation.finding_per_repeat, ['UNCALIBRATED', 'UNCALIBRATED']);
  assert.ok('max_probability_spread' in pair.questions.pair_relation);
  assert.ok(pair.questions.pair_relation.expectation);
  // Tampering with a report is detectable.
  assert.equal(verifyReport(content.replace('"UNCALIBRATED"', '"NO_FINDING"')), false);
  // Every report carries the limits of what it shows.
  assert.match(report.interpretation.join(' '), /does not mean correct, approved, complete, certified/);
  assert.match(report.interpretation.join(' '), /bounded heuristic/);
});

test('run: a missing answer, an extra answer or a model mismatch blocks at the first response', async () => {
  const cases: [(b: Record<string, unknown>) => void, number][] = [
    [(b) => { b.answers = {}; }, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID],
    [(b) => { (b.answers as Record<string, unknown>).bonus = { type: 'noul', noul: 1 }; }, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID],
    [(b) => { b.model = 'jev-9.9.9'; }, EXIT.BLOCKED_PROVIDER_OR_MODEL],
  ];
  for (const [mutate, expected] of cases) {
    const api = fakeApi({ mutate });
    const result = await runAudit({ corpus: 'calibration', root: readyRoot(), env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
    assert.equal(result.exitCode, expected);
    assert.equal(api.calls.length, 1);
    const report = readFileSync(result.outputPath as string, 'utf8');
    assert.ok(verifyReport(report));
    assert.ok(!report.includes(KEY));
  }
});

test('run: the holdout and repository corpora refuse an uncalibrated profile', async () => {
  for (const corpus of ['holdout', 'repository'] as const) {
    const api = fakeApi();
    const result = await runAudit({ corpus, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
    assert.equal(result.exitCode, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
    assert.equal(api.calls.length, 0);
  }
});

test('run: uncommitted or untracked sources block egress', async () => {
  const api = fakeApi();
  const git: Git = { ...CLEAN_GIT, notCleanAndTracked: (paths) => [paths[0] as string] };
  const result = await runAudit({ corpus: 'calibration', root: readyRoot(), env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git, outDir: outDir(), log: quiet });
  assert.equal(result.exitCode, EXIT.BLOCKED_EGRESS_OR_PREFLIGHT);
  assert.equal(api.calls.length, 0);
});

test('run: a secret in a corpus case blocks every request before the first is sent', async () => {
  const root = readyRoot((r) => editJson(r, CORPUS_PATHS.calibration, (c: any) => { c.cases[3].unit.text = 'Set SERVICE_TOKEN = abcdefghijklmnop in the shell.'; }));
  const api = fakeApi();
  const result = await runAudit({ corpus: 'calibration', root, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(result.exitCode, EXIT.BLOCKED_EGRESS_OR_PREFLIGHT);
  assert.equal(api.calls.length, 0);
  const report = JSON.parse(readFileSync(result.outputPath as string, 'utf8'));
  assert.match(report.violations.join(), /cal-04: .*assigned secret/);
  assert.ok(!JSON.stringify(report).includes('abcdefghijklmnop'));
});

test('run: a policy file that no longer matches the manifest blocks', async () => {
  const root = tempRoot((r) => editJson(r, PROFILE_PATH, (p) => { p.version = 'edited'; }), { regenerateManifest: false });
  const api = fakeApi();
  const result = await runAudit({ corpus: 'calibration', root, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(result.exitCode, EXIT.BLOCKED_PROFILE_OR_RESPONSE_INVALID);
  assert.equal(api.calls.length, 0);
});

test('run: with calibrated bands a contradiction is a CONFLICT, a precedence-settled one needs review, a clean corpus is NO_FINDING', async () => {
  const root = readyRoot((r) => editJson(r, PROFILE_PATH, (p) => { p.bands = perQuestionBands(p); }));
  const conflict = fakeApi({ pick: (id) => (id === 'pair_relation' ? 'unresolved_contradiction' : undefined) });
  const failed = await runAudit({ corpus: 'holdout', root, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: conflict.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(failed.exitCode, EXIT.GOVERNANCE_CONFLICT_OR_POLICY_FAIL);

  const settled = fakeApi({ pick: (id) => (id === 'pair_relation' ? 'conflict_resolved_by_precedence' : undefined) });
  const review = await runAudit({ corpus: 'holdout', root, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: settled.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(review.exitCode, EXIT.REQUIRES_HUMAN_REVIEW);
  const report = JSON.parse(readFileSync(review.outputPath as string, 'utf8'));
  assert.equal(report.results.find((r: any) => r.request_id === 'hold-14').finding, 'RESOLVED_CONFLICT');

  const clean = fakeApi({ mass: 0.95 });
  const passed = await runAudit({ corpus: 'holdout', root, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: clean.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(passed.exitCode, EXIT.NO_FINDING);
});
