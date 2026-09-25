// Local KoSIT validation harness for the invoice fixtures. Development and testing only: it needs Java and the
// official XRechnung bundle, neither of which belongs to the repository, so it is NOT part of `npm test`.
//
//   ORKAID_KOSIT_BUNDLE=/path/to/xrechnung-3.0.2-bundle-2026-08-31.zip npm run test:kosit [-- <fixture> ...]
//
// It verifies the recorded hashes (tools/kosit/kosit-manifest.json), extracts the validator and configuration into
// the git-ignored .cache/, regenerates each fixture's XML in-process and requires it to equal the committed golden
// file, runs the validator on that exact file, and writes one evidence record per document to
// .cache/kosit/evidence/. The process exit code of the validator, the report's `valid` field, the message
// severities and the assessment are recorded separately; a zero exit code alone is never treated as acceptance.
// A document passes only if the matched scenario is the intended one, every validation step is valid, the
// assessment is `accept`, and every message is explicitly triaged in tests/fixtures/xrechnung/kosit-triage.json.
// A control document (a golden copy with BT-10 removed) must be rejected, which shows the harness accepts no
// document unconditionally. A pass here is not legal certification and says nothing about tax correctness.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { buildInvoice, UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { FIXTURE_NAMES, loadFixtureInput, type FixtureName } from '../../tests/support/fixtures.ts';
import { parseReport, type ParsedReport } from './report.ts';

type Manifest = {
  bundle: { file: string; sha256: string };
  validator: { version: string; archiveEntry: string; sha256: string; minimumJava: number };
  configuration: { version: string; archiveEntry: string; sha256: string; scenarios: string };
  expectedScenario: string;
};
type Triage = Record<string, { code: string; level: string; disposition: string }[]>;

// Everything is resolved from the repository root, so the harness works from any working directory.
const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(ROOT, '.cache/kosit');
const GOLDEN = join(ROOT, 'tests/fixtures/xrechnung/golden');
const CONTROL_NAME = 'control-missing-buyer-reference';
const REQUIRED_STEPS = ['val-xsd', 'val-sch.1', 'val-sch.2', 'val-xml'];

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const sha256Base64 = (data: Buffer | string): string => createHash('sha256').update(data).digest('base64');

function fail(message: string): never {
  console.error(`kosit: ${message}`);
  process.exit(2);
}

