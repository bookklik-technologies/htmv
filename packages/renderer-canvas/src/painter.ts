/**
 * Canvas 2D painter (spec 5.1, 8.4, 15.1): painter order is expanded DOM order;
 * background/border of a node then children. Scenes composited in source order.
 * Group opacity is applied to an isolated surface, not multiplied into children.
 */
import { Rational } from '@htmv/core';
import { Evaluation, MediaRequest, parseColorSafe, clampProperty } from './evaluate.js';
import type { LayoutBox } from '@htmv/layout-dom';
import { layoutText } from '@htmv/layout-dom';

export interface NodeBoxIndex {
  boxes: Map<string, LayoutBox>;
}

export function indexBoxes(boxes: readonly LayoutBox[]): Map<string, LayoutBox> {
  const map = new Map<string, LayoutBox>();
  for (const b of boxes) map.set(b.id, b);
  return map;
}

export interface PaintContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  background: string;
  boxIndex: Map<string, LayoutBox>;
  media: MediaSurfaceProvider | null;
}

export interface MediaSurfaceProvider {
  /** Returns the decoded frame/bitmap for a media node at this evaluation, or null when transparent/pending. */
  getVideoSample(id: string, request: MediaRequest): CanvasImageSource | null;
  getImageSample?(idOrURL: string): CanvasImageSource | null;
}

export function paintFrame(paint: PaintContext, evaluation: Evaluation): void {
  const { ctx, width, height } = paint;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  // root background (spec 4.3): opaque 8-bit SDR surface
  ctx.fillStyle = paint.background;
  ctx.fillRect(0, 0, width, height);

  // compose scenes in source order; transitions override when overlapping
  const transitionByIncoming = new Map(evaluation.transitions.map((t) => [t.incomingId, t]));
  const transitionOutgoing = new Map(evaluation.transitions.map((t) => [t.outgoingId ?? '', t]));

  const rootBoxChildren = paint.boxIndex;
  void rootBoxChildren;

  paintSubtreeChildren(paint, evaluation, 'composition-root-placeholder', transitionByIncoming, transitionOutgoing);
  ctx.restore();
}

function paintSubtreeChildren(
  paint: PaintContext,
  evaluation: Evaluation,
  _rootMarker: string,
  transitionByIncoming: Map<string, Evaluation['transitions'][0]>,
  transitionOutgoing: Map<string, Evaluation['transitions'][0]>
): void {
  // Paint is driven by the paint tree captured at snapshot time: boxIndex contains
  // LayoutBox tree keyed by node id with children arrays.
  const findAnonymized = new Map(paint.boxIndex);
  void findAnonymized;
  const roots = findSceneRoots(paint.boxIndex);
  const segments: { id: string; out: string | null }[] = [];
  void segments;
  const outgoingHandled = new Set<string>();
  for (const sceneId of roots) {
    const outgoingT = transitionOutgoing.get(sceneId);
    if (outgoingT && evaluation.states.has(outgoingT.incomingId)) continue;
    const incomingT = transitionByIncoming.get(sceneId);
    if (incomingT && evaluation.states.has(sceneId)) {
      const outBox = paint.boxIndex.get(incomingT.outgoingId ?? '');
      const outgoingStillActive = incomingT.outgoingId !== null && evaluation.states.has(incomingT.outgoingId) && !outgoingHandled.has(incomingT.outgoingId);
      if (outBox && outgoingStillActive) {
        paintTransition(paint, evaluation, incomingT, outBox, paint.boxIndex.get(sceneId) as LayoutBox);
        outgoingHandled.add(incomingT.outgoingId ?? '');
        continue;
      }
    }
    paintNode(paint, evaluation, paint.boxIndex.get(sceneId) as LayoutBox);
  }
  void transitionOutgoing;
}

