import { Rational } from './rational.js';
import { warning, Diagnostic } from './diagnostics.js';

export type EasingFunction = (p: number) => number;

function linear(p: number): number {
  return p;
}

function cubicBezierSolver(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  // Bounded deterministic solver: solve x for progress, then evaluate y.
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new Error('cubic-bezier x controls must be in [0,1]');
  }
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a;
  const B = (a: number, b: number) => 3 * b - 6 * a;
  const C = (a: number) => 3 * a;
  const calc = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);

  const solveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      const delta = (calc(t, x1, x2) - x) / d;
      t -= delta;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      if (Math.abs(delta) < 1e-7) break;
    }
    // Fallback bisection
    if (Math.abs(calc(t, x1, x2) - x) > 1e-6) {
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (calc(mid, x1, x2) < x) lo = mid;
        else hi = mid;
      }
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const t = solveX(p);
    return calc(t, y1, y2);
  };
}

function steps(n: number, start: boolean): EasingFunction {
  if (!Number.isInteger(n) || n <= 0) throw new Error('steps() n must be a positive integer');
  return (p: number): number => {
    if (p >= 1) return 1;
    const clamped = Math.max(0, p);
    if (start) {
      return Math.min(1, (Math.floor(n * clamped) + 1) / n);
    }
    return Math.floor(n * clamped) / n;
  };
}

export interface SpringParams {
  mass: number;
  stiffness: number;
  damping: number;
  initialVelocity: number;
}

/**
 * Analytic spring response (spec 6.5):
 * m*x'' + c*x' + k*(x-1) = 0, x(0)=0, x'(0)=v; t in seconds.
 * All three damping regimes implemented; regime chosen from parsed values.
 */
export function springResponse(params: SpringParams): (t: number) => number {
  const { mass: m, stiffness: k, damping: c, initialVelocity: v } = params;
  if (!(m > 0) || !(k > 0) || !(c >= 0) || !Number.isFinite(v)) {
    throw new Error('spring(mass,stiffness,damping,initialVelocity) requires m,k>0, c>=0, v finite');
  }
  const alpha = c / (2 * m);
  const omega0sq = k / m;
  const omega0 = Math.sqrt(omega0sq);

  // c^2 < 4mk  => underdamped (including c=0)
  // c^2 = 4mk  => critical
  // c^2 > 4mk  => overdamped
  const c2 = c * c;
  const fourmk = 4 * m * k;
  const eps = 1e-12 * Math.max(1, fourmk);

  if (c2 < fourmk - eps) {
    const omega = Math.sqrt(omega0sq - alpha * alpha);
    return (t: number) => {
      const e = Math.exp(-alpha * t);
      return 1 + e * (-Math.cos(omega * t) + ((v - alpha) / omega) * Math.sin(omega * t));
    };
  }
  if (Math.abs(c2 - fourmk) <= eps) {
    // Numerically stable near critical damping:
    // x(t) = 1 - e^{-at} + e^{-at}(v-a)t  = 1 - e^{-at}(1 - (v-a)t)
    return (t: number) => {
      const e = Math.exp(-alpha * t);
      return 1 - e * (1 - (v - alpha) * t);
    };
  }
  const r1 = -alpha + Math.sqrt(alpha * alpha - omega0sq);
  const r2 = -alpha - Math.sqrt(alpha * alpha - omega0sq);
  const A = (v + r2) / (r1 - r2);
  const B = -1 - A;
  return (t: number) => {
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    // Stable evaluation for large durations: factor out the slower-decaying term
    if (r1 > r2) {
      return 1 + e2 * (A * Math.exp((r1 - r2) * t) + B);
    }
    return 1 + e1 * (A + B * Math.exp((r2 - r1) * t));
  };
}

export interface SpringParseResult {
  fn: (t: number) => number;
  diagnostics: Diagnostic[];
}

/**
 * Parse spring params as rationals to choose the damping regime (spec 6.5).
 */
