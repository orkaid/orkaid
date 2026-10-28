// MDR-31: the CI dependency-audit gate. It evaluates the structured result of the full `npm audit` and tolerates
// exactly one temporarily accepted advisory on one dependency path; everything else fails. Remove ACCEPTED and
// EXPIRES_AT (and this directory's CI step back to a plain `npm audit`) once a compatible fix is adopted.

export const ACCEPTED = {
  advisory: 'GHSA-gcqx-w48m-w2h4',
  severity: 'low',
  // @astrojs/svelte -> @sveltejs/vite-plugin-svelte -> deepmerge: the accepted dependency path.
  path: ['@astrojs/svelte', '@sveltejs/vite-plugin-svelte', 'deepmerge'],
};
// The acceptance ends at this instant (UTC); the gate fails from then on without a new decision.
export const EXPIRES_AT = Date.parse('2026-11-27T00:00:00Z');

export type Verdict = { ok: boolean; reason: string; findings: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (reason: string, findings: string[] = []): Verdict => ({ ok: false, reason, findings });

// `output` is the stdout of `npm audit --json`, `status` its exit code (null when it could not be run).
export function evaluateAudit(output: string, status: number | null, now: Date): Verdict {
  if (status !== 0 && status !== 1) return fail(`npm audit did not complete (exit status ${status})`);
  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch {
    return fail('npm audit output is not valid JSON');
  }
  if (!isRecord(report)) return fail('npm audit output is not a JSON object');
  if (report.error !== undefined) return fail(`npm audit reported an error: ${JSON.stringify(report.error)}`);
  if (report.auditReportVersion !== 2) return fail(`unsupported npm audit report version: ${String(report.auditReportVersion)}`);
  const vulnerabilities = report.vulnerabilities;
  if (!isRecord(vulnerabilities)) return fail('npm audit output has no vulnerabilities object');

  const names = Object.keys(vulnerabilities);
  if (status === 0) return names.length === 0 ? { ok: true, reason: 'no known vulnerabilities', findings: [] } : fail('npm audit exited 0 but lists vulnerabilities');
  if (names.length === 0) return fail('npm audit exited 1 but lists no vulnerabilities');

  const findings: string[] = [];
  const unaccepted: string[] = [];
  let acceptedAdvisorySeen = false;
  for (const name of names) {
    const entry = vulnerabilities[name];
    if (!isRecord(entry) || !Array.isArray(entry.via)) return fail(`unsupported npm audit entry for ${name}`);
    if (!ACCEPTED.path.includes(name)) unaccepted.push(`${name}: not on the accepted dependency path`);
    for (const via of entry.via) {
      if (typeof via === 'string') {
        if (!ACCEPTED.path.includes(via)) unaccepted.push(`${name}: via ${via}, not on the accepted dependency path`);
        continue;
      }
      if (!isRecord(via) || typeof via.url !== 'string' || typeof via.severity !== 'string') return fail(`unsupported advisory structure under ${name}`);
      const id = via.url.split('/').pop() ?? '';
      findings.push(`${name} (${via.severity}): ${String(via.title)} ${via.url}`);
      if (id !== ACCEPTED.advisory || via.severity !== ACCEPTED.severity || name !== 'deepmerge') unaccepted.push(`${name}: ${id || via.url} (${via.severity})`);
      else acceptedAdvisorySeen = true;
    }
  }
  if (unaccepted.length > 0) return fail(`vulnerabilities outside the accepted exception: ${unaccepted.join('; ')}`, findings);
  if (!acceptedAdvisorySeen) return fail('vulnerabilities are listed but none traces to the accepted advisory', findings);
  if (now.getTime() >= EXPIRES_AT) return fail(`the temporary acceptance of ${ACCEPTED.advisory} expired on ${new Date(EXPIRES_AT).toISOString()}`, findings);
  return { ok: true, reason: `only ${ACCEPTED.advisory} (accepted until ${new Date(EXPIRES_AT).toISOString()}, MDR-31)`, findings };
}
