import { describe, it, expect } from 'vitest';
import { Rational } from '../../packages/core/src/rational.js';
import {
  parseTimeAttribute,
  parseFps,
  frameTimestampMicroseconds,
  framesForSeconds,
  frameTimeSeconds
} from '../../packages/core/src/time.js';
import { computeSeriesSchedule, loopIteration } from '../../packages/core/src/clocks.js';
import { parseEasing, springResponse, equalPowerGains } from '../../packages/core/src/easing.js';
import { randomV1 } from '../../packages/core/src/prng.js';
import { CompilationError } from '../../packages/core/src/diagnostics.js';

describe('Rational', () => {
  it('reduces and compares', () => {
    expect(Rational.of(30000n, 1001n).toString()).toBe('30000/1001');
    expect(Rational.of(10n, 20n).toString()).toBe('1/2');
    expect(Rational.of(1n, 3n).add(Rational.of(1n, 6n)).toString()).toBe('1/2');
  });
  it('roundHalfUp endpoint semantics', () => {
    // frame 300 at 30000/1001 => 10.01s => 10,010,000 us
    expect(frameTimestampMicroseconds(300, Rational.parse('30000/1001'))).toBe(10010000n);
    // frame 1 at 30000/1001: 1e6 * 1001/30000 = 33366.666... -> 33367
    expect(frameTimestampMicroseconds(1, Rational.parse('30000/1001'))).toBe(33367n);
  });
  it('endpoints strictly increase at fractional fps over 300 frames', () => {
    const fps = Rational.parse('30000/1001');
    let prev = -1n;
    for (let n = 0; n <= 300; n++) {
      const us = frameTimestampMicroseconds(n, fps);
      expect(us).toBeGreaterThan(prev);
      prev = us;
    }
  });
  it('positiveMod', () => {
    expect(Rational.parse('-1/2').positiveMod(Rational.of(2n)).toString()).toBe('3/2');
  });
});

describe('time attributes', () => {
  it('accepts 0 unitless, 30f, 2s, 500ms', () => {
    expect(parseTimeAttribute('0').kind).toBe('seconds');
    expect(parseTimeAttribute('30f').kind).toBe('frames');
    expect(parseTimeAttribute('2.5s').value.toString()).toBe('5/2');
    expect(parseTimeAttribute('500ms').value.toString()).toBe('1/2');
  });
  it('rejects nonzero unitless and decimal fps', () => {
    expect(() => parseTimeAttribute('30')).toThrow(CompilationError);
    expect(() => parseFps('29.97')).toThrow(CompilationError);
    expect(parseFps('30000/1001').toString()).toBe('30000/1001');
  });
  it('root frame alignment: 10s at 30000/1001 is not frame-aligned', () => {
    const { exact } = framesForSeconds(Rational.of(10n), Rational.parse('30000/1001'));
    expect(exact).toBe(false);
    const at30 = framesForSeconds(Rational.of(10n), Rational.of(30n));
    expect(at30.exact).toBe(true);
    expect(at30.frames).toBe(300n);
  });
  it('t(n) = n*Q/P', () => {
    expect(frameTimeSeconds(90, Rational.of(30n)).toString()).toBe('3');
  });
});

describe('series and loops', () => {
  it('series schedule 90f + 15f overlap + 90f = 165f, incoming starts 75f', () => {
    const { starts, total } = computeSeriesSchedule([
      { duration: Rational.of(90n), overlapAfter: Rational.of(15n) },
      { duration: Rational.of(90n), overlapAfter: null }
    ]);
    expect(starts[1].toString()).toBe('75');
    expect(total.toString()).toBe('165');
  });
  it('loop iteration boundaries', () => {
    expect(loopIteration(Rational.zero(), Rational.of(60n))!.iteration).toBe(0);
    expect(loopIteration(Rational.of(60n), Rational.of(60n))!.iteration).toBe(1); // boundary belongs to next iteration
    expect(loopIteration(Rational.of(125n), Rational.of(60n))!.childTime.toString()).toBe('5');
  });
});

describe('easing', () => {
  it('linear identity, bezier endpoints', () => {
    const linear = parseEasing('linear');
    expect(linear.fn(0.25)).toBe(0.25);
    const easeOut = parseEasing('ease-out');
    expect(easeOut.fn(0)).toBe(0);
    expect(easeOut.fn(1)).toBe(1);
    expect(easeOut.fn(0.5)).toBeGreaterThan(0.5);
  });
  it('steps', () => {
    const s = parseEasing('steps(4,end)');
    expect(s.fn(1)).toBe(1);
    expect(s.fn(0.5)).toBe(0.5);
    expect(s.fn(0.99)).toBe(0.75);
    const s2 = parseEasing('steps(4,start)');
    expect(s2.fn(0)).toBe(0.25);
  });
  it('spring regimes agree near critical damping', () => {
    const under = springResponse({ mass: 1, stiffness: 100, damping: 8, initialVelocity: 0 });
    const crit = springResponse({ mass: 1, stiffness: 100, damping: 20, initialVelocity: 0 });
    const over = springResponse({ mass: 1, stiffness: 100, damping: 30, initialVelocity: 0 });
    expect(under(0)).toBe(0);
    expect(crit(0)).toBe(0);
    expect(over(0)).toBe(0);
    // All approach 1 eventually
    expect(under(5)).toBeCloseTo(1, 3);
    expect(crit(5)).toBeCloseTo(1, 6);
    expect(over(5)).toBeCloseTo(1, 6);
  });
  it('equal-power transition gains', () => {
    const { gOut, gIn } = equalPowerGains(0.5);
    expect(gOut).toBeCloseTo(Math.SQRT1_2);
    expect(gIn).toBeCloseTo(Math.SQRT1_2);
    expect(equalPowerGains(0).gOut).toBe(1);
    expect(equalPowerGains(1).gIn).toBe(1);
  });
});

describe('PRNG v1', () => {
  it('deterministic and in [0,1)', async () => {
    const a = await randomV1('0', 'node1', 'opacity', 0);
    const b = await randomV1('0', 'node1', 'opacity', 0);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    const c = await randomV1('0', 'node1', 'opacity', 1);
    expect(c).not.toBe(a);
  });
  it('iteration path changes channel', async () => {
    const x = await randomV1('s', 'k', 'r#0', 0);
    const y = await randomV1('s', 'k', 'r#1', 0);
    expect(x).not.toBe(y);
  });
});
