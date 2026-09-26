// Mechanical MDR-14 rule inventory for the preregistered CII experiment (tests/fixtures/xrechnung/cii-experiment).
// Development only, like validate.ts: it needs the official XRechnung bundle, which is not part of the repository.
//
//   ORKAID_KOSIT_BUNDLE=/path/to/xrechnung-3.0.2-bundle-2026-08-31.zip node tools/kosit/rule-inventory.ts [--write]
//
// Without --write it regenerates the inventory and fails unless it equals the committed file byte for byte.
// For every exercised decimal term it records the SeMoX UBL and CII paths, the XSD type chain reached by walking the
// path through the scenario's schema, and the ids of the Schematron assertions of the scenario that mention the term.
// Only ids, paths, types and hashes are written; no rule bodies. Ceiling: the XSD and XSLT files are read with
// targeted patterns (they are machine generated with stable formatting), not with a general XML parser.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const OUTPUT = join(ROOT, 'tests/fixtures/xrechnung/cii-experiment/rule-inventory.json');
const MODEL_ENTRY = 'xrechnung-3.0.2-xrechnung-model-2026-08-31.zip';
const MODEL_FILE = 'model/xrechnung-cius-model.xml';
const SCENARIOS = { ubl: 'EN16931 XRechnung (UBL Invoice)', cii: 'EN16931 XRechnung (CII)' } as const;
const BINDINGS = { ubl: 'ubl-inv', cii: 'cii' } as const;
// Terms exercised by the projection (PROTOCOL.md section 5). The decimal ones are selected by their SeMoX datatype.
const EXERCISED = ['BT-106', 'BT-109', 'BT-110', 'BT-112', 'BT-115', 'BT-116', 'BT-117', 'BT-119', 'BT-129', 'BT-131', 'BT-146', 'BT-152'];
const DECIMAL_DATATYPES = ['amount', 'upa', 'quantity', 'percentage'];
const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

type Syntax = keyof typeof SCENARIOS;
type Manifest = { bundle: { sha256: string }; configuration: { archiveEntry: string; sha256: string } };

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function fail(message: string): never {
  console.error(`rule-inventory: ${message}`);
  process.exit(2);
}

function unzip(args: string[]): void {
  const result = spawnSync('unzip', ['-o', '-q', ...args], { encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`unzip failed: ${result.error?.message ?? result.stderr.trim()}`);
}

// ------------------------------------------------------------------------------------------------ inputs

function prepare(manifest: Manifest): { config: string; model: string; modelArchiveSha256: string } {
  const bundle = process.env.ORKAID_KOSIT_BUNDLE;
  if (!bundle || !existsSync(bundle)) fail('set ORKAID_KOSIT_BUNDLE to the local official bundle zip (see tools/kosit/kosit-manifest.json).');
  if (sha256(readFileSync(bundle)) !== manifest.bundle.sha256) fail('bundle hash mismatch');

  const work = join(ROOT, '.cache/kosit/inventory');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  unzip([bundle, manifest.configuration.archiveEntry, MODEL_ENTRY, '-d', work]);
  const configZip = join(work, manifest.configuration.archiveEntry);
  if (sha256(readFileSync(configZip)) !== manifest.configuration.sha256) fail('validator configuration hash mismatch');
  const modelZip = join(work, MODEL_ENTRY);
  unzip([configZip, '-d', join(work, 'config')]);
  unzip([modelZip, '-d', join(work, 'model')]);
  return { config: join(work, 'config'), model: join(work, 'model', MODEL_FILE), modelArchiveSha256: sha256(readFileSync(modelZip)) };
}

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

function namespaces(startTag: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [, prefix = '', uri = ''] of startTag.matchAll(/\sxmlns(?::([\w.-]+))?="([^"]*)"/g)) map[prefix] = uri;
  return map;
}

// ------------------------------------------------------------------------------------------------ scenarios

type Scenario = { schemas: string[]; schematrons: string[]; customLevels: Record<string, string> };

function readScenario(configuration: string, name: string): Scenario {
  const text = readFileSync(join(configuration, 'scenarios.xml'), 'utf8');
  const block = [...text.matchAll(/<scenario>([\s\S]*?)<\/scenario>/g)].map((m) => m[1] ?? '').find((b) => /<name>([^<]*)<\/name>/.exec(b)?.[1] === name);
  if (block === undefined) fail(`scenario not found: ${name}`);
  const locations = (element: string) =>
    [...block.matchAll(new RegExp(`<${element}>([\\s\\S]*?)</${element}>`, 'g'))].map((m) => /<location>([^<]*)<\/location>/.exec(m[1] ?? '')?.[1]?.trim() ?? fail(`no location in ${element}`));
  const customLevels: Record<string, string> = {};
  for (const [, level = '', id = ''] of block.matchAll(/<customLevel level="([^"]*)">([^<]*)<\/customLevel>/g)) customLevels[id.trim()] = level;
  return { schemas: locations('validateWithXmlSchema'), schematrons: locations('validateWithSchematron'), customLevels };
}

