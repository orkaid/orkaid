import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import {
  CONTROLS,
  evaluateControl,
  evaluateFixture,
  evaluateUnitCode,
  FIXTURES,
  loadInput,
  positivePasses,
  serializeBoth,
  SYNTAXES,
  UNIT_CODE_CASES,
  type FixtureName,
} from '../../tools/cii-experiment/experiment.ts';
import { classifyRun } from '../../tools/cii-experiment/run.ts';
import { checkCiiBindings, extractProjection, mutate, normalizeDecimal } from '../support/projection.ts';
import { parseXml, renderXml } from '../support/xml.ts';

// Layers 2 and 3 of the preregistered Increment 3 experiment (MDR-16). Expectations come only from the frozen package
// in tests/fixtures/xrechnung/cii-experiment; the KoSIT layer runs in tools/cii-experiment/run.ts, outside npm test.

const aSimple = (): Record<'ubl' | 'cii', string> => {
  const built = buildInvoice(loadInput('a-simple').input);
  assert.ok(built.ok);
  return serializeBoth(built.value);
};

test('the CII serializer refuses an object that buildInvoice did not produce', () => {
  const built = buildInvoice(loadInput('a-simple').input);
  assert.ok(built.ok);
  const copy = structuredClone(built.value) as Invoice;
  assert.deepEqual(serializeCiiInvoice(copy), { ok: false, errors: [{ code: 'unvalidated_invoice', path: '' }] });
});

for (const name of Object.keys(FIXTURES) as FixtureName[]) {
  test(`${name}: engine, UBL and CII equal the frozen money oracle and projection, bindings hold`, () => {
    const result = evaluateFixture(name);
    assert.deepEqual(result.engineMoneyDiffs, []);
    assert.deepEqual(result.crossSyntaxDiffs, []);
    for (const syntax of SYNTAXES) {
      const r = result.syntaxes[syntax];
      assert.deepEqual([...r.extractionErrors, ...r.projectionDiffs, ...r.moneyDiffs, ...r.structure], [], syntax);
      assert.ok(r.lineIdsFollowOrder, syntax);
    }
    assert.notEqual(result.ublMatchesGolden, false, 'UBL regression against the committed golden file');
    assert.ok(positivePasses(result));
  });
}

test('the generated XML round-trips through the test reader, so mutations touch only what they name', () => {
  for (const xml of Object.values(aSimple())) assert.equal(renderXml(parseXml(xml)), xml);
});

for (const control of CONTROLS.controls.filter((c) => ['M1', 'N1', 'N2', 'N3', 'O1'].includes(c.id))) {
  for (const syntax of SYNTAXES) {
    test(`control ${control.id} (${syntax}) behaves as preregistered in its layer`, () => {
      const r = evaluateControl(control.id, syntax);
      assert.equal(r.asPreregistered, true, `${r.observedLayerOutcome} ${JSON.stringify([...r.projectionDiffs, ...r.moneyDiffs, ...r.extractionErrors])}`);
    });
  }
}

test('unit-code matrix: seven profile codes pass in both syntaxes, three boundary cases are rejected by the profile', () => {
  for (const u of UNIT_CODE_CASES.positive) assert.equal(evaluateUnitCode(u.code, 'positive').asPreregistered, true, u.code);
  for (const u of UNIT_CODE_CASES.boundaryNegative) assert.equal(evaluateUnitCode(u.code, 'boundary-negative').asPreregistered, true, JSON.stringify(u.code));
});

