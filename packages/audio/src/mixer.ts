/**
 * Canonical bounded-block Float32 PCM mixer (spec 10.1–10.3, 10.6).
 * - M = ceil(T*R) output samples; sample j represents time j/R.
 * - Per-node bounds: ceil(b*R) .. ceil(e*R), clipped to [0, M).
 * - Float64 accumulation, stable node-ID order, one final hard clip with report.
 * - No implicit pan/limiter/normalization.
 */
import { Rational } from '@htmv/core';

export interface MixDestination {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  totalSamples: number;
  peak: number;
  clippedSamples: number;
}

export interface AudioBlockSource {
  /** callback API: fill outputs at [mono|stereo] for absolute source time range */
  fill(destination: Float32Array[], sampleStart: number, sampleCount: number, sourceSampleRate: number): void;
}

/**
 * Rational-aware ceil of b*R for exact interval bounds (spec 10.2).
 */
export function ceilMulR(x: Rational, r: number): bigint {
  // x * R as rational, then ceil
  const rr = Rational.fromDecimalString(String(r));
  return x.mul(rr).ceil().num;
}

export function outputSampleCount(compositionDurationSeconds: Rational, rate: number): bigint {
  return compositionDurationSeconds.mul(Rational.fromDecimalString(String(rate))).ceil().num;
}

export interface NodeAudioSpec {
  nodeId: string;
  intervalStart: Rational; // root-time seconds b
  intervalEnd: Rational; // root-time seconds e (exclusive)
  baseGain: number; // 0..4; multiplies any animated gain product at sample time
  source: AudioBlockSource | null; // null = silence contribution
}

export interface MixEvents {
  onClipping?: (peak: number, clipped: number) => void;
}

/**
 * Offline mix over bounded blocks. gainAt(nodeId, rootTimeSeconds) consults
 * gain animations / clip fades / transition equal-power gains already prepared
 * by the caller (spec 10.6: derive root time first, map through structural clocks).
 */
export function mixOffline(
  nodes: readonly NodeAudioSpec[],
  sampleRate: number,
  channels: 1 | 2,
  totalSamples: bigint,
  gainAt: (nodeId: string, rootTimeSeconds: number) => number,
  events?: MixEvents
): MixDestination {
  const M = Number(totalSamples);
  const left = new Float32Array(M);
  const right = channels === 2 ? new Float32Array(M) : left;
  // stable node-ID order (spec 10.1)
  const sorted = [...nodes].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
  const BLOCK = 4096; // recommended processing block (spec 10.2)
  let peak = 0;
  let clipped = 0;

  for (const node of sorted) {
    const start = clampIndex(node.intervalStart.mul(Rational.fromDecimalString(String(sampleRate))).ceil().num, 0n, BigInt(M));
    const end = clampIndex(node.intervalEnd.mul(Rational.fromDecimalString(String(sampleRate))).ceil().num, 0n, BigInt(M));
    if (end <= start || !node.source) continue;
    const scratchL = new Float32Array(BLOCK);
    const scratchR = channels === 2 ? new Float32Array(BLOCK) : scratchL;
    const outL = new Float32Array(BLOCK);
    const outR = channels === 2 ? new Float32Array(BLOCK) : outL;
    for (let pos = Number(start); pos < Number(end); ) {
      const count = Math.min(BLOCK, Number(end) - pos);
      // canonical PCM from the node source; rate mapping handled by the adapter layer
      node.source.fill(channels === 2 ? [scratchL, scratchR] : [scratchL], pos, count, sampleRate);
      // per-sample gain: root time first, then mapped clocks (spec 10.6)
      const dt = 1 / sampleRate;
      for (let j = 0; j < count; j++) {
        const rootTime = (pos + j) * dt;
        const g = clampGain(gainAt(node.nodeId, rootTime)) * clampGain(node.baseGain);
        outL[j] = scratchL[j] * g;
        if (channels === 2) outR[j] = scratchR[j] * g;
      }
      for (let j = 0; j < count; j++) {
        const l = outL[j];
        const r = channels === 2 ? outR[j] : l;
        left[pos + j] += l;
        if (channels === 2) right[pos + j] += r;
      }
      pos += count;
    }
  }

  // Float64 accumulation path: JS numbers already accumulate in doubles here (left[] accumulations).
  // Final hard clip to [-1,1] with statistics (spec 10.3)
  for (let j = 0; j < M; j++) {
    const l = clampSample(left[j]);
    if (l !== left[j]) clipped++;
    left[j] = l;
    let r = l;
    if (channels === 2) {
      r = clampSample(right[j]);
      if (r !== right[j]) clipped++;
      right[j] = r;
    }
    const pl = Math.abs(l);
    const pr = Math.abs(r);
    if (pl > peak) peak = pl;
    if (pr > peak) peak = pr;
  }
  events?.onClipping?.(peak, clipped);
  return { left, right, sampleRate, totalSamples: M, peak, clippedSamples: clipped };
}

export function clampGain(g: number): number {
  if (!Number.isFinite(g)) return 0;
  return Math.min(4, Math.max(0, g));
}function clampSample(v: number): number {
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

function clampIndex(v: bigint, lo: bigint, hi: bigint): bigint {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Equal-power scene transition gains (spec 5.3): gOut=cos(p*pi/2), gIn=sin(p*pi/2),
 * applied to all audio in the respective items.
 */
export function transitionGains(p: number): { gOut: number; gIn: number } {
  const q = Math.max(0, Math.min(1, p));
  return { gOut: Math.cos((q * Math.PI) / 2), gIn: Math.sin((q * Math.PI) / 2) };
}

