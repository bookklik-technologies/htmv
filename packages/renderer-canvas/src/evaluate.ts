/**
 * Frame evaluation (spec 3.2â€“3.6): deterministic exact-time evaluation.
 * Interval logic: half-open [start,end). Effective clipping is computed in
 * root coordinates; local clock transforms do not erase ancestor clipping.
 */
import { Rational, Interval, evaluateClock, isActive, parseColor } from '@htmv/core';
import { TimingResult, ResolvedNode, ResolvedAnimation } from '@htmv/compiler';

export interface EasingEvaluator {
  (easing: string, p: number, durationSeconds: number): number;
}

export interface MediaRequest {
  sourceTime: Rational;
  rate: Rational;
  trimIn: Rational;
  trimOut: Rational | null;
  kind: 'video' | 'audio';
  audio: 'include' | 'mute';
  gain: number | null; // base gain attr, or null
  endBehavior: 'error' | 'hold';
  repeat: boolean;
  fadeIn: Rational;
  fadeOut: Rational;
  localTime: Rational;
}

export interface SeriesTransitionState {
  type: string;
  direction: string;
  progress: number;
  outgoingId: string | null;
  incomingId: string;
}

export interface NodeState {
  node: ResolvedNode;
  nodeLocal: Rational; // local time within node's own clock
  parentOverride: Rational | null; // time passed to descendants by loop/freeze
  iteration: number; // innermost loop index (0 outside)
  iterationPath: number[];
}

export interface Evaluation {
  frame: number;
  time: Rational;
  states: Map<string, NodeState>;
  animatedValues: Map<string, { property: string; value: number | string }[]>;
  captionsVisible: { text: string; nodeId: string }[];
  transitions: SeriesTransitionState[]; // per series mid-overlap
  mediaRequests: Map<string, MediaRequest>;
  warnings: { code: string; message: string }[];
}

const COLOR_RE = /^#|^rgb/;

function interpolateValue(a: string, b: string, t: number): number | string {
  if (parseColorSafe(a) && parseColorSafe(b)) {
    const ca = parseColorSafe(a);
    const cb = parseColorSafe(b);
    if (ca && cb) {
      const prem = (c: [number, number, number, number]) => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];
      const pa = prem(ca);
      const pb = prem(cb);
      const r: [number, number, number, number] = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) r[i] = pa[i] + (pb[i] - pa[i]) * t;
      const alpha = Math.min(1, Math.max(0, r[3]));
      const un = alpha <= 0 ? [0, 0, 0] : [r[0] / alpha, r[1] / alpha, r[2] / alpha].map((v) => Math.min(1, Math.max(0, v)));
      const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
      return `#${hex(un[0])}${hex(un[1])}${hex(un[2])}${hex(alpha)}`;
    }
  }
  const ua = /^(-?\d+(?:\.\d+)?)\s*(px|%)?$/.exec(a.trim());
  const ub = /^(-?\d+(?:\.\d+)?)\s*(px|%)?$/.exec(b.trim());
  if (ua && ub && (ua[2] ?? '') === (ub[2] ?? '')) {
    const va = Number(ua[1]);
    const vb = Number(ub[1]);
    return `${va + (vb - va) * t}${ua[2] ?? ''}`;
  }
  const va = parseFloat(a);
  const vb = parseFloat(b);
  if (Number.isFinite(va) && Number.isFinite(vb)) return va + (vb - va) * t;
  return t >= 1 ? b : a;
}

export function parseColorSafe(text: string): [number, number, number, number] | null {
  try {
    // imported lazily to avoid cycles
    const { parseColor } = require0();
    return parseColor(text);
  } catch {
    return null;
  }
}

function require0(): { parseColor: (t: string) => [number, number, number, number] } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return { parseColor };
}

function parseColorImpl(text: string): [number, number, number, number] {
  const s = text.trim();
  const hex6 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s) || (() => {
    const m = /^#\s*([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(s);
    return m ? { 1: m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 2: '' } : null;
  })();
  if (hex6) {
    const h = hex6[1];
    const a = hex6[2] ?? '';
    const aa = a.length === 1 ? a + a : a;
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, aa ? parseInt(aa, 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, rgb[4] !== undefined && rgb[4] !== '' ? Number(rgb[4]) : 1];
  throw new Error(`Malformed color "${text}"`);
}

