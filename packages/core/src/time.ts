import { Rational } from './rational.js';
import { error, CompilationError } from './diagnostics.js';

function throwDiag(code: string, message: string, suggestion?: string): never {
  throw new CompilationError([error(code, message, suggestion ? { suggestion } : {})]);
}

/**
 * Time attribute grammar (spec 3.1):
 *  - decimal number + f | s | ms
 *  - f values are integers (composition output frame rate)
 *  - s / ms parsed as exact rationals
 *  - unitless 0 accepted; all other unitless values are errors
 */
export interface ParsedTime {
  kind: 'frames' | 'seconds' | 'milliseconds';
  value: Rational; // frames count or exact seconds
}

export function parseTimeAttribute(text: string): ParsedTime {
  const s = text.trim();
  if (s === '') throwDiag('E_TIME_UNIT', 'Empty time value; use forms like "30f", "2s", "500ms" or "0".');
  if (/^-?\d+$/.test(s)) {
    if (s === '0') return { kind: 'seconds', value: Rational.zero() };
    throwDiag('E_TIME_UNIT', `Nonzero unitless time "${s}" is not valid; use a unit such as ${s}f or ${s}s.`);
  }
  const m = /^(-?\d+(?:\.\d+)?)(f|s|ms)$/.exec(s);
  if (!m) {
    throwDiag('E_TIME_UNIT', `Malformed time value "${text}"; valid forms are decimal number followed by f, s, or ms.`);
  }
  const num = m[1];
  const unit = m[2];
  if (unit === 'f') {
    if (num.includes('.')) {
      throwDiag('E_TIME_UNIT', `Frame counts must be integers; "${text}" has a fractional part.`);
    }
    return { kind: 'frames', value: Rational.parse(num) };
  }
  const r = Rational.fromDecimalString(num);
  return { kind: unit === 's' ? 'seconds' : 'milliseconds', value: unit === 'ms' ? r.div(Rational.fromInteger(1000n)) : r };
}

/**
 * fps grammar: positive integer, or reduced rational "P/Q" with Q>0.
 * Decimal shorthand such as 29.97 is rejected (spec 3.1).
 */
export function parseFps(text: string): Rational {
  const s = text.trim();
  if (/^\d+$/.test(s)) {
    const n = BigInt(s);
    if (n <= 0n) throwDiag('E_TIME_UNIT', `fps must be positive; received ${s}.`);
    return Rational.of(n, 1n);
  }
  const m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) {
    const p = BigInt(m[1]);
    const q = BigInt(m[2]);
    if (q === 0n) throwDiag('E_TIME_UNIT', 'fps denominator must be nonzero.');
    if (p <= 0n) throwDiag('E_TIME_UNIT', `fps must be positive; received ${s}.`);
    const r = Rational.of(p, q);
    if (r.den !== q) {
      throwDiag('E_TIME_UNIT', `fps rational "${s}" must be reduced; use ${r.toString()}.`);
    }
    return r;
  }
  throwDiag('E_TIME_UNIT', `fps "${s}" is not valid: use a positive integer like 30, or a reduced rational like 30000/1001. Decimal fps such as 29.97 is rejected; it is not the same as 30000/1001.`);
}

/**
 * Frame n samples composition time t(n) = n * Q/P seconds (spec 3.1).
 */
export function frameTimeSeconds(frame: number | bigint, fps: Rational): Rational {
  const n = typeof frame === 'bigint' ? frame : BigInt(frame);
  return Rational.of(n, 1n).div(fps);
}

/**
 * Timestamp quantization (spec 3.5):
 * us(n) = roundHalfUp(1,000,000 * n * Q / P)
 * Endpoints are computed independently; never accumulate rounded durations.
 */
export function frameTimestampMicroseconds(frame: number | bigint, fps: Rational): bigint {
  const n = typeof frame === 'bigint' ? frame : BigInt(frame);
  const us = Rational.of(n, 1n)
    .div(fps)
    .mul(Rational.fromInteger(1000000n));
  return us.roundHalfUp().num;
}

/** Exact positive-integer frame count of a time, or null when not frame-aligned. */
export function framesForSeconds(seconds: Rational, fps: Rational): { frames: bigint; exact: boolean } {
  const f = seconds.mul(fps);
  return { frames: f.floor().num, exact: f.den === 1n };
}
