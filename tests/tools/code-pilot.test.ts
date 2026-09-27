import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildBodies,
  buildManifest,
  loadProfile,
  MANIFEST_PATH,
  ROOT,
  runPilot,
  TARGET_IDS,
  verifyReport,
} from '../../tools/semantic-audit/code-pilot.ts';
import type { FetchLike, Git } from '../../tools/semantic-audit/run.ts';

// Offline tests of the real-code pilot tooling. Every fetch is injected; no test reads the real key file.

const KEY = 'test-key-not-a-real-credential-0002';
const CLEAN_GIT: Git = { head: () => 'e'.repeat(40), dirty: () => false, notCleanAndTracked: () => [] };
const PROFILE = loadProfile();
const quiet = () => {};
const outDir = () => mkdtempSync(join(tmpdir(), 'code-pilot-out-'));

function fakeApi(mutate?: (body: Record<string, unknown>, call: number) => void, failAt?: number) {
  let calls = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    calls++;
    if (failAt !== undefined && calls === failAt) throw new TypeError('fetch failed');
    const request = JSON.parse(String(init.body)) as { model: string; questions: Record<string, { criteria: Record<string, string> }> };
    const answers = Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: 'choice', choice: 'satisfies_invariant', confidence: 0.9, probabilities: { satisfies_invariant: 0.9, violates_invariant: 0.05, insufficient_evidence: 0.05 } }]));
    const body: Record<string, unknown> = { model: request.model, answers, usage: { input_tokens: 7000, output_tokens: 50 } };
    mutate?.(body, calls);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetchImpl, calls: () => calls };
}

test('code pilot: the committed manifest matches the frozen pilot files', () => {
  assert.equal(readFileSync(join(ROOT, MANIFEST_PATH), 'utf8'), buildManifest());
});

test('code pilot: six bodies, one path for all, only the fixture text and the frozen questions, all pass the preflight', async () => {
  const { bodies } = buildBodies();
  assert.deepEqual(bodies.map((b) => b.id), [...TARGET_IDS]);
  for (const b of bodies) {
    assert.deepEqual(Object.keys(b.body), ['model', 'state', 'questions']);
    assert.deepEqual(Object.keys(b.body.state.source_file), ['path', 'text']);
    assert.equal(b.body.state.source_file.path, 'src/lib/domain/xrechnung/document.ts');
    assert.ok(!JSON.stringify(b.body).includes(b.id === 'REAL' ? 'MUTANT' : b.id), b.id);
  }
  assert.equal(new Set(bodies.map((b) => b.source_sha256)).size, 6);
  const plan = await runPilot({ plan: true, env: {}, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(plan.outcome, 'PLAN_ONLY_NO_REQUEST_SENT');
  assert.equal(PROFILE.model, 'jev-1.13.0');
});

test('code pilot: a live run sends exactly 30 requests and records every repeat with provenance, never the key', async () => {
  const api = fakeApi();
  const result = await runPilot({ env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(api.calls(), 30);
  const text = readFileSync(result.outputPath as string, 'utf8');
  assert.ok(verifyReport(text) && !text.includes(KEY));
  const report = JSON.parse(text);
  assert.equal(report.requests, 30);
  assert.deepEqual(report.repository, { commit: 'e'.repeat(40), dirty: false });
  for (const r of report.results) assert.deepEqual(r.repeats.map((x: { repeat: number }) => x.repeat), [1, 2, 3, 4, 5]);
});

test('code pilot: a model mismatch or a missing answer blocks at once and is never a result', async () => {
  for (const [mutate, status] of [
    [(b: Record<string, unknown>) => { b.model = 'jev-9.9.9'; }, 'BLOCKED_PROVIDER_OR_MODEL'],
    [(b: Record<string, unknown>) => { delete (b.answers as Record<string, unknown>).inv3_validated_only_by_registration; }, 'BLOCKED_PROFILE_OR_RESPONSE_INVALID'],
  ] as const) {
    const api = fakeApi(mutate);
    const result = await runPilot({ env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: CLEAN_GIT, outDir: outDir(), log: quiet });
    assert.equal(result.outcome, status);
    assert.equal(api.calls(), 1);
  }
});

test('code pilot: uncommitted pilot files block before any request', async () => {
  const api = fakeApi();
  const dirty = await runPilot({ env: { TYPESAFE_API_KEY: KEY }, fetchImpl: api.fetchImpl, git: { ...CLEAN_GIT, notCleanAndTracked: (p) => [p[0] as string] }, outDir: outDir(), log: quiet });
  assert.equal(dirty.outcome, 'BLOCKED_EGRESS_OR_PREFLIGHT');
  assert.equal(api.calls(), 0);
});

test('code pilot: one infrastructure resume keeps every valid response and sends only the missing ones, once', async () => {
  const out = outDir();
  const first = fakeApi(undefined, 8);
  const blocked = await runPilot({ env: { TYPESAFE_API_KEY: KEY }, fetchImpl: first.fetchImpl, git: CLEAN_GIT, outDir: out, log: quiet });
  assert.equal(blocked.outcome, 'BLOCKED_PROVIDER_OR_MODEL');
  const kept = JSON.parse(readFileSync(blocked.outputPath as string, 'utf8')).completed.reduce((n: number, c: { repeats: unknown[] }) => n + c.repeats.length, 0);
  assert.equal(kept, 7);
  const second = fakeApi();
  const resumed = await runPilot({ resume: blocked.outputPath as string, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: second.fetchImpl, git: CLEAN_GIT, outDir: out, log: quiet, now: () => new Date('2030-01-01T00:00:00Z') });
  assert.equal(resumed.outcome, 'COMPLETED');
  assert.equal(second.calls(), 23);
  // A resume of a completed run, or of a resume, is refused.
  const again = await runPilot({ resume: resumed.outputPath as string, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: second.fetchImpl, git: CLEAN_GIT, outDir: out, log: quiet });
  assert.equal(again.outcome, 'BLOCKED_PROFILE_OR_RESPONSE_INVALID');
});
