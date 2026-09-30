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
// document unconditionally. The Kleinunternehmer fixtures are validated in UBL and CII, each with mutated controls
// that must be rejected by the rule they break; the reverse-charge fixtures likewise (UBL and CII, both identifier
// branches, mutated controls for BR-AE-02, -05, -09 and -10). A pass here is not legal certification and says nothing about tax correctness.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { buildInvoice, UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { FIXTURE_NAMES, loadFixtureInput, type FixtureName } from '../../tests/support/fixtures.ts';
import { parseReport, type ParsedReport } from './report.ts';

export type Manifest = {
  bundle: { file: string; sha256: string };
  validator: { version: string; archiveEntry: string; sha256: string; minimumJava: number };
  configuration: { version: string; archiveEntry: string; sha256: string; scenarios: string };
  expectedScenario: string;
};
type Triage = Record<string, { code: string; level: string; disposition: string }[]>;

// Everything is resolved from the repository root, so the harness works from any working directory.
const ROOT = resolve(import.meta.dirname, '../..');
export const CACHE = join(ROOT, '.cache/kosit');
const GOLDEN = join(ROOT, 'tests/fixtures/xrechnung/golden');
const CONTROL_NAME = 'control-missing-buyer-reference';
type Syntax = 'ubl' | 'cii';
const SCENARIOS: Record<Syntax, string> = { ubl: 'EN16931 XRechnung (UBL Invoice)', cii: 'EN16931 XRechnung (CII)' };
// M1 current evidence: these fixtures are also validated in CII (their goldens are `<name>.cii.xml`).
const CII_FIXTURES: readonly FixtureName[] = ['e-kleinunternehmer', 'f-kleinunternehmer-lines', 'g-reverse-charge-vat-ids', 'h-reverse-charge-registration-ids'];
const ciiName = (name: string): string => `${name}.cii`;

