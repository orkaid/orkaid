// Layers 2 and 3 of the preregistered Increment 3 CII experiment (MDR-16; tests/fixtures/xrechnung/cii-experiment):
// the positive fixtures through the production engine and both serializers, the independent money oracle, the
// normalized projection, the structural binding checks, and the frozen controls and probes as mutations of the
// generated XML. Layer 1 (KoSIT) is in run.ts. Nothing here computes an expected value: expectations are read from the
// frozen package only.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { formatDecimal } from '../../src/lib/domain/xrechnung/decimal.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { withValue, type JsonObject } from '../../tests/support/fixtures.ts';
import {
  bucketNodes,
  bucketValueNode,
  checkCiiBindings,
  checkUblCurrency,
  compareMoney,
  compareProjections,
  extractProjection,
  lineIdsFollowOrder,
  lineNodes,
  lineValueNode,
  loadPackageJson,
  mutate,
  parentOf,
  reorderChildren,
  valueNode,
  type ExpectedMoney,
  type Projection,
  type Syntax,
} from '../../tests/support/projection.ts';

const ROOT = resolve(import.meta.dirname, '../..');
export const SYNTAXES: readonly Syntax[] = ['ubl', 'cii'];
export const FIXTURES = {
  'a-simple': 'tests/fixtures/xrechnung/a-simple.json',
  'b-ten-lines': 'tests/fixtures/xrechnung/b-ten-lines.json',
  'c-rounded-line-net': 'tests/fixtures/xrechnung/c-rounded-line-net.json',
  'd-mixed-rates': 'tests/fixtures/xrechnung/d-mixed-rates.json',
  's1-interleaved-vat': 'tests/fixtures/xrechnung/cii-experiment/s1-interleaved-vat.json',
  's2-date-roles': 'tests/fixtures/xrechnung/cii-experiment/s2-date-roles.json',
  's4a-rounded-zero-line': 'tests/fixtures/xrechnung/cii-experiment/s4a-rounded-zero-line.json',
  's4b-half-up': 'tests/fixtures/xrechnung/cii-experiment/s4b-half-up.json',
} as const;
export type FixtureName = keyof typeof FIXTURES;
const BASELINE_GOLDEN = new Set<FixtureName>(['a-simple', 'b-ten-lines', 'c-rounded-line-net', 'd-mixed-rates']);

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

type ProjectionsFile = { fixtures: Record<string, Projection> };
type MoneyFile = { fixtures: Record<string, ExpectedMoney> };
export const EXPECTED_PROJECTIONS = loadPackageJson<ProjectionsFile>('expected-projections.json').fixtures;
export const EXPECTED_MONEY = loadPackageJson<MoneyFile>('expected-money.json').fixtures;

export function loadInput(name: FixtureName): { input: JsonObject; text: string } {
  const text = readFileSync(resolve(ROOT, FIXTURES[name]), 'utf8');
  return { input: JSON.parse(text) as JsonObject, text };
}

export function serializeBoth(invoice: Invoice): Record<Syntax, string> {
  const ubl = serializeUblInvoice(invoice);
  const cii = serializeCiiInvoice(invoice);
  if (!ubl.ok || !cii.ok) throw new Error('a validated invoice did not serialize');
  return { ubl: ubl.xml, cii: cii.xml };
}

// The engine's own values, before any serializer, in the shape compareMoney reads.
function engineProjection(invoice: Invoice): Projection {
  const f = (value: Parameters<typeof formatDecimal>[0]): string => formatDecimal(value);
  const totals = invoice.totals;
  return {
    'BG-25': Object.fromEntries(totals.lines.map((line, index) => [String(index + 1), { 'BT-131': normalize(f(line.netAmount)) }])),
    'BG-23': Object.fromEntries(totals.vatBreakdown.map((b) => [`${b.category}|${b.rate}`, { 'BT-116': normalize(f(b.taxableAmount)), 'BT-117': normalize(f(b.taxAmount)) }])),
    'BG-22': {
      'BT-106': normalize(f(totals.sumOfLineNetAmounts)), 'BT-109': normalize(f(totals.totalWithoutVat)), 'BT-110': normalize(f(totals.totalVat)),
      'BT-112': normalize(f(totals.totalWithVat)), 'BT-115': normalize(f(totals.amountDue)),
    },
  };
}
const normalize = (value: string): string => {
  const [integer = '', fraction = ''] = value.split('.');
  const frac = fraction.replace(/0+$/, '');
  return frac === '' ? integer : `${integer}.${frac}`;
};

// ------------------------------------------------------------------------------------------------ positives

