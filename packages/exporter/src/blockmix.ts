/** Bounded, exact-phase canonical PCM mixing shared by preview and export. */
import { Rational, parseEasing } from '@htmv/core';
import type { CompiledCompositionImpl, ResolvedNode } from '@htmv/compiler';
import type { MediaReader } from '@htmv/media';
import type { RendererSession } from './session.js';
import { transitionGains, fadeEnvelope, resampleWindow, RESAMPLER_TAPS } from '@htmv/audio';
import { propertyValue } from '@htmv/renderer-canvas';

export interface BlockMixResult { left: Float32Array; right: Float32Array; clippedSamples: number; peak: number; pcmBlockBytes: number }
const PCM_PAGE = 4096;
const pcmCaches = new WeakMap<MediaReader, Map<number, Float32Array[]>>();
const easingCache = new Map<string, (p: number) => number>();
function easing(name: string, p: number, duration: number): number {
  const key = `${name}|${duration}`;
  let fn = easingCache.get(key);
  if (!fn) { fn = parseEasing(name, duration).fn; if (easingCache.size > 256) easingCache.clear(); easingCache.set(key, fn); }
  return fn(p);
}

/** Every ancestor gates activity before applying its loop/freeze descendant clock. */
function clocksAt(compiled: CompiledCompositionImpl, node: ResolvedNode, root: Rational): Map<string, Rational> | null {
  const path: ResolvedNode[] = []; let current: ResolvedNode | undefined = node;
  while (current) { path.unshift(current); current = current.parentId ? compiled.timing.nodes.get(current.parentId) : undefined; }
  let time = root; const clocks = new Map<string, Rational>();
  for (const n of path) {
    const local = time.sub(n.relativeStart);
    if (typeof n.duration === 'string' || local.lt(Rational.zero()) || local.gte(n.duration)) return null;
    clocks.set(n.id, local);
    time = n.clock?.kind === 'loop' ? local.positiveMod(n.clock.iterationDuration) : n.clock?.kind === 'freeze' ? n.clock.at : local;
    if (n !== node) clocks.set(`${n.id}:children`, time);
  }
  return clocks;
}

export async function mixAudioBlockCanonical(compiled: CompiledCompositionImpl, session: RendererSession, start: Rational, count: number, meta: { sampleRate: 44100 | 48000; channels: 1 | 2 }): Promise<BlockMixResult> {
  const sumL = new Float64Array(count); const sumR = meta.channels === 2 ? new Float64Array(count) : sumL;
  let windowBytes = 0;
  const nodes = [...compiled.timing.nodes.values()].filter((n) => n.kind === 'audio' || n.kind === 'video' && n.media?.audio === 'include').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const node of nodes) {
    const media = node.media!; const reader = session.openAudioReader(node); if (!reader) continue;
    const srcRate = await session.sourceSampleRate(node); const srcChannels = await session.sourceChannelCount(node);
    if (srcChannels > 2) throw new Error('E_CODEC_DECODE: audio with more than two channels requires an explicit downmix adapter.');
    const rate = Rational.fromInteger(BigInt(srcRate));
    const first = media.trimIn.mul(rate).ceil().toSafeInteger();
    const last = media.trimOut?.mul(rate).ceil().toSafeInteger() ?? Number.MAX_SAFE_INTEGER;
    let cache = pcmCaches.get(reader); if (!cache) { cache = new Map(); pcmCaches.set(reader, cache); }
    const wrapped = (index: number): number => {
      if (media.repeat && last > first && last !== Number.MAX_SAFE_INTEGER) index = first + ((index - first) % (last - first) + last - first) % (last - first);
      return index;
    };
    const positions = new Map<number, { position: Rational; gain: number }>();
    const neededPages = new Set<number>();
    for (let j = 0; j < count; j++) {
      const root = start.add(Rational.of(BigInt(j), BigInt(meta.sampleRate)));
      const clocks = clocksAt(compiled, node, root); if (!clocks) continue;
      const local = clocks.get(node.id)!;
      let source = media.trimIn.add(local.mul(media.rate));
      if (media.repeat && media.trimOut) source = media.trimIn.add(local.mul(media.rate).positiveMod(media.trimOut.sub(media.trimIn)));
      if (!media.repeat && media.trimOut && source.gte(media.trimOut)) continue;
      const position = source.mul(rate); const center = position.floor().toSafeInteger();
      const gain = gainAtClocks(compiled, node, clocks) * fadeEnvelope(local.toNumber() + (media.fadeOffset?.toNumber() ?? 0), media.fadeIn?.toNumber() ?? 0, media.fadeOut?.toNumber() ?? 0, (media.fadeDuration ?? node.duration as Rational).toNumber()) * transitionAtClocks(compiled, node, clocks);
      positions.set(j, { position, gain });
      for (let k = center - RESAMPLER_TAPS; k <= center + RESAMPLER_TAPS; k++) {
        const index = wrapped(k); if (index >= first && index < last && index >= 0) neededPages.add(Math.floor(index / PCM_PAGE));
      }
    }
    if (neededPages.size > 64) throw new Error('E_RESOURCE_LIMIT: PCM neighborhood exceeds bounded cache admission.');
    for (const page of neededPages) {
      if (cache.has(page)) continue;
      const data = Array.from({ length: srcChannels }, () => new Float32Array(PCM_PAGE));
      await reader.getAudioBlock(page * PCM_PAGE / srcRate, PCM_PAGE / srcRate, data, srcRate);
      if (cache.size >= 64) {
        const stale = [...cache.keys()].find((key) => !neededPages.has(key)); if (stale !== undefined) cache.delete(stale);
      }
      cache.set(page, data);
    }
    const sampleAt = (input: number, channel: number): number => {
      const index = wrapped(input);
      if (index < first || index >= last || index < 0) return 0;
      const page = Math.floor(index / PCM_PAGE);
      return cache!.get(page)?.[Math.min(channel, srcChannels - 1)]?.[index - page * PCM_PAGE] ?? 0;
    };
    const windowL = new Float32Array(2 * RESAMPLER_TAPS + 1); const windowR = new Float32Array(windowL.length);
    windowBytes = Math.max(windowBytes, windowL.byteLength + windowR.byteLength);
    for (const [j, { position, gain }] of positions) {
      const center = position.floor().toSafeInteger();
      for (let k = 0; k < windowL.length; k++) {
        windowL[k] = sampleAt(center + k - RESAMPLER_TAPS, 0);
        windowR[k] = srcChannels === 2 ? sampleAt(center + k - RESAMPLER_TAPS, 1) : windowL[k];
      }
      const cutoff = Math.min(1, meta.sampleRate / (srcRate * media.rate.toNumber()));
      const l = resampleWindow(position, windowL, cutoff); const r = srcChannels === 2 ? resampleWindow(position, windowR, cutoff) : l;
      sumL[j] += (meta.channels === 1 ? (l + r) / 2 : l) * gain;
      if (meta.channels === 2) sumR[j] += r * gain;
    }
  }
  const left = new Float32Array(count); const right = meta.channels === 2 ? new Float32Array(count) : left;
  let peak = 0; let clippedSamples = 0;
  for (let j = 0; j < count; j++) {
    peak = Math.max(peak, Math.abs(sumL[j]), Math.abs(sumR[j]));
    if (Math.abs(sumL[j]) > 1) clippedSamples++;
    if (meta.channels === 2 && Math.abs(sumR[j]) > 1) clippedSamples++;
    left[j] = Math.max(-1, Math.min(1, sumL[j]));
    if (meta.channels === 2) right[j] = Math.max(-1, Math.min(1, sumR[j]));
  }
  const accumulatorBytes = sumL.byteLength + (sumR === sumL ? 0 : sumR.byteLength);
  const pcmBlockBytes = accumulatorBytes + Math.max(windowBytes, left.byteLength + (right === left ? 0 : right.byteLength));
  return { left, right, clippedSamples, peak, pcmBlockBytes };
}

