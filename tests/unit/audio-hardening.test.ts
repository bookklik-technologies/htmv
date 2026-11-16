import { describe, expect, it } from 'vitest';
import { Rational } from '@htmv/core';
import { mixOffline } from '../../packages/audio/src/mixer.js';
import { resampleBlock, resampleWindow, RESAMPLER_TAPS } from '../../packages/audio/src/resampler.js';

describe('audio helper consistency', () => {
  it('accumulates in Float64 before the single final Float32 conversion', () => {
    const nodes = [16777216, 1, -16777216].map((value, index) => ({
      nodeId: `node-${index}`, intervalStart: Rational.zero(),
      intervalEnd: Rational.of(1n, 48000n), baseGain: 1,
      source: { fill: (buffers: Float32Array[]) => { buffers[0][0] = value; } }
    }));
    const mixed = mixOffline(nodes, 48000, 1, 1n, () => 1);
    expect(mixed.left[0]).toBe(1);
    expect(mixed.clippedSamples).toBe(0);
  });

  it('uses the canonical sinc kernel and supplied downsampling cutoff', () => {
    const window = new Float32Array(2 * RESAMPLER_TAPS + 1);
    window[RESAMPLER_TAPS] = 1;
    const output = new Float32Array(1);
    resampleBlock(output, 0, 1, () => Rational.zero(), () => window, 0, null, () => 1, () => 1, 0.5);
    expect(output[0]).toBeCloseTo(resampleWindow(Rational.zero(), window, 0.5), 6);
    expect(output[0]).toBeLessThan(0.6);
    expect(() => resampleWindow(Rational.zero(), window, NaN)).toThrow(RangeError);
  });
});