test('the frozen CII binding choices are checked structurally, independent of semantic equality', () => {
  const { cii } = aSimple();
  const violations = (change: Parameters<typeof mutate>[1]): string[] => checkCiiBindings(mutate(cii, change)).map((v) => v.term);
  // First element with this name in document order (the first DateTimeString is BT-2).
  const find = (root: ReturnType<typeof parseXml>, name: string): ReturnType<typeof parseXml> => {
    const search = (node: ReturnType<typeof parseXml>): ReturnType<typeof parseXml> | undefined =>
      node.name === name ? node : node.children.map(search).find((found) => found !== undefined);
    const found = search(root);
    if (found === undefined) throw new Error(name);
    return found;
  };
  assert.deepEqual(checkCiiBindings(cii), []);
  // The same value in a forbidden element must not pass, even though BT-41 and BT-84 would still be the same text.
  assert.ok(violations((root) => (find(root, 'ram:PersonName').name = 'ram:DepartmentName')).includes('BT-41'));
  assert.ok(violations((root) => (find(root, 'ram:IBANID').name = 'ram:ProprietaryID')).includes('BT-84'));
  assert.ok(violations((root) => delete find(root, 'ram:URIUniversalCommunication').children[0]?.attributes.schemeID).includes('BT-34-1 / BT-49-1'));
  assert.ok(violations((root) => ((find(root, 'udt:DateTimeString').attributes.format = '610'))).includes('BT-2 / BT-9 / BT-72'));
  assert.ok(violations((root) => delete find(root, 'udt:DateTimeString').attributes.format).includes('BT-2 / BT-9 / BT-72'));
  // A date without format 102 is an extraction failure, never guessed.
  const noFormat = mutate(cii, (root) => delete find(root, 'udt:DateTimeString').attributes.format);
  assert.ok(extractProjection(noFormat, 'cii').errors.some((e) => e.startsWith('BT-2:')));
});

test('the comparator treats a duplicate BT-126 or VAT-bucket key as an error', () => {
  const { ubl } = aSimple();
  const duplicateLine = ubl.replace('<cbc:ID>2</cbc:ID>', '<cbc:ID>1</cbc:ID>');
  assert.ok(extractProjection(duplicateLine, 'ubl').errors.includes('BG-25: duplicate BT-126 key 1'));
  const built = buildInvoice(loadInput('d-mixed-rates').input);
  assert.ok(built.ok);
  const mixed = serializeBoth(built.value).cii.replace('<ram:RateApplicablePercent>7</ram:RateApplicablePercent>\n      </ram:ApplicableTradeTax>', '<ram:RateApplicablePercent>19</ram:RateApplicablePercent>\n      </ram:ApplicableTradeTax>');
  assert.ok(extractProjection(mixed, 'cii').errors.includes('BG-23: duplicate key S|19'));
});

test('decimal normalization is exact and refuses non-xs:decimal forms', () => {
  const cases: [string, string | undefined][] = [
    ['1.50', '1.5'], ['0.00', '0'], ['120.000', '120'], ['007.10', '7.1'], ['1.', '1'], ['.5', '0.5'], ['-0.0', '0'],
    ['1,50', undefined], ['1.5E0', undefined], ['', undefined], ['.', undefined], [' 1', undefined],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeDecimal(input), expected, input);
});

test('KoSIT run classification follows PROTOCOL.md section 10', () => {
  const base = { exitCode: 0, noScenario: false, intendedScenario: 'S', documentSha256Base64: 'h', engine: 'E' };
  const report = { scenario: 'S', assessment: 'accept' as const, messages: [], documentHashSha256Base64: 'h', engine: 'E' };
  const warning = { id: 'x', level: 'warning', code: 'R', xpathLocation: '', text: '' };
  assert.equal(classifyRun({ ...base, report }), 'ACCEPT');
  assert.equal(classifyRun({ ...base, report: { ...report, messages: [{ ...warning, level: 'information' }] } }), 'ACCEPT');
  assert.equal(classifyRun({ ...base, report: { ...report, messages: [warning] } }), 'ACCEPT-W');
  assert.equal(classifyRun({ ...base, exitCode: 1, report: { ...report, assessment: 'reject' } }), 'REJECT');
  assert.equal(classifyRun({ ...base, report: { ...report, scenario: 'Other' } }), 'WRONG-SCENARIO');
  assert.equal(classifyRun({ ...base, noScenario: true, report: { ...report, scenario: undefined } }), 'NO-SCENARIO');
  assert.equal(classifyRun({ ...base, report: { ...report, scenario: undefined } }), 'RUN-INVALID');
  assert.equal(classifyRun({ ...base, report: undefined }), 'RUN-INVALID');
  assert.equal(classifyRun({ ...base, exitCode: null, report }), 'RUN-INVALID');
  assert.equal(classifyRun({ ...base, report: { ...report, documentHashSha256Base64: 'other' } }), 'RUN-INVALID');
  assert.equal(classifyRun({ ...base, report: { ...report, assessment: undefined } }), 'RUN-INVALID');
});
