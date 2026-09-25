import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  findBoundaryViolations,
  findFloatMoneyViolations,
  findSerializerArithmeticViolations,
} from '../support/static-checks.ts';

// Automated static checks over the domain sources. They are AST based (comments and string contents never trigger
// the float rules) and each rule is itself proven against small violating and non-violating snippets first, so a
// green run cannot come from a checker that finds nothing.

const DOMAIN_DIR = 'src/lib/domain';
const UBL_FILE = 'src/lib/domain/xrechnung/ubl.ts';

const rules = (violations: { rule: string }[]) => violations.map((v) => v.rule).sort();

// ------------------------------------------------------------- the float rules detect violations

test('float rules: every binary floating-point route into money code is detected', () => {
  const cases: [string, string | string[]][] = [
    ["const a = parseFloat('1.5');", 'float-identifier'],
    ["const a = parseInt('15', 10);", 'float-identifier'],
    ["const a = Number('1.5');", 'float-identifier'],
    ['const a = Number.MAX_SAFE_INTEGER;', 'float-identifier'],
    ['const a = other.parseFloat(x);', 'float-identifier'],
    ['const a = new Intl.NumberFormat("de");', 'float-identifier'],
    ['const a = Math.round(x);', 'float-math'],
    ['const a = Math.floor(x / 2);', 'float-math'],
    ['const a = Math;', 'float-math'],
    ['const a = x.toFixed(2);', 'float-format-method'],
    ['const a = x.toLocaleString("de");', 'float-format-method'],
    ['const a = 1.5;', 'float-literal'],
    ['const a = 1e3;', 'float-literal'],
    ['const a = +text;', 'unary-plus-coercion'],
    ["const a = globalThis.Number('1.5');", ['float-global', 'float-identifier']],
    ["const a = globalThis['Number']('1.5');", 'float-global'],
    ["const a = x['toFixed'](2);", 'float-format-method'],
    ["const a = Math['round'](x);", 'float-math'],
    ["const a = JSON.parse('1.5');", 'float-json-parse'],
    ["const a = eval('1.5');", 'dynamic-code'],
    ["const a = new Function('return 1.5');", 'dynamic-code'],
    ["const a = '1.5' * 2;", 'string-coercion'],
    ["const a = x - '1.5';", 'string-coercion'],
    ["const a = -'1.5';", 'string-coercion'],
  ];
  for (const [source, rule] of cases) {
    assert.deepEqual(rules(findFloatMoneyViolations('x.ts', source)), [rule].flat(), source);
  }
});

test('float rules: integer scale arithmetic, bigint, comments and strings are not violations', () => {
  const clean = [
    'const a = Math.max(x.scale, y.scale);',
    'const a = Math.min(1, 2);',
    'const a = 10n ** BigInt(scale);',
    'const a = 0x10 + 1_000;',
    "const a = 'Number parseFloat 1.5 toFixed';",
    '// Number parseFloat 1.5 toFixed Math.round\nconst a = 1;',
    '/* Number(x) */ const a = 1;',
    'const a: number = 1;',
  ];
  for (const source of clean) assert.deepEqual(findFloatMoneyViolations('x.ts', source), [], source);
});

// ------------------------------------------------------------- the boundary rules detect violations

test('boundary rules: framework, DOM, network and UBL strings are detected', () => {
  const cases: [string, string[]][] = [
    ["import { x } from 'astro:content';", ['framework-import']],
    ["import x from 'svelte';", ['framework-import']],
    ['const a = document.body;', ['dom-or-network']],
    ['const a = window;', ['dom-or-network']],
    ["const a = localStorage.getItem('k');", ['dom-or-network']],
    ["const a = fetch('/x');", ['dom-or-network']],
    ["const a = '<cbc:ID>1</cbc:ID>';", ['ubl-outside-serializer']],
    // A template literal is several literal pieces; each piece that carries UBL text is reported.
    ['const a = `<cac:Party>${x}</cac:Party>`;', ['ubl-outside-serializer', 'ubl-outside-serializer']],
    ["const a = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';", ['ubl-outside-serializer']],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(rules(findBoundaryViolations('x.ts', source, { allowUbl: false })), expected, source);
  }
});

