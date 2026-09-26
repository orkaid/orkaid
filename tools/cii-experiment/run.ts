// Runs the preregistered Increment 3 CII experiment end to end (MDR-16; PROTOCOL.md in
// tests/fixtures/xrechnung/cii-experiment) and writes the machine-readable result to docs/cii-experiment/results.json.
// Development only, like tools/kosit/validate.ts: layer 1 needs Java and the official bundle.
//
//   ORKAID_KOSIT_BUNDLE=/path/to/xrechnung-3.0.2-bundle-2026-08-31.zip node tools/cii-experiment/run.ts
//
// Order: the manifest and the protected sources are re-verified first, then every positive fixture, control and probe
// goes through layers 2 and 3 (experiment.ts) and through KoSIT in the mechanically selected scenario. Every run is
// classified as ACCEPT, ACCEPT-W, REJECT, NO-SCENARIO, WRONG-SCENARIO or RUN-INVALID (PROTOCOL.md section 10); the
// exit code, `valid`, steps, messages and assessment are recorded separately. Full raw evidence (stdout, stderr) stays
// in the git-ignored .cache/kosit/cii-experiment/; the committed result holds no local paths. It records outcomes and
// classifications; it never decides an Expected Outcome.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';
import type { ParsedReport } from '../kosit/report.ts';
import { CACHE, prepareTooling, runValidator, type Manifest, type Tooling } from '../kosit/validate.ts';
import {
  CONTROLS,
  controlDocument,
  evaluateControl,
  evaluateFixture,
  evaluateUnitCode,
  FIXTURES,
  lexicalDocument,
  positivePasses,
  r120Document,
  sha256,
  SYNTAXES,
  UNIT_CODE_CASES,
  type FixtureName,
} from './experiment.ts';
import { extractProjection, type Syntax } from '../../tests/support/projection.ts';
import { buildManifest, MANIFEST_PATH } from './manifest.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = join(CACHE, 'cii-experiment');
const OUTPUT = join(ROOT, 'docs/cii-experiment/results.json');
const PREREGISTRATION_COMMIT = '2d2ee212a47907db80ac1279290c5d785a4ce452';
const PROTECTED = ['src/lib/domain/xrechnung/document.ts', 'src/lib/domain/xrechnung/invoice.ts', 'src/lib/domain/xrechnung/decimal.ts', 'src/lib/domain/xrechnung/number-notation.ts'];
const REQUIRED_STEPS = ['val-xsd', 'val-sch.1', 'val-sch.2'];
const INTENDED: Record<Syntax, string> = { ubl: 'EN16931 XRechnung (UBL Invoice)', cii: 'EN16931 XRechnung (CII)' };

export type RunClass = 'ACCEPT' | 'ACCEPT-W' | 'REJECT' | 'NO-SCENARIO' | 'WRONG-SCENARIO' | 'RUN-INVALID';

/** PROTOCOL.md section 10.4 and 10.5. `noScenario` is the report's own statement that no scenario matched. */
export function classifyRun(input: {
  exitCode: number | null;
  report: Pick<ParsedReport, 'scenario' | 'assessment' | 'messages' | 'documentHashSha256Base64' | 'engine'> | undefined;
  noScenario: boolean;
  intendedScenario: string;
  documentSha256Base64: string;
  engine: string;
}): RunClass {
  const { report } = input;
  if (report === undefined || input.exitCode === null || input.exitCode > 1) return 'RUN-INVALID';
  if (report.documentHashSha256Base64 !== input.documentSha256Base64 || report.engine !== input.engine) return 'RUN-INVALID';
  if (report.scenario === undefined) return input.noScenario ? 'NO-SCENARIO' : 'RUN-INVALID';
  if (report.scenario !== input.intendedScenario) return 'WRONG-SCENARIO';
  if (report.assessment === 'reject') return 'REJECT';
  if (report.assessment !== 'accept') return 'RUN-INVALID';
  return report.messages.some((m) => m.level === 'warning' || m.level === 'error') ? 'ACCEPT-W' : 'ACCEPT';
}

type KositRecord = {
  class: RunClass;
  intendedScenario: string;
  scenarioMatched: string | undefined;
  documentSha256: string;
  processExitCode: number | null;
  reportValid: boolean | undefined;
  assessment: string | undefined;
  steps: readonly { id: string; valid: boolean }[];
  stepsComplete: boolean;
  messages: readonly { id: string; level: string; code: string; xpathLocation: string; text: string }[];
  problems: string[];
};