export function clampProperty(property: string, v: number): number {
  switch (property) {
    case 'opacity':
      return Math.min(1, Math.max(0, v));
    case 'gain':
      return Math.min(4, Math.max(0, v));
    case 'width':
    case 'height':
      return Math.max(0, v);
    case 'background-color':
    case 'color':
      return v;
    default:
      return v;
  }
}

export function propertyValue(anim: ResolvedAnimation, p: number, easingEval: EasingEvaluator, durationSeconds: number): number | string {
  if (anim.keyframes && anim.keyframes.length > 0) {
    const kfs = anim.keyframes;
    if (p <= kfs[0].offset) return kfs[0].value;
    if (p >= kfs[kfs.length - 1].offset) return kfs[kfs.length - 1].value;
    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].offset <= p) i++;
    const a = kfs[i];
    const b = kfs[i + 1];
    const span = b.offset - a.offset || 1;
    const seg = (p - a.offset) / span;
    const segEase = a.easing && a.easing !== 'linear' ? easingEval(a.easing, seg, span * durationSeconds) : seg;
    return interpolateValue(a.value, b.value, segEase);
  }
  const eased = easingEval(anim.easing, p, durationSeconds);
  const from = anim.from ?? '0';
  const to = anim.to ?? '0';
  return interpolateValue(from, to, eased);
}