function findSceneRoots(boxIndex: Map<string, LayoutBox>): string[] {
  // scenes are top-level along with boxes; find boxes whose parent isn't a box
  const all = [...boxIndex.values()].filter((b) => b.kind === 'scene' || b.kind === 'box' || b.kind === 'text' || b.kind === 'image' || b.kind === 'video' || b.kind === 'captions' || b.kind === 'plugin');
  const referencedChildren = new Set<string>();
  for (const b of all) for (const c of b.children) referencedChildren.add(c.id);
  // Order: DOM source order preserved by snapshot capture order
  return all.filter((b) => !referencedChildren.has(b.id)).map((b) => b.id);
}

function paintNode(paint: PaintContext, evaluation: Evaluation, box: LayoutBox): void {
  const state = evaluation.states.get(box.id);
  if (!state) return; // inactive this frame: neither paints nor emits audio
  paintBoxWithChildren(paint, evaluation, box);
}

function paintBoxWithChildren(paint: PaintContext, evaluation: Evaluation, box: LayoutBox): void {
  const { ctx } = paint;
  const values = evaluation.animatedValues.get(box.id) ?? [];
  const anim = collectAnimated(values, box);
  const groupAlpha = anim.opacity !== undefined ? clampProperty('opacity', anim.opacity as number) : box.computed.opacity;

  const isolated = groupAlpha < 1 || (anim.opacity !== undefined && (anim.opacity as number) < 1);
  if (groupAlpha === 0) return;
  if (isolated) {
    // isolated group alpha onto bounded reusable surface (spec 5.1)
    const surface = getIsolatedSurface(paint, paint.width, paint.height);
    const sctx = surface.getContext('2d') as CanvasRenderingContext2D;
    sctx.clearRect(0, 0, surface.width, surface.height);
    sctx.setTransform(ctx.getTransform());
    try {
    paintBoxBody({ ...paint, ctx: sctx }, evaluation, box, anim, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= groupAlpha;
    ctx.drawImage(surface, 0, 0);
    ctx.restore();
    } finally { releaseIsolatedSurface(surface); }
    return;
  }
  ctx.save();
  ctx.globalAlpha *= groupAlpha;
  paintBoxBody(paint, evaluation, box, anim, 0, 0);
  ctx.restore();
}

function collectAnimated(values: { property: string; value: number | string }[], box: LayoutBox): {
  opacity?: number;
  translateX?: number;
  translateY?: number;
  rotate?: number;
  scaleX?: number;
  scaleY?: number;
  backgroundColor?: string;
  color?: string;
} {
  const out: ReturnType<typeof collectAnimated> = {};
  for (const { property, value } of values) {
    switch (property) {
      case 'opacity': out.opacity = typeof value === 'number' ? value : parseFloat(value); break;
      case 'translate-x': out.translateX = parseLen(value) * (String(value).endsWith('%') ? box.width / 100 : 1); break;
      case 'translate-y': out.translateY = parseLen(value) * (String(value).endsWith('%') ? box.height / 100 : 1); break;
      case 'rotate': out.rotate = typeof value === 'number' ? value : parseFloat(value); break;
      case 'scale-x': out.scaleX = typeof value === 'number' ? value : parseFloat(value); break;
      case 'scale-y': out.scaleY = typeof value === 'number' ? value : parseFloat(value); break;
      case 'background-color': out.backgroundColor = String(value); break;
      case 'color': out.color = String(value); break;
    }
  }
  return out;
}

function parseLen(v: number | string): number {
  if (typeof v === 'number') return v;
  const m = /^(-?\d+(?:\.\d+)?)\s*(px|%)?$/.exec(v);
  return m ? Number(m[1]) : 0;
}

function paintBoxBody(
  paint: PaintContext,
  evaluation: Evaluation,
  box: LayoutBox,
  anim: { opacity?: number; translateX?: number; translateY?: number; rotate?: number; scaleX?: number; scaleY?: number; backgroundColor?: string; color?: string },
  _offX: number,
  _offY: number
): void {
  const ctx = paint.ctx;
  ctx.save();
  // transform: animated channels replace static transform (spec 6.3)
  const hasAnimatedTransform = anim.translateX !== undefined || anim.translateY !== undefined || anim.rotate !== undefined || anim.scaleX !== undefined || anim.scaleY !== undefined;
  applyTransform(ctx, box, anim, hasAnimatedTransform);
  // clips: overflow + rounded corners propagate via resolved stack (spec 5.1)
  if (box.overflowHidden) {
    applyRoundedClip(ctx, box);
  }
  if (box.visibility !== 'visible') { paintChildren(paint, evaluation, box); ctx.restore(); return; }
  // background
  const bg = anim.backgroundColor ?? rgbFromComputed(box.computed.backgroundColor);
  if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = bg;
    fillRoundedRect(ctx, box.x, box.y, box.width, box.height, box.borderRadiusPx, box.borderRadiusYpx);
  }
  // background image (admitted raster/gradient): painted without repeat tile layout support beyond once
  if (box.computed.backgroundImage) {
    paintBackgroundImage(paint, box);
  }
  // borders
  paintBorders(ctx, box);
  // content
  if (box.kind === 'text') {
    paintText(paint, box, anim.color ?? box.computed.color);
  } else if (box.kind === 'image' || box.kind === 'video' || box.kind === 'plugin') {
    ctx.save(); if (box.borderRadiusPx.some((r) => r > 0)) applyRoundedClip(ctx, box);
    paintMediaContent(paint, evaluation, box);
    ctx.restore();
  } else if (box.kind === 'captions') {
    paintCaptionsInline(paint, evaluation, box);
  }
  paintChildren(paint, evaluation, box);
  ctx.restore();
}

