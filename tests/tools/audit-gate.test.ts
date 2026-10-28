import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCEPTED, EXPIRES_AT, evaluateAudit } from '../../tools/audit-gate/policy.ts';

// The shape is what `npm audit --json` (auditReportVersion 2) printed for the accepted advisory on 2026-10-28.
const advisory = (id: string, severity: string, name = 'deepmerge') => ({
  source: 1, name, dependency: name, title: `advisory ${id}`, url: `https://github.com/advisories/${id}`, severity, range: '>=4.2.0 <=4.3.1',
});
const entry = (via: unknown[], severity = 'low') => ({ severity, via, effects: [], range: '*' });
const acceptedChain = () => ({
  '@astrojs/svelte': entry(['@sveltejs/vite-plugin-svelte']),
  '@sveltejs/vite-plugin-svelte': entry(['deepmerge']),
  deepmerge: entry([advisory(ACCEPTED.advisory, 'low')]),
});
const report = (vulnerabilities: Record<string, unknown>) => JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: {} });
const BEFORE_EXPIRY = new Date('2026-10-28T12:00:00Z');

test('no vulnerabilities passes', () => {
  assert.equal(evaluateAudit(report({}), 0, BEFORE_EXPIRY).ok, true);
});

test('only the accepted advisory on the accepted path passes before the expiry, with its findings still listed', () => {
  const verdict = evaluateAudit(report(acceptedChain()), 1, BEFORE_EXPIRY);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.findings.length, 1);
  assert.match(verdict.findings[0] as string, /GHSA-gcqx-w48m-w2h4/);
});

test('the accepted advisory plus another LOW advisory fails', () => {
  const verdict = evaluateAudit(report({ ...acceptedChain(), other: entry([advisory('GHSA-aaaa-bbbb-cccc', 'low', 'other')]) }), 1, BEFORE_EXPIRY);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /GHSA-aaaa-bbbb-cccc/);
});

test('a second advisory on the accepted package itself fails', () => {
  const chain = acceptedChain();
  chain.deepmerge = entry([advisory(ACCEPTED.advisory, 'low'), advisory('GHSA-dddd-eeee-ffff', 'low')]);
  assert.equal(evaluateAudit(report(chain), 1, BEFORE_EXPIRY).ok, false);
});

for (const severity of ['high', 'critical']) {
  test(`the accepted advisory plus a ${severity.toUpperCase()} advisory fails`, () => {
    const verdict = evaluateAudit(report({ ...acceptedChain(), other: entry([advisory('GHSA-aaaa-bbbb-cccc', severity, 'other')], severity) }), 1, BEFORE_EXPIRY);
    assert.equal(verdict.ok, false);
  });
}

test('the accepted advisory raised above LOW severity fails and needs reassessment', () => {
  const chain = acceptedChain();
  chain.deepmerge = entry([advisory(ACCEPTED.advisory, 'moderate')], 'moderate');
  assert.equal(evaluateAudit(report(chain), 1, BEFORE_EXPIRY).ok, false);
});

test('the accepted advisory reached through a package off the accepted path fails', () => {
  assert.equal(evaluateAudit(report({ ...acceptedChain(), 'some-other-plugin': entry(['deepmerge']) }), 1, BEFORE_EXPIRY).ok, false);
});

test('malformed audit output fails', () => {
  for (const output of ['', 'not json', '[]', 'null', JSON.stringify({ auditReportVersion: 1, vulnerabilities: {} }), JSON.stringify({ auditReportVersion: 2 }), JSON.stringify({ auditReportVersion: 2, vulnerabilities: { deepmerge: { via: 'x' } } }), report({ deepmerge: entry([{ url: 5 }]) })]) {
    assert.equal(evaluateAudit(output, 1, BEFORE_EXPIRY).ok, false, output);
  }
});

test('an inconsistent exit status fails', () => {
  assert.equal(evaluateAudit(report(acceptedChain()), 0, BEFORE_EXPIRY).ok, false);
  assert.equal(evaluateAudit(report({}), 1, BEFORE_EXPIRY).ok, false);
});

test('an audit or network failure fails, including a clean-looking body', () => {
  const networkError = JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request failed', detail: 'getaddrinfo ENOTFOUND registry.npmjs.org' } });
  assert.equal(evaluateAudit(networkError, 1, BEFORE_EXPIRY).ok, false);
  assert.equal(evaluateAudit(report({}), null, BEFORE_EXPIRY).ok, false);
  assert.equal(evaluateAudit(report({}), 2, BEFORE_EXPIRY).ok, false);
  assert.equal(evaluateAudit(JSON.stringify({ error: { code: 'ENOLOCK' }, auditReportVersion: 2, vulnerabilities: {} }), 0, BEFORE_EXPIRY).ok, false);
});

test('the acceptance holds up to the last instant before 2026-11-27T00:00:00Z and fails from that instant', () => {
  assert.equal(EXPIRES_AT, Date.parse('2026-11-27T00:00:00Z'));
  assert.equal(evaluateAudit(report(acceptedChain()), 1, new Date(EXPIRES_AT - 1)).ok, true);
  const expired = evaluateAudit(report(acceptedChain()), 1, new Date(EXPIRES_AT));
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/);
  assert.equal(evaluateAudit(report(acceptedChain()), 1, new Date('2027-01-01T00:00:00Z')).ok, false);
});

test('a clean audit still passes after the expiry, because nothing is being accepted', () => {
  assert.equal(evaluateAudit(report({}), 0, new Date('2027-01-01T00:00:00Z')).ok, true);
});
