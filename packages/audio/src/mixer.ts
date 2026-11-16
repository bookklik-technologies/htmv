/**
 * Whole-output Float32 PCM convenience mixer with bounded Float64 scratch blocks.
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
  if (totalSamples < 0n || totalSamples > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Mix sample count must be nonnegative and safe; sample rate must be a positive safe integer.');
  }
  const M = Number(totalSamples);
  const left = new Float32Array(M);
  const right = channels === 2 ? new Float32Array(M) : left;
  // stable node-ID order (spec 10.1)
  const sorted = [...nodes].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
  const BLOCK = 4096; // recommended processing block (spec 10.2)
  let peak = 0;
  let clipped = 0;

  const bounds = sorted.map((node) => ({
    node,
    start: Number(clampIndex(ceilMulR(node.intervalStart, sampleRate), 0n, totalSamples)),
    end: Number(clampIndex(ceilMulR(node.intervalEnd, sampleRate), 0n, totalSamples))
  }));
  const scratchLeft = new Float32Array(BLOCK);
  const scratchRight = channels === 2 ? new Float32Array(BLOCK) : scratchLeft;
  const accumulatedLeft = new Float64Array(BLOCK);
  const accumulatedRight = channels === 2 ? new Float64Array(BLOCK) : accumulatedLeft;
  for (let blockStart = 0; blockStart < M; blockStart += BLOCK) {
    const count = Math.min(BLOCK, M - blockStart);
    accumulatedLeft.fill(0);
    if (channels === 2) accumulatedRight.fill(0);
    for (const { node, start, end } of bounds) {
      const from = Math.max(start, blockStart);
      const to = Math.min(end, blockStart + count);
      if (to <= from || !node.source) continue;
      scratchLeft.fill(0);
      if (channels === 2) scratchRight.fill(0);
      node.source.fill(channels === 2 ? [scratchLeft, scratchRight] : [scratchLeft], from, to - from, sampleRate);
      for (let offset = 0; offset < to - from; offset++) {
        const gain = clampGain(gainAt(node.nodeId, (from + offset) / sampleRate)) * clampGain(node.baseGain);
        const target = from - blockStart + offset;
        accumulatedLeft[target] += scratchLeft[offset] * gain;
        if (channels === 2) accumulatedRight[target] += scratchRight[offset] * gain;
      }
    }
    for (let offset = 0; offset < count; offset++) {
      const mixedLeft = accumulatedLeft[offset];
      const mixedRight = accumulatedRight[offset];
      const finalLeft = clampSample(mixedLeft);
      const finalRight = clampSample(mixedRight);
      if (finalLeft !== mixedLeft) clipped++;
      if (channels === 2 && finalRight !== mixedRight) clipped++;
      left[blockStart + offset] = finalLeft;
      if (channels === 2) right[blockStart + offset] = finalRight;
      peak = Math.max(peak, Math.abs(finalLeft), Math.abs(finalRight));
    }
  }
  events?.onClipping?.(peak, clipped);
  return { left, right, sampleRate, totalSamples: M, peak, clippedSamples: clipped };
}

export function clampGain(g: number): number {
  if (!Number.isFinite(g)) return 0;
  return Math.min(4, Math.max(0, g));
}

function clampSample(v: number): number {
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