// ------------------------------------------------------------------------------------------------ SeMoX

type Binding = { namespaces: Record<string, string>; paths: Record<string, string[]> };

function readModel(model: string): { datatypes: Record<string, string>; bindings: Record<string, Binding> } {
  const text = readFileSync(model, 'utf8');
  const datatypes: Record<string, string> = {};
  for (const [, id = '', datatype = ''] of text.matchAll(/<m:term id="(BT-\d+)" datatype="([^"]+)"/g)) datatypes[id] = datatype;
  const bindings: Record<string, Binding> = {};
  for (const [, start = '', body = ''] of text.matchAll(/(<m:binding id="[^"]+"[^>]*>)([\s\S]*?)<\/m:binding>/g)) {
    const paths: Record<string, string[]> = {};
    for (const [, term = '', xpath = ''] of body.matchAll(/<m:term ref="(B[TG]-\d+)"\s+xpath="([^"]*)"/g)) (paths[term] ??= []).push(xpath);
    bindings[attr(start, 'id') ?? ''] = { namespaces: namespaces(start), paths };
  }
  return { datatypes, bindings };
}

// ------------------------------------------------------------------------------------------------ XSD

type Qualified = { namespace: string; name: string };
type TypeDefinition = { file: string; prefixes: Record<string, string>; body: string };
// `used` collects the schema files a walk actually reads; only those are hashed into the inventory.
type SchemaIndex = { elements: Map<string, { file: string; prefixes: Record<string, string>; tag: string }>; types: Map<string, TypeDefinition>; used: Set<string> };

const key = (q: Qualified): string => `{${q.namespace}}${q.name}`;

function resolveQName(qname: string, prefixes: Record<string, string>): Qualified {
  const [prefix, name] = qname.includes(':') ? (qname.split(':') as [string, string]) : ['', qname];
  const namespace = prefixes[prefix];
  if (namespace === undefined) fail(`unknown prefix in ${qname}`);
  return { namespace, name };
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(directory, entry.name)) : entry.name.endsWith('.xsd') ? [join(directory, entry.name)] : [],
  );
}

function indexSchemas(directory: string): SchemaIndex {
  const index: SchemaIndex = { elements: new Map(), types: new Map(), used: new Set() };
  for (const file of listFiles(directory).sort()) {
    const text = readFileSync(file, 'utf8').replace(/<xsd:annotation>[\s\S]*?<\/xsd:annotation>/g, '');
    const start = /<xsd:schema\b[^>]*>/.exec(text)?.[0];
    if (start === undefined) continue;
    const prefixes = namespaces(start);
    const target = attr(start, 'targetNamespace') ?? '';
    // Global element declarations are direct children of xsd:schema; local ones sit inside complex types.
    const global = text.replace(/<xsd:complexType\b[\s\S]*?<\/xsd:complexType>/g, '');
    for (const [tag] of global.matchAll(/<xsd:element\b[^>]*>/g)) {
      const name = attr(tag, 'name');
      if (name !== undefined) index.elements.set(key({ namespace: target, name }), { file, prefixes, tag });
    }
    for (const [, kind = '', name = '', body = ''] of text.matchAll(/<xsd:(complexType|simpleType) name="([^"]+)"[^>]*>([\s\S]*?)<\/xsd:\1>/g)) {
      index.types.set(key({ namespace: target, name: `${kind}:${name}` }), { file, prefixes, body });
    }
  }
  return index;
}

function findType(index: SchemaIndex, q: Qualified): TypeDefinition | undefined {
  const definition = index.types.get(key({ namespace: q.namespace, name: `complexType:${q.name}` })) ?? index.types.get(key({ namespace: q.namespace, name: `simpleType:${q.name}` }));
  if (definition !== undefined) index.used.add(definition.file);
  return definition;
}

type TypeChain = { chain: string[]; facets: Record<string, string>; attributes: Record<string, string> };

