/** Admit static, self-contained SVG before treating it as a single image leaf. */
import { CNode } from './parse.js';
const tags = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'lineargradient', 'radialgradient', 'stop', 'text', 'tspan']);
const attributes = new Set(['id', 'xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'points', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform', 'gradientunits', 'gradienttransform', 'spreadmethod', 'offset', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline']);
const cases: Record<string, string> = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', lineargradient: 'linearGradient', radialgradient: 'radialGradient', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod' };
const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function svgImage(node: CNode, fontFamilies: ReadonlySet<string>): string {
  const serialize = (n: CNode): string => {
    if (n.kind === 'text') return escape(n.text);
    if (!tags.has(n.tag)) throw new Error(`SVG element ${n.tag} is not admitted.`);
    if (['text', 'tspan'].includes(n.tag) && !fontFamilies.has(n.attributes['font-family'] ?? '')) throw new Error('SVG text requires an explicitly admitted font-family on each text leaf.');
    const attrs: string[] = [];
    for (const [name, value] of Object.entries(n.attributes)) {
      if (name === 'xmlns' && value === 'http://www.w3.org/2000/svg') { attrs.push('xmlns="http://www.w3.org/2000/svg"'); continue; }
      if (n === node && ['class', 'style', 'data-hv-start', 'data-hv-duration'].includes(name)) continue;
      if (!attributes.has(name) || /(?:https?|javascript|data|blob):/i.test(value) || [...value.matchAll(/url\(([^)]*)\)/g)].some((m) => !/^#[\w:.-]+$/.test(m[1].replace(/["']/g, '').trim()))) throw new Error(`SVG attribute ${name} or its external reference is not admitted.`);
      attrs.push(`${cases[name] ?? name}="${escape(value)}"`);
    }
    if (n === node && !n.attributes.xmlns) attrs.push('xmlns="http://www.w3.org/2000/svg"');
    const tag = cases[n.tag] ?? n.tag;
    return `<${tag} ${attrs.join(' ')}>${n.children.map(serialize).join('')}</${tag}>`;
  };
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialize(node))}`;
}
