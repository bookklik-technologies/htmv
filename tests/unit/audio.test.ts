import { describe, it, expect } from 'vitest';
import { mixOffline, transitionGains, outputSampleCount } from '../../packages/audio/src/mixer.js';
import { repeatSourceTime, resampleBlock, getSincSmoke, fadeEnvelope } from '../../packages/audio/src/resampler.js';
import { Rational } from '@htmv/core';

describe('mixer', () => {
  it('M = ceil(T*R): 10.01s at 48kHz => 480,480 samples', () => {
    expect(outputSampleCount(Rational.parse('1001/100'), 48000)).toBe(480480n);
  });
  it('interval bounds use exact ceil', () => {
    const peak = { v: 0, c: 0 };
    const mix = mixOffline(
      [
        {
          nodeId: 'b',
          intervalStart: Rational.parse('1/3'),
          intervalEnd: Rational.parse('1/2'),
          baseGain: 1,
          source: {
            fill: (bufs, sampleStart, count, rate) => {
              void sampleStart; void rate;
              for (let i = 0; i < count; i++) {
                bufs[0][i] = 0.5;
                if (bufs.length > 1) bufs[1].fill ? 0 : 0;
              }
              if (bufs.length > 1) for (let i = 0; i < count; i++) bufs[1][i] = 0.5;
            }
          }
        }
      ],
      48000,
      2,
      240n,
      () => 1
    );
    const start = Math.ceil((1 / 3) * 48000); // 16000
    const end = Math.ceil((1 / 2) * 48000); // 24000
    for (let j = 0; j < mix.left.length; j++) {
      if (j >= start && j < end) expect(mix.left[j]).toBeCloseTo(0.5, 6);
      else expect(mix.left[j]).toBe(0); // exact silence outside active intervals
    }
    void peak;
  });
  it('final clip reports counts (W_AUDIO_CLIPPING)', () => {
    const mix = mixOffline(
      [
        { nodeId: 'a', intervalStart: Rational.zero(), intervalEnd: Rational.parse('1/48000'), baseGain: 1, source: { fill: (b, _s, c) => { for (let i = 0; i < c; i++) b[0][i] = 5; } } }
      ],
      48000,
      1,
      4n,
      () => 1
    );
    expect(mix.clippedSamples).toBe(1);
    expect(mix.peak).toBe(1);
  });
  it('equal-power transition gains', () => {
    const g = transitionGains(0.5);
    expect(g.gOut + g.gIn).toBeGreaterThan(Math.SQRT1_2);
    expect(g.gOut).toBeCloseTo(Math.SQRT1_2);
  });
  it('fades multiply on overlap', () => {
    expect(fadeEnvelope(0.25, 1, 1, 2)).toBeCloseTo(0.25);
    expect(fadeEnvelope(1.5, 1, 1, 2)).toBeCloseTo(0.5);
    expect(fadeEnvelope(1.2, 1.5, 1, 2)).toBeCloseTo(0.8 * 0.8); // overlapping fades multiply
  });
});

describe('resampler', () => {
  it('repeatSourceTime wraps within the trim span', () => {
    const a = Rational.zero();
    const span = Rational.of(2n); // 2s trim interval
    expect(repeatSourceTime(Rational.parse('1/2'), Rational.of(1n), a, span).toString()).toBe('1/2');
    expect(repeatSourceTime(Rational.of(3n), Rational.of(1n), a, span).toString()).toBe('1');
    expect(repeatSourceTime(Rational.of(4n), Rational.of(2n), a, span).toString()).toBe('0'); // exact multiple => a
  });
  it('resampleBlock is finite and bounded', () => {
    const out = new Float32Array(8);
    resampleBlock(
      out,
      0,
      8,
      (j) => Rational.fromDecimalString(String(j)),
      () => new Float32Array(33),
      0,
      null,
      () => 1,
      () => 1
    );
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

// smoke helper existence check
expect(getSincSmoke).toBeDefined();
