import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('canonical pixels obey scene boundaries, inline styles and nested opacity/clip/transform', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const c = await m.compile(`<hv-composition id="c" width="100" height="100" fps="30" duration="150f">
      <hv-scene duration="60f"><div style="position:absolute;left:10px;top:10px;width:40px;height:40px;background-color:blue;opacity:0.5;overflow:hidden;transform:translateX(20px)"><div style="position:absolute;left:20px;top:0px;width:40px;height:40px;background-color:red"></div></div></hv-scene>
      <hv-scene start="60f" duration="60f"><div style="width:100px;height:100px;background-color:green"></div></hv-scene>
    </hv-composition>`);
    const r = await m.createRenderer(c);
    const pixels = async (frame: number, points: number[][]) => {
      const f = await r.renderFrame(frame); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(f.image, 0, 0); f.close();
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    };
    try { return { first: await pixels(0, [[35, 20], [55, 20], [75, 20]]), second: await pixels(60, [[35, 20]]), empty: await pixels(120, [[35, 20]]) }; }
    finally { await r.dispose(); await c.dispose(); }
  });
  expect(result.first[0]).toEqual([0, 0, 128, 255]); expect(result.first[1]).toEqual([128, 0, 0, 255]); expect(result.first[2]).toEqual([0, 0, 0, 255]);
  expect(result.second[0]).toEqual([0, 128, 0, 255]); expect(result.empty[0]).toEqual([0, 0, 0, 255]);
});

test('frozen programmatic images and restricted SVG reach the canonical painter', async ({ page }) => {
  const pixels = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const asset = document.createElement('canvas'); asset.width = asset.height = 4; const actx = asset.getContext('2d')!; actx.fillStyle = 'red'; actx.fillRect(0, 0, 4, 4);
    const blob = await new Promise<Blob>((resolve) => asset.toBlob((b) => resolve(b!)));
    const c = await m.compile(`<hv-composition id="c" width="100" height="100" fps="30" duration="30f"><img src="asset:photo" style="position:absolute;left:0px;top:0px;width:50px;height:100px"><svg width="50" height="100" viewBox="0 0 50 100" style="position:absolute;left:50px;top:0px"><rect width="50" height="100" fill="blue" /></svg></hv-composition>`, { assets: { photo: blob } });
    const r = await m.createRenderer(c);
    try { const f = await r.renderFrame(0); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(f.image, 0, 0); f.close(); return [[...ctx.getImageData(20, 20, 1, 1).data], [...ctx.getImageData(70, 20, 1, 1).data]]; }
    finally { await r.dispose(); await c.dispose(); }
  });
  expect(pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
});

test('layout animation changes pixels and loop animations restart on the exact boundary', async ({ page }) => {
  const values = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const c = await m.compile(`<hv-composition id="c" width="100" height="100" fps="30" duration="60f"><hv-loop iteration-duration="30f" count="2"><div id="box" style="width:10px;height:100px;background-color:red"></div><hv-animation target="#box" property="width" duration="30f" from="10px" to="90px" fill="both"></hv-animation></hv-loop></hv-composition>`);
    const r = await m.createRenderer(c);
    try {
      const result = [];
      for (const frame of [0, 15, 30, 45, 0]) { const f = await r.renderFrame(frame); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(f.image, 0, 0); f.close(); result.push(ctx.getImageData(30, 30, 1, 1).data[0]); }
      return result;
    } finally { await r.dispose(); await c.dispose(); }
  });
  expect(values).toEqual([0, 255, 0, 255, 0]);
});

