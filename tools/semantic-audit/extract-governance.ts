// Deterministic extraction of governance units from the allowlisted Markdown sources (governance/sources.json).
// Development tooling only; nothing here is part of the Orkaid product, and nothing here touches the network.
//
//   node tools/semantic-audit/extract-governance.ts     # print the units and candidate pairs as JSON
//
// A unit is one rule-sized block: a paragraph, one item of an unordered list, or a whole ordered list (the order is
// part of its meaning). A paragraph ending in ':' directly before a list is that list's lead-in and is kept in every
// unit made from the list, so an item never loses the condition it belongs to. Headings, horizontal rules, fenced
// code, YAML frontmatter and `@file` import lines are not units. The same bytes always give the same units and ids.
//
// Candidate pairs for the cross-document question come from shared topic tags. Tags only select candidates for a
// judgment; they never decide a finding. Ceiling: a conflict between two rules with no shared tag is not paired.
//
// A source whose role is `delegating` (it routes to another source rather than stating policy of its own) is never
// paired with the source it delegates to: restated policy is not a second authority that could conflict with the
// first. That classification is owner policy for exact bytes, so a delegating source whose hash has changed blocks
// extraction until the owner reclassifies it.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Blocked } from './policy.ts';

export const ROOT = resolve(import.meta.dirname, '../..');
export const SOURCES_PATH = 'tools/semantic-audit/governance/sources.json';

export type Authority = { readonly rank: number; readonly label: string };
export type SourceStatus = 'normative' | 'descriptive' | 'provisional' | 'historical';

export type GovernanceUnit = {
  readonly rule_id: string; // `${document}#${sectionKey}.${ordinal}`
  readonly document: string; // repository-relative path
  readonly section: string; // heading text, with a bold sub-label where one applies
  readonly line: number; // 1-based first line of the unit
  readonly authority: Authority;
  readonly status: SourceStatus;
  readonly text: string;
  readonly text_sha256: string;
  readonly tags: readonly string[];
  readonly open_marker: boolean;
  readonly related_rules: readonly string[];
};

export type UnitPair = { readonly a: string; readonly b: string; readonly shared_tags: readonly string[] };

export type SourceRole =
  | { readonly kind: 'independent' }
  | { readonly kind: 'delegating'; readonly delegates_to: string; readonly classified_sha256: string };

export type Sources = {
  readonly precedence_rule: string;
  readonly pair_tags: readonly string[]; // tags that make a pair worth a cross-document judgment (policy input)
  readonly audited: readonly { readonly path: string; readonly authority: Authority; readonly status: SourceStatus; readonly role: SourceRole }[];
};

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

// Topic vocabulary for candidate selection. Word-boundary, case-insensitive, on the unit text.
const TAGS: readonly (readonly [string, RegExp])[] = [
  ['external-mutation', /\b(push|merge|deploy(ment)?|release|publish(ed|ing)?|tag publication|dns)\b/i],
  ['git', /\b(git|branch|worktree|commit|main)\b/i],
  ['dependency', /\b(dependenc(y|ies)|package|lockfile|npm|upgrade)\b/i],
  ['verification', /\b(tests?|verif(y|ication|ied)|checks?|build|audit|evidence)\b/i],
  ['secrets', /\b(secrets?|credentials?|api keys?|access tokens?|\.env\S*|cookies?|passwords?)\b|\.env\*/i],
  ['ai', /\b(ai|llm|model|agents?|subagents?)\b/i],
  ['decision-state', /\b(OPEN|DECIDED|IMPLEMENTED|PROPOSED|DEFERRED|decisions?|MDRs?|ledger)\b/],
  ['failure', /\b(fail(s|ure|ing)?|errors?|invalid|unsupported|unavailable|missing|mismatch(es)?|does not match|reject(ed|s)?|block(ed|s)?|fallback|degrad(e|ing))\b/i],
  ['infrastructure', /\b(server|ssr|persistence|d1|r2|kv|durable objects|queues?|vps|docker|wrangler|cloudflare|infrastructure)\b/i],
  ['regulatory', /\b(legal|law|regulatory|xrechnung|en 16931|ubl|cii|kosit|gobd|ustg|ao|hgb|tax|compliance|conformance)\b/i],
  ['publication', /\b(public|private|publication|copy|claims?)\b/i],
  ['authority', /\b(authority|authorization|instruction|precedence|conflict)\b/i],
];