// Mutated copies of a Kleinunternehmer golden that the official validator must reject, each by the named rules.
// The domain refuses to generate these documents, so they are derived from the golden text.
const removeElement = (xml: string, pattern: RegExp): string => {
  const mutated = xml.replace(pattern, '');
  if (mutated === xml) fail('a control mutation did not change the document');
  return mutated;
};
const KLEINUNTERNEHMER_CONTROLS: Record<string, { syntax: Syntax; base: FixtureName; mutate: (xml: string) => string; codes: string[] }> = {
  'control-ku-ubl-missing-bt120': { syntax: 'ubl', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<cbc:TaxExemptionReason>.*<\/cbc:TaxExemptionReason>\n/m), codes: ['BR-E-10'] },
  'control-ku-ubl-nonzero-vat': { syntax: 'ubl', base: 'e-kleinunternehmer', mutate: (x) => x.replace(/(<cbc:TaxAmount currencyID="EUR">)0\.00/g, '$11.00'), codes: ['BR-E-09'] },
  'control-ku-ubl-missing-seller-tax-id': { syntax: 'ubl', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m), codes: ['BR-E-02', 'BR-DE-16'] },
  'control-ku-cii-missing-bt120': { syntax: 'cii', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<ram:ExemptionReason>.*<\/ram:ExemptionReason>\n/m), codes: ['BR-E-10'] },
  'control-ku-cii-nonzero-vat': { syntax: 'cii', base: 'e-kleinunternehmer', mutate: (x) => x.replace(/(<ram:CalculatedAmount>)0\.00/g, '$11.00'), codes: ['BR-E-09'] },
  'control-ku-cii-missing-seller-tax-id': { syntax: 'cii', base: 'e-kleinunternehmer', mutate: (x) => removeElement(x, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m), codes: ['BR-E-02', 'BR-DE-16'] },
};
// Applies `mutate` to the part of the document from `marker` on (the buyer party), so the seller's identifiers are left alone.
const fromMarker = (xml: string, marker: string, mutate: (rest: string) => string): string => {
  const at = xml.indexOf(marker);
  if (at < 0) fail(`a control mutation found no ${marker}`);
  return xml.slice(0, at) + mutate(xml.slice(at));
};
const UBL_BUYER = '<cac:AccountingCustomerParty>';
const CII_BUYER = '<ram:BuyerTradeParty>';
// Reverse charge (AE). RC-1 (g: seller BT-31, buyer BT-48) and RC-2 (h: seller BT-30 + BT-32, buyer BT-47) each
// lose the one identifier that their branch of BR-AE-02 relies on; h keeps BR-CO-26 satisfied through BT-30, so only the AE rule fires.
const REVERSE_CHARGE_CONTROLS: typeof KLEINUNTERNEHMER_CONTROLS = {
  'control-rc-ubl-missing-buyer-bt48': { syntax: 'ubl', base: 'g-reverse-charge-vat-ids', mutate: (x) => fromMarker(x, UBL_BUYER, (s) => removeElement(s, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m)), codes: ['BR-AE-02'] },
  'control-rc-ubl-missing-buyer-bt47': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => fromMarker(x, UBL_BUYER, (s) => removeElement(s, /^ *<cbc:CompanyID>.*<\/cbc:CompanyID>\n/m)), codes: ['BR-AE-02'] },
  'control-rc-ubl-missing-seller-tax-id': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<cac:PartyTaxScheme>\n(?:.*\n){5}/m), codes: ['BR-AE-02', 'BR-DE-16'] },
  'control-rc-ubl-nonzero-vat': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<cbc:TaxAmount currencyID="EUR">)0\.00/g, '$11.00'), codes: ['BR-AE-09'] },
  'control-rc-ubl-nonzero-line-rate': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<cac:ClassifiedTaxCategory>\n *<cbc:ID>AE<\/cbc:ID>\n *<cbc:Percent>)0</g, '$119<'), codes: ['BR-AE-05'] },
  'control-rc-ubl-missing-bt120': { syntax: 'ubl', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<cbc:TaxExemptionReason>.*<\/cbc:TaxExemptionReason>\n/m), codes: ['BR-AE-10'] },
  'control-rc-cii-missing-buyer-bt48': { syntax: 'cii', base: 'g-reverse-charge-vat-ids', mutate: (x) => fromMarker(x, CII_BUYER, (s) => removeElement(s, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m)), codes: ['BR-AE-02'] },
  'control-rc-cii-missing-buyer-bt47': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => fromMarker(x, CII_BUYER, (s) => removeElement(s, /^ *<ram:SpecifiedLegalOrganization>\n(?:.*\n){2}/m)), codes: ['BR-AE-02'] },
  'control-rc-cii-missing-seller-tax-id': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<ram:SpecifiedTaxRegistration>\n(?:.*\n){2}/m), codes: ['BR-AE-02', 'BR-DE-16'] },
  'control-rc-cii-nonzero-vat': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<ram:CalculatedAmount>)0\.00/g, '$11.00'), codes: ['BR-AE-09'] },
  'control-rc-cii-nonzero-line-rate': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => x.replace(/(<ram:CategoryCode>AE<\/ram:CategoryCode>\n *<ram:RateApplicablePercent>)0</g, '$119<'), codes: ['BR-AE-05'] },
  'control-rc-cii-missing-bt120': { syntax: 'cii', base: 'h-reverse-charge-registration-ids', mutate: (x) => removeElement(x, /^ *<ram:ExemptionReason>.*<\/ram:ExemptionReason>\n/m), codes: ['BR-AE-10'] },
};
const SPECIAL_CONTROLS = { ...KLEINUNTERNEHMER_CONTROLS, ...REVERSE_CHARGE_CONTROLS };
const REQUIRED_STEPS = ['val-xsd', 'val-sch.1', 'val-sch.2', 'val-xml'];

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const sha256Base64 = (data: Buffer | string): string => createHash('sha256').update(data).digest('base64');

function fail(message: string): never {
  console.error(`kosit: ${message}`);
  process.exit(2);
}