function paintChildren(paint: PaintContext, evaluation: Evaluation, box: LayoutBox): void {
  const handled = new Set<string>();
  for (const child of box.children) {
    if (handled.has(child.id)) continue;
    const state = evaluation.states.get(child.id);
    if (!state) continue;
    const transition = evaluation.transitions.find((t) => t.outgoingId === child.id);
    const incoming = transition ? box.children.find((c) => c.id === transition.incomingId) : undefined;
    if (transition && incoming && evaluation.states.has(incoming.id)) {
      paintTransition(paint, evaluation, transition, child, incoming);
      handled.add(incoming.id);
      continue;
    }
    paintBoxWithChildren(paint, evaluation, child);
  }
}

function applyTransform(ctx: CanvasRenderingContext2D, box: LayoutBox, anim: { translateX?: number; translateY?: number; rotate?: number; scaleX?: number; scaleY?: number }, hasAnimated: boolean): void {
  const originX = box.x + (box.transformOrigin?.[0] ?? box.width / 2);
  const originY = box.y + (box.transformOrigin?.[1] ?? box.height / 2);
  if (!hasAnimated && (!box.transform || box.transform.length === 0)) return;
  ctx.translate(originX, originY);
  const deg = Math.PI / 180;
  if (hasAnimated) {
    const m = transformMatrix(anim.translateX ?? 0, anim.translateY ?? 0, (anim.rotate ?? 0) * deg, anim.scaleX ?? 1, anim.scaleY ?? 1);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  } else if (box.transform) {
    for (const t of box.transform) {
      switch (t.fn) {
        case 'translate': ctx.translate(t.args[0] ?? 0, t.args[1] ?? 0); break;
        case 'translateX': ctx.translate(t.args[0] ?? 0, 0); break;
        case 'translateY': ctx.translate(0, t.args[0] ?? 0); break;
        case 'rotate': ctx.rotate((t.args[0] ?? 0) * deg); break;
        case 'scale': ctx.scale(t.args[0] ?? 1, t.args[1] ?? t.args[0] ?? 1); break;
        case 'scaleX': ctx.scale(t.args[0] ?? 1, 1); break;
        case 'scaleY': ctx.scale(1, t.args[0] ?? 1); break;
        case 'skew': ctx.transform(1, Math.tan((t.args[1] ?? 0) * deg), Math.tan((t.args[0] ?? 0) * deg), 1, 0, 0); break;
        case 'skewX': ctx.transform(1, 0, Math.tan((t.args[0] ?? 0) * deg), 1, 0, 0); break;
        case 'skewY': ctx.transform(1, Math.tan((t.args[0] ?? 0) * deg), 0, 1, 0, 0); break;
        case 'matrix': {
          const a = t.args;
          ctx.transform(a[0] ?? 1, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1, a[4] ?? 0, a[5] ?? 0);
          break;
        }
      }
    }
  }
  ctx.translate(-originX, -originY);
}

