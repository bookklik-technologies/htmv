/** Composition-local browser layout and hierarchical, untransformed paint snapshots. */
import { ResolvedNode, TimingResult, parseInlineStyle, validateStylesheet, resolveCssAssetUrls } from '@htmv/compiler';
import { RESET_CSS, LayoutBox, applyAdmittedDeclarations, collectComputedStyle } from './layoutDoc.js';
import { layoutText, getMeasureContext, canvasFontString } from './textLayout.js';

export interface SnapshotOptions {
  width: number; height: number; background: string; cssText: string; rootFontPx: number;
  imageURLs?: ReadonlyMap<string, string>;
  imageSizes?: ReadonlyMap<string, { width: number; height: number }>;
  animatedValues?: ReadonlyMap<string, readonly { property: string; value: number | string }[]>;
}
export interface SnapshotResult { root: LayoutBox; boxes: LayoutBox[] }

export class LayoutSession {
  private iframe: HTMLIFrameElement | null = null;
  private doc: Document | null = null;
  ensureDocument(width: number, height: number): Document {
    if (this.doc) return this.doc;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: `${width}px`, height: `${height}px`, visibility: 'hidden', border: '0' });
    document.body.appendChild(iframe);
    this.iframe = iframe;
    const doc = iframe.contentDocument!;
    doc.open(); doc.close();
    const reset = doc.createElement('style'); reset.textContent = RESET_CSS; doc.head.appendChild(reset);
    Object.assign(doc.body.style, { width: `${width}px`, height: `${height}px`, overflow: 'visible' });
    this.doc = doc;
    return doc;
  }
  dispose(): void { this.iframe?.remove(); this.iframe = null; this.doc = null; }
}

