/** Standards-based inert HTML parsing; never connects source to the live document. */
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
export interface CNode { kind: 'element' | 'text'; tag: string; attributes: Record<string, string>; children: CNode[]; text: string; line: number; sourceKey?: string }
export function parseHtml(source: string): CNode {
  const fragment = parseFragment(source, { sourceCodeLocationInfo: true });
  const convert = (node: DefaultTreeAdapterMap['childNode']): CNode | null => {
    if (node.nodeName === '#text') return { kind: 'text', tag: 'text', attributes: {}, children: [], text: (node as DefaultTreeAdapterMap['textNode']).value, line: node.sourceCodeLocation?.startLine ?? 1 };
    if (!('tagName' in node)) return null;
    const tag = node.tagName.toLowerCase(); const location = node.sourceCodeLocation;
    if (tag.includes('-') && location && (!('endTag' in location) || !location.endTag)) throw new Error(`Custom element <${tag}> requires an explicit closing tag (line ${location.startLine}).`);
    const attributes = Object.fromEntries(node.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
    const children = ('content' in node ? (node as DefaultTreeAdapterMap['template']).content.childNodes : node.childNodes).map(convert).filter((n): n is CNode => n !== null);
    return { kind: 'element', tag, attributes, children, text: tag === 'script' || tag === 'style' ? children.map((n) => n.text).join('') : '', line: location?.startLine ?? 1, sourceKey: String(location?.startOffset ?? '') };
  };
  return { kind: 'element', tag: '#root', attributes: {}, children: fragment.childNodes.map(convert).filter((n): n is CNode => n !== null), text: '', line: 1 };
}
export function sanitizeDocument(root: CNode): { removed: string[] } {
  const removed: string[] = [];
  const walk = (node: CNode): void => {
    node.children = node.children.filter((child) => {
      if (child.tag === 'script' && !(child.attributes.type === 'application/json' && ('data-hv-props' in child.attributes || 'data-hv-schema' in child.attributes))) { removed.push('script'); return false; }
      return true;
    });
    for (const child of node.children) {
      for (const name of Object.keys(child.attributes)) {
        if (/^on[a-z]+$/i.test(name) || /^(?:href|src|xlink:href)$/i.test(name) && /^\s*javascript:/i.test(child.attributes[name])) { removed.push(name); delete child.attributes[name]; }
      }
      walk(child);
    }
  };
  walk(root); return { removed };
}