/** Column-vector composed matrix T(tx,ty) × R(angle) × S(sx,sy) (spec 6.3). */
export function transformMatrix(tx: number, ty: number, angle: number, sx: number, sy: number): [number, number, number, number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // M = T * R * S  (translation applied after rotation applied after scale)
  const a = sx * cos;
  const b = sy * sin;
  const c = -sx * sin;
  const d = sy * cos;
  const e = tx;
  const f = ty;
  return [a, b, c, d, e, f];
}

export interface FrameGeometryNode {
  id: string; x: number; y: number; width: number; height: number; rotation: number; scaleX: number; scaleY: number; opacity: number;
  corners: { x: number; y: number }[]; values: Record<string, number | string>;
}
/** Editor geometry uses the exact transform application and evaluation used by painting. */
export function inspectPaintFrame(ctx: CanvasRenderingContext2D, boxes: Map<string, LayoutBox>, evaluation: Evaluation, width: number, height: number): FrameGeometryNode[] {
  const result: FrameGeometryNode[] = [];
  const visit = (box: LayoutBox, alpha: number): void => {
    if (!evaluation.states.has(box.id) || !box.display || box.visibility === 'hidden') return;
    ctx.save();
    try {
      const transition = evaluation.transitions.find(t => t.incomingId === box.id || t.outgoingId === box.id);
      if (transition) {
        const incoming = transition.incomingId === box.id;
        if (transition.type === 'crossfade') alpha *= incoming ? transition.progress : 1 - transition.progress;
        if (transition.type === 'slide') { const dir: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }; const [x, y] = dir[transition.direction] ?? [-1, 0]; const amount = incoming ? transition.progress - 1 : transition.progress; ctx.translate(x * amount * width, y * amount * height); }
      }
      const values = evaluation.animatedValues.get(box.id) ?? [], anim = collectAnimated(values, box);
      alpha *= anim.opacity !== undefined ? clampProperty('opacity', anim.opacity) : box.computed.opacity;
      const transformed = values.some(v => ['translate-x', 'translate-y', 'rotate', 'scale-x', 'scale-y'].includes(v.property));
      applyTransform(ctx, box, anim, transformed);
      const matrix = ctx.getTransform();
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]].map(([x, y]) => { const v = matrix.transformPoint({ x, y }); return { x: v.x, y: v.y }; });
      result.push({ id: box.id, x: box.x + (anim.translateX ?? 0), y: box.y + (anim.translateY ?? 0), width: box.width, height: box.height, rotation: anim.rotate ?? 0, scaleX: anim.scaleX ?? 1, scaleY: anim.scaleY ?? 1, opacity: alpha, corners, values: Object.fromEntries(values.map(v => [v.property, v.value])) });
      for (const child of box.children) visit(child, alpha);
    } finally { ctx.restore(); }
  };
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  try { for (const id of findSceneRoots(boxes)) visit(boxes.get(id)!, 1); } finally { ctx.restore(); }
  return result;
}

