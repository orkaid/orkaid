import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, UNIT_CODES } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withValue } from '../support/fixtures.ts';
import { one, parseXml, select } from '../support/xml.ts';

// M1 H87 (piece): the bounded unit-code profile is widened by exactly one code. H87 and MTQ are both in the pinned
// BR-CL-23 list (UBL and CII, checked mechanically by tools/kosit/validate.ts for every profile code); MTQ is the
// negative control: valid for the validator, outside the Orkaid profile. No binding or model change is involved.

const withUnit = (unitCode: string) => withValue(loadFixtureInput('a-simple'), 'lines.0.unitCode', unitCode);

test('the unit-code profile is exactly the earlier seven codes plus H87', () => {
  assert.deepEqual([...UNIT_CODES], ['C62', 'HUR', 'DAY', 'MON', 'KGM', 'LTR', 'MTR', 'H87']);
});

test('H87 is accepted, an official code outside the profile (MTQ) is still rejected by the profile', () => {
  const ok = buildInvoice(withUnit('H87'));
  assert.ok(ok.ok);
  assert.equal(ok.value.lines[0]?.unitCode, 'H87');
  const rejected = buildInvoice(withUnit('MTQ'));
  assert.ok(!rejected.ok);
  assert.deepEqual(rejected.errors.map((e) => `${e.code}@${e.path}`), ['unsupported_unit_code@lines[0].unitCode']);
});

test('H87 is written at BT-130 in UBL and in CII, and the other line keeps its own unit', () => {
  const built = buildInvoice(withUnit('H87'));
  assert.ok(built.ok);
  const ubl = serializeUblInvoice(built.value);
  const cii = serializeCiiInvoice(built.value);
  assert.ok(ubl.ok && cii.ok);
  const ublUnits = select(parseXml(ubl.xml), 'cac:InvoiceLine').map((l) => one(l, 'cbc:InvoicedQuantity').attributes.unitCode);
  assert.deepEqual(ublUnits, ['H87', 'HUR']);
  const ciiUnits = select(parseXml(cii.xml), 'rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem').map(
    (l) => one(one(l, 'ram:SpecifiedLineTradeDelivery'), 'ram:BilledQuantity').attributes.unitCode,
  );
  assert.deepEqual(ciiUnits, ['H87', 'HUR']);
});