// `OPEN` is the decision state and is matched in capitals only, so "open-source" is not a marker.
const OPEN_STATE = /\bOPEN\b/;
const OPEN_WORDING = /\b(provisional|deferred|not (yet )?decided|undecided|unresolved)\b/i;

export function tagsFor(text: string): string[] {
  return TAGS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

export function hasOpenMarker(text: string): boolean {
  return OPEN_STATE.test(text) || OPEN_WORDING.test(text);
}

type RawUnit = { sectionKey: string; section: string; line: number; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const BOLD_ONLY = /^\*\*([^*].*)\*\*$/;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sectionKeyOf(heading: string): string {
  const numbered = /^(\d+)\.\s/.exec(heading);
  return numbered ? numbered[1] as string : slug(heading);
}

/** Splits one Markdown document into raw units. Pure: depends only on the text. */
export function parseMarkdownUnits(content: string): RawUnit[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const units: RawUnit[] = [];

  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }

  let section = '';
  let sectionKey = 'preamble';
  let subLabel = '';
  let paragraph: { line: number; lines: string[] } | undefined;
  let leadIn: { line: number; text: string } | undefined;
  let list: { line: number; ordered: boolean; items: { line: number; text: string }[] } | undefined;
  let inFence = false;

  const key = () => (subLabel ? `${sectionKey}-${slug(subLabel)}` : sectionKey);
  const label = () => (subLabel ? `${section} › ${subLabel}` : section);

  const flushParagraph = () => {
    if (!paragraph) return;
    units.push({ sectionKey: key(), section: label(), line: paragraph.line, text: paragraph.lines.join('\n') });
    paragraph = undefined;
  };
  const flushList = () => {
    if (!list) return;
    const prefix = leadIn ? `${leadIn.text}\n` : '';
    const line = leadIn ? leadIn.line : list.line;
    if (list.ordered) {
      units.push({ sectionKey: key(), section: label(), line, text: prefix + list.items.map((item) => item.text).join('\n') });
    } else {
      for (const item of list.items) units.push({ sectionKey: key(), section: label(), line: leadIn ? leadIn.line : item.line, text: prefix + item.text });
    }
    list = undefined;
    leadIn = undefined;
  };
  // A paragraph that ends in ':' waits: if a list follows it becomes the lead-in, otherwise it is an ordinary unit.
  const endParagraph = () => {
    if (paragraph && paragraph.lines.at(-1)?.endsWith(':')) {
      leadIn = { line: paragraph.line, text: paragraph.lines.join('\n') };
      paragraph = undefined;
    } else {
      flushParagraph();
    }
  };
  const dropPendingLeadIn = () => {
    if (leadIn) units.push({ sectionKey: key(), section: label(), line: leadIn.line, text: leadIn.text });
    leadIn = undefined;
  };

  for (let index = start; index < lines.length; index++) {
    const raw = lines[index] as string;
    const lineNumber = index + 1;

    if (raw.trimStart().startsWith('```')) {
      endParagraph();
      flushList();
      dropPendingLeadIn();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (raw.trim() === '') {
      if (list) flushList();
      else endParagraph();
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading || /^(-{3,}|\*{3,})$/.test(raw.trim()) || /^@\S+$/.test(raw.trim())) {
      flushParagraph();
      flushList();
      dropPendingLeadIn();
      if (heading) {
        const level = (heading[1] as string).length;
        const text = (heading[2] as string).trim();
        if (level <= 2) {
          section = text;
          sectionKey = level === 1 ? 'preamble' : sectionKeyOf(text);
          subLabel = '';
        } else {
          subLabel = text;
        }
      }
      continue;
    }

    const bold = BOLD_ONLY.exec(raw.trim());
    if (bold && !paragraph && !list) {
      const next = lines.slice(index + 1).find((candidate) => candidate.trim() !== '');
      if (next !== undefined && LIST_ITEM.test(next)) {
        dropPendingLeadIn();
        subLabel = bold[1] as string;
        continue;
      }
    }

    const item = LIST_ITEM.exec(raw);
    if (item && !paragraph) {
      const indent = (item[1] as string).length;
      const ordered = /\d+\./.test(item[2] as string);
      if (list && indent > 0) {
        const last = list.items.at(-1) as { text: string };
        last.text += `\n${raw.trim()}`;
      } else {
        if (!list) list = { line: lineNumber, ordered, items: [] };
        list.items.push({ line: lineNumber, text: ordered ? raw.trim() : `- ${item[3]}` });
      }
      continue;
    }

    if (list) {
      // An indented continuation line belongs to the current item; anything else ends the list.
      if (/^\s+\S/.test(raw)) {
        const last = list.items.at(-1) as { text: string };
        last.text += ` ${raw.trim()}`;
        continue;
      }
      flushList();
    }

    if (leadIn && !paragraph) {
      // Text after a lead-in without a list in between: the lead-in was an ordinary paragraph.
      dropPendingLeadIn();
    }
    if (!paragraph) paragraph = { line: lineNumber, lines: [] };
    paragraph.lines.push(raw.trim());
  }
  flushParagraph();
  flushList();
  dropPendingLeadIn();
  return units;
}

export function loadSources(root = ROOT): Sources {
  return JSON.parse(readFileSync(join(root, SOURCES_PATH), 'utf8')) as Sources;
}

export function extractUnits(root = ROOT, sources = loadSources(root)): { units: GovernanceUnit[]; pairs: UnitPair[] } {
  const draft: Omit<GovernanceUnit, 'related_rules'>[] = [];
  const delegations = new Map<string, string>();
  for (const source of sources.audited) {
    const content = readFileSync(join(root, source.path), 'utf8');
    if (source.role.kind === 'delegating') {
      if (sha256(content) !== source.role.classified_sha256) {
        throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${source.path} changed since the owner classified it as delegating to ${source.role.delegates_to}; reclassify it in ${SOURCES_PATH}`);
      }
      delegations.set(source.path, source.role.delegates_to);
    } else if (source.role.kind !== 'independent') {
      throw new Blocked('BLOCKED_PROFILE_OR_RESPONSE_INVALID', `${source.path} has no valid role in ${SOURCES_PATH}`);
    }
    const ordinals = new Map<string, number>();
    for (const raw of parseMarkdownUnits(content)) {
      const ordinal = (ordinals.get(raw.sectionKey) ?? 0) + 1;
      ordinals.set(raw.sectionKey, ordinal);
      draft.push({
        rule_id: `${source.path}#${raw.sectionKey}.${ordinal}`,
        document: source.path,
        section: raw.section,
        line: raw.line,
        authority: source.authority,
        status: source.status,
        text: raw.text,
        text_sha256: sha256(raw.text),
        tags: tagsFor(raw.text),
        open_marker: hasOpenMarker(raw.text),
      });
    }
  }

  const pairs = candidatePairs(draft, new Set(sources.pair_tags), delegations);
  const related = new Map<string, string[]>();
  for (const pair of pairs) {
    related.set(pair.a, [...(related.get(pair.a) ?? []), pair.b]);
    related.set(pair.b, [...(related.get(pair.b) ?? []), pair.a]);
  }
  return { units: draft.map((unit) => ({ ...unit, related_rules: related.get(unit.rule_id) ?? [] })), pairs };
}

type PairInput = Pick<GovernanceUnit, 'rule_id' | 'document' | 'tags'>;

/**
 * Units in different sections (or documents) that share a pair-worthy tag, except a delegating document paired with
 * the document it delegates to (`delegations`: document -> delegate). Deterministic order.
 */
export function candidatePairs(units: readonly PairInput[], pairTags: ReadonlySet<string>, delegations: ReadonlyMap<string, string> = new Map()): UnitPair[] {
  const sectionOf = (ruleId: string) => ruleId.slice(0, ruleId.lastIndexOf('.'));
  const pairs: UnitPair[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i] as PairInput;
      const b = units[j] as PairInput;
      if (sectionOf(a.rule_id) === sectionOf(b.rule_id)) continue;
      if (delegations.get(a.document) === b.document || delegations.get(b.document) === a.document) continue;
      const shared = a.tags.filter((tag) => pairTags.has(tag) && b.tags.includes(tag));
      if (shared.length > 0) pairs.push({ a: a.rule_id, b: b.rule_id, shared_tags: shared });
    }
  }
  return pairs;
}

if (import.meta.main) {
  const { units, pairs } = extractUnits();
  console.log(JSON.stringify({ units, pairs }, null, 2));
}
