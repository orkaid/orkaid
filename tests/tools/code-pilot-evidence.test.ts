import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { evaluatePilot, ROOT } from '../../tools/semantic-audit/code-pilot.ts';

// The preserved real-code pilot v1 must keep reproducing its committed evaluation, offline, and must refuse any
// artifact that no longer matches the hashes its report and manifest recorded.

const PILOT = join(ROOT, 'docs/semantic-audit/code-pilot-v1');
const EVIDENCE = join(PILOT, 'evidence');

test('code pilot v1 evidence: the preserved report reproduces the committed evaluation exactly', () => {
  assert.equal(`${JSON.stringify(evaluatePilot(EVIDENCE), null, 2)}\n`, readFileSync(join(PILOT, 'evaluation.json'), 'utf8'));
});

test('code pilot v1 evidence: the preregistered result is 3 of 4 mutants detected, MUTANT-04 missed, control stable', () => {
  const { preregistered } = evaluatePilot(EVIDENCE) as { preregistered: { mutants: { id: string; detected: boolean }[]; control_stable: boolean } };
  assert.deepEqual(preregistered.mutants.map((m) => [m.id, m.detected]), [['MUTANT-01', true], ['MUTANT-02', true], ['MUTANT-03', true], ['MUTANT-04', false]]);
  assert.equal(preregistered.control_stable, true);
});

test('code pilot v1 evidence: a changed report, fixture, label or profile is refused', () => {
  const tampered = (file: string, edit: (text: string) => string) => {
    const dir = mkdtempSync(join(tmpdir(), 'code-pilot-evidence-'));
    cpSync(EVIDENCE, dir, { recursive: true });
    writeFileSync(join(dir, file), edit(readFileSync(join(dir, file), 'utf8')));
    assert.throws(() => evaluatePilot(dir), /evidence: /, file);
  };
  tampered('report.json', (t) => t.replace('"violates_invariant": 0.93', '"violates_invariant": 0.13'));
  tampered('targets/MUTANT-04.ts.txt', (t) => `${t}\n`);
  tampered('targets.json', (t) => t.replace('"UNKNOWN_BASELINE"', '"satisfies_invariant"'));
  tampered('code-audit-document-pilot-v1.json', (t) => t.replace('jev-1.13.0', 'jev-1.13.1'));
});