function typeChain(index: SchemaIndex, start: Qualified, root: string): TypeChain {
  const chain: string[] = [];
  const facets: Record<string, string> = {};
  const attributes: Record<string, string> = {};
  let current: Qualified | undefined = start;
  while (current !== undefined) {
    if (current.namespace === XSD_NAMESPACE) {
      chain.push(`xsd:${current.name}`);
      break;
    }
    const definition = findType(index, current);
    if (definition === undefined) fail(`type not found: ${key(current)}`);
    chain.push(`${current.name} (${relative(root, definition.file)})`);
    // A restriction overrides what it restricts, so the first occurrence along the chain wins.
    for (const [, facet = '', value = ''] of definition.body.matchAll(/<xsd:(fractionDigits|totalDigits|pattern|minInclusive|maxInclusive|minExclusive|maxExclusive|length|minLength|maxLength)\s+value="([^"]*)"/g)) facets[facet] ??= value;
    for (const [tag] of definition.body.matchAll(/<xsd:attribute\b[^>]*>/g)) {
      const name = attr(tag, 'name');
      if (name !== undefined) attributes[name] ??= attr(tag, 'use') ?? 'optional';
    }
    const base = /<xsd:(?:extension|restriction) base="([^"]+)"/.exec(definition.body)?.[1];
    current = base === undefined ? undefined : resolveQName(base, definition.prefixes);
  }
  return { chain, facets, attributes };
}

// Walks an absolute SeMoX path (predicates dropped) from the global root element through the declared children.
function walk(index: SchemaIndex, xpath: string, bindingNamespaces: Record<string, string>, root: string): TypeChain {
  const steps = xpath.replace(/\[[^\]]*\]/g, '').split('/').filter(Boolean);
  let element: { tag: string; prefixes: Record<string, string>; namespace: string } | undefined;
  for (const step of steps) {
    const wanted = resolveQName(step, bindingNamespaces);
    if (element === undefined) {
      const declared = index.elements.get(key(wanted));
      if (declared === undefined) fail(`root element not found: ${step}`);
      index.used.add(declared.file);
      element = { tag: declared.tag, prefixes: declared.prefixes, namespace: wanted.namespace };
      continue;
    }
    const typeName = attr(element.tag, 'type');
    if (typeName === undefined) fail(`element without type before ${step} in ${xpath}`);
    const definition = findType(index, resolveQName(typeName, element.prefixes));
    if (definition === undefined) fail(`type not found: ${typeName}`);
    const target = attr(/<xsd:schema\b[^>]*>/.exec(readFileSync(definition.file, 'utf8'))?.[0] ?? '', 'targetNamespace') ?? '';
    let next: typeof element | undefined;
    for (const [tag] of definition.body.matchAll(/<xsd:element\b[^>]*>/g)) {
      const name = attr(tag, 'name');
      const ref = attr(tag, 'ref');
      if (name !== undefined && target === wanted.namespace && name === wanted.name) next = { tag, prefixes: definition.prefixes, namespace: target };
      if (ref !== undefined && key(resolveQName(ref, definition.prefixes)) === key(wanted)) {
        const declared = index.elements.get(key(wanted));
        if (declared === undefined) fail(`referenced element not found: ${ref}`);
        index.used.add(declared.file);
        next = { tag: declared.tag, prefixes: declared.prefixes, namespace: wanted.namespace };
      }
    }
    if (next === undefined) fail(`step ${step} not declared in ${typeName} (${xpath})`);
    element = next;
  }
  const typeName = element === undefined ? undefined : attr(element.tag, 'type');
  if (element === undefined || typeName === undefined) fail(`no type at the end of ${xpath}`);
  return typeChain(index, resolveQName(typeName, element.prefixes), root);
}

// ------------------------------------------------------------------------------------------------ Schematron

type Assertion = { id: string; flag: string; searchable: string; text: string };

function readAssertions(file: string): Assertion[] {
  const text = readFileSync(file, 'utf8');
  const globals: Record<string, string> = {};
  for (const [tag] of text.matchAll(/<xsl:param\b[^>]*>/g)) {
    const name = attr(tag, 'name');
    const select = attr(tag, 'select');
    if (name !== undefined && select !== undefined) globals[name] = select;
  }
  const assertions: Assertion[] = [];
  for (const template of text.split('<xsl:template ').slice(1)) {
    const context = /^match="([^"]*)"/.exec(template)?.[1] ?? '';
    const locals: Record<string, string> = { ...globals };
    for (const [tag] of template.matchAll(/<xsl:variable\b[^>]*>/g)) {
      const name = attr(tag, 'name');
      const select = attr(tag, 'select');
      if (name !== undefined && select !== undefined) locals[name] = select;
    }
    for (const [, test = '', kind = '', tag = '', body = ''] of template.matchAll(/<xsl:if test="([^"]*)">\s*<svrl:(failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:\2>/g)) {
      const id = attr(tag, 'id');
      if (id === undefined) fail(`${kind} without id in ${file}`);
      const variables = [...test.matchAll(/\$([\w.-]+)/g)].map(([, name = '']) => locals[name] ?? '');
      assertions.push({ id, flag: attr(tag, 'flag') ?? '', searchable: [context, test, ...variables].join('\n'), text: /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(body)?.[1] ?? '' });
    }
  }
  return assertions;
}

