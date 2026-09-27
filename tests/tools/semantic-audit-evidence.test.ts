import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ROOT } from '../../tools/semantic-audit/extract-governance.ts';
import { evaluateEvidence } from '../../tools/semantic-audit/evaluate.ts';

// The closed Phase-1 v1 evidence must keep reproducing its committed evaluation, offline, and must refuse any
// artifact that no longer matches the hashes its reports recorded.

const V1 = join(ROOT, 'docs/semantic-audit/phase1-v1');
const EVIDENCE = join(V1, 'evidence');

test('evidence v1: the preserved reports reproduce the committed evaluation exactly', async () => {
  const evaluation = await evaluateEvidence(EVIDENCE);
  assert.equal(`${JSON.stringify(evaluation, null, 2)}\n`, readFileSync(join(V1, 'evaluation.json'), 'utf8'));
});

test('evidence v1: the formal preregistered result is CONFLICT on P4, P5 and P7', async () => {
  const { formal } = (await evaluateEvidence(EVIDENCE)) as { formal: { decision: string; P: Record<string, string> } };
  assert.equal(formal.decision, 'CONFLICT');
  assert.deepEqual(Object.entries(formal.P).filter(([, v]) => v !== 'SATISFIED').map(([k]) => k), ['P4', 'P5', 'P7']);
});

test('evidence v1: a changed report, corpus or policy copy is refused', async () => {
  const tampered = async (file: string, edit: (text: string) => string) => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-audit-evidence-'));
    cpSync(EVIDENCE, dir, { recursive: true });
    writeFileSync(join(dir, file), edit(readFileSync(join(dir, file), 'utf8')));
    await assert.rejects(evaluateEvidence(dir), /evidence: /);
  };
  await tampered('2026-09-27T12-00-07-819Z-holdout.json', (t) => t.replace('"finding": "CONFLICT"', '"finding": "NO_FINDING"'));
  await tampered('holdout-cases.json', (t) => t.replace('"CONFLICT"', '"NO_FINDING"'));
  await tampered('policy.ts', (t) => `${t}\n`);
  await tampered('profile-0.2.0.json', (t) => t.replace('0.15', '0.2'));
});