export function buildLayoutDom(session: LayoutSession, timing: TimingResult, options: SnapshotOptions): { doc: Document; boxes: LayoutBox[] } {
  const doc = session.ensureDocument(options.width, options.height);
  doc.body.replaceChildren(); doc.head.querySelector('[data-hv-author]')?.remove();
  const style = doc.createElement('style'); style.setAttribute('data-hv-author', ''); style.textContent = options.cssText; doc.head.appendChild(style);
  const root = [...timing.nodes.values()].find((n) => n.kind === 'composition');
  const boxes: LayoutBox[] = [];
  if (!root) return { doc, boxes };
  const elements = new Map<string, HTMLElement>();
  const mount = (node: ResolvedNode, parent: HTMLElement): void => {
    if (node.kind === 'audio' || node.kind === 'declaration') return;
    const el = doc.createElement(node.tag) as HTMLElement;
    el.setAttribute('data-hv-id', node.id); el.id = node.attributes.id ?? node.id;
    if (node.attributes.class) el.className = node.attributes.class;
    if (['sequence', 'series', 'loop', 'freeze'].includes(node.kind)) el.style.display = 'contents';
    if (node.kind === 'composition') Object.assign(el.style, { display: 'block', position: 'relative', width: `${options.width}px`, height: `${options.height}px`, overflow: 'hidden' });
    if (node.kind === 'scene') Object.assign(el.style, { display: 'block', position: 'absolute', left: '0', top: '0', width: `${options.width}px`, height: `${options.height}px`, overflow: 'hidden' });
    if (node.kind === 'captions') Object.assign(el.style, { display: 'block', position: 'absolute', left: '0', top: '0', width: `${options.width}px`, height: `${options.height}px`, color: 'white', fontSize: '32px' });
    if (node.kind === 'video') Object.assign(el.style, { display: 'block', width: '100%', height: '100%' });
    if (node.kind === 'plugin') { (el as HTMLCanvasElement).width = Number(node.attributes.width); (el as HTMLCanvasElement).height = Number(node.attributes.height); }
    applyAdmittedDeclarations(el, parseInlineStyle(resolveCssAssetUrls(node.attributes.style ?? '', options.imageURLs ?? new Map(), 'declarationList')).declarations);
    if (node.kind === 'video') { el.style.objectFit = node.media?.fit ?? 'cover'; el.style.objectPosition = node.media?.position ?? '50% 50%'; }
    if (node.kind === 'text') el.textContent = node.text ?? '';
    if (node.kind === 'image') {
      (el as HTMLImageElement).src = options.imageURLs?.get(node.attributes.src) ?? node.attributes.src ?? '';
      const size = options.imageSizes?.get(node.attributes.src);
      if (size) { el.setAttribute('width', String(size.width)); el.setAttribute('height', String(size.height)); }
      for (const prop of ['width', 'height'] as const) if (node.attributes[prop]) el.style[prop] = `${node.attributes[prop]}px`;
    }
    for (const anim of options.animatedValues?.get(node.id) ?? []) {
      if (['width', 'height', 'left', 'top'].includes(anim.property)) {
        const value = Number.parseFloat(String(anim.value));
        if (!Number.isFinite(value)) throw new Error('E_ANIMATION: nonfinite layout value.');
        el.style.setProperty(anim.property, `${['width', 'height'].includes(anim.property) ? Math.max(0, value) : value}px`);
      } else if (anim.property === 'text-number') {
        const value = Number(anim.value);
        if (!Number.isFinite(value)) throw new Error('E_ANIMATION: nonfinite text-number.');
        el.textContent = String(Math.sign(value) * Math.floor(Math.abs(value) + 0.5));
      }
    }
    parent.appendChild(el); elements.set(node.id, el);
    for (const id of node.childIds) { const child = timing.nodes.get(id); if (child) mount(child, el); }
  };
  mount(root, doc.body);
  const rules = validateStylesheet(options.cssText).rules;
  const matrices = new Map<string, { fn: string; args: number[] }[]>();
  const origins = new Map<string, [number, number]>();
  const authoredTransforms = new Map<string, [string, string]>();
  for (const [id, el] of elements) {
    const node = timing.nodes.get(id)!;
    if (['sequence', 'series', 'loop', 'freeze'].includes(node.kind) && rules.some((r) => r.declarations.length && el.matches(r.selector))) throw new Error(`E_STYLE_UNSUPPORTED: styles cannot target transparent wrapper ${id}.`);
    const cs = doc.defaultView!.getComputedStyle(el);
    authoredTransforms.set(id, [el.style.getPropertyValue('transform'), el.style.getPropertyPriority('transform')]);
    if (cs.transform !== 'none') matrices.set(id, parseTransformFunctions(cs.transform));
    const origin = cs.transformOrigin.split(/\s+/).map(Number.parseFloat);
    origins.set(id, [origin[0] || 0, origin[1] || 0]);
  }
  for (const el of elements.values()) el.style.setProperty('transform', 'none', 'important');
  const textLines = new Map<string, ReturnType<typeof layoutText>>();
  for (const [id, el] of elements) {
    if (timing.nodes.get(id)?.kind !== 'text') continue;
    const c = collectComputedStyle(el); const cs = doc.defaultView!.getComputedStyle(el);
    if (cs.display === 'none') continue;
    const width = el.getBoundingClientRect().width - (Number.parseFloat(cs.paddingLeft) || 0) - (Number.parseFloat(cs.paddingRight) || 0) - c.borderLeftWidth - c.borderRightWidth;
    if (!Number.isFinite(width) || width <= 0) throw new Error(`E_TEXT_LAYOUT: ${id} requires a finite positive content width.`);
    const result = layoutText({ text: el.textContent ?? '', font: { family: c.fontFamily, px: c.fontSize, weight: c.fontWeight, style: c.fontStyle }, lineHeightPx: c.lineHeight, maxWidthPx: width, measure: () => getMeasureContext(doc).ctx, align: c.textAlign, direction: c.direction, whiteSpace: c.whiteSpace, overflowWrap: c.overflowWrap, textTransform: c.textTransform });
    textLines.set(id, result);
    const fixedHeight = !!el.style.height && el.style.height !== 'auto' || rules.some((r) => el.matches(r.selector) && r.declarations.some(([p, v]) => p === 'height' && v !== 'auto'));
    if (!fixedHeight) el.style.height = `${result.lines.length * c.lineHeight + c.borderTopWidth + c.borderBottomWidth + (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0)}px`;
  }
  for (const [id, el] of elements) {
    const [value, priority] = authoredTransforms.get(id)!;
    if (value) el.style.setProperty('transform', value, priority); else el.style.removeProperty('transform');
  }
  for (const [id, el] of elements) {
    const cs = doc.defaultView!.getComputedStyle(el);
    if (cs.transform !== 'none') matrices.set(id, parseTransformFunctions(cs.transform)); else matrices.delete(id);
    const origin = cs.transformOrigin.split(/\s+/).map(Number.parseFloat); origins.set(id, [origin[0] || 0, origin[1] || 0]);
  }
  for (const el of elements.values()) el.style.setProperty('transform', 'none', 'important');
  const capture = (node: ResolvedNode, parent: LayoutBox | null): void => {
    const el = elements.get(node.id); if (!el) return;
    const cs = doc.defaultView!.getComputedStyle(el); if (cs.display === 'none') return;
    if (cs.display === 'contents') { for (const cid of node.childIds) { const child = timing.nodes.get(cid); if (child) capture(child, parent); } return; }
    const rect = el.getBoundingClientRect(); const computed = collectComputedStyle(el);
    const radius = (value: string, vertical: boolean): number => { const parts = value.trim().split(/\s+/), part = vertical ? parts[1] ?? parts[0] : parts[0]; return Math.max(0, part.endsWith('%') ? (vertical ? rect.height : rect.width) * Number.parseFloat(part) / 100 : Number.parseFloat(part) || 0); };
    const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    const rx = corners.map(v => radius(v, false)) as [number, number, number, number], ry = corners.map(v => radius(v, true)) as [number, number, number, number];
    // CSS proportionally reduces intersecting radii. Empty pairs impose no restriction.
    const factor = Math.min(1, ...[rx[0] + rx[1], rx[2] + rx[3]].map(sum => sum ? rect.width / sum : 1), ...[ry[0] + ry[3], ry[1] + ry[2]].map(sum => sum ? rect.height / sum : 1));
    for (let i = 0; i < 4; i++) { rx[i] *= factor; ry[i] *= factor; }
    const box: LayoutBox = {
      id: node.id, tag: node.tag, kind: node.kind === 'composition' ? 'box' : node.kind as LayoutBox['kind'],
      x: rect.left, y: rect.top, width: rect.width, height: rect.height, children: [], computed, display: true,
      visibility: cs.visibility === 'hidden' ? 'hidden' : 'visible', overflowHidden: cs.overflow === 'hidden',
      borderRadiusPx: rx, borderRadiusYpx: ry,
      transform: matrices.get(node.id), transformOrigin: origins.get(node.id)
    };
    const text = textLines.get(node.id);
    if (text) {
      const px = computed.borderLeftWidth + (Number.parseFloat(cs.paddingLeft) || 0); const py = computed.borderTopWidth + (Number.parseFloat(cs.paddingTop) || 0);
      box.text = el.textContent ?? ''; box.lines = text.lineLayout.map((line) => ({ ...line, x: line.x + px, y: line.y + py }));
    }
    parent?.children.push(box); boxes.push(box);
    for (const cid of node.childIds) { const child = timing.nodes.get(cid); if (child) capture(child, box); }
  };
  capture(root, null); return { doc, boxes };
}

export function parseTransformFunctions(transform: string): { fn: string; args: number[] }[] {
  const out: { fn: string; args: number[] }[] = []; const re = /(translate|translateX|translateY|rotate|scale|scaleX|scaleY|skew|skewX|skewY|matrix)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transform))) out.push({ fn: m[1], args: m[2].split(/[ ,]+/).filter(Boolean).map(Number.parseFloat) });
  return out;
}
export { canvasFontString };