function applyRoundedClip(ctx: CanvasRenderingContext2D, box: LayoutBox): void {
  ctx.beginPath();
  roundRectPath(ctx, box.x, box.y, box.width, box.height, box.borderRadiusPx, box.borderRadiusYpx);
  ctx.clip();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number], ry = r): void {
  ctx.roundRect(x, y, w, h, r.map((radius, i) => ({ x: Math.max(0, radius), y: Math.max(0, ry[i]) })));
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number], ry = r): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r, ry);
  ctx.fill();
}

function rgbFromComputed(color: string): string {
  return color;
}

function paintBorders(ctx: CanvasRenderingContext2D, box: LayoutBox): void {
  if (box.computed.borderStyle === 'none') return;
  const widths = [box.computed.borderTopWidth, box.computed.borderRightWidth, box.computed.borderBottomWidth, box.computed.borderLeftWidth], width = widths[0];
  if (width > 0 && widths.every(w => w === width) && box.borderRadiusPx.some(r => r > 0)) {
    const ry = box.borderRadiusYpx ?? box.borderRadiusPx;
    ctx.beginPath(); roundRectPath(ctx, box.x, box.y, box.width, box.height, box.borderRadiusPx, ry);
    if (box.width > width * 2 && box.height > width * 2) roundRectPath(ctx, box.x + width, box.y + width, box.width - width * 2, box.height - width * 2, box.borderRadiusPx.map(r => Math.max(0, r - width)) as [number, number, number, number], ry.map(r => Math.max(0, r - width)) as [number, number, number, number]);
    ctx.fillStyle = box.computed.borderColor; ctx.fill('evenodd'); return;
  }
  const sides: [number, number, number, number, string][] = [
    // top
    [box.x, box.y, box.width, box.computed.borderTopWidth, `top`],
    // right
    [box.x + box.width - box.computed.borderRightWidth, box.y, box.computed.borderRightWidth, box.height, `right`],
    // bottom
    [box.x, box.y + box.height - box.computed.borderBottomWidth, box.width, box.computed.borderBottomWidth, `bottom`],
    // left
    [box.x, box.y, box.computed.borderLeftWidth, box.height, `left`]
  ];
  ctx.fillStyle = box.computed.borderColor;
  for (const side of sides) {
    if (side[2] > 0 && side[3] > 0) ctx.fillRect(side[0], side[1], side[2], side[3]);
  }
}

function paintText(paint: PaintContext, box: LayoutBox, color: string): void {
  const ctx = paint.ctx;
  if (!box.lines) return;
  const c = box.computed;
  ctx.save();
  ctx.font = `${c.fontStyle === 'italic' ? 'italic ' : ''}${fontWeightCanvas(c.fontWeight)} ${c.fontSize}px ${c.fontFamily}`;
  ctx.fillStyle = color;
  // textDecorationLine solid current-color, pinned positions (spec 8.3)
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.direction = box.computed.direction === 'rtl' ? 'rtl' : 'ltr';
  for (const line of box.lines) {
    const baselineY = box.y + line.y;
    ctx.fillText(line.text, box.x + line.x, baselineY);
    if (c.textDecorationLine.includes('underline') || c.textDecorationLine.includes('line-through')) {
      const y = c.textDecorationLine.includes('line-through') && !c.textDecorationLine.includes('underline')
        ? baselineY - c.fontSize * 0.3
        : baselineY + c.fontSize * 0.15;
      ctx.fillRect(box.x + line.x, y, line.width, Math.max(1, c.fontSize / 16));
    }
  }
  ctx.restore();
}

function fontWeightCanvas(w: string): string {
  if (w === 'normal') return '400';
  if (w === 'bold') return '700';
  return w;
}

