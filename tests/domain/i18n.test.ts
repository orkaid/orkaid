import assert from 'node:assert/strict';
import test from 'node:test';

import { localePath, ui } from '../../src/i18n/ui.ts';

test('localePath keeps German routes unprefixed and prefixes English routes', () => {
  assert.equal(localePath('de', '/tools/'), '/tools/');
  assert.equal(localePath('en', '/tools/'), '/en/tools/');
  assert.equal(localePath('de', '/'), '/');
  assert.equal(localePath('en', '/'), '/en/');
});

test('locale dictionaries expose the same UI keys', () => {
  assert.deepEqual(Object.keys(ui.de).sort(), Object.keys(ui.en).sort());
});
