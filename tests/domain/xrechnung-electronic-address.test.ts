import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCiiInvoice } from '../../src/lib/domain/xrechnung/cii.ts';
import { buildInvoice, type Invoice } from '../../src/lib/domain/xrechnung/document.ts';
import { serializeUblInvoice } from '../../src/lib/domain/xrechnung/ubl.ts';
import { loadFixtureInput, withValue, type JsonObject } from '../support/fixtures.ts';
import { one, parseXml } from '../support/xml.ts';

// M1 electronic-address (BT-34 / BT-49) scheme identifiers: EM, 0204 and 0088. EXTERNAL: BR-62/BR-63 require a
// scheme; BR-CL-25 (both syntaxes) accepts these three codes from the CEF EAS list. No pinned rule constrains the
// VALUE of 0204 or 0088, and none is invented here: EM keeps the e-mail check, the other two get the generic
// safe-text guard only. Nothing about routing or Leitweg-ID is implied by a scheme code.

const base = () => loadFixtureInput('a-simple');
const address = (schemeId: string, value: string) => ({ schemeId, value });

function built(input: JsonObject): Invoice {
  const result = buildInvoice(input);
  return result.ok ? result.value : assert.fail(`expected success: ${JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? String(v) : v))}`);
}

function rejected(input: JsonObject): readonly string[] {
  const result = buildInvoice(input);
  assert.equal(result.ok, false, 'expected rejection');
  return result.ok ? assert.fail('unreachable') : result.errors.map((e) => `${e.code}@${e.path}`);
}

const withAddresses = (seller: ReturnType<typeof address>, buyer: ReturnType<typeof address>) =>
  withValue(withValue(base(), 'seller.electronicAddress', seller), 'buyer.electronicAddress', buyer);

const SELLER_UBL = 'cac:AccountingSupplierParty/cac:Party/cbc:EndpointID';
const BUYER_UBL = 'cac:AccountingCustomerParty/cac:Party/cbc:EndpointID';
const SELLER_CII = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:URIUniversalCommunication/ram:URIID';
const BUYER_CII = 'rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID';

const CASES = [
  ['0204 seller / 0088 buyer', address('0204', 'seller-endpoint-0204'), address('0088', '4012345000009')],
  ['0088 seller / 0204 buyer', address('0088', '4012345000016'), address('0204', 'buyer-endpoint-0204')],
  ['EM seller / EM buyer', address('EM', 'rechnung@example.com'), address('EM', 'einkauf@example.org')],
] as const;

for (const [name, seller, buyer] of CASES) {
  test(`${name}: scheme and value reach the UBL and CII bindings unchanged`, () => {
    const invoice = built(withAddresses(seller, buyer));
    assert.deepEqual(invoice.seller.electronicAddress, seller);
    assert.deepEqual(invoice.buyer.electronicAddress, buyer);

    const ubl = serializeUblInvoice(invoice);
    assert.ok(ubl.ok);
    const ublRoot = parseXml(ubl.ok ? ubl.xml : '');
    for (const [path, expected] of [[SELLER_UBL, seller], [BUYER_UBL, buyer]] as const) {
      assert.equal(one(ublRoot, path).attributes.schemeID, expected.schemeId, path);
      assert.equal(one(ublRoot, path).text, expected.value, path);
    }

    const cii = serializeCiiInvoice(invoice);
    assert.ok(cii.ok);
    const ciiRoot = parseXml(cii.ok ? cii.xml : '');
    for (const [path, expected] of [[SELLER_CII, seller], [BUYER_CII, buyer]] as const) {
      assert.equal(one(ciiRoot, path).attributes.schemeID, expected.schemeId, path);
      assert.equal(one(ciiRoot, path).text, expected.value, path);
    }
  });
}

test('a scheme outside EM / 0204 / 0088 is rejected as unsupported, for seller and buyer', () => {
  for (const scheme of ['9930', '0002', 'em', 'EM ', '', '0204 0088']) {
    assert.deepEqual(rejected(withValue(base(), 'seller.electronicAddress.schemeId', scheme)), ['unsupported_electronic_address_scheme@seller.electronicAddress.schemeId'], JSON.stringify(scheme));
    assert.deepEqual(rejected(withValue(base(), 'buyer.electronicAddress.schemeId', scheme)), ['unsupported_electronic_address_scheme@buyer.electronicAddress.schemeId'], JSON.stringify(scheme));
  }
});

test('the e-mail check belongs to EM only: the same string is rejected under EM and accepted under 0204 / 0088', () => {
  const value = 'not-an-email-address';
  assert.deepEqual(rejected(withValue(base(), 'seller.electronicAddress.value', value)), ['invalid_email@seller.electronicAddress.value']);
  for (const scheme of ['0204', '0088']) {
    assert.equal(built(withValue(base(), 'seller.electronicAddress', address(scheme, value))).seller.electronicAddress.value, value, scheme);
    assert.equal(built(withValue(base(), 'buyer.electronicAddress', address(scheme, value))).buyer.electronicAddress.value, value, scheme);
  }
});

test('non-EM values still pass the generic text guard: empty, padded and control-character values are rejected', () => {
  for (const scheme of ['0204', '0088']) {
    const path = 'buyer.electronicAddress.value';
    const at = (value: string) => rejected(withValue(base(), 'buyer.electronicAddress', address(scheme, value)));
    assert.deepEqual(at(''), [`empty_text@${path}`], scheme);
    assert.deepEqual(at(' x'), [`invalid_text@${path}`], scheme);
    assert.deepEqual(at('a\u0000b'), [`invalid_text@${path}`], scheme);
  }
});