test('async plugins receive deterministic synchronous randomness and awaited frame readiness', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    let disposed = 0; const samples: number[] = [];
    const plugin = { id: 'fixture', version: '1', execution: 'main', capabilities: [], validate: () => [], prepare: async () => ({
      render: async (context: any) => { await Promise.resolve(); const value = context.random('fixed', 0); samples.push(value); context.ctx.fillStyle = 'red'; context.ctx.fillRect(0, 0, context.width, context.height); },
      dispose: () => { disposed++; }
    }) };
    const c = await m.compile('<hv-composition id="c" width="100" height="100" fps="30" duration="30f"><canvas width="100" height="100" data-hv-plugin="fixture"></canvas></hv-composition>', { plugins: [plugin] });
    const r = await m.createRenderer(c); const reds = [];
    for (const n of [0, 15, 0]) { const f = await r.renderFrame(n); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(f.image, 0, 0); f.close(); reds.push(ctx.getImageData(10, 10, 1, 1).data[0]); }
    await r.dispose(); await c.dispose(); return { samples, reds, disposed };
  });
  expect(result.reds).toEqual([255, 255, 255]); expect(result.samples[0]).toBe(result.samples[2]); expect(typeof result.samples[0]).toBe('number'); expect(result.disposed).toBe(1);
});

test('stereo 44.1kHz PCM is resampled without swapping or collapsing channels; sync gate is honest', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const rate = 44100; const frames = rate; const buffer = new ArrayBuffer(44 + frames * 4); const d = new DataView(buffer);
    const text = (offset: number, s: string) => [...s].forEach((c, i) => d.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); d.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 4, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true); text(36, 'data'); d.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) { d.setInt16(44 + i * 4, 8192, true); d.setInt16(46 + i * 4, -16384, true); }
    const c = await m.compile('<hv-composition id="c" width="100" height="100" fps="30" duration="30f"><hv-audio src="asset:music"></hv-audio></hv-composition>', { assets: { music: new Blob([buffer], { type: 'audio/wav' }) } });
    const r = await m.createRenderer(c);
    try {
      const block = await r.mixAudioBlockForExport(m.Rational.of(1n, 100n), 512, 0, c.metadata, []);
      const strict = await r.preflight({ profile: 'auto' });
      const loose = await r.preflight({ profile: 'auto', syncPolicy: 'allow-unverified' });
      return { left: [...block.left], right: [...block.right], strict: strict.supported, strictSelected: !!strict.selected, strictCodes: strict.diagnostics.map((d: any) => d.code), looseSync: loose.selected?.syncCertification ?? null };
    } finally { await r.dispose(); await c.dispose(); }
  });
  for (const sample of result.left) expect(sample).toBeCloseTo(0.25, 5);
  for (const sample of result.right) expect(sample).toBeCloseTo(-0.5, 5);
  expect(result.strict).toBe(false); expect(result.strictSelected).toBe(false); expect(result.strictCodes).toContain('E_AUDIO_DELAY_UNVERIFIED');
  if (result.looseSync) expect(result.looseSync).toBe('unverified');
});

test('HTMLElement/template compilation and caller-owned explicit renderer lifecycle', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const template = document.createElement('template'); template.innerHTML = '<hv-composition id="new" width="100" height="100" fps="30" duration="30f"><div style="width:100px;height:100px;background-color:red"></div></hv-composition>';
    const c = await m.compile(template); const r = await m.createRenderer(c);
    const player = document.createElement('hv-player') as any;
    const ready = new Promise<void>((resolve, reject) => { player.addEventListener('hv-ready', () => resolve(), { once: true }); player.addEventListener('hv-error', (e: any) => reject(new Error(e.detail.message)), { once: true }); });
    player.renderer = r; document.body.appendChild(player); await ready;
    const canvas = player.querySelector('canvas') as HTMLCanvasElement;
    const size = [canvas.width, canvas.height]; player.remove(); await new Promise((resolve) => setTimeout(resolve, 0));
    const f = await r.renderFrame(0); f.close(); const externalAlive = r.state === 'ready';
    await r.dispose(); await c.dispose(); return { size, externalAlive };
  });
  expect(result.size).toEqual([100, 100]); expect(result.externalAlive).toBe(true);
});

