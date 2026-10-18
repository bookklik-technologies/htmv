/**
 * IR lowering and revision hashing (spec 12.3).
 */
import { Rational } from '@htmv/core';
import { ResolvedNode, ResolvedAnimation, TimingResult } from './timing.js';
import { CompositionIR, AssetDescriptor, JsonObject } from '@htmv/core';

function ratJson(r: Rational): { numerator: string; denominator: string } {
  return r.toJSON();
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function lowerToIR(
  timing: TimingResult,
  meta: {
    compositionId: string;
    width: number;
    height: number;
    fps: Rational;
    durationFrames: bigint;
    sampleRate: 44100 | 48000;
    channels: 1 | 2;
    seed: string;
  },
  assets: AssetDescriptor[],
  props: JsonObject
): CompositionIR {
  const rootId = [...timing.nodes.values()].find((n) => n.kind === 'composition')?.id ?? meta.compositionId;
  const nodes: CompositionIR['nodes'] = {};
  for (const [id, n] of timing.nodes) {
    nodes[id] = {
      id,
      kind: n.kind === 'composition' ? 'scene' : n.kind === 'declaration' ? 'box' : n.kind,
      parentId: n.parentId,
      childIds: [...n.childIds],
      start: ratJson(n.start),
      duration: ratJson(n.duration === 'remainder' || n.duration === 'auto' ? Rational.zero() : n.duration as Rational)
      ,tag: n.tag, attributes: { ...n.attributes }, text: n.text,
      relativeStart: ratJson(n.relativeStart), clock: n.clock, media: n.media,
      captions: n.captions, transitionAfter: n.transitionAfter
    };
  }
  return {
    schemaVersion: '1',
    revisionHash: '',
    width: meta.width,
    height: meta.height,
    fps: ratJson(meta.fps),
    durationFrames: Number(meta.durationFrames),
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    rootId,
    nodes,
    animations: timing.animations.map((a: ResolvedAnimation) => ({
      id: a.id,
      targetIds: [a.targetSelector.slice(1)],
      clockScopeId: a.clockScopeId,
      property: a.property,
      start: ratJson(a.start),
      duration: ratJson(a.duration),
      from: a.from,
      to: a.to,
      easing: a.easing,
      fill: a.fill,
      mode: a.mode,
      keyframes: a.keyframes
    })),
    assets,
    props,
    seed: meta.seed
  };
}

export async function finalizeRevisionHash(ir: CompositionIR): Promise<string> {
  const copy: CompositionIR = { ...ir, revisionHash: '' };
  const canonical = JSON.stringify(copy, null, 0);
  return sha256Hex(canonical);
}

