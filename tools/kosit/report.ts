// Reads the XML report written by the KoSIT validator (report namespace http://www.xoev.de/de/validator/varl/1).
// The report is machine generated with a stable prefix (`rep:`), so this uses targeted patterns instead of an XML
// library. Ceiling: it reads exactly the parts the harness reports (valid, engine, document hash, matched scenario,
// validation steps, messages, assessment) and returns undefined/empty for anything it does not find, which the
// harness then treats as a failure. The process exit code, the report `valid` field, the message severities and the
// assessment are separate results and are kept separate here.

export type ReportMessage = {
  readonly id: string;
  readonly level: string;
  readonly code: string;
  readonly xpathLocation: string;
  readonly text: string;
};

export type ParsedReport = {
  readonly valid: boolean | undefined;
  readonly engine: string | undefined;
  readonly documentHashSha256Base64: string | undefined;
  readonly scenario: string | undefined;
  readonly steps: readonly { readonly id: string; readonly valid: boolean }[];
  readonly messages: readonly ReportMessage[];
  readonly assessment: 'accept' | 'reject' | undefined;
};

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const decode = (raw: string): string => raw.replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity] as string);

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name = '', value = ''] of tag.matchAll(/\s([A-Za-z][\w.:-]*)="([^"]*)"/g)) found[name] = decode(value);
  return found;
}

// A tag body: anything except '>', with quoted attribute values allowed to contain '>'.
const TAG_BODY = `(?:[^>"']|"[^"]*"|'[^']*')*`;

const asBoolean = (value: string | undefined): boolean | undefined => (value === 'true' ? true : value === 'false' ? false : undefined);

export function parseReport(xml: string): ParsedReport {
  const root = new RegExp(`<rep:report\\b${TAG_BODY}>`).exec(xml);
  const assessment = /<rep:assessment>\s*<rep:(accept|reject)\b/.exec(xml)?.[1];

  return {
    valid: asBoolean(root ? attributes(root[0]).valid : undefined),
    engine: /<rep:engine>\s*<rep:name>([^<]*)</.exec(xml)?.[1],
    documentHashSha256Base64: /<rep:hashValue>([^<]*)</.exec(xml)?.[1],
    scenario: /<rep:scenarioMatched>\s*<s:scenario>\s*<s:name>([^<]*)</.exec(xml)?.[1],
    steps: [...xml.matchAll(new RegExp(`<rep:validationStepResult\\b${TAG_BODY}>`, 'g'))].flatMap(([tag]) => {
      const { id, valid } = attributes(tag);
      const parsed = asBoolean(valid);
      return id !== undefined && parsed !== undefined ? [{ id, valid: parsed }] : [];
    }),
    messages: [...xml.matchAll(new RegExp(`<rep:message\\b(${TAG_BODY})>([\\s\\S]*?)</rep:message>`, 'g'))].map(([, tag = '', body = '']) => {
      const found = attributes(` ${tag}`);
      return {
        id: found.id ?? '',
        level: found.level ?? '',
        code: found.code ?? '',
        xpathLocation: found.xpathLocation ?? '',
        text: decode(body).replace(/\s+/g, ' ').trim(),
      };
    }),
    assessment: assessment === 'accept' || assessment === 'reject' ? assessment : undefined,
  };
}