test('boundary rules: the serializer file may contain UBL strings, everything else may not', () => {
  const ubl = "const a = '<cbc:ID>1</cbc:ID>';";
  assert.deepEqual(findBoundaryViolations('ubl.ts', ubl, { allowUbl: true }), []);
  assert.equal(findBoundaryViolations('other.ts', ubl, { allowUbl: false }).length, 1);
});

test('serializer rules: arithmetic, Decimal internals and money-engine imports are detected', () => {
  const cases: [string, string[]][] = [
    ['const a = x * y;', ['serializer-arithmetic']],
    ['const a = x / y;', ['serializer-arithmetic']],
    ['const a = x % y;', ['serializer-arithmetic']],
    ['const a = x - y;', ['serializer-arithmetic']],
    ['let a = 1; a *= 2;', ['serializer-arithmetic']],
    ['const a = value.units;', ['serializer-decimal-internals']],
    ['const a = value.scale;', ['serializer-decimal-internals']],
    ["const a = value['units'];", ['serializer-decimal-internals']],
    ['const { units, scale } = value;', ['serializer-decimal-internals', 'serializer-decimal-internals']],
    ['const { units: u } = value;', ['serializer-decimal-internals']],
    ['let a = 1; a++;', ['serializer-arithmetic']],
    ['let a = 1; --a;', ['serializer-arithmetic']],
    ['const a = x << 2;', ['serializer-arithmetic']],
    ['const a = x | y;', ['serializer-arithmetic']],
    ["import * as decimal from './decimal.ts';", ['serializer-money-import']],
    ["import { add } from './decimal';", ['serializer-money-import']],
    ["import { parseDecimalInput } from './number-notation.ts';", ['serializer-money-import']],
    ["import { add as sum } from '../xrechnung/decimal.ts';", ['serializer-money-import']],
    ["import { add } from './decimal.ts';", ['serializer-money-import']],
    ["import { multiply, roundHalfUp } from './decimal.ts';", ['serializer-money-import', 'serializer-money-import']],
    ["import { parseDecimal } from './decimal.ts';", ['serializer-money-import']],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(rules(findSerializerArithmeticViolations('ubl.ts', source)), expected, source);
  }
});

test('serializer rules: string building, type-only imports and the XML decimal formatter are allowed', () => {
  const clean = [
    "const a = 'x' + name + 'y';",
    "import type { Decimal } from './decimal.ts';",
    "import { type Decimal, formatDecimal } from './decimal.ts';",
    "import { formatXmlDecimal } from './number-notation.ts';",
    'const a = `${indent}<cbc:ID>${id}</cbc:ID>`;',
  ];
  for (const source of clean) assert.deepEqual(findSerializerArithmeticViolations('ubl.ts', source), [], source);
});

// ------------------------------------------------------------- the real domain sources

function domainSources(): { file: string; source: string }[] {
  return (readdirSync(DOMAIN_DIR, { recursive: true }) as string[])
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(DOMAIN_DIR, name))
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }));
}

test('the domain money code contains no binary floating-point route', () => {
  const files = domainSources();
  assert.ok(files.length >= 3, 'the scan must actually find the domain files');
  for (const { file, source } of files) {
    assert.deepEqual(findFloatMoneyViolations(file, source), [], file);
  }
});

test('the domain code is framework-independent and confines UBL knowledge to the serializer', () => {
  for (const { file, source } of domainSources()) {
    assert.deepEqual(findBoundaryViolations(file, source, { allowUbl: file === UBL_FILE }), [], file);
  }
});

// A heuristic guard, not a proof: `+` is allowed (it also builds strings), so a summation through `+` on values that
// were obtained some other way would pass. What actually establishes the amounts is the independent oracle in the
// serializer tests and the local validator run; this check keeps the obvious routes closed.
test('the UBL serializer passes the arithmetic and Decimal-internals heuristic guard', () => {
  assert.ok(existsSync(UBL_FILE), 'the serializer file must exist');
  assert.deepEqual(findSerializerArithmeticViolations(UBL_FILE, readFileSync(UBL_FILE, 'utf8')), []);
});