function gainAtClocks(compiled: CompiledCompositionImpl, node: ResolvedNode, clocks: Map<string, Rational>): number {
  for (const anim of compiled.timing.animations) {
    if (anim.targetSelector !== `#${node.id}` || anim.property !== 'gain') continue;
    let time = clocks.get(`${anim.clockScopeId}:children`) ?? clocks.get(anim.clockScopeId); if (!time) continue;
    if (anim.sampleStart && time.lt(anim.sampleStart)) time = anim.sampleStart;
    if (anim.sampleEnd && time.gt(anim.sampleEnd)) time = anim.sampleEnd;
    const progress = time.sub(anim.start).div(anim.duration);
    if (progress.lt(Rational.zero()) && !['backwards', 'both'].includes(anim.fill)) continue;
    if (progress.gte(Rational.of(1n)) && !['forwards', 'both'].includes(anim.fill)) continue;
    return Math.min(4, Math.max(0, Number.parseFloat(String(propertyValue(anim, Math.min(1, Math.max(0, progress.toNumber())), easing, anim.duration.toNumber())))));
  }
  return Number.parseFloat(node.media?.gain ?? '1');
}
function transitionAtClocks(compiled: CompiledCompositionImpl, node: ResolvedNode, clocks: Map<string, Rational>): number {
  let item: ResolvedNode | undefined = node; let gain = 1;
  while (item?.parentId) {
    const parent = compiled.timing.nodes.get(item.parentId); if (!parent) break;
    if (parent.kind === 'series') {
      const time = clocks.get(`${parent.id}:children`) ?? clocks.get(parent.id)!;
      const i = parent.childIds.indexOf(item.id);
      const previous = compiled.timing.nodes.get(parent.childIds[i - 1]); const next = compiled.timing.nodes.get(parent.childIds[i + 1]);
      if (previous?.transitionAfter && time.lt(item.relativeStart.add(previous.transitionAfter.duration))) gain *= transitionGains(time.sub(item.relativeStart).div(previous.transitionAfter.duration).toNumber()).gIn;
      if (item.transitionAfter && next && time.gte(next.relativeStart)) gain *= transitionGains(time.sub(next.relativeStart).div(item.transitionAfter.duration).toNumber()).gOut;
    }
    item = parent;
  }
  return gain;
}
export function gainAtRootTime(compiled: CompiledCompositionImpl, node: ResolvedNode, time: number): number { const clocks = clocksAt(compiled, node, Rational.fromDecimalString(String(time))); return clocks ? gainAtClocks(compiled, node, clocks) : 0; }
export function transitionGainAt(compiled: CompiledCompositionImpl, node: ResolvedNode, time: number): number { const clocks = clocksAt(compiled, node, Rational.fromDecimalString(String(time))); return clocks ? transitionAtClocks(compiled, node, clocks) : 0; }