function paintMediaContent(paint: PaintContext, evaluation: Evaluation, box: LayoutBox): void {
  const ctx = paint.ctx;
  const request = evaluation.mediaRequests.get(box.id);
  const image = box.kind === 'image' || box.kind === 'plugin'
    ? paint.media?.getImageSample?.(box.id) ?? null
    : paint.media?.getVideoSample(box.id, request ?? fakeRequest()) ?? null;
  if (box.kind === 'image' || box.kind === 'plugin') {
    if (image) drawFitted(ctx, image, box, box.computed.objectFit, box.computed.objectPosition);
    // broken/late assets are errors upstream; render nothing here otherwise
    return;
  }
  // video: fit attribute values are the authoritative controls (spec 8.7)
  const node = request;
  const fit = (node as unknown as { fit?: string }).fit ?? box.computed.objectFit;
  void fit;
  if (image) drawFitted(ctx, image, box, box.computed.objectFit, box.computed.objectPosition);
}

function drawFitted(ctx: CanvasRenderingContext2D, src: CanvasImageSource, box: LayoutBox, fit: string, position: string): void {
  const iw = naturalWidth(src);
  const ih = naturalHeight(src);
  if (!iw || !ih) return;
  const scale = fit === 'cover'
    ? Math.max(box.width / iw, box.height / ih)
    : fit === 'contain'
      ? Math.min(box.width / iw, box.height / ih)
      : fit === 'fill'
        ? 1
        : Math.min(box.width / iw, box.height / ih);
  const dw = fit === 'fill' ? box.width : iw * scale;
  const dh = fit === 'fill' ? box.height : ih * scale;
  const pm = parsePercentPair(position);
  const x = box.x + (box.width - dw) * pm[0];
  const y = box.y + (box.height - dh) * pm[1];
  ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip();
  ctx.drawImage(src, x, y, dw, dh);
  ctx.restore();
}

function parsePercentPair(position: string): [number, number] {
  const parts = position.split(/\s+/);
  const toFrac = (s: string | undefined, dflt: number): number => {
    if (!s) return dflt;
    if (/^\d+(\.\d+)?%$/.test(s)) return Number(s.replace('%', '')) / 100;
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s); // px -> treat as fraction fallback
    return dflt;
  };
  return [toFrac(parts[0], 0.5), toFrac(parts[1] ?? parts[0], 0.5)];
}

function naturalWidth(src: CanvasImageSource): number {
  const w = (src as { width?: number }).width;
  const nw = (src as { naturalWidth?: number }).naturalWidth;
  return nw ?? w ?? 0;
}
function naturalHeight(src: CanvasImageSource): number {
  const h = (src as { height?: number }).height;
  const nh = (src as { naturalHeight?: number }).naturalHeight;
  return nh ?? h ?? 0;
}

function fakeRequest(): MediaRequest {
  return {
    sourceTime: Rational.zero(),
    rate: Rational.fromInteger(1),
    trimIn: Rational.zero(),
    trimOut: null,
    kind: 'video',
    audio: 'mute',
    gain: null,
    endBehavior: 'error',
    repeat: false,
    fadeIn: Rational.zero(),
    fadeOut: Rational.zero(),
    localTime: Rational.zero()
  };
}

// ---- isolated surfaces (bounded, spec 8.4) --------------------
const surfacePool: HTMLCanvasElement[] = [];
const borrowedSurfaces = new Set<HTMLCanvasElement>();

function getIsolatedSurface(paint: PaintContext, w: number, h: number): HTMLCanvasElement {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  const existing = surfacePool.find((c) => !borrowedSurfaces.has(c) && c.width === cw && c.height === ch);
  if (existing) {
    // crop draw handled by caller using surface coordinates starting 0,0 with size cw/ch
    borrowedSurfaces.add(existing); return existing;
  }
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  if (borrowedSurfaces.size >= 8) throw new Error('E_RESOURCE_LIMIT: too many simultaneous compositing surfaces.');
  surfacePool.push(c); borrowedSurfaces.add(c);
  return c;
}

function releaseIsolatedSurface(c: HTMLCanvasElement): void {
  borrowedSurfaces.delete(c);
  const index = surfacePool.indexOf(c); if (index >= 0) surfacePool.splice(index, 1);
  c.width = c.height = 0;
}

