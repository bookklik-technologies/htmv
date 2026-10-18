/**
 * Template expansion, bindings, scoped IDs (spec 7.2–7.6).
 * Expansion happens once per compilation, never per frame.
 */
import { CNode } from './parse.js';
import { parseBindingPath, resolveBindingPath, bindingText, BindingScope } from './bindings.js';
import { JsonValue, JsonObject, Diagnostic, error, sha256Hex } from '@htmv/core';
import { validateSchemaSubset } from './schema.js';

export interface ExpansionLimits {
  maxDepth: number; // default 32
  maxNodes: number; // default 10000
}

export const DEFAULT_LIMITS: ExpansionLimits = { maxDepth: 32, maxNodes: 10000 };

export class ExpansionContext {
  templates = new Map<string, CNode>();
  schemas = new Map<string, JsonValue>(); // component-local schemas by template id
  rootProps: JsonObject;
  rootSchema?: JsonValue;
  diagnostics: Diagnostic[] = [];
  nodeCount = 0;
  idCounts = new Map<string, number>();
  limits: ExpansionLimits;
  scopeStack: BindingScope[];

  constructor(rootProps: JsonObject, limits = DEFAULT_LIMITS) {
    this.rootProps = rootProps;
    this.limits = limits;
    this.scopeStack = [{ props: rootProps }];
  }

  currentScope(): BindingScope {
    return this.scopeStack[this.scopeStack.length - 1];
  }
}

export interface ExpandedTree {
  root: CNode;
  diagnostics: Diagnostic[];
  nodeCount: number;
}

/** Collect <template data-hv-component> definitions and root data-hv-props/schema blocks. */
export function collectDeclarations(root: CNode, ctx: ExpansionContext): { propsBlock?: string; schemaBlock?: string } {
  let propsBlock: string | undefined;
  let schemaBlock: string | undefined;
  for (const child of root.children) {
    if (child.kind !== 'element') continue;
    if (child.tag === 'template') {
      if ('data-hv-component' in child.attributes) {
        const id = child.attributes['id'];
        if (!id) {
          ctx.diagnostics.push(error('E_TEMPLATE_ID', 'Component template is missing an id attribute.', { attribute: 'id' }));
          continue;
        }
        if (ctx.templates.has(id)) {
          ctx.diagnostics.push(error('E_TEMPLATE_DUPLICATE', `Duplicate component template id "${id}".`));
          continue;
        }
        ctx.templates.set(id, child);
        // component-local schema
        for (const sub of child.children) {
          if (sub.kind === 'element' && sub.tag === 'script' && 'data-hv-schema' in sub.attributes) {
            ctx.schemas.set(id, parseJsonBody(sub.text, ctx, `component:${id}`));
          }
        }
      }
      continue;
    }
    if (child.tag === 'script') {
      if ('data-hv-props' in child.attributes) propsBlock = child.text;
      if ('data-hv-schema' in child.attributes) schemaBlock = child.text;
    }
  }
  return { propsBlock, schemaBlock };
}

function parseJsonBody(text: string, ctx: ExpansionContext, label: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    ctx.diagnostics.push(error('E_JSON', `Inert JSON block (${label}) is not valid JSON.`));
    return {};
  }
}

/**
 * Expand a tree: data-hv-each / data-hv-if / hv-use instantiation,
 * binding application, scoped IDs.
 */