export type SyntaxResult = {
  sha256: string;
  extractionErrors: string[];
  projectionDiffs: string[]; // against expected-projections.json
  moneyDiffs: string[]; // against expected-money.json
  lineIdsFollowOrder: boolean;
  structure: string[]; // CII: frozen binding choices; UBL: currencyID validity
  lexical: Record<string, string>;
};

export type FixtureResult = {
  fixture: FixtureName;
  input: string;
  inputSha256: string;
  built: boolean;
  buildErrors?: unknown;
  engineMoneyDiffs: string[];
  ublMatchesGolden?: boolean;
  xml: Record<Syntax, string>;
  syntaxes: Record<Syntax, SyntaxResult>;
  crossSyntaxDiffs: string[]; // UBL projection against CII projection
  lexicalEqual: boolean;
};

export function evaluateXml(xml: string, syntax: Syntax, fixture: FixtureName): SyntaxResult {
  const extraction = extractProjection(xml, syntax);
  const expected = EXPECTED_PROJECTIONS[fixture];
  const money = EXPECTED_MONEY[fixture];
  if (expected === undefined || money === undefined) throw new Error(`no frozen expectation for ${fixture}`);
  return {
    sha256: sha256(xml),
    extractionErrors: extraction.errors,
    projectionDiffs: compareProjections(expected, extraction.projection),
    moneyDiffs: compareMoney(money, extraction.projection),
    lineIdsFollowOrder: lineIdsFollowOrder(xml, syntax),
    structure: syntax === 'cii' ? checkCiiBindings(xml).map((v) => `${v.term}: ${v.violation}`) : checkUblCurrency(xml),
    lexical: extraction.lexical,
  };
}

export function evaluateFixture(name: FixtureName): FixtureResult {
  const { input, text } = loadInput(name);
  const built = buildInvoice(input);
  const money = EXPECTED_MONEY[name];
  if (!built.ok || money === undefined) {
    const empty = { sha256: '', extractionErrors: [], projectionDiffs: [], moneyDiffs: [], lineIdsFollowOrder: false, structure: [], lexical: {} };
    return {
      fixture: name, input: FIXTURES[name], inputSha256: sha256(text), built: false, buildErrors: built.ok ? 'no money oracle' : built.errors,
      engineMoneyDiffs: [], xml: { ubl: '', cii: '' }, syntaxes: { ubl: empty, cii: empty }, crossSyntaxDiffs: [], lexicalEqual: false,
    };
  }
  const xml = serializeBoth(built.value);
  const ubl = evaluateXml(xml.ubl, 'ubl', name);
  const cii = evaluateXml(xml.cii, 'cii', name);
  const golden = BASELINE_GOLDEN.has(name) ? readFileSync(resolve(ROOT, `tests/fixtures/xrechnung/golden/${name}.xml`), 'utf8') === xml.ubl : undefined;
  return {
    fixture: name,
    input: FIXTURES[name],
    inputSha256: sha256(text),
    built: true,
    engineMoneyDiffs: compareMoney(money, engineProjection(built.value)),
    ...(golden === undefined ? {} : { ublMatchesGolden: golden }),
    xml,
    syntaxes: { ubl, cii },
    crossSyntaxDiffs: compareProjections(extractProjection(xml.ubl, 'ubl').projection, extractProjection(xml.cii, 'cii').projection),
    lexicalEqual: JSON.stringify(ubl.lexical) === JSON.stringify(cii.lexical),
  };
}

export const positivePasses = (r: FixtureResult): boolean =>
  r.built && r.engineMoneyDiffs.length === 0 && r.ublMatchesGolden !== false && r.crossSyntaxDiffs.length === 0 &&
  SYNTAXES.every((s) => {
    const x = r.syntaxes[s];
    return x.extractionErrors.length === 0 && x.projectionDiffs.length === 0 && x.moneyDiffs.length === 0 && x.lineIdsFollowOrder && x.structure.length === 0;
  });

// ------------------------------------------------------------------------------------------------ controls

type Control = { id: string; base: FixtureName; mutation: unknown; expected: unknown };
type ControlsFile = {
  controls: Control[];
  r120Probe: { base: FixtureName; documents: { id: string; expected: Record<string, string | [string, string]> }[] };
  lexicalProbes: { base: FixtureName; probes: { id: string; value: string }[] };
};
export const CONTROLS = loadPackageJson<ControlsFile>('controls.json');

function baseXml(fixture: FixtureName): Record<Syntax, string> {
  const built = buildInvoice(loadInput(fixture).input);
  if (!built.ok) throw new Error(`control base ${fixture} does not build`);
  return serializeBoth(built.value);
}

const PERMUTATION = [3, 1, 2, 0]; // input lines 4, 2, 3, 1

