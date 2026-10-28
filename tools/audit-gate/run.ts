// CI entry point (MDR-31): `node tools/audit-gate/run.ts`. Runs the full `npm audit --json`, prints every finding
// and exits 1 unless the result is clean or contains only the accepted advisory (see policy.ts).
import { spawnSync } from 'node:child_process';

import { evaluateAudit } from './policy.ts';

const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const verdict = evaluateAudit(audit.stdout ?? '', audit.status, new Date());
for (const finding of verdict.findings) console.log(`finding: ${finding}`);
console.log(`audit gate: ${verdict.ok ? 'PASS' : 'FAIL'} - ${verdict.reason}`);
process.exit(verdict.ok ? 0 : 1);
