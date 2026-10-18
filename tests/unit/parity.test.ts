import { describe, it, expect } from 'vitest';
import { compile } from '@htmv/compiler';
import { Rational } from '@htmv/core';
import { evaluateFrame } from '@htmv/renderer-canvas';
import { canonicalEasing } from '@htmv/exporter';
import { renderCaptionsSidecar } from '../../packages/exporter/src/captions.js';
import { MemoryWriterSession, SeekableWriterSession } from '../../packages/exporter/src/writers.js';
import { resampleWindow } from '../../packages/audio/src/resampler.js';
import { runPreflight } from '../../packages/exporter/src/preflight.js';

const source = (children: string, duration = '150f') => `<hv-composition id="c" width="100" height="100" fps="30" duration="${duration}">${children}</hv-composition>`;
const sample = (c: Awaited<ReturnType<typeof compile>>, frame: number) => evaluateFrame(c.timing, { frame, fps: Rational.of(30n), durationFrames: c.metadata.durationFrames, easing: canonicalEasing.evaluate });

describe('spec parity regressions', () => {
  it('creates a seconds-based root and gates half-open scene windows', async () => {
    const c = await compile(source('<hv-scene id="a" duration="60f"><p>A</p></hv-scene><hv-scene id="b" start="60f" duration="60f"><p>B</p></hv-scene>'));
    expect(c.timing.nodes.get('c')!.duration.toString()).toBe('5');
    expect(sample(c, 59).states.has('a')).toBe(true);
    expect(sample(c, 60).states.has('a')).toBe(false);
    expect(sample(c, 60).states.has('b')).toBe(true);
    expect(sample(c, 120).states.has('b')).toBe(false);
  });
  it('maps nested offsets, loops, freeze and enclosing animation clocks', async () => {
    const nested = await compile(source('<hv-scene start="60f"><hv-sequence start="15f"><p id="x">X</p></hv-sequence></hv-scene>'));
    expect(sample(nested, 90).states.get('x')!.nodeLocal.toString()).toBe('1/2');
    const c = await compile(source('<hv-loop iteration-duration="30f" count="3"><p id="x">X</p><hv-animation target="#x" property="opacity" duration="30f" from="0" to="1"></hv-animation></hv-loop>'));
    expect(sample(c, 0).animatedValues.get('x')?.[0].value).toBe(sample(c, 30).animatedValues.get('x')?.[0].value);
    expect(Number(sample(c, 45).animatedValues.get('x')?.[0].value)).toBeCloseTo(0.5);
    const frozen = await compile(source('<hv-freeze at="60f" duration="90f"><p id="f" data-hv-start="30f">held</p></hv-freeze>'));
    expect(sample(frozen, 0).states.get('f')!.nodeLocal.toString()).toBe('1');
    expect(sample(frozen, 60).states.get('f')!.nodeLocal.toString()).toBe('1');
  });
  it('hashes literal rendering inputs and freezes the published revision', async () => {
    const a = await compile(source('<p style="color:red">A</p>'));
    const b = await compile(source('<p style="color:red">B</p>'));
    const d = await compile(source('<p style="color:blue">A</p>'));
    expect(a.revisionHash).not.toBe(b.revisionHash); expect(a.revisionHash).not.toBe(d.revisionHash);
    expect(a.serializeIR().revisionHash).toBe(a.revisionHash);
    expect(() => a.timing.nodes.clear()).toThrow(/immutable/);
    expect(() => { a.timing.nodes.get('c')!.attributes.background = 'red'; }).toThrow();
  });
  it('expands loop captions, clips ancestors and rejects freeze sidecars', async () => {
    const c = await compile(source('<hv-sequence start="30f" duration="90f"><hv-loop iteration-duration="30f" count="3"><hv-captions><hv-cue start="0" end="15f">cue</hv-cue></hv-captions></hv-loop></hv-sequence>'));
    const text = await (await renderCaptionsSidecar(c, { from: 45, toExclusive: 105 })).text();
    expect(text.match(/--> /g)).toHaveLength(2);
    expect(text).toContain('00:00:00.500 --> 00:00:01.000');
    expect(text).toContain('00:00:01.500 --> 00:00:02.000');
    const f = await compile(source('<hv-freeze at="15f" duration="60f"><hv-captions><hv-cue start="0" end="30f">cue</hv-cue></hv-captions></hv-freeze>'));
    await expect(renderCaptionsSidecar(f, null)).rejects.toThrow('E_FREEZE_CAPTIONS');
  });
  it('honors positioned writes instead of appending rewritten bytes', async () => {
    const memory = new MemoryWriterSession(100);
    await memory.write(0n, new Uint8Array([1, 2, 3, 4])); await memory.write(1n, new Uint8Array([9]));
    const result = await memory.finish();
    expect(result.kind).toBe('blob');
    if (result.kind === 'blob') expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([1, 9, 3, 4]);
    const positions: bigint[] = [];
    const external = new SeekableWriterSession({ kind: 'seekable', writeAt: async (position) => { positions.push(position); }, close: async () => {}, abort: async () => {} });
    await external.write(12n, new Uint8Array([1])); await external.write(0n, new Uint8Array([2]));
    expect(positions).toEqual([12n, 0n]); expect(external.bytesWritten()).toBe(13n);
  });
  it('resamples fractional phases with unity DC gain', () => {
    for (const phase of ['0', '1/3', '10/7']) expect(resampleWindow(Rational.parse(phase), new Float32Array(33).fill(0.25))).toBeCloseTo(0.25, 7);
  });
  it('preserves component timing and instance-local selector references', async () => {
    const c = await compile(source('<template id="card" data-hv-component><p id="title">X</p><hv-animation target="#title" property="opacity" duration="30f" from="0" to="1"></hv-animation></template><hv-use template="#card" start="30f" duration="30f"></hv-use>'));
    const text = [...c.timing.nodes.values()].find((n) => n.kind === 'text')!;
    expect(sample(c, 0).states.has(text.id)).toBe(false); expect(sample(c, 30).states.has(text.id)).toBe(true); expect(sample(c, 60).states.has(text.id)).toBe(false);
    expect(c.timing.animations[0].targetSelector).toBe(`#${text.id}`);
  });
});