test('source mutation recompiles once and invalid edits retain the last good player revision', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const wrapper = document.createElement('div'); wrapper.innerHTML = '<hv-composition id="changing" width="100" height="100" fps="30" duration="30f"><div id="color" style="width:100px;height:100px;background-color:red"></div></hv-composition><hv-player for="changing" controls></hv-player>';
    const player = wrapper.querySelector('hv-player') as any;
    const event = (name: string) => new Promise<void>((resolve) => player.addEventListener(name, () => resolve(), { once: true }));
    const first = event('hv-ready'); document.body.appendChild(wrapper); await first;
    const before = player.renderer.revisionHash;
    const next = event('hv-ready'); wrapper.querySelector('#color')!.setAttribute('style', 'width:100px;height:100px;background-color:blue'); await next;
    const after = player.renderer.revisionHash; const readyRenderer = player.renderer;
    const error = event('hv-error'); wrapper.querySelector('#color')!.setAttribute('style', 'filter:blur(2px)'); await error;
    const retained = player.renderer === readyRenderer; await player.seekToFrame(0);
    const pixel = [...(player.querySelector('canvas') as HTMLCanvasElement).getContext('2d')!.getImageData(50, 50, 1, 1).data];
    const max = player.querySelector('input').max;
    wrapper.remove(); await new Promise((resolve) => setTimeout(resolve, 0)); return { before, after, retained, pixel, max };
  });
  expect(result.before).not.toBe(result.after); expect(result.retained).toBe(true); expect(result.pixel).toEqual([0, 0, 255, 255]); expect(result.max).toBe('29');
});

test('writer failures and cancellation abort owned sessions and leave the renderer reusable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const c = await m.compile('<hv-composition id="c" width="100" height="100" fps="10" duration="20f"><div style="width:100px;height:100px;background-color:red"></div></hv-composition>');
    const r = await m.createRenderer(c);
    try {
      const report = await r.preflight({ profile: 'auto' }); if (!report.selected) return { unsupported: true };
      let failedAbort = 0; let failedClose = 0; let failed = false;
      try { await r.exportVideo({ configuration: report.selected, target: { kind: 'writer', writer: { kind: 'seekable', writeAt: async () => { throw new Error('fixture quota failure'); }, abort: async () => { failedAbort++; }, close: async () => { failedClose++; } } } }); } catch { failed = true; }
      const controller = new AbortController(); let cancelledAbort = 0; let cancelledClose = 0; let cancelled = false;
      try { await r.exportVideo({ configuration: report.selected, signal: controller.signal, target: { kind: 'writer', writer: { kind: 'seekable', writeAt: async () => { controller.abort(); }, abort: async () => { cancelledAbort++; }, close: async () => { cancelledClose++; } } } }); } catch { cancelled = true; }
      const pending = r.renderFrame(0); const exportPromise = r.exportVideo({ configuration: report.selected, target: { kind: 'memory' } });
      let busy = false; try { await r.renderFrame(1); } catch (e) { busy = (e as any).code === 'E_BUSY'; }
      (await pending).close(); await exportPromise;
      return { unsupported: false, failed, failedAbort, failedClose, cancelled, cancelledAbort, cancelledClose, busy, state: r.state };
    } finally { await r.dispose(); await c.dispose(); }
  });
  test.skip(result.unsupported, 'No admitted video encoder in this environment.');
  expect(result.failed).toBe(true); expect(result.failedAbort).toBe(1); expect(result.failedClose).toBe(0);
  expect(result.cancelled).toBe(true); expect(result.cancelledAbort).toBe(1); expect(result.cancelledClose).toBe(0); expect(result.busy).toBe(true); expect(result.state).toBe('ready');
});

