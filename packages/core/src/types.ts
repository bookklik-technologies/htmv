import { Rational } from './rational.js';
import { Diagnostic } from './diagnostics.js';
import namedColors from 'color-name';

export type Source = HTMLElement | HTMLTemplateElement | string;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Profile = 'mp4' | 'webm';
export type FrameRange = { from: number; toExclusive: number };

export interface CompileOptions {
  baseURL?: string;
  props?: JsonObject;
  assets?: Record<string, Blob | File>;
  styles?: readonly string[];
  stylePolicy?: 'strict' | 'ignore-unsupported';
  fontPolicy?: 'portable' | 'system-allowed';
  plugins?: readonly HtmvPluginLike[];
  signal?: AbortSignal;
}

export interface HtmvPluginLike {
  id: string;
  version: string;
  execution: 'main' | 'worker' | 'either';
  capabilities: readonly string[];
}

export interface CompositionMetadata {
  id: string;
  width: number;
  height: number;
  fps: { numerator: number; denominator: number };
  durationFrames: number;
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
  seed: string;
  background: string;
}

export interface DiagnosticLike extends Diagnostic {}

export interface TimelineNodeIR {
  id: string;
  kind: 'scene' | 'sequence' | 'series' | 'loop' | 'freeze' | 'box' | 'text' | 'image' | 'video' | 'audio' | 'captions' | 'plugin';
  parentId: string | null;
  childIds: string[];
  start: { numerator: string; denominator: string };
  duration: { numerator: string; denominator: string };
  tag?: string;
  attributes?: Readonly<Record<string, string>>;
  text?: string;
  relativeStart?: { numerator: string; denominator: string };
  clock?: unknown;
  media?: unknown;
  captions?: unknown;
  transitionAfter?: unknown;
}

export interface AnimationIR {
  id: string;
  targetIds: string[];
  property: string;
  start: { numerator: string; denominator: string };
  duration: { numerator: string; denominator: string };
  from?: string;
  to?: string;
  easing: string;
  fill: 'none' | 'backwards' | 'forwards' | 'both';
  mode: 'replace';
  clockScopeId?: string;
  keyframes?: { offset: number; value: string; easing?: string }[];
}

export interface AssetDescriptor {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'font' | 'captions' | 'json';
  src: string;
  family?: string;
  weight?: string;
  fontStyle?: string;
  integrity?: string;
}

export interface CompositionIR {
  schemaVersion: '1';
  revisionHash: string;
  width: number;
  height: number;
  fps: { numerator: string; denominator: string };
  durationFrames: number;
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
  rootId: string;
  nodes: Record<string, TimelineNodeIR>;
  animations: AnimationIR[];
  assets: AssetDescriptor[];
  props: JsonObject;
  seed: string;
  background?: string;
  plugins?: readonly { id: string; version: string }[];
  assetHashes?: Readonly<Record<string, string | null>>;
}

export interface CompiledCompositionLike {
  readonly metadata: CompositionMetadata;
  readonly diagnostics: readonly Diagnostic[];
  readonly revisionHash: string;
  inspectTimeline(): unknown;
  serializeIR(): CompositionIR;
  dispose(): Promise<void>;
}

/** Property registry (spec 6.3). */
export interface PropertySpec {
  kind: 'number' | 'color' | 'length' | 'gain' | 'text-number';
  clamp: (v: number) => number;
  requiresLayout?: boolean;
  targets: readonly string[]; // node kinds
}

export const PROPERTY_REGISTRY: Record<string, PropertySpec> = {
  opacity: { kind: 'number', clamp: (v) => Math.min(1, Math.max(0, v)), targets: ['scene', 'box', 'text', 'image', 'video', 'captions', 'plugin'] },
  'translate-x': { kind: 'length', clamp: (v) => v, targets: ['scene', 'box', 'text', 'image', 'video', 'captions', 'plugin'] },
  'translate-y': { kind: 'length', clamp: (v) => v, targets: ['scene', 'box', 'text', 'image', 'video', 'captions', 'plugin'] },
  rotate: { kind: 'number', clamp: (v) => v, targets: ['scene', 'box', 'text', 'image', 'video', 'captions', 'plugin'] },
  'scale-x': { kind: 'number', clamp: (v) => v, targets: ['scene', 'box', 'text', 'image', 'video', 'captions', 'plugin'] },
  'scale-y': { kind: 'number', clamp: (v) => v, targets: ['scene', 'box', 'text', 'image', 'video', 'captions', 'plugin'] },
  color: { kind: 'color', clamp: (v) => v, targets: ['text'] },
  'background-color': { kind: 'color', clamp: (v) => v, targets: ['scene', 'box', 'captions'] },
  width: { kind: 'length', clamp: (v) => Math.max(0, v), requiresLayout: true, targets: ['box', 'text', 'image', 'video'] },
  height: { kind: 'length', clamp: (v) => Math.max(0, v), requiresLayout: true, targets: ['box', 'text', 'image', 'video'] },
  left: { kind: 'length', clamp: (v) => v, requiresLayout: true, targets: ['box', 'text', 'image', 'video'] },
  top: { kind: 'length', clamp: (v) => v, requiresLayout: true, targets: ['box', 'text', 'image', 'video'] },
  gain: { kind: 'gain', clamp: (v) => Math.min(4, Math.max(0, v)), targets: ['video', 'audio'] },
  'text-number': { kind: 'text-number', clamp: (v) => v, requiresLayout: true, targets: ['text'] }
};

export function parseLengthNumber(text: string, property: string): { value: number; unit: 'px' | '%' } {
  const s = text.trim();
  const m = /^(-?\d+(?:\.\d+)?)(px|%)?$/.exec(s);
  if (!m) throw new Error(`Invalid ${property} value "${text}"; use px or %`);
  return { value: Number(m[1]), unit: (m[2] as 'px' | '%') ?? 'px' };
}

export function parseColor(text: string): [number, number, number, number] {
  const s = text.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const named = namedColors[s]; if (named) return [named[0] / 255, named[1] / 255, named[2] / 255, 1];
  const hex6 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s) || /^#([0-9a-fA-F]{3})([0-9a-fA-F])?$/.exec(s);
  if (hex6) {
    let h = hex6[1];
    let a = hex6[2] ?? '';
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (a.length === 1) a = a + a;
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
      a ? parseInt(a, 16) / 255 : 1
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, rgb[4] ? Number(rgb[4]) : 1];
  }
  throw new Error(`Malformed color "${text}"`);
}

/** Rational helper re-export for consumers. */
export { Rational };