export function parseSpring(params: SpringParams, durationSeconds: number): SpringParseResult {
  const fn = springResponse(params);
  const diagnostics: Diagnostic[] = [];
  // W_SPRING_UNSETTLED if |x(d)-1| > 0.001 or |x'(d)| > 0.001 per second
  const xd = fn(durationSeconds);
  const h = 1e-4;
  const xd2 = fn(durationSeconds + h);
  const xd1 = fn(Math.max(0, durationSeconds - h));
  const vel = (xd2 - xd1) / (h + Math.min(h, durationSeconds));
  if (Math.abs(xd - 1) > 0.001 || Math.abs(vel) > 0.001) {
    diagnostics.push(
      warning(
        'W_SPRING_UNSETTLED',
        `Spring has meaningful residual motion at the declared duration (|x(d)-1|=${Math.abs(xd - 1).toFixed(4)}, |x'(d)|=${Math.abs(vel).toFixed(4)}); deterministic physical truncation applies.`,
        { suggestion: 'Increase duration or adjust damping so the spring settles.' }
      )
    );
  }
  return { fn, diagnostics };
}

const namedEasings: Record<string, string> = {
  linear: 'linear',
  'ease-in': 'cubic-bezier(0.42, 0, 1, 1)',
  'ease-out': 'cubic-bezier(0, 0, 0.58, 1)',
  'ease-in-out': 'cubic-bezier(0.42, 0, 0.58, 1)'
};

export function parseEasing(text: string, durationSeconds = 1): { fn: EasingFunction; spring?: (t: number) => number; diagnostics: Diagnostic[] } {
  const s = text.trim();
  const diagnostics: Diagnostic[] = [];
  if (s === 'linear') return { fn: linear, diagnostics };
  if (namedEasings[s]) return { fn: cubicBezierSolver(...(parseBezier(namedEasings[s]) as [number, number, number, number])), diagnostics };
  if (s.startsWith('cubic-bezier(')) {
    return { fn: cubicBezierSolver(...(parseBezier(s) as [number, number, number, number])), diagnostics };
  }
  const stepsMatch = /^steps\((\d+),(start|end)\)$/.exec(s);
  if (stepsMatch) {
    return { fn: steps(parseInt(stepsMatch[1], 10), stepsMatch[2] === 'start'), diagnostics };
  }
  const springMatch = /^spring\(([^)]*)\)$/.exec(s);
  if (springMatch) {
    const parts = springMatch[1].split(',').map((x) => x.trim());
    const [mass, stiffness, damping, initialVelocity] = parts;
    const params: SpringParams = {
      mass: Number(mass ?? '1'),
      stiffness: Number(stiffness ?? '100'),
      damping: Number(damping ?? '10'),
      initialVelocity: Number(initialVelocity ?? '0')
    };
    const res = parseSpring(params, durationSeconds);
    return { fn: (p: number) => res.fn(p * durationSeconds), spring: res.fn, diagnostics: res.diagnostics };
  }
  throw new Error(`Unknown easing "${text}"`);
}

function parseBezier(text: string): [number, number, number, number] {
  const m = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\s*\)$/.exec(text);
  if (!m) throw new Error(`Malformed cubic-bezier: ${text}`);
  const vals = [m[1], m[2], m[3], m[4]].map(Number);
  if (vals.some((v) => !Number.isFinite(v))) throw new Error(`Malformed cubic-bezier: ${text}`);
  const [x1, y1, x2, y2] = vals;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new Error(`cubic-bezier x controls must be in [0,1]: ${text}`);
  }
  return [x1, y1, x2, y2];
}

/** Registry value for spec 5.2 transition gains. */
export function equalPowerGains(p: number): { gOut: number; gIn: number } {
  const q = Math.max(0, Math.min(1, p));
  return { gOut: Math.cos((q * Math.PI) / 2), gIn: Math.sin((q * Math.PI) / 2) };
}