export function expandNode(node: CNode, ctx: ExpansionContext, depth: number, instancePath: string): CNode | null {
  if (depth > ctx.limits.maxDepth) {
    ctx.diagnostics.push(error('E_RESOURCE_LIMIT', `Template expansion depth exceeded ${ctx.limits.maxDepth} at ${instancePath}.`));
    return null;
  }
  if (node.kind === 'text') {
    ctx.nodeCount++;
    return node;
  }
  const attrs = node.attributes;

  // Declared component templates are definitions, not instances
  if (node.tag === 'template' && 'data-hv-component' in attrs) {
    return null;
  }

  // Conditionals
  if ('data-hv-if' in attrs) {
    const path = parseBindingPath(attrs['data-hv-if']);
    const value = path ? resolveBindingPath(path, ctx.currentScope()) : undefined;
    if (path === null) {
      ctx.diagnostics.push(error('E_BINDING_PATH', `Invalid data-hv-if path "${attrs['data-hv-if']}".`));
      return null;
    }
    if (typeof value !== 'boolean') {
      ctx.diagnostics.push(error('E_BINDING_TYPE', `data-hv-if "${attrs['data-hv-if']}" must resolve to a boolean.`));
      return null;
    }
    if (!value) return null;
  }

  // Repetition
  if ('data-hv-each' in attrs) {
    if (node.tag !== 'template') {
      ctx.diagnostics.push(error('E_EACH_TEMPLATE', 'data-hv-each is only valid on <template>.'));
      return null;
    }
    if (!('data-hv-as' in attrs) || attrs['data-hv-as'] !== 'item') {
      ctx.diagnostics.push(error('E_EACH_AS', 'data-hv-as must be exactly "item" in v1.', { attribute: 'data-hv-as' }));
      return null;
    }
    const path = parseBindingPath(attrs['data-hv-each']);
    if (!path) {
      ctx.diagnostics.push(error('E_BINDING_PATH', `Invalid data-hv-each path "${attrs['data-hv-each']}".`));
      return null;
    }
    const value = resolveBindingPath(path, ctx.currentScope());
    if (!Array.isArray(value)) {
      ctx.diagnostics.push(error('E_BINDING_TYPE', `data-hv-each "${attrs['data-hv-each']}" must resolve to an array.`));
      return null;
    }
    if ('data-hv-key' in attrs) {
      // validate keys below
    } else {
      ctx.diagnostics.push(error('E_EACH_KEY', 'data-hv-key is required for repetition.', { attribute: 'data-hv-key' }));
    }
    const keyPath = 'data-hv-key' in attrs ? parseBindingPath(attrs['data-hv-key']) : null;
    const seenKeys = new Set<string>();
    const container: CNode = { kind: 'element', tag: '#expanded-each', attributes: {}, children: [], text: '', line: node.line };
    value.forEach((entry, index) => {
      let stableKey = String(index);
      if (keyPath) {
        const key = resolveBindingPath(keyPath, { ...ctx.currentScope(), item: entry, index });
        if (key === undefined || key === null || typeof key === 'object') {
          ctx.diagnostics.push(error('E_EACH_KEY', `data-hv-key "${attrs['data-hv-key']}" did not resolve to a unique string/number key at index ${index}.`));
        } else {
          const keyStr = String(key);
          stableKey = JSON.stringify([typeof key, key]);
          if (seenKeys.has(keyStr)) {
            ctx.diagnostics.push(error('E_EACH_KEY', `Duplicate repetition key "${keyStr}" among siblings.`));
          }
          seenKeys.add(keyStr);
        }
      }
      ctx.scopeStack.push({ ...ctx.currentScope(), item: entry, index });
      for (const child of node.children) {
        const expanded = expandNode(child, ctx, depth + 1, `${instancePath}[${stableKey}]`);
        if (expanded) container.children.push(expanded);
      }
      ctx.scopeStack.pop();
    });
    return container;
  }

  // hv-use instantiation
  if (node.tag === 'hv-use') {
    const templateRef = attrs['template'];
    if (!templateRef || !templateRef.startsWith('#')) {
      ctx.diagnostics.push(error('E_USE_TEMPLATE', `hv-use requires a template reference like "#stat-card"; received "${templateRef}".`));
      return null;
    }
    const templateId = templateRef.slice(1);
    const template = ctx.templates.get(templateId);
    if (!template) {
      ctx.diagnostics.push(error('E_USE_TEMPLATE', `Unknown component template "${templateRef}".`));
      return null;
    }
    // props: strict JSON or bound
    let propsValue: JsonValue | undefined;
    if ('data-hv-attr-props' in attrs) {
      const path = parseBindingPath(attrs['data-hv-attr-props']);
      const resolved = path ? resolveBindingPath(path, ctx.currentScope()) : undefined;
      if (!path || resolved === undefined) {
        ctx.diagnostics.push(error('E_BINDING_PATH', `data-hv-attr-props "${attrs['data-hv-attr-props']}" did not resolve.`));
        return null;
      }
      propsValue = resolved;
    } else if ('props' in attrs) {
      try {
        propsValue = JSON.parse(attrs['props']) as JsonValue;
      } catch {
        ctx.diagnostics.push(error('E_JSON', `hv-use props must be a strict JSON object; received "${attrs['props']}".`, { attribute: 'props' }));
        return null;
      }
    } else {
      propsValue = {};
    }
    if (typeof propsValue !== 'object' || propsValue === null || Array.isArray(propsValue)) {
      ctx.diagnostics.push(error('E_JSON', 'hv-use props requires an object.', { attribute: 'props' }));
      return null;
    }
    // Component schema validation
    const schema = ctx.schemas.get(templateId);
    if (schema !== undefined) {
      const res = validateSchemaSubset(propsValue as JsonValue, schema);
      ctx.diagnostics.push(...res.diagnostics);
      if (!res.valid) return null;
    }
    ctx.scopeStack.push({ ...ctx.currentScope(), props: propsValue, parentProps: ctx.currentScope().props });
    const path = `${instancePath}/${templateId}@${node.sourceKey ?? node.line}`;
    const instance: CNode = { kind: 'element', tag: 'hv-sequence', attributes: { 'hv-use-template': templateId, 'hv-instance-key': sha256Hex(path).slice(0, 16) }, children: [], text: '', line: node.line };
    for (const name of ['start', 'duration', 'id']) if (attrs[name] !== undefined) instance.attributes[name] = attrs[name];
    for (const child of template.children) {
      if (child.kind === 'element' && child.tag === 'script' && 'data-hv-schema' in child.attributes) continue;
      const expanded = expandNode(child, ctx, depth + 1, path);
      if (expanded) instance.children.push(expanded);
    }
    ctx.scopeStack.pop();
    ctx.nodeCount++;
    return instance;
  }

  // Apply bindings (data-hv-text / data-hv-src / data-hv-attr-* / data-hv-style-*)
  const expandedNode: CNode = { ...node, attributes: { ...attrs }, children: [] };
  if (ctx.scopeStack.length > 1) expandedNode.attributes['hv-instance-key'] = sha256Hex(instancePath).slice(0, 16);
  applyBindings(expandedNode, ctx, instancePath);

  // Scoped IDs: author IDs inside component instances rewritten instance-local
  if ('id' in expandedNode.attributes && ctx.scopeStack.length > 1) {
    const id = expandedNode.attributes['id'];
    expandedNode.attributes['id'] = `${id}__hv${sha256Hex(instancePath).slice(0, 16)}`;
    expandedNode.attributes['hv-author-id'] = id;
  }
  if (node.tag === 'hv-animation' && ctx.scopeStack.length > 1) expandedNode.attributes.target = (expandedNode.attributes.target ?? '').replace(/#([A-Za-z_][\w-]*)/g, (_, id: string) => `#${id}__hv${sha256Hex(instancePath).slice(0, 16)}`);

  ctx.nodeCount++;
  if (ctx.nodeCount > ctx.limits.maxNodes) {
    ctx.diagnostics.push(error('E_RESOURCE_LIMIT', `Expanded node count exceeded ${ctx.limits.maxNodes}.`));
    return null;
  }

  const boundText = 'hv-text-bound' in expandedNode.attributes;
  delete expandedNode.attributes['hv-text-bound'];
  if (!boundText) {
    for (const child of node.children) {
      const expanded = expandNode(child, ctx, depth + 1, instancePath);
      if (expanded) {
        // flatten synthetic containers into the parent (spec 7.6)
        for (const flat of flattenSynthetic(expanded)) {
          expandedNode.children.push(flat);
        }
      }
    }
  }
  return expandedNode;
}

function flattenSynthetic(n: CNode): CNode[] {
  if (n.tag === '#expanded-each' || n.tag === '#expanded-use') {
    return n.children.flatMap((c) => flattenSynthetic(c));
  }
  return [n];
}

function applyBindings(node: CNode, ctx: ExpansionContext, instancePath: string): void {
  const attrs = node.attributes;
  // data-hv-text
  if ('data-hv-text' in attrs) {
    const path = parseBindingPath(attrs['data-hv-text']);
    const value = path ? resolveBindingPath(path, ctx.currentScope()) : undefined;
    if (!path || value === undefined) {
      ctx.diagnostics.push(error('E_BINDING_PATH', `data-hv-text "${attrs['data-hv-text']}" did not resolve at ${instancePath}. Missing paths are errors.`));
    } else {
      const text = bindingText(value);
      if (text === null) {
        ctx.diagnostics.push(error('E_BINDING_TYPE', `data-hv-text resolved to an object/array; format upstream and pass strings/numbers.`));
      } else {
        node.children = [{ kind: 'text', tag: 'text', attributes: {}, children: [], text, line: node.line }];
        node.attributes['hv-text-bound'] = '1'; // binding replaced authored text
      }
    }
    delete attrs['data-hv-text'];
  }
  // data-hv-src
  if ('data-hv-src' in attrs) {
    const path = parseBindingPath(attrs['data-hv-src']);
    const value = path ? resolveBindingPath(path, ctx.currentScope()) : undefined;
    if (!path || typeof value !== 'string') {
      ctx.diagnostics.push(error('E_BINDING_PATH', `data-hv-src "${attrs['data-hv-src']}" must resolve to a string URL.`));
    } else {
      if (/^javascript:/i.test(value)) {
        ctx.diagnostics.push(error('E_BINDING_URL', `data-hv-src resolved to a disallowed URL scheme.`));
      } else {
        attrs['src'] = value;
      }
    }
    delete attrs['data-hv-src'];
  }
  // data-hv-attr-NAME
  for (const name of Object.keys(attrs)) {
    if (!name.startsWith('data-hv-attr-')) continue;
    const target = name.slice('data-hv-attr-'.length);
    const path = parseBindingPath(attrs[name]);
    const value = path ? resolveBindingPath(path, ctx.currentScope()) : undefined;
    if (!path || value === undefined) {
      ctx.diagnostics.push(error('E_BINDING_PATH', `${name} "${attrs[name]}" did not resolve.`));
    } else if (target in attrs && target !== name) {
      ctx.diagnostics.push(error('E_BINDING_CONFLICT', `Attribute "${target}" has both an explicit value and a ${name} binding; no hidden precedence rule exists.`));
    } else {
      if (typeof value === 'object' && value !== null) {
        attrs[target] = JSON.stringify(value);
      } else {
        attrs[target] = String(value);
      }
    }
    delete attrs[name];
  }
  // data-hv-style-NAME
  for (const name of Object.keys(attrs)) {
    if (!name.startsWith('data-hv-style-')) continue;
    const prop = name.slice('data-hv-style-'.length).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const path = parseBindingPath(attrs[name]);
    const value = path ? resolveBindingPath(path, ctx.currentScope()) : undefined;
    if (!path || value === undefined) {
      ctx.diagnostics.push(error('E_BINDING_PATH', `${name} "${attrs[name]}" did not resolve.`));
    } else {
      const text = bindingText(value);
      if (text === null) {
        ctx.diagnostics.push(error('E_BINDING_TYPE', `${name} resolved to non-scalar; style bindings are strings in the CSS registry grammar.`));
      } else {
        const existing = attrs['style'] ?? '';
        attrs['style'] = `${existing};${kebab(prop)}:${text}`.replace(/^;/, '');
      }
    }
    delete attrs[name];
  }
  // unknown data-hv-* names are errors (spec 2.2)
  for (const name of Object.keys(attrs)) {
    if (name.startsWith('data-hv-')) {
      const known = [
        'data-hv-start', 'data-hv-duration', 'data-hv-if', 'data-hv-each', 'data-hv-as', 'data-hv-key',
        'data-hv-component', 'data-hv-props', 'data-hv-schema', 'data-hv-plugin', 'data-hv-plugin-props'
      ];
      if (!known.includes(name) && !name.startsWith('data-hv-attr-') && !name.startsWith('data-hv-style-')) {
        ctx.diagnostics.push(error('E_UNKNOWN_ATTR', `Unknown data-hv-* attribute "${name}" is an error.`));
      }
    }
  }
}

function kebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