function reorderLines(root: Parameters<typeof lineNodes>[0], syntax: Syntax, renumber: boolean): void {
  const lines = lineNodes(root, syntax);
  const reordered = PERMUTATION.map((index) => lines[index] as (typeof lines)[number]);
  reorderChildren(parentOf(root, lines[0] as (typeof lines)[number]), lines, reordered);
  if (renumber) reordered.forEach((line, index) => (lineValueNode(line, syntax, 'BT-126').text = String(index + 1)));
}

function setMoney(root: Parameters<typeof lineNodes>[0], syntax: Syntax, target: string, from: string, to: string): void {
  // Targets are the names used in controls.json: "BT-110", "BG-23 S|7 BT-117", "BG-25 1 BT-131".
  const parts = target.split(' ');
  const node =
    parts[0] === 'BG-23' ? bucketValueNode(root, syntax, parts[1] as string, parts[2] as string)
    : parts[0] === 'BG-25' ? lineValueNode(lineNodes(root, syntax).find((l) => lineValueNode(l, syntax, 'BT-126').text === parts[1]) ?? root, syntax, parts[2] as string)
    : valueNode(root, syntax, target);
  if (node.text !== from) throw new Error(`${target} is ${node.text}, the control expects ${from}`);
  node.text = to;
}

function swap(root: Parameters<typeof lineNodes>[0], syntax: Syntax, a: string, b: string): void {
  const x = valueNode(root, syntax, a);
  const y = valueNode(root, syntax, b);
  [x.text, y.text] = [y.text, x.text];
}

/** The frozen mutation of a control, applied to generated XML of its base. */
export function controlDocument(id: string, syntax: Syntax): string {
  const control = CONTROLS.controls.find((c) => c.id === id);
  if (control === undefined) throw new Error(`unknown control ${id}`);
  const xml = baseXml(control.base)[syntax];
  const bt24 = (value: string) => (root: Parameters<typeof lineNodes>[0]) => (valueNode(root, syntax, 'BT-24').text = value);
  switch (id) {
    case 'V1':
      return mutate(xml, (root) => {
        const node = valueNode(root, syntax, 'BT-10');
        const parent = parentOf(root, node);
        parent.children = parent.children.filter((child) => child !== node);
      });
    case 'V2':
      return mutate(xml, bt24('urn:cen.eu:en16931:2017'));
    case 'V3':
      return mutate(xml, bt24('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_2.3'));
    case 'M1':
      return mutate(xml, (root) => {
        for (const [target, [from, to]] of Object.entries(control.mutation as Record<string, [string, string]>)) setMoney(root, syntax, target, from, to);
      });
    case 'N1':
      return mutate(xml, (root) => swap(root, syntax, 'BT-2', 'BT-72'));
    case 'N2':
      return mutate(xml, (root) => swap(root, syntax, 'BT-27', 'BT-44'));
    case 'N3':
      return mutate(xml, (root) => reorderLines(root, syntax, true));
    case 'O1':
      return mutate(xml, (root) => {
        reorderLines(root, syntax, false);
        const buckets = bucketNodes(root, syntax);
        reorderChildren(parentOf(root, buckets[0] as (typeof buckets)[number]), buckets, [...buckets].reverse());
      });
    default:
      throw new Error(`no mutation for ${id}`);
  }
}

/** R120 probe documents: P0 unchanged, P1/P2 with line 1 BT-131 and the dependent totals set to the frozen values. */
export function r120Document(id: string, syntax: Syntax): string {
  const probe = CONTROLS.r120Probe;
  const xml = baseXml(probe.base)[syntax];
  if (id === 'P0') return xml;
  const expected = probe.documents.find((d) => d.id === id)?.expected;
  const p0 = probe.documents.find((d) => d.id === 'P0')?.expected;
  if (expected === undefined || p0 === undefined) throw new Error(`unknown R120 document ${id}`);
  return mutate(xml, (root) => {
    for (const [target, value] of Object.entries(expected)) {
      const before = p0[target];
      if (Array.isArray(value) && Array.isArray(before)) {
        const key = target.split(' ')[1] as string;
        setMoney(root, syntax, `BG-23 ${key} BT-116`, before[0], value[0]);
        if (before[1] !== value[1]) setMoney(root, syntax, `BG-23 ${key} BT-117`, before[1], value[1]);
      } else if (typeof value === 'string' && typeof before === 'string' && before !== value) {
        setMoney(root, syntax, target, before, value);
      }
    }
  });
}

/** MDR-14 lexical probes: line 1 BT-131 of the base replaced by the probe's lexical value. */
export function lexicalDocument(id: string, syntax: Syntax): string {
  const { base, probes } = CONTROLS.lexicalProbes;
  const probe = probes.find((p) => p.id === id);
  if (probe === undefined) throw new Error(`unknown lexical probe ${id}`);
  return mutate(baseXml(base)[syntax], (root) => setMoney(root, syntax, 'BG-25 1 BT-131', '1.50', probe.value));
}