function kosit(name: string, syntax: Syntax, xml: string, tooling: Tooling, manifest: Manifest): KositRecord {
  mkdirSync(WORK, { recursive: true });
  const xmlPath = join(WORK, `${name}.xml`);
  writeFileSync(xmlPath, xml);
  const { executed, reportText, report, problems } = runValidator(`cii-experiment-${name}`, xmlPath, tooling);
  const record: KositRecord = {
    class: classifyRun({
      exitCode: executed.status,
      report,
      noScenario: reportText !== undefined && /<rep:noScenarioMatched\b/.test(reportText),
      intendedScenario: INTENDED[syntax],
      documentSha256Base64: Buffer.from(sha256(xml), 'hex').toString('base64'),
      engine: `KoSIT Validator ${manifest.validator.version}`,
    }),
    intendedScenario: INTENDED[syntax],
    scenarioMatched: report?.scenario,
    documentSha256: sha256(xml),
    processExitCode: executed.status,
    reportValid: report?.valid,
    assessment: report?.assessment,
    steps: report?.steps ?? [],
    stepsComplete: REQUIRED_STEPS.every((id) => report?.steps.some((s) => s.id === id)),
    messages: report?.messages ?? [],
    problems,
  };
  mkdirSync(join(WORK, 'evidence'), { recursive: true });
  writeFileSync(join(WORK, 'evidence', `${name}.json`), `${JSON.stringify({ ...record, stdout: executed.stdout.slice(0, 20000), stderr: executed.stderr.slice(0, 20000) }, null, 2)}\n`);
  console.log(`${record.class.padEnd(14)} ${name.padEnd(36)} exit=${record.processExitCode} valid=${record.reportValid} scenario=${record.scenarioMatched ?? '-'} messages=${record.messages.map((m) => `${m.level}:${m.code}`).join(',') || '-'}`);
  return record;
}

const hasR120 = (r: KositRecord): boolean => r.messages.some((m) => m.code.endsWith('R120'));
const xsdValid = (r: KositRecord): boolean | undefined => r.steps.find((s) => s.id === 'val-xsd')?.valid;
const cleanRun = (r: KositRecord): boolean => ['ACCEPT', 'ACCEPT-W', 'REJECT'].includes(r.class) && r.stepsComplete && xsdValid(r) === true;

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

// BR-CL-23 unit-code list of each syntax's EN 16931 Schematron in the pinned configuration.
function unitCodeList(tooling: Tooling, syntax: Syntax): string[] {
  const file = syntax === 'ubl' ? 'resources/ubl/2.1/xsl/EN16931-UBL-validation.xsl' : 'resources/cii/16b/xsl/EN16931-CII-validation.xsl';
  const stylesheet = readFileSync(join(tooling.configurationDirectory, file), 'utf8');
  const at = stylesheet.indexOf('id="BR-CL-23"');
  const start = stylesheet.lastIndexOf('<xsl:if test="', at);
  const list = /contains\(' ([^']+) '/.exec(stylesheet.slice(start, at))?.[1]?.split(' ');
  if (at < 0 || list === undefined) throw new Error(`cannot find the BR-CL-23 list for ${syntax}`);
  return list;
}

