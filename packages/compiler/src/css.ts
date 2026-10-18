/**
 * CSS profile validation (spec 8.3).
 * Only listed normalized properties belong to the standard profile.
 * Expand admitted shorthands before validation. CSS variables and calc()
 * may supply values to listed properties, but do not authorize extra features.
 */
import * as csstree from 'css-tree';
import { error, parseColor } from '@htmv/core';

export interface CssRule {
  selector: string;
  declarations: [string, string][];
  sourceLocation?: { line: number; column: number };
}

export interface StyleValidationResult {
  rules: CssRule[];
  diagnostics: { property: string; value: string; message: string; selector: string }[];
}

const SUPPORTED_PROPERTIES = new Set<string>([
  // Layout
  'display', 'position', 'left', 'top', 'right', 'bottom',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing',
  // Flex
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex',
  'justify-content', 'align-items', 'align-content', 'align-self',
  'row-gap', 'column-gap', 'gap',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows',
  'grid-auto-flow', 'grid-column', 'grid-row', 'align-items-self',
  // Background
  'background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  // Border
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius',
  // Clip
  'overflow',
  // Transform
  'transform', 'transform-origin',
  // Alpha
  'opacity',
  // Text
  'font', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'text-align', 'direction', 'white-space', 'overflow-wrap', 'text-transform',
  // Decoration
  'text-decoration', 'text-decoration-line',
  // Image
  'object-fit', 'object-position',
  // Visibility
  'visibility',
  // Inheritance
  'color'
]);

const ADMITTED_SHORTHANDS: Record<string, string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  background: ['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat'],
  border: ['border-width', 'border-style', 'border-color'],
  font: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height'],
  'text-decoration': ['text-decoration-line'],
  gap: ['row-gap', 'column-gap'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis']
};

const HARD_FORBIDDEN = new Set<string>([
  'z-index', 'float', 'position-sticky', 'clip-path', 'filter', 'backdrop-filter',
  'mix-blend-mode', 'box-shadow', 'text-shadow', 'mask', 'transition', 'animation',
  'writing-mode', 'columns', 'content'
]);

const ADMITTED_ENUM_VALUES: Record<string, RegExp> = {
  display: /^(block|flex|grid|none)$/,
  position: /^(static|relative|absolute)$/,
  'box-sizing': /^(border-box)$/,
  'flex-direction': /^(row|column|row-reverse|column-reverse)$/,
  'flex-wrap': /^(nowrap|wrap)$/,
  'justify-content': /^(flex-start|flex-end|center|space-between|space-around|space-evenly)$/,
  'align-items': /^(flex-start|flex-end|center|baseline|stretch)$/,
  'align-content': /^(flex-start|flex-end|center|stretch|space-between|space-around)$/,
  'align-self': /^(auto|flex-start|flex-end|center|stretch)$/,
  'background-size': /^(cover|contain)$/,
  'background-repeat': /^(no-repeat)$/,
  'border-style': /^(solid|none)$/,
  overflow: /^(visible|hidden)$/,
  'font-style': /^(normal|italic)$/,
  'text-align': /^(left|right|center|start|end)$/,
  direction: /^(ltr|rtl)$/,
  'white-space': /^(normal|pre|pre-wrap)$/,
  'overflow-wrap': /^(normal|anywhere)$/,
  'text-transform': /^(none|uppercase|lowercase)$/,
  'text-decoration-line': /^(none|underline|line-through)$/,
  'object-fit': /^(fill|contain|cover)$/,
  visibility: /^(visible|hidden)$/,
  'grid-auto-flow': /^(row|column|row dense|column dense)$/
};

function splitTopLevel(value: string, sep: string): string[] {
  if (sep !== ' ') throw new Error('Unsupported CSS separator.');
  const ast = parseCss(value, 'value');
  if (ast.type !== 'Value') return [];
  return ast.children.toArray().map((node) => csstree.generate(node));
}