// Expected failing terms of the comparator controls (controls.json), as projection path prefixes.
const COMPARATOR_TARGETS: Record<string, string[]> = {
  N1: ['BT-2:', 'BT-72:'],
  N2: ['BG-4/BT-27:', 'BG-7/BT-44:'],
  N3: ['BG-25/1/', 'BG-25/4/'],
};

export type ControlResult = {
  control: string;
  syntax: Syntax;
  layer: string;
  sha256: string;
  extractionErrors: string[];
  projectionDiffs: string[];
  moneyDiffs: string[];
  expectedLayerOutcome: string;
  observedLayerOutcome: string;
  asPreregistered: boolean | 'validator';
};

export function evaluateControl(id: string, syntax: Syntax): ControlResult {
  const control = CONTROLS.controls.find((c) => c.id === id) as Control;
  const xml = controlDocument(id, syntax);
  const r = evaluateXml(xml, syntax, control.base);
  const base = { control: id, syntax, sha256: r.sha256, extractionErrors: r.extractionErrors, projectionDiffs: r.projectionDiffs, moneyDiffs: r.moneyDiffs };
  if (id === 'M1') {
    const expectedTerms = ['BG-23/S|7/BT-117', 'BG-22/BT-110', 'BG-22/BT-112', 'BG-22/BT-115'];
    const failing = r.moneyDiffs.map((d) => d.split(':')[0]);
    const exact = failing.length === expectedTerms.length && expectedTerms.every((term) => failing.includes(term));
    return { ...base, layer: 'monetary oracle', expectedLayerOutcome: 'reject on BT-117 (S|7), BT-110, BT-112, BT-115', observedLayerOutcome: r.moneyDiffs.length > 0 ? `reject: ${failing.join(', ')}` : 'accept', asPreregistered: exact };
  }
  if (id === 'O1') {
    const pass = r.projectionDiffs.length === 0 && r.extractionErrors.length === 0;
    return { ...base, layer: 'semantic comparator', expectedLayerOutcome: 'PASS', observedLayerOutcome: pass ? 'PASS' : 'FAIL', asPreregistered: pass };
  }
  const targets = COMPARATOR_TARGETS[id];
  if (targets !== undefined) {
    const allOnTarget = r.projectionDiffs.every((d) => targets.some((t) => d.startsWith(t)));
    const everyTargetHit = targets.every((t) => r.projectionDiffs.some((d) => d.startsWith(t)));
    const fails = r.projectionDiffs.length > 0;
    return {
      ...base, layer: 'semantic comparator', expectedLayerOutcome: `FAIL on ${targets.join(' ')}`, observedLayerOutcome: fails ? 'FAIL' : 'PASS',
      asPreregistered: fails && allOnTarget && everyTargetHit && r.extractionErrors.length === 0,
    };
  }
  return { ...base, layer: 'validator', expectedLayerOutcome: 'see KoSIT result', observedLayerOutcome: 'see KoSIT result', asPreregistered: 'validator' };
}

// ------------------------------------------------------------------------------------------------ unit codes

type UnitCodesFile = { positive: { code: string }[]; boundaryNegative: { code: string }[] };
export const UNIT_CODE_CASES = loadPackageJson<UnitCodesFile>('unit-codes.json');

export type UnitCodeResult = { code: string; kind: 'positive' | 'boundary-negative'; built: boolean; errors?: unknown; asPreregistered: boolean; detail: string[] };

export function evaluateUnitCode(code: string, kind: UnitCodeResult['kind']): UnitCodeResult {
  const input = withValue(loadInput('a-simple').input, 'lines.0.unitCode', code);
  const built = buildInvoice(input);
  if (kind === 'boundary-negative') {
    const errors = built.ok ? [] : built.errors;
    const exact = !built.ok && errors.length === 1 && errors[0]?.code === 'unsupported_unit_code' && errors[0]?.path === 'lines[0].unitCode';
    return { code, kind, built: built.ok, errors, asPreregistered: exact, detail: [] };
  }
  if (!built.ok) return { code, kind, built: false, errors: built.errors, asPreregistered: false, detail: [] };
  const expected = structuredClone(EXPECTED_PROJECTIONS['a-simple'] as Projection);
  ((expected['BG-25'] as Projection)['1'] as Projection)['BT-130'] = code;
  const xml = serializeBoth(built.value);
  const detail = SYNTAXES.flatMap((syntax) => {
    const e = extractProjection(xml[syntax], syntax);
    return [...e.errors, ...compareProjections(expected, e.projection)].map((d) => `${syntax}: ${d}`);
  });
  return { code, kind, built: true, asPreregistered: detail.length === 0, detail };
}