function main(): void {
  // 1. Preregistration integrity, before anything else.
  const manifestText = readFileSync(join(ROOT, MANIFEST_PATH), 'utf8');
  const manifestMatches = manifestText === buildManifest();
  const protectedDiff = git(['diff', '--stat', PREREGISTRATION_COMMIT, '--', ...PROTECTED]).trim();
  const descends = spawnSync('git', ['merge-base', '--is-ancestor', PREREGISTRATION_COMMIT, 'HEAD'], { cwd: ROOT }).status === 0;
  if (!manifestMatches) console.error('PROTOCOL DEVIATION: the preregistration package does not match MANIFEST.json');
  if (protectedDiff !== '') console.error(`PROTOCOL DEVIATION: protected sources changed:\n${protectedDiff}`);

  const kositManifest = JSON.parse(readFileSync(join(ROOT, 'tools/kosit/kosit-manifest.json'), 'utf8')) as Manifest;
  const tooling = prepareTooling(kositManifest);
  console.log(`${tooling.javaVersion} | validator ${kositManifest.validator.version} | configuration ${kositManifest.configuration.version}`);

  // 2. Positive fixtures.
  const positives = (Object.keys(FIXTURES) as FixtureName[]).map((name) => {
    const r = evaluateFixture(name);
    const validator = Object.fromEntries(SYNTAXES.map((s) => [s, kosit(`${name}.${s}`, s, r.xml[s], tooling, kositManifest)])) as Record<Syntax, KositRecord>;
    const { xml: _xml, ...rest } = r;
    return { ...rest, layers23Pass: positivePasses(r), kosit: validator };
  });

  // 3. Controls.
  const controls = CONTROLS.controls.flatMap((c) =>
    SYNTAXES.map((s) => {
      const layers = evaluateControl(c.id, s);
      return { ...layers, kosit: kosit(`${c.id}.${s}`, s, controlDocument(c.id, s), tooling, kositManifest) };
    }),
  );

  // 4. R120 probe.
  const probeDocument = (s: Syntax, id: 'P0' | 'P1' | 'P2') => {
    const xml = r120Document(id, s);
    const extraction = extractProjection(xml, s);
    const { 'BG-25': lines, 'BG-23': buckets, 'BG-22': totals } = extraction.projection;
    return { projection: { 'BG-25': lines, 'BG-23': buckets, 'BG-22': totals }, extractionErrors: extraction.errors, kosit: kosit(`R120-${id}.${s}`, s, xml, tooling, kositManifest) };
  };
  const probeSyntax = (s: Syntax) => ({ P0: probeDocument(s, 'P0'), P1: probeDocument(s, 'P1'), P2: probeDocument(s, 'P2') });
  const probe = { ubl: probeSyntax('ubl'), cii: probeSyntax('cii') };
  const enforced = (s: Syntax): boolean => {
    const p = probe[s];
    return [p.P0, p.P1, p.P2].every((d) => cleanRun(d.kosit)) && hasR120(p.P1.kosit) && !hasR120(p.P0.kosit) && !hasR120(p.P2.kosit);
  };
  const r120Val = SYNTAXES.filter((s) => hasR120(probe[s].P0.kosit) || hasR120(probe[s].P2.kosit));
  const ciiNotEnforced = enforced('ubl') && [probe.cii.P0, probe.cii.P1, probe.cii.P2].every((d) => cleanRun(d.kosit)) && !hasR120(probe.cii.P1.kosit) && r120Val.length === 0;
  const r120 = {
    ubl: enforced('ubl') ? 'ENFORCED' : 'INCONCLUSIVE',
    cii: enforced('cii') ? 'ENFORCED' : ciiNotEnforced ? 'NOT ENFORCED' : 'INCONCLUSIVE',
    r120InP0OrP2: r120Val,
  };

  // 5. MDR-14 lexical probes.
  const lexical = CONTROLS.lexicalProbes.probes.flatMap((p) =>
    SYNTAXES.map((s) => {
      const xml = lexicalDocument(p.id, s);
      const record = kosit(`${p.id}.${s}`, s, xml, tooling, kositManifest);
      const line = (extractProjection(xml, s).projection['BG-25'] as Record<string, Record<string, string>> | undefined)?.['1']?.['BT-131'];
      return { probe: p.id, value: p.value, syntax: s, xsdValid: xsdValid(record), brDec23: record.messages.filter((m) => m.code === 'BR-DEC-23').map((m) => m.level), normalizedValue: line, kosit: record };
    }),
  );

  // 6. Unit codes: profile behaviour, and the codes' presence in each syntax's validator list.
  const lists = { ubl: unitCodeList(tooling, 'ubl'), cii: unitCodeList(tooling, 'cii') };
  const unitCodes = [
    ...UNIT_CODE_CASES.positive.map((u) => evaluateUnitCode(u.code, 'positive')),
    ...UNIT_CODE_CASES.boundaryNegative.map((u) => evaluateUnitCode(u.code, 'boundary-negative')),
  ].map((r) => ({ ...r, inBrCl23: { ubl: lists.ubl.includes(r.code), cii: lists.cii.includes(r.code) } }));

  const result = {
    purpose: 'Machine-readable result of the preregistered Increment 3 CII experiment (MDR-16). Generated by tools/cii-experiment/run.ts; outcomes and classifications only, no Expected Outcome is decided here.',
    preregistration: {
      commit: PREREGISTRATION_COMMIT,
      descendsFromPreregistration: descends,
      manifestSha256: sha256(manifestText),
      manifestMatchesPackage: manifestMatches,
      protectedSources: PROTECTED,
      protectedSourcesDiffEmpty: protectedDiff === '',
    },
    runtime: {
      node: process.versions.node,
      java: tooling.javaVersion,
      validator: kositManifest.validator.version,
      validatorJarSha256: kositManifest.validator.sha256,
      configuration: kositManifest.configuration.version,
      configurationSha256: kositManifest.configuration.sha256,
      bundleSha256: kositManifest.bundle.sha256,
      domainUnitCodes: UNIT_CODES,
    },
    positives,
    controls,
    r120: { ...r120, documents: probe },
    lexical,
    unitCodes,
  };
  mkdirSync(join(ROOT, 'docs/cii-experiment'), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`R120: UBL ${r120.ubl}, CII ${r120.cii}${r120Val.length ? ` (R120 in P0/P2: ${r120Val.join(', ')})` : ''}`);
  console.log(`positives layers 2+3: ${positives.filter((p) => p.layers23Pass).length}/${positives.length}; manifest ${manifestMatches ? 'matches' : 'DRIFTED'}; protected sources ${protectedDiff === '' ? 'unchanged' : 'CHANGED'}`);
  console.log(`written ${OUTPUT.slice(ROOT.length + 1)}`);
}

if (import.meta.main) main();