function run(command: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  // A hung validator ends as a failed run (status null) instead of hanging the harness.
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  if (result.error) fail(`cannot run ${command}: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function verifiedHash(file: string, expected: string, what: string): void {
  const actual = sha256Hex(readFileSync(file));
  if (actual !== expected) fail(`${what} hash mismatch: expected ${expected}, found ${actual}`);
}

// ---------------------------------------------------------------------------------------------- tooling

function prepareTooling(manifest: Manifest): { jar: string; configuration: string; javaVersion: string; configurationDirectory: string } {
  const bundle = process.env.ORKAID_KOSIT_BUNDLE;
  if (!bundle) fail('set ORKAID_KOSIT_BUNDLE to the local official bundle zip (see tools/kosit/kosit-manifest.json).');
  if (!existsSync(bundle)) fail(`ORKAID_KOSIT_BUNDLE does not exist: ${basename(bundle)}`);
  verifiedHash(bundle, manifest.bundle.sha256, 'bundle');

  const directory = join(CACHE, manifest.bundle.sha256.slice(0, 12));
  const jar = join(directory, manifest.validator.archiveEntry);
  const configurationZip = join(directory, manifest.configuration.archiveEntry);
  const configurationDirectory = join(directory, 'config');
  mkdirSync(directory, { recursive: true });

  if (!existsSync(jar) || !existsSync(configurationZip)) {
    const extracted = run('unzip', ['-o', '-q', bundle, manifest.validator.archiveEntry, manifest.configuration.archiveEntry, '-d', directory]);
    if (extracted.status !== 0) fail(`unzip of the bundle failed: ${extracted.stderr.trim()}`);
  }
  verifiedHash(jar, manifest.validator.sha256, 'validator jar');
  verifiedHash(configurationZip, manifest.configuration.sha256, 'validator configuration');
  // The configuration is extracted afresh from the hash-verified zip on every run, never reused from an earlier one.
  rmSync(configurationDirectory, { recursive: true, force: true });
  const extractedConfiguration = run('unzip', ['-o', '-q', configurationZip, '-d', configurationDirectory]);
  if (extractedConfiguration.status !== 0) fail(`unzip of the configuration failed: ${extractedConfiguration.stderr.trim()}`);

  const java = run('java', ['-version']);
  const javaVersion = (java.stderr || java.stdout).split('\n')[0]?.trim() ?? 'unknown';
  const major = /version "(?:1\.)?(\d+)/.exec(javaVersion)?.[1];
  if (major === undefined || BigInt(major) < BigInt(manifest.validator.minimumJava)) fail(`Java ${manifest.validator.minimumJava}+ required, found: ${javaVersion}`);

  return { jar, configuration: join(configurationDirectory, manifest.configuration.scenarios), javaVersion, configurationDirectory };
}

// The domain lists the unit codes it supports; each must be in the validator configuration's own code list (rule BR-CL-23).
function verifyUnitCodes(configurationDirectory: string): void {
  const stylesheet = readFileSync(join(configurationDirectory, 'resources/ubl/2.1/xsl/EN16931-UBL-validation.xsl'), 'utf8');
  const at = stylesheet.indexOf('id="BR-CL-23"');
  const start = stylesheet.lastIndexOf('<xsl:if test="', at);
  const list = /contains\(' ([^']+) '/.exec(stylesheet.slice(start, at))?.[1]?.split(' ');
  if (at < 0 || list === undefined) fail('cannot find the BR-CL-23 unit code list in the validator configuration');
  const missing = UNIT_CODES.filter((code) => !list.includes(code));
  if (missing.length > 0) fail(`unit codes not in the validator configuration list: ${missing.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------- documents

type Target = { name: string; xmlPath: string; xml: string; fixtureInput?: string; expectAccept: boolean };

function fixtureTarget(name: FixtureName): Target {
  const goldenPath = join(GOLDEN, `${name}.xml`);
  if (!existsSync(goldenPath)) fail(`missing golden file ${goldenPath}`);
  const golden = readFileSync(goldenPath, 'utf8');

  // The XML that is validated must be the XML the serializer generates from the fixture, byte for byte.
  const built = buildInvoice(loadFixtureInput(name));
  if (!built.ok) fail(`fixture ${name} does not build: ${JSON.stringify(built.errors)}`);
  const serialized = serializeUblInvoice(built.value);
  if (!serialized.ok) fail(`fixture ${name} does not serialize`);
  if (serialized.xml !== golden) fail(`fixture ${name}: the generated XML differs from ${goldenPath}`);

  return { name, xmlPath: goldenPath, xml: golden, fixtureInput: readFileSync(join(ROOT, `tests/fixtures/xrechnung/${name}.json`), 'utf8'), expectAccept: true };
}

function controlTarget(): Target {
  const golden = readFileSync(join(GOLDEN, 'a-simple.xml'), 'utf8');
  const control = golden.replace(/^ *<cbc:BuyerReference>.*<\/cbc:BuyerReference>\n/m, '');
  if (control === golden) fail('the control document could not be derived from a-simple.xml');
  const directory = join(CACHE, 'work');
  mkdirSync(directory, { recursive: true });
  const xmlPath = join(directory, `${CONTROL_NAME}.xml`);
  writeFileSync(xmlPath, control);
  return { name: CONTROL_NAME, xmlPath, xml: control, expectAccept: false };
}

// ---------------------------------------------------------------------------------------------- validation

function validate(target: Target, tooling: ReturnType<typeof prepareTooling>, manifest: Manifest, triage: Triage) {
  // A report left by an earlier run must never be mistaken for this run's result.
  const outputDirectory = join(CACHE, 'reports', target.name);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const executed = run('java', ['-jar', tooling.jar, '-s', tooling.configuration, '-r', tooling.configurationDirectory, '-o', outputDirectory, '-h', resolve(target.xmlPath)]);

  const reportPath = join(outputDirectory, `${basename(target.xmlPath, '.xml')}-report.xml`);
  // A real report is a few tens of kilobytes; the parser is only meant for such machine-generated files.
  const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined;
  const problems: string[] = [];
  if (reportText !== undefined && reportText.length > 2_000_000) problems.push('the validator report is unexpectedly large and was not parsed');
  const report: ParsedReport | undefined = reportText !== undefined && reportText.length <= 2_000_000 ? parseReport(reportText) : undefined;
  const triaged: { code: string; level: string; disposition: string }[] = [];

  // The exit code is a separate result. It does not prove acceptance, but a validator run that failed to complete
  // normally invalidates the run: an accepted document must end with 0, and the rejected control with a nonzero code
  // (1 with validator 1.6.3, as observed).
  if (target.expectAccept && executed.status !== 0) problems.push(`the validator exited with ${executed.status}, expected 0`);
  if (!target.expectAccept && (executed.status === 0 || executed.status === null)) problems.push(`the validator exited with ${executed.status} for a document it should reject`);

  if (report === undefined) {
    if (reportText === undefined) problems.push('the validator wrote no report');
  } else {
    if (report.scenario !== manifest.expectedScenario) problems.push(`matched scenario is "${report.scenario}", expected "${manifest.expectedScenario}"`);
    if (report.documentHashSha256Base64 !== sha256Base64(target.xml)) problems.push('the validator hashed different bytes than the ones that were generated');
    if (report.engine !== `KoSIT Validator ${manifest.validator.version}`) problems.push(`engine is "${report.engine}"`);

    if (target.expectAccept) {
      for (const id of REQUIRED_STEPS) if (!report.steps.some((s) => s.id === id)) problems.push(`validation step ${id} is missing from the report`);
      for (const step of report.steps) if (!step.valid) problems.push(`validation step ${step.id} is not valid`);
      if (report.valid !== true) problems.push('the report is not valid');
      if (report.assessment !== 'accept') problems.push(`assessment is ${report.assessment}`);
      for (const message of report.messages) {
        const entry = (triage[target.name] ?? []).find((t) => t.code === message.code && t.level === message.level);
        if (message.level !== 'information') problems.push(`${message.level} ${message.code}: ${message.text}`);
        else if (entry === undefined) problems.push(`untriaged information message ${message.code}: ${message.text}`);
        else triaged.push(entry);
      }
    } else {
      // Control: the harness must be able to say no.
      if (report.assessment !== 'reject') problems.push(`the control document was not rejected (assessment ${report.assessment})`);
      if (!report.messages.some((m) => m.code === 'BR-DE-15')) problems.push('the control document did not trigger BR-DE-15');
    }
  }

  const evidence = {
    document: target.name,
    role: target.expectAccept ? 'positive fixture' : 'negative control',
    fixtureInputSha256: target.fixtureInput === undefined ? undefined : sha256Hex(target.fixtureInput),
    xmlFile: basename(target.xmlPath),
    xmlSha256: sha256Hex(target.xml),
    validator: { version: manifest.validator.version, engine: report?.engine, jarSha256: manifest.validator.sha256 },
    configuration: { version: manifest.configuration.version, archiveSha256: manifest.configuration.sha256 },
    java: tooling.javaVersion,
    scenarioMatched: report?.scenario,
    steps: report?.steps,
    reportValid: report?.valid,
    assessment: report?.assessment,
    messages: report?.messages,
    triage: triaged,
    processExitCode: executed.status,
    stdout: executed.stdout.slice(0, 20000),
    stderr: executed.stderr.slice(0, 20000),
    pass: problems.length === 0,
    problems,
  };
  mkdirSync(join(CACHE, 'evidence'), { recursive: true });
  writeFileSync(join(CACHE, 'evidence', `${target.name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function main(): void {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tools/kosit/kosit-manifest.json'), 'utf8')) as Manifest;
  const triage = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/xrechnung/kosit-triage.json'), 'utf8')) as Triage;
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : [...FIXTURE_NAMES, CONTROL_NAME];
  for (const name of names) if (name !== CONTROL_NAME && !(FIXTURE_NAMES as readonly string[]).includes(name)) fail(`unknown fixture ${name}`);

  const tooling = prepareTooling(manifest);
  verifyUnitCodes(tooling.configurationDirectory);
  console.log(`${tooling.javaVersion} | validator ${manifest.validator.version} | configuration ${manifest.configuration.version}`);

  let allPassed = true;
  for (const name of names) {
    const target = name === CONTROL_NAME ? controlTarget() : fixtureTarget(name as FixtureName);
    const evidence = validate(target, tooling, manifest, triage);
    allPassed &&= evidence.pass;
    console.log(
      `${evidence.pass ? 'PASS' : 'FAIL'} ${target.name.padEnd(34)} exit=${evidence.processExitCode} valid=${evidence.reportValid} assessment=${evidence.assessment} messages=${evidence.messages?.length ?? '-'} xml=${evidence.xmlSha256.slice(0, 12)}`,
    );
    for (const message of evidence.messages ?? []) console.log(`       ${message.level} ${message.code}`);
    for (const problem of evidence.problems) console.log(`       problem: ${problem}`);
  }
  console.log(`evidence: ${CACHE}/evidence/`);
  process.exit(allPassed ? 0 : 1);
}

main();
