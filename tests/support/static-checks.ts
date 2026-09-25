// AST-based static checks over domain sources, used by tests only. They use the TypeScript compiler API that is
// already a devDependency. Working on the AST (not on text) means comments and string contents never trigger a rule.

import ts from 'typescript';

export type Violation = { readonly rule: string; readonly line: number; readonly text: string };

type Visitor = (node: ts.Node, report: (rule: string) => void, sourceFile: ts.SourceFile) => void;

function scan(fileName: string, source: string, visit: Visitor): Violation[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  const walk = (node: ts.Node): void => {
    visit(
      node,
      (rule) => {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({ rule, line: line + 1, text: node.getText(sourceFile).slice(0, 80) });
      },
      sourceFile,
    );
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return violations;
}

// ---------------------------------------------------------------------------------------------------------------
// V1 monetary policy: no monetary value or decimal input passes through binary floating-point.
// Allowed: Math.max / Math.min (integer scale arithmetic), bigint arithmetic, the `number` type for integer scales.

const FLOAT_IDENTIFIERS = new Set(['Number', 'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'Intl']);
const ALLOWED_MATH = new Set(['max', 'min']);
const FLOAT_FORMAT_METHODS = new Set(['toFixed', 'toPrecision', 'toExponential', 'toLocaleString']);
const COERCING_OPERATORS = new Set([ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskAsteriskToken]);

export function findFloatMoneyViolations(fileName: string, source: string): Violation[] {
  return scan(fileName, source, (node, report, sourceFile) => {
    // Property names count too (`other.parseFloat`), which is stricter than needed but never wrong in money code.
    if (ts.isIdentifier(node) && FLOAT_IDENTIFIERS.has(node.text)) report('float-identifier');

    if (ts.isIdentifier(node) && node.text === 'globalThis') report('float-global');
    if (ts.isIdentifier(node) && (node.text === 'eval' || node.text === 'Function')) report('dynamic-code');

    if (ts.isIdentifier(node) && node.text === 'Math' && !isAllowedMathAccess(node)) report('float-math');

    if (ts.isPropertyAccessExpression(node) && FLOAT_FORMAT_METHODS.has(node.name.text)) report('float-format-method');
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'JSON' && node.name.text === 'parse') {
      report('float-json-parse');
    }

    // Element access with a string literal names the same members: x['toFixed'] (Math[...] is caught above).
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const member = node.argumentExpression.text;
      if (FLOAT_FORMAT_METHODS.has(member)) report('float-format-method');
    }

    // Arithmetic with a string literal operand coerces the string to a binary floating-point number.
    if (ts.isBinaryExpression(node) && COERCING_OPERATORS.has(node.operatorToken.kind) && (ts.isStringLiteralLike(node.left) || ts.isStringLiteralLike(node.right))) {
      report('string-coercion');
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isStringLiteralLike(node.operand)) report('string-coercion');

    // NumericLiteral.text is the normalised value ("1e3" reads "1000"), so the source spelling is what is inspected.
    if (ts.isNumericLiteral(node)) {
      const spelling = node.getText(sourceFile);
      if (!/^0[xXbBoO]/.test(spelling) && /[.eE]/.test(spelling)) report('float-literal');
    }

    // Unary plus coerces its operand to a binary floating-point number. The literal `+1` is not a coercion.
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken && !ts.isNumericLiteral(node.operand)) {
      report('unary-plus-coercion');
    }
  });
}

function isPropertyName(node: ts.Identifier): boolean {  // used for the DOM and network names only
  const parent = node.parent;
  return ts.isPropertyAccessExpression(parent) && parent.name === node;
}

function isAllowedMathAccess(node: ts.Identifier): boolean {
  const parent = node.parent;
  return ts.isPropertyAccessExpression(parent) && parent.expression === node && ALLOWED_MATH.has(parent.name.text);
}

// ---------------------------------------------------------------------------------------------------------------
// AGENTS.md section 7 and the syntax-independent semantic model: domain code is framework-independent, and
// UBL-specific structures exist only in the serializer.

const DOM_OR_NETWORK = new Set(['document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'fetch', 'XMLHttpRequest']);
const FRAMEWORK_IMPORT = /^(astro|svelte|@astrojs\/)/;
const UBL_TEXT = /urn:oasis:names:specification:ubl|\bc[ab]c:/;

export function findBoundaryViolations(fileName: string, source: string, options: { allowUbl: boolean }): Violation[] {
  return scan(fileName, source, (node, report) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && FRAMEWORK_IMPORT.test(node.moduleSpecifier.text)) {
      report('framework-import');
    }

    if (ts.isIdentifier(node) && DOM_OR_NETWORK.has(node.text) && !isPropertyName(node)) report('dom-or-network');

    const text = literalText(node);
    if (text !== undefined && !options.allowUbl && UBL_TEXT.test(text)) report('ubl-outside-serializer');
  });
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// The serializer takes every monetary value from the existing calculation and never recalculates.
// Ceiling: `+` is allowed because it also builds strings, so a summation through `+` would not be caught here; the
// serializer cannot reach a Decimal's `units`/`scale` (rule below), which is what a sum would need.

const ARITHMETIC_OPERATORS = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
]);
const DECIMAL_INTERNALS = new Set(['units', 'scale']);
const MONEY_MODULE = /(^|\/)(decimal|number-notation)(\.ts)?$/;
const MONEY_ENGINE_FUNCTIONS = new Set(['add', 'multiply', 'roundHalfUp', 'parseDecimal', 'parseDecimalInput']);

export function findSerializerArithmeticViolations(fileName: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);

  const report = (node: ts.Node, rule: string): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({ rule, line: line + 1, text: node.getText(sourceFile).slice(0, 80) });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ARITHMETIC_OPERATORS.has(node.operatorToken.kind)) report(node, 'serializer-arithmetic');

    if (ts.isPropertyAccessExpression(node) && DECIMAL_INTERNALS.has(node.name.text)) report(node, 'serializer-decimal-internals');
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && DECIMAL_INTERNALS.has(node.argumentExpression.text)) {
      report(node, 'serializer-decimal-internals');
    }
    if (ts.isBindingElement(node) && DECIMAL_INTERNALS.has((node.propertyName ?? node.name).getText(sourceFile))) report(node, 'serializer-decimal-internals');

    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      report(node, 'serializer-arithmetic');
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && MONEY_MODULE.test(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause && clause.phaseModifier !== ts.SyntaxKind.TypeKeyword && clause.namedBindings) {
        // A namespace import would reach every function of the money engine, so it is refused outright.
        if (ts.isNamespaceImport(clause.namedBindings)) report(node, 'serializer-money-import');
        else {
          for (const element of clause.namedBindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (!element.isTypeOnly && MONEY_ENGINE_FUNCTIONS.has(imported)) report(element, 'serializer-money-import');
          }
        }
      }
    }

    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return violations;
}