// A path token matches the element's local name with any prefix; a text token matches the term id in the message.
function matches(assertion: Assertion, localName: string, term: string): string[] {
  const basis: string[] = [];
  if (new RegExp(`(?<![\\w.:-])(?:[\\w-]+:)?${localName}(?![\\w.-])`).test(assertion.searchable)) basis.push('path');
  if (new RegExp(`\\b${term}(?![0-9])`).test(assertion.text)) basis.push('text');
  return basis;
}

// ------------------------------------------------------------------------------------------------ inventory

function buildInventory(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tools/kosit/kosit-manifest.json'), 'utf8')) as Manifest;
  const { config, model, modelArchiveSha256 } = prepare(manifest);
  const { datatypes, bindings } = readModel(model);
  const resources = new Map<string, string>();
  const hashed = (file: string): string => {
    const path = relative(config, file);
    resources.set(path, sha256(readFileSync(file)));
    return path;
  };

  const scenarios = {} as Record<Syntax, { name: string; schemaFiles: string[]; schematronFiles: string[]; customLevels: Record<string, string> }>;
  const indexes = {} as Record<Syntax, SchemaIndex>;
  const assertions = {} as Record<Syntax, { file: string; list: Assertion[] }[]>;
  for (const syntax of ['ubl', 'cii'] as const) {
    const scenario = readScenario(config, SCENARIOS[syntax]);
    const schemaDirectory = join(config, (scenario.schemas[0] ?? fail('no schema')).split('/').slice(0, -2).join('/'));
    indexes[syntax] = indexSchemas(schemaDirectory);
    assertions[syntax] = scenario.schematrons.map((location) => ({ file: hashed(join(config, location)), list: readAssertions(join(config, location)) }));
    scenarios[syntax] = {
      name: SCENARIOS[syntax],
      schemaFiles: [], // filled after the walks, with the files they read
      schematronFiles: assertions[syntax].map((a) => a.file),
      customLevels: scenario.customLevels,
    };
  }

  const terms = EXERCISED.filter((term) => DECIMAL_DATATYPES.includes(datatypes[term] ?? '')).map((term) => {
    const entry: Record<string, unknown> = { term, semoxDatatype: datatypes[term] };
    for (const syntax of ['ubl', 'cii'] as const) {
      const binding = bindings[BINDINGS[syntax]] ?? fail(`binding ${BINDINGS[syntax]} missing`);
      const paths = binding.paths[term] ?? fail(`${term} has no ${syntax} path`);
      const localName = (paths[0] ?? '').replace(/\[[^\]]*\]/g, '').split('/').pop()?.split(':').pop() ?? '';
      const rules: Record<string, { id: string; flag: string; level?: string; basis: string[] }[]> = {};
      for (const { file, list } of assertions[syntax]) {
        const found = new Map<string, { id: string; flag: string; level?: string; basis: string[] }>();
        for (const assertion of list) {
          const basis = matches(assertion, localName, term);
          if (basis.length === 0) continue;
          const previous = found.get(assertion.id);
          const level = scenarios[syntax].customLevels[assertion.id];
          found.set(assertion.id, { id: assertion.id, flag: assertion.flag, ...(level ? { level } : {}), basis: [...new Set([...(previous?.basis ?? []), ...basis])].sort() });
        }
        rules[file] = [...found.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
      }
      entry[syntax] = { paths, xsd: walk(indexes[syntax], paths[0] ?? '', binding.namespaces, config), rules };
    }
    return entry;
  });
  for (const syntax of ['ubl', 'cii'] as const) scenarios[syntax].schemaFiles = [...indexes[syntax].used].sort().map(hashed);

  const inventory = {
    purpose: 'Preregistered MDR-14 rule inventory for the Increment 3 CII experiment. Generated by tools/kosit/rule-inventory.ts from the pinned artifacts; rule bodies are not reproduced.',
    selection: 'Terms: the exercised projection terms whose SeMoX datatype is amount, upa, quantity or percentage. Rules: every assertion of the scenario Schematron files whose context, test, or referenced variable/parameter mentions the local name of the term\'s element (basis "path"), or whose message names the term (basis "text"). Over-inclusion is intended.',
    pinned: { bundleSha256: manifest.bundle.sha256, configurationSha256: manifest.configuration.sha256, modelArchive: MODEL_ENTRY, modelArchiveSha256, modelFile: MODEL_FILE, modelFileSha256: sha256(readFileSync(model)) },
    scenarios,
    resources: Object.fromEntries([...resources.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))),
    terms,
  };
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

const generated = buildInventory();
if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, generated);
  console.log(`written ${relative(ROOT, OUTPUT)} (sha256 ${sha256(generated)})`);
} else {
  const committed = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (committed !== generated) fail(`${relative(ROOT, OUTPUT)} differs from the regenerated inventory`);
  console.log(`rule inventory reproduced byte for byte (sha256 ${sha256(generated)})`);
}
