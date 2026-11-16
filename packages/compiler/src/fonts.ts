import { AssetDescriptor, Diagnostic, error } from '@htmv/core';
import * as csstree from 'css-tree';
import { selectAll } from 'css-select';
import { AnyNode, Document, Element } from 'domhandler';
import { AssetLoadResult } from './assets.js';
import { CssRule, parseInlineStyle } from './css.js';
import { ResolvedNode } from './timing.js';

const SYSTEM_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

function fontFamilies(value: string): string[] | null {
  try {
    if (!csstree.lexer.matchProperty('font-family', value).matched) return null;
    const ast = csstree.parse(value, { context: 'value' });
    if (ast.type !== 'Value') return null;
    const families: string[] = [];
    let parts: string[] = [];
    let quoted = false;
    for (const node of ast.children.toArray()) {
      if (node.type === 'Operator' && node.value === ',') {
        if (!parts.length) return null;
        families.push(parts.join(' ').toLowerCase()); parts = []; quoted = false;
      } else if (node.type === 'String' && !parts.length && node.value.trim()) { parts.push(node.value); quoted = true; }
      else if (node.type === 'Identifier' && !quoted) parts.push(csstree.ident.decode(node.name));
      else return null;
    }
    if (!parts.length) return null;
    families.push(parts.join(' ').toLowerCase());
    return families;
  } catch { return null; }
}

export function validatePortableFonts(
  nodes: ReadonlyMap<string, ResolvedNode>, rules: readonly CssRule[],
  assets: readonly AssetDescriptor[], resolved: ReadonlyMap<string, AssetLoadResult>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const registered = new Set<string>();
  for (const asset of assets) {
    if (asset.kind !== 'font') continue;
    if (!asset.family?.trim() || !resolved.get(asset.id)?.blob?.size) diagnostics.push(error('E_FONT_POLICY', `Portable font ${asset.id} requires a family and frozen, nonempty font bytes.`));
    else registered.add(asset.family.toLowerCase());
  }
  const admittedFamily = (value: string): boolean => {
    const families = fontFamilies(value);
    if (!families || families.some((family) => SYSTEM_FAMILIES.has(family) || !registered.has(family))) {
      diagnostics.push(error('E_FONT_POLICY', `Portable font-family "${value}" must name only declared fonts with frozen bytes; system families and unresolved variables are not portable.`));
      return false;
    }
    return true;
  };
  const elements = new Map<string, Element>();
  const nodeIds = new Map<Element, string>();
  const document = new Document([]);
  const mount = (node: ResolvedNode, parent: Element | Document): void => {
    if (node.kind === 'audio' || node.kind === 'declaration') return;
    const element = new Element(node.tag, { id: node.attributes.id ?? node.id, class: node.attributes.class ?? '' }, []);
    elements.set(node.id, element);
    nodeIds.set(element, node.id);
    element.parent = parent;
    const previous = parent.children[parent.children.length - 1];
    if (previous) { previous.next = element; element.prev = previous; }
    parent.children.push(element);
    for (const id of node.childIds) {
      const child = nodes.get(id);
      if (child) mount(child, element);
    }
  };
  const root = [...nodes.values()].find((node) => node.kind === 'composition');
  if (root) mount(root, document);
  const covered = new Set<string>();
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property !== 'font-family' || !admittedFamily(value)) continue;
      try {
        if (/[:\[]/.test(rule.selector)) throw new Error('Font selectors must use static tags, IDs, classes, or combinators.');
        for (const element of selectAll<AnyNode, Element>(rule.selector, document)) covered.add(nodeIds.get(element)!);
      } catch {
        diagnostics.push(error('E_FONT_POLICY', `Portable font selector "${rule.selector}" cannot be verified statically; use a static selector or inline font-family.`));
      }
    }
  }
  for (const node of nodes.values()) {
    if (!elements.has(node.id)) continue;
    for (const [property, value] of parseInlineStyle(node.attributes.style ?? '').declarations) {
      if (property === 'font-family' && admittedFamily(value)) covered.add(node.id);
    }
  }
  for (const node of nodes.values()) {
    if (!elements.has(node.id) || node.kind !== 'text' && node.kind !== 'captions') continue;
    let ancestor: ResolvedNode | undefined = node;
    while (ancestor && !covered.has(ancestor.id)) ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : undefined;
    if (!ancestor) diagnostics.push(error('E_FONT_POLICY', `Portable text ${node.id} has no verifiable declared font-family, including through inheritance.`, { nodeId: node.id }));
  }
  return diagnostics;
}
