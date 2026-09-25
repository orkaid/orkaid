import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReport } from '../../tools/kosit/report.ts';

// Small reports in the shape the KoSIT Validator 1.6.3 writes (prefixes rep:/s:, steps with nested messages).
// They are hand-written excerpts for the parser, not validator output about an Orkaid document.

const HEAD = '<?xml version="1.0" encoding="UTF-8"?><rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1" xmlns:s="http://www.xoev.de/de/validator/framework/1/scenarios" varlVersion="1.0.0"';
const BODY = `<rep:engine><rep:name>KoSIT Validator 1.6.3</rep:name></rep:engine>
<rep:documentIdentification><rep:documentHash><rep:hashAlgorithm>SHA-256</rep:hashAlgorithm><rep:hashValue>dPsJxgnV+6FajFQwYJmNO5KFj1aoH7Ww7SRNZ5TkmNE=</rep:hashValue></rep:documentHash></rep:documentIdentification>
<rep:scenarioMatched><s:scenario><s:name>EN16931 XRechnung (UBL Invoice)</s:name><s:description><s:p>Validates UBL</s:p></s:description></s:scenario>`;

const ACCEPTED = `${HEAD} valid="true">${BODY}
<rep:validationStepResult id="val-xsd" valid="true"><s:resource><s:name>XML Schema</s:name></s:resource></rep:validationStepResult>
<rep:validationStepResult id="val-sch.2" valid="true"><s:resource><s:name>CIUS</s:name></s:resource>
<rep:message id="val-sch.2.1" level="information" xpathLocation="/Q{urn:x}Invoice[1]" code="BR-DE-TMP-32">
  [BR-DE-TMP-32] Eine Rechnung sollte &quot;BT-72&quot; &amp; mehr enthalten.
</rep:message></rep:validationStepResult>
<rep:validationStepResult id="val-xml" valid="true"/>
</rep:scenarioMatched><rep:assessment><rep:accept><rep:explanation/></rep:accept></rep:assessment></rep:report>`;

const REJECTED = `${HEAD} valid="false">${BODY}
<rep:validationStepResult id="val-xsd" valid="true"/>
<rep:validationStepResult id="val-sch.2" valid="false">
<rep:message id="val-sch.2.1" level="error" xpathLocation="/Q{urn:x}Invoice[1]" code="BR-DE-15">[BR-DE-15] Buyer reference fehlt.</rep:message>
<rep:message id="val-sch.2.2" level="warning" xpathLocation="/Q{urn:x}Invoice[1]/a" code="BR-DE-21">[BR-DE-21] soll</rep:message>
</rep:validationStepResult></rep:scenarioMatched><rep:assessment><rep:reject/></rep:assessment></rep:report>`;

test('an accepted report: valid, matched scenario, steps, one information message, accept', () => {
  const report = parseReport(ACCEPTED);
  assert.equal(report.valid, true);
  assert.equal(report.engine, 'KoSIT Validator 1.6.3');
  assert.equal(report.documentHashSha256Base64, 'dPsJxgnV+6FajFQwYJmNO5KFj1aoH7Ww7SRNZ5TkmNE=');
  assert.equal(report.scenario, 'EN16931 XRechnung (UBL Invoice)');
  assert.deepEqual(report.steps, [{ id: 'val-xsd', valid: true }, { id: 'val-sch.2', valid: true }, { id: 'val-xml', valid: true }]);
  assert.deepEqual(report.messages, [
    { id: 'val-sch.2.1', level: 'information', code: 'BR-DE-TMP-32', xpathLocation: '/Q{urn:x}Invoice[1]', text: '[BR-DE-TMP-32] Eine Rechnung sollte "BT-72" & mehr enthalten.' },
  ]);
  assert.equal(report.assessment, 'accept');
});

test('a rejected report: invalid steps, messages with their own severities, reject', () => {
  const report = parseReport(REJECTED);
  assert.equal(report.valid, false);
  assert.deepEqual(report.steps.map((s) => s.valid), [true, false]);
  assert.deepEqual(report.messages.map((m) => [m.code, m.level]), [['BR-DE-15', 'error'], ['BR-DE-21', 'warning']]);
  assert.equal(report.assessment, 'reject');
});

test('validity, severity and assessment are independent: an invalid report can still be an accept assessment', () => {
  const warningOnly = ACCEPTED.replace('valid="true">', 'valid="false">').replace('level="information"', 'level="warning"');
  const report = parseReport(warningOnly);
  assert.equal(report.valid, false);
  assert.equal(report.messages[0]?.level, 'warning');
  assert.equal(report.assessment, 'accept');
});

test('anything the parser cannot find is reported as absent, never invented', () => {
  const empty = parseReport('<not-a-report/>');
  assert.deepEqual(empty, { valid: undefined, engine: undefined, documentHashSha256Base64: undefined, scenario: undefined, steps: [], messages: [], assessment: undefined });
});

test('a greater-than sign inside a quoted attribute value does not end the tag', () => {
  const xml = ACCEPTED.replace('xpathLocation="/Q{urn:x}Invoice[1]"', 'xpathLocation="/Q{urn:x}Invoice[a>b]"');
  assert.equal(parseReport(xml).messages[0]?.xpathLocation, '/Q{urn:x}Invoice[a>b]');
  assert.equal(parseReport(xml).steps.length, 3);
});
