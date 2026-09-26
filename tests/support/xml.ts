// A deliberately small, strict XML reader for tests. It exists so that the values in generated XML can be checked
// independently of the serializer that wrote them. It reads the constrained output of serializeUblInvoice and
// serializeCiiInvoice (elements, attributes, the five predefined entities, no comments, CDATA or DTD) and throws on
// anything else, including a bare ampersand. It is not a general XML parser: names are matched with their literal
// prefix, not by namespace, so callers that depend on a prefix check its namespace declaration themselves.
// Well-formedness in the full sense is established by the KoSIT run.

export type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };

function decode(raw: string): string {
  // Checked on the raw text: after decoding, an ampersand may legitimately be there (from `&amp;`).
  if (/&(?!(?:lt|gt|quot|apos|amp);)/.test(raw)) throw new Error(`unescaped ampersand in: ${raw}`);
  return raw.replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity] as string);
}

export function parseXml(xml: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  for (const token of xml.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (token.startsWith('<?')) continue;
    if (token.startsWith('</')) {
      const open = stack.pop();
      if (open === undefined || open.name !== token.slice(2, -1).trim()) throw new Error(`mismatched closing tag ${token}`);
    } else if (token.startsWith('<')) {
      const [, name = ''] = /^<([A-Za-z][\w.:-]*)/.exec(token) ?? [];
      const attributes: Record<string, string> = {};
      for (const [, key = '', value = ''] of token.matchAll(/\s([A-Za-z][\w.:-]*)="([^"]*)"/g)) attributes[key] = decode(value);
      const node: XmlNode = { name, attributes, children: [], text: '' };
      const parent = stack.at(-1);
      if (parent) parent.children.push(node);
      else if (root) throw new Error('more than one root element');
      else root = node;
      stack.push(node);
    } else if (token.trim() !== '') {
      const parent = stack.at(-1);
      if (!parent) throw new Error('text outside the root element');
      parent.text += decode(token);
    }
  }
  if (stack.length > 0 || root === undefined) throw new Error('unclosed element');
  return root;
}

/** All nodes at a slash-separated path of child element names below `node`, in document order. */
export function select(node: XmlNode, path: string): XmlNode[] {
  let current = [node];
  for (const name of path.split('/')) current = current.flatMap((n) => n.children.filter((child) => child.name === name));
  return current;
}

export function one(node: XmlNode, path: string): XmlNode {
  const found = select(node, path);
  if (found.length !== 1) throw new Error(`expected exactly one ${path}, found ${found.length}`);
  return found[0] as XmlNode;
}

export const textAt = (node: XmlNode, path: string): string => one(node, path).text;
export const childNames = (node: XmlNode): string[] => node.children.map((child) => child.name);

// Writes a tree read by parseXml back in the exact layout of the serializers (XML declaration, two-space indentation,
// LF newlines, leaf text on one line). Used to apply controlled mutations to generated XML: for unmutated output,
// renderXml(parseXml(xml)) === xml, which the callers assert before trusting a mutation.
export function renderXml(root: XmlNode): string {
  const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const lines = (node: XmlNode, depth: number): string[] => {
    const padding = '  '.repeat(depth);
    const attributes = Object.entries(node.attributes).map(([key, value]) => ` ${key}="${escapeText(value).replaceAll('"', '&quot;')}"`).join('');
    if (node.children.length === 0) return [`${padding}<${node.name}${attributes}>${escapeText(node.text)}</${node.name}>`];
    return [`${padding}<${node.name}${attributes}>`, ...node.children.flatMap((child) => lines(child, depth + 1)), `${padding}</${node.name}>`];
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${lines(root, 0).join('\n')}\n`;
}