export function run(command: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
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

export type Tooling = { jar: string; configuration: string; javaVersion: string; configurationDirectory: string };

export function prepareTooling(manifest: Manifest): Tooling {
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

type Target = { name: string; syntax: Syntax; xmlPath: string; xml: string; fixtureInput?: string; expectAccept: boolean; expectCodes?: readonly string[] };

function generate(name: FixtureName, syntax: Syntax): string {
  const built = buildInvoice(loadFixtureInput(name));
  if (!built.ok) fail(`fixture ${name} does not build: ${JSON.stringify(built.errors)}`);
  const serialized = syntax === 'ubl' ? serializeUblInvoice(built.value) : serializeCiiInvoice(built.value);
  if (!serialized.ok) fail(`fixture ${name} does not serialize`);
  return serialized.xml;
}

function fixtureTarget(name: FixtureName, syntax: Syntax): Target {
  const goldenPath = join(GOLDEN, `${syntax === 'ubl' ? name : ciiName(name)}.xml`);
  if (!existsSync(goldenPath)) fail(`missing golden file ${goldenPath}`);
  const golden = readFileSync(goldenPath, 'utf8');

  // The XML that is validated must be the XML the serializer generates from the fixture, byte for byte.
  if (generate(name, syntax) !== golden) fail(`fixture ${name}: the generated ${syntax} XML differs from ${goldenPath}`);

  return { name: syntax === 'ubl' ? name : ciiName(name), syntax, xmlPath: goldenPath, xml: golden, fixtureInput: readFileSync(join(ROOT, `tests/fixtures/xrechnung/${name}.json`), 'utf8'), expectAccept: true };
}

function writeControl(name: string, syntax: Syntax, xml: string, expectCodes: readonly string[]): Target {
  const directory = join(CACHE, 'work');
  mkdirSync(directory, { recursive: true });
  const xmlPath = join(directory, `${name}.xml`);
  writeFileSync(xmlPath, xml);
  return { name, syntax, xmlPath, xml, expectAccept: false, expectCodes };
}

function specialControlTarget(name: string): Target {
  const control = SPECIAL_CONTROLS[name];
  if (control === undefined) fail(`unknown control ${name}`);
  // The base is the committed golden, after it has been proven equal to the generated document.
  return writeControl(name, control.syntax, control.mutate(fixtureTarget(control.base, control.syntax).xml), control.codes);
}

function controlTarget(): Target {
  const golden = readFileSync(join(GOLDEN, 'a-simple.xml'), 'utf8');
  const control = golden.replace(/^ *<cbc:BuyerReference>.*<\/cbc:BuyerReference>\n/m, '');
  if (control === golden) fail('the control document could not be derived from a-simple.xml');
  return writeControl(CONTROL_NAME, 'ubl', control, ['BR-DE-15']);
}

// ---------------------------------------------------------------------------------------------- validation

/** Runs the validator once on one file and reads its report. Shared with tools/cii-experiment/run.ts. */
export function runValidator(name: string, xmlPath: string, tooling: Tooling): { executed: ReturnType<typeof run>; reportText: string | undefined; report: ParsedReport | undefined; problems: string[] } {
  // A report left by an earlier run must never be mistaken for this run's result.
  const outputDirectory = join(CACHE, 'reports', name);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const executed = run('java', ['-jar', tooling.jar, '-s', tooling.configuration, '-r', tooling.configurationDirectory, '-o', outputDirectory, '-h', resolve(xmlPath)]);

  const reportPath = join(outputDirectory, `${basename(xmlPath, '.xml')}-report.xml`);
  // A real report is a few tens of kilobytes; the parser is only meant for such machine-generated files.
  const reportText = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined;
  const problems: string[] = [];
  if (reportText !== undefined && reportText.length > 2_000_000) problems.push('the validator report is unexpectedly large and was not parsed');
  const report: ParsedReport | undefined = reportText !== undefined && reportText.length <= 2_000_000 ? parseReport(reportText) : undefined;
  return { executed, reportText, report, problems };
}

function validate(target: Target, tooling: Tooling, manifest: Manifest, triage: Triage) {
  const { executed, reportText, report, problems } = runValidator(target.name, target.xmlPath, tooling);
  const triaged: { code: string; level: string; disposition: string }[] = [];

  // The exit code is a separate result. It does not prove acceptance, but a validator run that failed to complete
  // normally invalidates the run: an accepted document must end with 0, and the rejected control with a nonzero code
  // (1 with validator 1.6.3, as observed).
  if (target.expectAccept && executed.status !== 0) problems.push(`the validator exited with ${executed.status}, expected 0`);
  if (!target.expectAccept && (executed.status === 0 || executed.status === null)) problems.push(`the validator exited with ${executed.status} for a document it should reject`);

  if (report === undefined) {
    if (reportText === undefined) problems.push('the validator wrote no report');
  } else {
    if (report.scenario !== SCENARIOS[target.syntax]) problems.push(`matched scenario is "${report.scenario}", expected "${SCENARIOS[target.syntax]}"`);
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
      for (const code of target.expectCodes ?? []) if (!report.messages.some((m) => m.code === code)) problems.push(`the control document did not trigger ${code}`);
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
  const allNames = [...FIXTURE_NAMES, ...CII_FIXTURES.map(ciiName), CONTROL_NAME, ...Object.keys(SPECIAL_CONTROLS)];
  const names = requested.length > 0 ? requested : allNames;
  for (const name of names) if (!allNames.includes(name)) fail(`unknown fixture ${name}`);

  const tooling = prepareTooling(manifest);
  verifyUnitCodes(tooling.configurationDirectory);
  console.log(`${tooling.javaVersion} | validator ${manifest.validator.version} | configuration ${manifest.configuration.version}`);

  let allPassed = true;
  for (const name of names) {
    const target =
      name === CONTROL_NAME
        ? controlTarget()
        : name in SPECIAL_CONTROLS
          ? specialControlTarget(name)
          : name.endsWith('.cii')
            ? fixtureTarget(name.slice(0, -'.cii'.length) as FixtureName, 'cii')
            : fixtureTarget(name as FixtureName, 'ubl');
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

if (import.meta.main) main();