// Normalize escaped function identifiers before parsing: CSS treats u\\72l() as url().
function parseCss(source: string, context: 'value' | 'stylesheet' | 'declarationList'): csstree.CssNode {
  let normalized = ''; let end = 0;
  csstree.tokenize(source, (type, start, stop) => {
    if (type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident.decode(source.slice(start, stop - 1));
    normalized += source.slice(end, start) + (name.toLowerCase() === 'url' ? 'url' : name) + '(';
    end = stop;
  });
  return csstree.parse(normalized + source.slice(end), { context, parseCustomProperty: true });
}

const VALUE_FUNCTIONS = new Set(['var', 'calc', 'min', 'max', 'clamp', 'rgb', 'rgba', 'hsl', 'hsla', 'linear-gradient', 'repeat', 'minmax', 'fit-content', 'translate', 'translatex', 'translatey', 'rotate', 'scale', 'scalex', 'scaley', 'skew', 'skewx', 'skewy', 'matrix']);
function admittedValue(value: string): csstree.CssNode {
  const ast = parseCss(value, 'value');
  csstree.walk(ast, (node) => {
    if (node.type === 'Raw') throw new Error('Unparsed CSS is not admitted.');
    if (node.type === 'Function' && !VALUE_FUNCTIONS.has(csstree.ident.decode(node.name).toLowerCase())) throw new Error(`CSS function ${node.name} is not admitted.`);
  });
  return ast;
}

/** Rewrites parsed URL nodes, including URLs nested in custom properties/fallbacks. */
export async function rewriteCssUrls(value: string, resolve: (url: string) => Promise<string>): Promise<string> {
  const ast = admittedValue(value); const urls: csstree.Url[] = [];
  csstree.walk(ast, (node) => { if (node.type === 'Url') urls.push(node); });
  for (const node of urls) node.value = await resolve(node.value);
  return csstree.generate(ast);
}

/** The layout document receives only engine-owned URLs for prepared image bytes. */
export function resolveCssAssetUrls(source: string, urls: ReadonlyMap<string, string>, context: 'stylesheet' | 'declarationList'): string {
  const ast = parseCss(source, context);
  csstree.walk(ast, (node) => {
    if (node.type !== 'Url') return;
    const resolved = node.value.startsWith('asset:') ? urls.get(node.value) : undefined;
    if (!resolved) throw error('E_ASSET_FETCH', `CSS image reference ${node.value} has no prepared resource.`);
    node.value = resolved;
  });
  return csstree.generate(ast);
}

export function expandShorthand(property: string, value: string): [string, string][] {
  if (property === 'margin' || property === 'padding') {
    const parts = splitTopLevel(value, ' ');
    const side = property === 'margin' ? 'margin' : 'padding';
    if (parts.length === 1) return [[`${side}-top`, parts[0]], [`${side}-right`, parts[0]], [`${side}-bottom`, parts[0]], [`${side}-left`, parts[0]]];
    if (parts.length === 2) return [[`${side}-top`, parts[0]], [`${side}-bottom`, parts[0]], [`${side}-right`, parts[1]], [`${side}-left`, parts[1]]];
    if (parts.length === 3) return [[`${side}-top`, parts[0]], [`${side}-right`, parts[1]], [`${side}-left`, parts[1]], [`${side}-bottom`, parts[2]]];
    if (parts.length === 4) return [[`${side}-top`, parts[0]], [`${side}-right`, parts[1]], [`${side}-bottom`, parts[2]], [`${side}-left`, parts[3]]];
    return [];
  }
  if (property === 'background') {
    if (value.startsWith('var(')) return [[property, value]];
    // Only single-layer background: color, image (url/gradient), size/position/repeat keywords
    const out: [string, string][] = [];
    const parts = splitTopLevel(value, ' ');
    for (const part of parts) {
      let color = false; try { parseColor(part); color = true; } catch { /* not a color */ }
      if (color) {
        out.push(['background-color', part]);
      } else if (/^(url|linear-gradient)\(/.test(part)) {
        out.push(['background-image', part]);
      } else if (/^(cover|contain)$/.test(part)) {
        out.push(['background-size', part]);
      } else if (/^no-repeat$/.test(part)) {
        out.push(['background-repeat', part]);
      } else {
        out.push(['background-position', part]);
      }
    }
    return out;
  }
  if (property === 'border') {
    const parts = splitTopLevel(value, ' ');
    const out: [string, string][] = [];
    for (const part of parts) {
      if (/^\d/.test(part)) out.push(['border-width', part]);
      else if (/^(solid|none)$/.test(part)) out.push(['border-style', part]);
      else out.push(['border-color', part]);
    }
    return out;
  }
  if (property === 'font') {
    return [['font-family', value]];
  }
  if (property === 'text-decoration') {
    return [['text-decoration-line', value]];
  }
  if (property === 'gap') {
    const parts = splitTopLevel(value, ' ');
    if (parts.length === 1) return [['row-gap', parts[0]], ['column-gap', parts[0]]];
    return [['row-gap', parts[0]], ['column-gap', parts[1]]];
  }
  if (property === 'flex') {
    const parts = splitTopLevel(value, ' ');
    const out: [string, string][] = [];
    if (parts[0]) out.push(['flex-grow', parts[0]]);
    if (parts[1]) out.push(['flex-shrink', parts[1]]);
    if (parts[2]) out.push(['flex-basis', parts[2]]);
    return out;
  }
  return [[property, value]];
}

export function validateDeclaration(property: string, value: string): { ok: boolean; message?: string; expanded: [string, string][] } {
  const decoded = csstree.ident.decode(property.trim());
  const prop = decoded.startsWith('--') ? decoded : decoded.toLowerCase();
  let val: string;
  try { val = csstree.generate(admittedValue(value)); }
  catch (e) { return { ok: false, message: (e as Error).message, expanded: [] }; }
  if (val.toLowerCase().includes('!important')) return { ok: false, message: '!important is not admitted.', expanded: [] };
  if (prop.startsWith('--')) {
    // CSS variables may supply values to listed properties, not authorize extra features
    return { ok: true, expanded: [[prop, val]] };
  }
  if (prop.startsWith('@') || prop.startsWith('*') || prop.startsWith('/') || val.toLowerCase().includes('!important')) {
    return { ok: false, message: `Declaration "${prop}: ${val}" is outside the supported CSS profile.`, expanded: [] };
  }
  if (HARD_FORBIDDEN.has(prop)) {
    return { ok: false, message: `Property "${prop}" is unsupported in the HTMV standard CSS profile.`, expanded: [] };
  }
  if (val.includes('!important')) {
    return { ok: false, message: '!important is not admitted.', expanded: [] };
  }
  if (SUPPORTED_PROPERTIES.has(prop)) {
    if (prop === 'position' && /sticky|fixed/.test(val)) {
      return { ok: false, message: `position:${val} is unsupported (static/relative/absolute only).`, expanded: [] };
    }
    if (prop === 'display' && /^(inline|inline-block|inline-flex|contents|table.*)$/.test(val)) {
      return { ok: false, message: `display:${val} is unsupported (block/flex/grid/none only).`, expanded: [] };
    }
    if (prop === 'font-weight' && !/^(normal|bold|[1-9]00)$/.test(val)) {
      return { ok: false, message: `font-weight:${val} unsupported.`, expanded: [] };
    }
    if (prop === 'font-size' && !val.startsWith('var(') && !/^(\d+(?:\.\d+)?(px|em|rem|%)|inherit)$/.test(val)) {
      return { ok: false, message: `font-size:${val} unsupported (px/em/rem/%).`, expanded: [] };
    }
    if (prop === 'transform' && !val.startsWith('var(') && !validateTransformValue(val)) {
      return { ok: false, message: `transform:${val} contains unsupported 2D/3D functions.`, expanded: [] };
    }
    if (prop === 'background-image' || prop === 'background') {
      // url() and linear-gradient only; validated at the asset admission layer for URLs
      if (val.includes('radial-gradient') || val.includes('conic-gradient') || val.includes('repeating')) {
        return { ok: false, message: `Only linear-gradient with sRGB stops is admitted.`, expanded: [] };
      }
    }
    const enumRe = ADMITTED_ENUM_VALUES[prop];
    if (enumRe && !(enumRe.test(val) || /^[\d.%]+/.test(val) || val.startsWith('var(') || val.startsWith('calc('))) {
      return { ok: false, message: `Value "${val}" for ${prop} is outside the supported profile.`, expanded: [] };
    }
    return { ok: true, expanded: expandShorthand(prop, val) };
  }
  return { ok: false, message: `Property "${prop}" is not in the supported CSS profile.`, expanded: [] };
}

const ALLOWED_TRANSFORM_FNS = /^(translate|translateX|translateY|rotate|scale|scaleX|scaleY|skew|skewX|skewY|matrix)\(/;

function validateTransformValue(val: string): boolean {
  const fns = val.match(/[a-zA-Z]+\(/g) ?? [];
  if (fns.length === 0) return val === 'none';
  return fns.every((f) => ALLOWED_TRANSFORM_FNS.test(f)) && !/[A-Z]{2,}/.test(val.replace(/[a-zA-Z]+\(/g, ''));
}

/** Parse a stylesheet body into rules with declarations. */
export function parseCssRules(cssText: string): CssRule[] {
  const rules: CssRule[] = []; const ast = parseCss(cssText, 'stylesheet');
  if (ast.type !== 'StyleSheet') return rules;
  ast.children.forEach((node) => {
    if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') {
      rules.push({ selector: '@unsupported', declarations: [] }); return;
    }
    const declarations: [string, string][] = [];
    node.block.children.forEach((decl) => {
      if (decl.type !== 'Declaration') { declarations.push(['@unsupported', 'unparsed']); return; }
      declarations.push([decl.property, csstree.generate(decl.value) + (decl.important ? '!important' : '')]);
    });
    rules.push({ selector: csstree.generate(node.prelude), declarations });
  });
  return rules;
}

export function validateStylesheet(cssText: string): StyleValidationResult {
  const diagnostics: StyleValidationResult['diagnostics'] = [];
  const rules: CssRule[] = [];
  let parsed: CssRule[];
  try { parsed = parseCssRules(cssText); }
  catch (e) { return { rules, diagnostics: [{ property: '', value: '', selector: '', message: `Invalid CSS: ${(e as Error).message}` }] }; }
  for (const rule of parsed) {
    if (rule.selector.includes('@')) {
      diagnostics.push({ property: '', value: '', message: 'At-rules are not admitted.', selector: rule.selector });
      continue;
    }
    if (rule.selector.includes('::')) {
      diagnostics.push({ property: '', value: '', message: 'Pseudo-elements are not admitted.', selector: rule.selector });
      continue;
    }
    const expandedDecls: [string, string][] = [];
    for (const [prop, val] of rule.declarations) {
      const res = validateDeclaration(prop, val);
      if (!res.ok && res.message) {
        diagnostics.push({ property: prop, value: val, message: res.message, selector: rule.selector });
      } else {
        expandedDecls.push(...res.expanded);
      }
    }
    rules.push({ selector: rule.selector, declarations: expandedDecls });
  }
  return { rules, diagnostics };
}

/** Parse an inline style attribute into expanded declarations. */
export function parseInlineStyle(styleText: string): { declarations: [string, string][]; diagnostics: string[] } {
  const declarations: [string, string][] = [];
  const diagnostics: string[] = [];
  try {
    const ast = parseCss(styleText, 'declarationList');
    if (ast.type !== 'DeclarationList') throw new Error('Expected CSS declarations.');
    ast.children.forEach((decl) => {
      if (decl.type !== 'Declaration') { diagnostics.push('Unparsed CSS is not admitted.'); return; }
      const res = validateDeclaration(decl.property, csstree.generate(decl.value) + (decl.important ? '!important' : ''));
      if (!res.ok && res.message) diagnostics.push(res.message);
      else declarations.push(...res.expanded);
    });
  } catch (e) { diagnostics.push(`Invalid CSS: ${(e as Error).message}`); }
  return { declarations, diagnostics };
}
