import { Rational } from './rational.js';

/**
 * Clock transforms (spec 3.3). Given parent time tp, produce child local time.
 */
export type ClockTransform =
  | { kind: 'identity' }
  | { kind: 'offset'; start: Rational } // ordinary timed node: local = tp - b
  | { kind: 'loop'; iterationDuration: Rational } // loop
  | { kind: 'freeze'; at: Rational } // freeze: fixed local time
  | { kind: 'media'; trimIn: Rational; rate: Rational }; // media: sourceTime = trimIn + local * rate

export function evaluateClock(clock: ClockTransform, parentTime: Rational): Rational {
  switch (clock.kind) {
    case 'identity':
      return parentTime;
    case 'offset':
      return parentTime.sub(clock.start);
    case 'loop': {
      const L = clock.iterationDuration;
      if (L.isZero() || L.sign() < 0) return parentTime;
      if (parentTime.sign() < 0) return parentTime; // before start, inactive anyway
      const iteration = parentTime.div(L).floor();
      return parentTime.sub(iteration.mul(L));
    }
    case 'freeze':
      return clock.at;
    case 'media':
      return clock.trimIn.add(parentTime.mul(clock.rate));
  }
}

export interface LoopIterationInfo {
  iteration: number;
  childTime: Rational;
}

export function loopIteration(local: Rational, L: Rational): LoopIterationInfo | null {
  if (L.isZero() || L.sign() < 0 || local.sign() < 0) return null;
  const iteration = local.div(L).floor();
  return { iteration: iteration.toSafeInteger(), childTime: local.sub(iteration.mul(L)) };
}

export interface Interval {
  start: Rational;
  end: Rational; // exclusive
}

/** Half-open [start, end) activity (spec 3.2). */
export function isActive(interval: Interval, t: Rational): boolean {
  return t.gte(interval.start) && t.lt(interval.end);
}

export function intersect(a: Interval, b: Interval): Interval {
  return { start: a.start.gt(b.start) ? a.start : b.start, end: a.end.lt(b.end) ? a.end : b.end };
}

/**
 * Series layout (spec 5.2):
 * start0 = 0; start(i+1) = start(i) + Di - Oi; seriesLength = sum(Di) - sum(Oi)
 */
export interface SeriesItem {
  duration: Rational;
  overlapAfter: Rational | null; // transition overlap to the next item
}

export function computeSeriesSchedule(items: readonly SeriesItem[]): {
  starts: Rational[];
  total: Rational;
} {
  const starts: Rational[] = [];
  let total = Rational.zero();
  for (let i = 0; i < items.length; i++) {
    starts.push(total);
    total = total.add(items[i].duration);
    if (i < items.length - 1) {
      const o = items[i].overlapAfter ?? Rational.zero();
      total = total.sub(o);
    }
  }
  return { starts, total };
}