export function evaluateFrame(
  timing: TimingResult,
  opts: {
    frame: number;
    fps: Rational;
    durationFrames: number;
    easing: EasingEvaluator;
    time?: Rational;
  }
): Evaluation {
  const time = opts.time ?? Rational.fromInteger(BigInt(opts.frame)).div(opts.fps);
  const nodes = timing.nodes;
  const root = [...nodes.values()].find((n) => n.kind === 'composition');
  const states = new Map<string, NodeState>();
  const animatedValues = new Map<string, { property: string; value: number | string }[]>();
  const captionsVisible: { text: string; nodeId: string }[] = [];
  const transitions: SeriesTransitionState[] = [];
  const mediaRequests = new Map<string, MediaRequest>();
  const warnings: { code: string; message: string }[] = [];

  const numberDuration = (n: ResolvedNode): Rational | null => (typeof n.duration === 'object' ? (n.duration as Rational) : null);

  function walk(node: ResolvedNode, clip: Interval | null, parentTimeIn: Rational, iterationPath: number[]): void {
    const dur = numberDuration(node);
    if (node.kind !== 'composition' && dur === null) return; // unresolved duration
    // Ancestors gate traversal in their own clock. This preserves clipping even
    // when a loop or freeze replaces the clock passed to descendants.
    const nodeLocal = parentTimeIn.sub(node.relativeStart);
    const extent = node.kind === 'composition'
      ? Rational.fromInteger(BigInt(opts.durationFrames)).div(opts.fps)
      : dur!;
    if (nodeLocal.lt(Rational.zero()) || nodeLocal.gte(extent)) return;
    const state: NodeState = { node, nodeLocal, parentOverride: null, iteration: iterationPath.length ? iterationPath[iterationPath.length - 1] : 0, iterationPath: [...iterationPath] };
    states.set(node.id, state);

    // series transitions (spec 5.2/5.3)
    if (node.kind === 'series') {
      const items = node.childIds.map((c) => nodes.get(c)).filter(Boolean) as ResolvedNode[];
      for (let i = 0; i < items.length - 1; i++) {
        const outgoing = items[i];
        const incoming = items[i + 1];
        const outDur = numberDuration(outgoing);
        const overlapStart = incoming.relativeStart;
        const overlapEnd = outDur ? outgoing.relativeStart.add(outDur) : nodeLocal;
        if (outgoing.transitionAfter && nodeLocal.gte(overlapStart) && nodeLocal.lt(overlapEnd)) {
          const spanIn = overlapEnd.sub(overlapStart);
          const progress = spanIn.isZero() ? 1 : nodeLocal.sub(overlapStart).div(spanIn).toNumber();
          const t = outgoing.transitionAfter;
          transitions.push({
            type: t?.type ?? 'crossfade',
            direction: t?.direction ?? 'left',
            progress: Math.min(1, Math.max(0, progress)),
            outgoingId: outgoing.id,
            incomingId: incoming.id
          });
        }
      }
    }

    // captions
    if (node.kind === 'captions' && node.captions) {
      const localCue = nodeLocal;
      for (const cue of node.captions.cues) {
        if (localCue.gte(cue.start) && localCue.lt(cue.end) && cue.text.trim()) {
          captionsVisible.push({ text: cue.text, nodeId: node.id });
        }
      }
    }

    // media sampling
    if ((node.kind === 'video' || node.kind === 'audio') && node.media) {
      const srcTime = node.media.trimIn.add(nodeLocal.mul(node.media.rate));
      const gainAttr = node.media.gain !== undefined ? parseFloat(node.media.gain) : null;
      mediaRequests.set(node.id, {
        sourceTime: srcTime,
        rate: node.media.rate,
        trimIn: node.media.trimIn,
        trimOut: node.media.trimOut,
        kind: node.kind === 'video' ? 'video' : 'audio',
        audio: node.media.audio ?? 'include',
        gain: gainAttr,
        endBehavior: node.media.endBehavior ?? 'error',
        repeat: node.media.repeat ?? false,
        fadeIn: node.media.fadeIn ?? Rational.zero(),
        fadeOut: node.media.fadeOut ?? Rational.zero(),
        localTime: nodeLocal
      });
    }

    // children clock mapping
    let childParentTime = nodeLocal;
    let childPath = iterationPath;
    if (node.kind === 'loop' && node.clock?.kind === 'loop') {
      if (nodeLocal.lt(Rational.zero())) return;
      childParentTime = evaluateClock(node.clock, nodeLocal);
      childPath = [...iterationPath, nodeLocal.div(node.clock.iterationDuration).floor().toSafeInteger()];
    } else if (node.kind === 'freeze' && node.clock?.kind === 'freeze') {
      childParentTime = node.clock.at;
    }
    state.parentOverride = childParentTime;
    for (const cid of node.childIds) {
      const child = nodes.get(cid);
      if (child) walk(child, null, childParentTime, childPath);
    }
  }

  function walkOverride(node: ResolvedNode, clip: Interval | null, childParentTime: Rational, iterationPath: number[]): void {
    // entered from a loop/freeze parent: parentTimeIn = childParentTime
    walk(node, clip, childParentTime, iterationPath);
  }
  void walkOverride;

  if (root) walk(root, null, time, []);

  // animations
  for (const anim of timing.animations) {
    const target = nodes.get(anim.targetSelector.slice(1));
    if (!target) continue;
    if (!states.has(anim.clockScopeId)) continue; // enclosing timeline inactive
    if (!states.has(target.id)) continue; // target inactive this frame
    const b = anim.start;
    const d = anim.duration;
    const scope = states.get(anim.clockScopeId)!;
    let sampleTime = scope.parentOverride ?? scope.nodeLocal;
    if (anim.sampleStart && sampleTime.lt(anim.sampleStart)) sampleTime = anim.sampleStart;
    if (anim.sampleEnd && sampleTime.gt(anim.sampleEnd)) sampleTime = anim.sampleEnd;
    const p0 = sampleTime.sub(b).div(d);
    let p: number | null = null;
    if (p0.lt(Rational.zero())) {
      if (anim.fill === 'backwards' || anim.fill === 'both') p = 0;
    } else if (p0.lt(Rational.of(1n))) {
      p = p0.toNumber();
    } else {
      if (anim.fill === 'forwards' || anim.fill === 'both') p = 1;
    }
    if (p === null) continue;
    const value = propertyValue(anim, clamp01(p), opts.easing, d.toNumber());
    const list = animatedValues.get(target.id) ?? [];
    list.push({ property: anim.property, value });
    animatedValues.set(target.id, list);
    if ((anim.property === 'scale-x' || anim.property === 'scale-y') && typeof value === 'number' && value <= 0) {
      warnings.push({ code: 'W_SCALE_NONPOSITIVE', message: `Sampled nonpositive scale on ${target.id}` });
    }
  }

  return {
    frame: opts.frame,
    time,
    states,
    animatedValues,
    captionsVisible,
    transitions,
    mediaRequests,
    warnings
  };
}

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, p));
}

// re-exports for painter consumers

