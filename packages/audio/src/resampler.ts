/**
 * Version-pinned band-limited rational-position resampler (spec 10.2/10.6).
 * - Source positions derive from absolute exact rational mapped time, not accumulated phase.
 * - Filter state preserved across blocks implicitly by requesting absolute neighborhoods.
 * - Repeated audio maps a + positiveModulo(l*r, S); seam taps wrap within the trim
 *   interval; no implicit crossfade, extra gap, or encoder restart (spec 10.6).
 */
import { Rational } from '@htmv/core';

export const RESAMPLER_TAPS = 16; // half-length of the band-limited window
export const RESAMPLER_POLICY = 'kaiser6-sinc16-v1'; // pinned coefficients/rounding identifier
const kernels = new Map<string, Float64Array>();

/** Fractional-phase Kaiser-windowed sinc, normalized for unity DC response. */
export function resampleWindow(center: Rational, window: Float32Array, cutoff = 1): number {
  if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 1) throw new RangeError('Resampler cutoff must be in (0, 1].');
  const fraction = center.frac().toNumber();
  const key = `${center.frac()}|${cutoff}`;
  const cached = kernels.get(key);
  if (cached) { let sum = 0; for (let k = 0; k < cached.length; k++) sum += (window[k] ?? 0) * cached[k]; return sum; }
  let sum = 0; let weightSum = 0;
  const weights = new Float64Array(2 * RESAMPLER_TAPS + 1);
  const bessel = (x: number): number => { let value = 1; let term = 1; for (let k = 1; k <= 24; k++) { term *= x * x / (4 * k * k); value += term; if (term < 1e-15) break; } return value; };
  const norm = bessel(6);
  for (let k = 0; k < 2 * RESAMPLER_TAPS + 1; k++) {
    const x = k - RESAMPLER_TAPS - fraction;
    if (Math.abs(x) > RESAMPLER_TAPS) continue;
    const sinc = Math.abs(x) < 1e-12 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
    const weight = sinc * bessel(6 * Math.sqrt(Math.max(0, 1 - (x / RESAMPLER_TAPS) ** 2))) / norm;
    weights[k] = weight;
    sum += (window[k] ?? 0) * weight; weightSum += weight;
  }
  if (Math.abs(weightSum) < 1e-12) return 0;
  for (let k = 0; k < weights.length; k++) weights[k] /= weightSum;
  if (kernels.size >= 2048) kernels.delete(kernels.keys().next().value!); kernels.set(key, weights);
  return sum / weightSum;
}

export function getSincSmoke(): number[] {
  const impulse = new Float32Array(RESAMPLER_TAPS * 2 + 1);
  return Array.from(impulse, (_, index) => {
    impulse.fill(0);
    impulse[index] = 1;
    return resampleWindow(Rational.zero(), impulse);
  });
}

/**
 * Resample exactly `count` output samples starting at output index `from`
 * (exact rational source position mapping is supplied by the caller).
 * Each output sample j reads source position pos(j) = sourceAt(from+j) exactly.
 */
export function resampleBlock(
  out: Float32Array,
  from: number,
  count: number,
  sourceAt: (outIndex: number) => Rational,
  readSource: (center: Rational) => Float32Array, // returns a window of source samples around center, of length 2*TAPS+1 starting at floor(center)-TAPS (may wrap per caller per spec 10.6)
  channelIndex: number,
  windowSource: Float32Array | null,
  fade: (outIndex: number) => number,
  writeGain: (outIndex: number) => number,
  cutoff = 1
): void {
  for (let j = 0; j < count; j++) {
    const center = sourceAt(from + j);
    const window = readSource(center);
    void channelIndex;
    void windowSource;
    out[j] = resampleWindow(center, window, cutoff) * fade(from + j) * writeGain(from + j);
  }
}

/** Exact positive-modulo repetition mapping for source time (spec 10.6). */
export function repeatSourceTime(l: Rational, rate: Rational, a: Rational, span: Rational): Rational {
  return a.add(l.mul(rate).positiveMod(span));
}

/**
 * Fade envelopes multiply; computed in the node's output-local time, never restarting per repeat (spec 10.6).
 */
export function fadeEnvelope(localTime: number, fadeIn: number, fadeOut: number, nodeDuration: number): number {
  let g = 1;
  if (fadeIn > 0 && localTime < fadeIn) g *= Math.max(0, localTime / fadeIn);
  const toEnd = nodeDuration - localTime;
  if (fadeOut > 0 && toEnd < fadeOut) g *= Math.max(0, Math.max(0, toEnd) / fadeOut);
  return g;
}
