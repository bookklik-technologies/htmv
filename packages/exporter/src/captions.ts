/** Exact root cue intervals, finite-loop expansion and range-local VTT endpoints. */
import { Rational, FrameRange } from '@htmv/core';
import type { CompiledCompositionImpl, ResolvedNode } from '@htmv/compiler';
function format(ms: bigint): string {
  return `${String(ms / 3600000n).padStart(2, '0')}:${String(ms / 60000n % 60n).padStart(2, '0')}:${String(ms / 1000n % 60n).padStart(2, '0')}.${String(ms % 1000n).padStart(3, '0')}`;
}
export async function renderCaptionsSidecar(compiled: CompiledCompositionImpl, range: FrameRange | null, onWarning?: (message: string) => void): Promise<Blob> {
  const fps = Rational.of(BigInt(compiled.metadata.fps.numerator), BigInt(compiled.metadata.fps.denominator));
  const full = compiled.metadata.durationFrames;
  if (range && (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.toExclusive) || range.from < 0 || range.from >= range.toExclusive || range.toExclusive > full)) throw new RangeError('Invalid caption export range.');
  const a = Rational.of(BigInt(range?.from ?? 0)).div(fps); const e = Rational.of(BigInt(range?.toExclusive ?? full)).div(fps);
  const cues: { start: Rational; end: Rational; text: string; order: number }[] = [];
  const root = [...compiled.timing.nodes.values()].find((n) => n.kind === 'composition');
  const walk = (node: ResolvedNode, origin: Rational, clipStart: Rational, clipEnd: Rational, frozen: boolean): void => {
    if (typeof node.duration === 'string') return;
    const start = origin.add(node.relativeStart); const end = start.add(node.duration);
    const lo = start.gt(clipStart) ? start : clipStart; const hi = end.lt(clipEnd) ? end : clipEnd;
    if (lo.gte(hi)) return;
    if (node.kind === 'captions') {
      if (frozen) throw new Error('E_FREEZE_CAPTIONS: sidecar captions under freeze are not supported; use burned-in captions.');
      for (const cue of node.captions?.cues ?? []) {
        const cs = start.add(cue.start); const ce = start.add(cue.end);
        const b = cs.gt(lo) ? cs : lo; const f = ce.lt(hi) ? ce : hi;
        if (b.lt(f)) cues.push({ start: b, end: f, text: cue.text, order: cues.length });
      }
    }
    if (cues.length > 100000) throw new Error('E_RESOURCE_LIMIT: too many sidecar cues.');
    if (node.clock?.kind === 'loop') {
      const length = node.clock.iterationDuration;
      const first = lo.sub(start).div(length).floor().toSafeInteger(); const last = hi.sub(start).div(length).ceil().toSafeInteger();
      for (let i = first; i < last; i++) {
        const iteration = start.add(length.mul(Rational.of(BigInt(i)))); const boundary = iteration.add(length);
        for (const cid of node.childIds) walk(compiled.timing.nodes.get(cid)!, iteration, lo.gt(iteration) ? lo : iteration, hi.lt(boundary) ? hi : boundary, frozen);
      }
    } else for (const cid of node.childIds) walk(compiled.timing.nodes.get(cid)!, start, lo, hi, frozen || node.kind === 'freeze');
  };
  if (root) walk(root, Rational.zero(), a, e, false);
  cues.sort((x, y) => x.start.lt(y.start) ? -1 : x.start.gt(y.start) ? 1 : x.order - y.order);
  const lines = ['WEBVTT', '']; let index = 1;
  for (const cue of cues) {
    const b = cue.start.sub(a).mul(Rational.of(1000n)).roundHalfUp().num; const f = cue.end.sub(a).mul(Rational.of(1000n)).roundHalfUp().num;
    if (b >= f) { onWarning?.('W_CAPTION_QUANTIZATION: zero-length millisecond cue omitted.'); continue; }
    lines.push(String(index++), `${format(b)} --> ${format(f)}`, cue.text, '');
  }
  return new Blob([lines.join('\n')], { type: 'text/vtt' });
}