test('M0 title + decoded clip + repeated audio exports through a positioned streaming writer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const seed = await m.compile('<hv-composition id="seed" width="100" height="100" fps="10" duration="20f"><div data-hv-duration="10f" style="position:absolute;width:100px;height:100px;background-color:red"></div><div data-hv-start="10f" data-hv-duration="10f" style="position:absolute;width:100px;height:100px;background-color:blue"></div></hv-composition>');
    const sr = await m.createRenderer(seed); let clip: Blob;
    try {
      const report = await sr.preflight({ profile: 'auto' }); if (!report.selected) return { unsupported: true };
      const output = await sr.exportVideo({ configuration: report.selected, target: { kind: 'memory' } }); clip = output.blob;
    } finally { await sr.dispose(); await seed.dispose(); }
    const rate = 48000; const bytes = new ArrayBuffer(44 + rate * 2); const d = new DataView(bytes);
    const text = (offset: number, s: string) => [...s].forEach((c, i) => d.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); d.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); text(36, 'data'); d.setUint32(40, rate * 2, true);
    for (let i = 0; i < rate; i++) d.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI * 880 / rate) * 4000), true);
    const c = await m.compile('<hv-composition id="film" width="100" height="100" fps="10" duration="20f"><hv-video src="asset:clip" audio="mute" duration="20f"></hv-video><p style="position:absolute;left:5px;top:5px;width:90px;font-size:20px;color:white">Title</p><hv-audio src="asset:music" repeat="true" trim-out="1s"></hv-audio></hv-composition>', { assets: { clip: clip!, music: new Blob([bytes], { type: 'audio/wav' }) } });
    const r = await m.createRenderer(c);
    try {
      const colors = [];
      for (const frame of [0, 15, 0]) { const f = await r.renderFrame(frame); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(f.image, 0, 0); f.close(); colors.push([...ctx.getImageData(80, 80, 1, 1).data]); }
      const report = await r.preflight({ profile: 'auto', syncPolicy: 'allow-unverified' }); if (!report.selected) return { unsupported: true };
      const chunks: { at: number; data: Uint8Array }[] = []; let closed = false; let aborted = false; let finalizing = false; let wroteBeforeFinalize = false;
      const output = await r.exportVideo({ configuration: report.selected, target: { kind: 'writer', writer: { kind: 'seekable', writeAt: async (at: bigint, data: Uint8Array) => { if (!finalizing) wroteBeforeFinalize = true; chunks.push({ at: Number(at), data: data.slice() }); await new Promise((resolve) => setTimeout(resolve, 1)); }, close: async () => { closed = true; }, abort: async () => { aborted = true; } } }, onProgress: (progress: any) => { if (progress.phase === 'finalizing') finalizing = true; } });
      const length = Math.max(...chunks.map((c) => c.at + c.data.length)); const assembled = new Uint8Array(length); for (const chunk of chunks) assembled.set(chunk.data, chunk.at);
      const roundtrip = await m.compile('<hv-composition id="roundtrip" width="100" height="100" fps="10" duration="20f"><hv-video src="asset:result" audio="mute" duration="20f"></hv-video></hv-composition>', { assets: { result: new Blob([assembled], { type: report.selected.mimeType }) } });
      const rr = await m.createRenderer(roundtrip); const frame = await rr.renderFrame(15); frame.close(); await rr.dispose(); await roundtrip.dispose();
      return { unsupported: false, colors, closed, aborted, wroteBeforeFinalize, kind: output.kind, bytes: output.bytesWritten, length, frames: output.manifest.outputFrameCount, samples: output.manifest.outputSampleCount, sync: output.manifest.syncCertification, warning: output.manifest.warnings.some((w: string) => w.includes('E_AUDIO_DELAY_UNVERIFIED')), metrics: output.manifest.resourceHighWaterMarks };
    } finally { await r.dispose(); await c.dispose(); }
  });
  test.skip(result.unsupported, 'No admitted A/V encoder configuration in this browser.');
  expect(result.colors![0][0]).toBeGreaterThan(230); expect(result.colors![1][2]).toBeGreaterThan(230); expect(result.colors![2]).toEqual(result.colors![0]);
  expect(result.kind).toBe('file'); expect(result.closed).toBe(true); expect(result.aborted).toBe(false); expect(result.wroteBeforeFinalize).toBe(true);
  expect(result.bytes).toBe(result.length); expect(result.frames).toBe(20); expect(result.samples).toBe(96000); expect(result.sync).toBe('unverified'); expect(result.warning).toBe(true);
  expect(result.metrics!.decodedFramesMax).toBeGreaterThan(0); expect(result.metrics!.pcmBlockBytesMax).toBeGreaterThan(4096 * 4 * 2);
  expect(result.metrics!.encoderQueueMax).toBeNull(); expect(result.metrics!.muxQueueBytesMax).toBeNull();
});
