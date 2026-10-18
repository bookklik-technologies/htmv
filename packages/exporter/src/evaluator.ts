/**
 * Canonical easing evaluation shared by visuals and per-sample audio gains
 * (spec 6.5, 10.3). Results are memoized by easing string.
 */
import { parseEasing } from '@htmv/core';

export const canonicalEasing: { evaluate(name: string, p: number, durationSeconds: number): number } = {
  evaluate(name: string, p: number, durationSeconds: number): number {
    try {
      const { fn } = parseEasing(name, durationSeconds);
      return fn(p);
    } catch {
      return p; // linear fallback for unknown easings already rejected at compile
    }
  }
};

export const easingEvaluator: EasingEvaluatorAlias = (easing: string, p: number, durationSeconds: number) =>
  canonicalEasing.evaluate(easing, p, durationSeconds);

export interface EasingEvaluatorAlias {
  (easing: string, p: number, durationSeconds: number): number;
}