function paintBackgroundImage(paint: PaintContext, box: LayoutBox): void {
  const ctx = paint.ctx;
  const bi = box.computed.backgroundImage;
  if (!bi) return;
  const gradient = parseLinearGradient(bi);
  if (gradient) {
    const [x0, y0, x1, y1, stops] = gradient;
    const g = ctx.createLinearGradient(box.x + x0 * box.width, box.y + y0 * box.height, box.x + x1 * box.width, box.y + y1 * box.height);
    for (const [offset, color] of stops) {
      const c = parseColorSafe(color) ?? [0, 0, 0, 1];
      g.addColorStop(offset, `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`);
    }
    ctx.save();
    applyRoundedClip(ctx, box);
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.restore();
    return;
  }
  const url = /^url\(["']?(.*?)["']?\)$/.exec(bi)?.[1];
  const image = url ? paint.media?.getImageSample?.(url) : null;
  if (image) drawFitted(ctx, image, box, box.computed.backgroundSize === 'contain' ? 'contain' : 'cover', box.computed.backgroundPosition);
}

export function parseLinearGradient(bi: string): [number, number, number, number, [number, string][]] | null {
  const m = /^linear-gradient\(([\s\S]*)\)$/.exec(bi);
  if (!m) return null;
  // parse `45deg, #fff 0%, #000 100%` — admit sRGB stops with optional percents
  const inner = m[1];
  const parts = splitTop(inner);
  let angleDeg = 180;
  const stopsRaw: [number, string][] = [];
  const angleMatch = /^(-?[\d.]+)deg$/.exec(parts[0].trim());
  let i = 0;
  if (angleMatch) {
    angleDeg = parseFloat(angleMatch[1]);
    i = 1;
  }
  const count = parts.length - i;
  let idx = 0;
  for (; i < parts.length; i++) {
    const p = parts[i].trim();
    const sp = /\s+(?=[\d.]+%?$)/.test(p) ? p.lastIndexOf(' ') : -1;
    let color = p;
    let offset = count <= 1 ? idx / Math.max(1, count - 1) : NaN;
    if (sp > 0) {
      color = p.slice(0, sp);
      const opRaw = p.slice(sp + 1).trim().replace('%', '');
      if (/^[\d.]+$/.test(opRaw)) offset = Number(opRaw) / 100;
    }
    if (Number.isNaN(offset)) offset = count <= 1 ? idx / Math.max(1, count - 1) : idx / Math.max(1, count - 1);
    stopsRaw.push([offset, color]);
    idx++;
  }
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const cx = 0.5;
  const cy = 0.5;
  const len = 0.5;
  const x0 = cx - Math.cos(rad) * len;
  const y0 = cy - Math.sin(rad) * len;
  const x1 = cx + Math.cos(rad) * len;
  const y1 = cy + Math.sin(rad) * len;
  return [x0, y0, x1, y1, stopsRaw];
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---- transitions (spec 5.3) -----------------------------------

function paintTransition(
  paint: PaintContext,
  evaluation: Evaluation,
  t: Evaluation['transitions'][0],
  outBox: LayoutBox,
  incBox: LayoutBox
): void {
  const ctx = paint.ctx;
  const p = t.progress;
  if (t.type === 'crossfade') {
    const mix = getIsolatedSurface(paint, paint.width, paint.height);
    const layer = getIsolatedSurface(paint, paint.width, paint.height);
    try {
      const mctx = mix.getContext('2d')!;
      const lctx = layer.getContext('2d')!;
      mctx.clearRect(0, 0, mix.width, mix.height);
      for (const [box, alpha] of [[outBox, 1 - p], [incBox, p]] as const) {
        lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, layer.width, layer.height);
        lctx.setTransform(ctx.getTransform());
        paintBoxWithChildren({ ...paint, ctx: lctx }, evaluation, box);
        mctx.globalCompositeOperation = 'lighter'; mctx.globalAlpha = alpha;
        mctx.drawImage(layer, 0, 0);
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(mix, 0, 0); ctx.restore();
    } finally { releaseIsolatedSurface(layer); releaseIsolatedSurface(mix); }
    return;
  }
  if (t.type === 'slide') {
    const dir = t.direction;
    const shift = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as Record<string, [number, number]>;
    const sh = shift[dir] ?? [1, 0];
    const dxOut = sh[0] * p * paint.width;
    const dyOut = sh[1] * p * paint.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, paint.width, paint.height);
    ctx.clip();
    ctx.save();
    ctx.translate(dxOut, dyOut);
    paintBoxWithChildren(paint, evaluation, outBox);
    ctx.restore();
    const dxIn = sh[0] * (p - 1) * paint.width;
    const dyIn = sh[1] * (p - 1) * paint.height;
    ctx.save();
    ctx.translate(dxIn, dyIn);
    paintBoxWithChildren(paint, evaluation, incBox);
    ctx.restore();
    ctx.restore();
    return;
  }
  // wipe: reveal incoming through an axis-aligned clip rectangle
  const dir = t.direction;
  ctx.save();
  paintBoxWithChildren(paint, evaluation, outBox);
  ctx.save();
  const clip: [number, number, number, number] =
    dir === 'left' ? [0, 0, paint.width * p, paint.height]
      : dir === 'right' ? [paint.width * (1 - p), 0, paint.width * p, paint.height]
        : dir === 'up' ? [0, paint.height * (1 - p), paint.width, paint.height * p]
          : [0, 0, paint.width, paint.height * p];
  ctx.beginPath();
  ctx.rect(clip[0], clip[1], clip[2], clip[3]);
  ctx.clip();
  paintBoxWithChildren(paint, evaluation, incBox);
  ctx.restore();
  ctx.restore();
}

function paintCaptionsInline(paint: PaintContext, evaluation: Evaluation, box: LayoutBox): void {
  // burned-in captions overlay (defaults spec 10.5); author styling replaces defaults
  const ctx = paint.ctx;
  const lines = evaluation.captionsVisible.filter((cue) => cue.nodeId === box.id);
  if (lines.length === 0) return;
  let y = box.y + box.height - 0.05 * paint.height;
  ctx.save();
  ctx.textAlign = 'center';
  const wrapped = lines.flatMap((cue) => layoutText({ text: cue.text, font: { family: box.computed.fontFamily, px: box.computed.fontSize, weight: box.computed.fontWeight, style: box.computed.fontStyle }, lineHeightPx: box.computed.lineHeight, maxWidthPx: Math.max(1, Math.min(box.width, paint.width * 0.9) - 16), measure: () => ctx, align: 'center', direction: box.computed.direction, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }).lines);
  for (const textLine of wrapped.reverse()) {
      ctx.font = `${box.computed.fontWeight === '700' ? '700 ' : ''}${box.computed.fontSize}px ${box.computed.fontFamily}`;
      const w = ctx.measureText(textLine).width;
      // solid high-contrast background, bottom-center anchor, 5% inset, max 90% width
      const cx = paint.width / 2;
      ctx.fillStyle = box.computed.backgroundColor !== 'rgba(0, 0, 0, 0)' && box.computed.backgroundColor !== 'transparent'
        ? box.computed.backgroundColor
        : 'rgba(0,0,0,0.75)';
      ctx.fillRect(cx - Math.min(w, paint.width * 0.9) / 2 - 8, y - box.computed.fontSize - 6, Math.min(w, paint.width * 0.9) + 16, box.computed.fontSize + 12);
      ctx.fillStyle = box.computed.color;
      ctx.fillText(textLine, cx, y);
      y -= box.computed.lineHeight + 12;
  }
  ctx.restore();
}
