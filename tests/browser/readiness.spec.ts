import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('CSS URLs use admitted credential-free fetching and cannot bypass a denied loader', async ({ page, context }) => {
  await context.addCookies([{ name: 'readiness_fixture', value: 'synthetic', url: 'http://127.0.0.1:8899' }]);
  const requests: { cookie: boolean }[] = [];
  await page.route('**/readiness.png', async (route) => {
    requests.push({ cookie: !!(await route.request().allHeaders()).cookie });
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64') });
  });
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const variants = ['background-image:URL(/readiness.png)', String.raw`background-image:u\72l("/readiness.png")`, '--photo:URL(/readiness.png);background-image:var(--photo)', 'background-image:var(--missing,URL(/readiness.png))'];
    let deniedCalls = 0; let denied = 0;
    const source = (style: string) => `<hv-composition id="css" width="100" height="100" fps="30" duration="30f"><div style='width:100px;height:100px;${style}'></div></hv-composition>`;
    for (const style of variants) {
      let c: any; let r: any;
      try { c = await m.compile(source(style), { assetLoader: { load: async () => { deniedCalls++; throw new Error('fixture denied'); } } }); r = await m.createRenderer(c); }
      catch (e) { if (String(e).includes('fixture denied')) denied++; }
      finally { await r?.dispose(); await c?.dispose(); }
    }
    const prepared: number[] = [];
    for (const style of variants) {
      const c = await m.compile(source(style)); const r = await m.createRenderer(c);
      try { const frame = await r.renderFrame(0); frame.close(); prepared.push(c.ir.assets.length); }
      finally { await r.dispose(); await c.dispose(); }
    }
    const unsafe = await m.compile(source('background-image:image-set("/readiness.png" 1x)'), { stylePolicy: 'ignore-unsupported' });
    const renderer = await m.createRenderer(unsafe); await renderer.dispose(); await unsafe.dispose();
    return { deniedCalls, denied, prepared };
  });
  expect(result.deniedCalls).toBe(4); expect(result.denied).toBe(4); expect(result.prepared).toEqual([1, 1, 1, 1]);
  expect(requests).toHaveLength(4); expect(requests.every((request) => !request.cookie)).toBe(true);
});

test('transparent stills respect export ownership and preserve decoded output pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const seed = await m.compile('<hv-composition id="seed" width="100" height="100" fps="10" duration="10f"><div data-hv-duration="5f" style="position:absolute;width:100px;height:100px;background-color:red"></div><div data-hv-start="5f" data-hv-duration="5f" style="position:absolute;width:100px;height:100px;background-color:blue"></div></hv-composition>');
    const sr = await m.createRenderer(seed); let clip: Blob;
    try {
      const pf = await sr.preflight({ profile: 'auto' }); if (!pf.selected) return { unsupported: true };
      clip = (await sr.exportVideo({ configuration: pf.selected, target: { kind: 'memory' } })).blob;
    } finally { await sr.dispose(); await seed.dispose(); }
    const source = '<hv-composition id="film" width="100" height="100" fps="10" duration="10f"><hv-video src="asset:clip" audio="mute" duration="10f"></hv-video></hv-composition>';
    const c = await m.compile(source, { assets: { clip: clip! } }); const r = await m.createRenderer(c);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const ready = new Promise<void>((resolve) => { entered = resolve; });
    const prefetch = r.prefetchMedia.bind(r); let first = true;
    r.prefetchMedia = async (evaluation: any, signal: AbortSignal) => { await prefetch(evaluation, signal); if (evaluation.frame === 0 && first) { first = false; entered(); await gate; } };
    try {
      const pf = await r.preflight({ profile: 'auto' }); if (!pf.selected) return { unsupported: true };
      const exporting = r.exportVideo({ configuration: pf.selected, target: { kind: 'memory' } }); await ready;
      const busy: string[] = [];
      try {
        for (const transparent of [true, false]) {
          try { await r.renderStill({ frame: 5, type: 'png', transparent }); busy.push('accepted'); }
          catch (e) { busy.push((e as any).code); }
        }
      } finally { release(); }
      const output = await exporting;
      await r.renderStill({ frame: 5, type: 'png', transparent: true });
      const roundtrip = await m.compile(source, { assets: { clip: output.blob } }); const rr = await m.createRenderer(roundtrip);
      let pixel: number[];
      try { const frame = await rr.renderFrame(0); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(frame.image, 0, 0); frame.close(); pixel = [...ctx.getImageData(50, 50, 1, 1).data]; }
      finally { await rr.dispose(); await roundtrip.dispose(); }
      return { unsupported: false, busy, pixel: pixel!, metrics: output.manifest.resourceHighWaterMarks };
    } finally { release(); await r.dispose(); await c.dispose(); }
  });
  test.skip(result.unsupported, 'No admitted encoder in this environment.');
  expect(result.busy).toEqual(['E_BUSY', 'E_BUSY']); expect(result.pixel![0]).toBeGreaterThan(230); expect(result.pixel![2]).toBeLessThan(20);
  expect(result.metrics!.decodedFramesMax).toBeGreaterThan(0); expect(result.metrics!.pcmBlockBytesMax).toBe(0);
  expect(result.metrics!.encoderQueueMax).toBeNull(); expect(result.metrics!.muxQueueBytesMax).toBeNull();
});

test('a transparent still queued before export finishes first and obeys cancellation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const c = await m.compile('<hv-composition id="still" width="100" height="100" fps="10" duration="10f"></hv-composition>'); const r = await m.createRenderer(c);
    try {
      const pf = await r.preflight({ profile: 'auto' }); if (!pf.selected) return { unsupported: true };
      const controller = new AbortController(); controller.abort();
      let aborted = ''; try { await r.renderStill({ frame: 0, type: 'png', transparent: true, signal: controller.signal }); } catch (e) { aborted = (e as Error).name; }
      const still = r.renderStill({ frame: 0, type: 'png', transparent: true }); const exported = r.exportVideo({ configuration: pf.selected, target: { kind: 'memory' } });
      const blob = await still; const output = await exported;
      const bitmap = await createImageBitmap(blob); const canvas = new OffscreenCanvas(100, 100); const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return { unsupported: false, aborted, alpha: ctx.getImageData(50, 50, 1, 1).data[3], frames: output.manifest.outputFrameCount };
    } finally { await r.dispose(); await c.dispose(); }
  });
  test.skip(result.unsupported, 'No admitted encoder in this environment.'); expect(result.aborted).toBe('AbortError'); expect(result.alpha).toBe(0); expect(result.frames).toBe(10);
});

test('built elements auto entry registers in the browser using package exports', async ({ page }) => {
  const output = await build({ stdin: { contents: "import '@htmv/elements/auto';", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false });
  await page.route('**/readiness-blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
  await page.goto('/readiness-blank');
  const registered = await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try { await import(url); return !!customElements.get('hv-player') && !!customElements.get('hv-composition'); }
    finally { URL.revokeObjectURL(url); }
  }, output.outputFiles[0].text);
  expect(registered).toBe(true);
});

test('rapid slider seeks show the latest frame without a cancellation error panel', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const m = await import('/examples/shared/htmv/index.js');
    const c = await m.compile('<hv-composition id="seek" width="100" height="100" fps="30" duration="90f"></hv-composition>'); const r = await m.createRenderer(c);
    const player = document.createElement('hv-player') as any; player.renderer = r; player.setAttribute('controls', '');
    const ready = new Promise<void>((resolve) => player.addEventListener('hv-ready', () => resolve(), { once: true })); document.body.appendChild(player); await ready;
    const errors: string[] = []; const frames: number[] = [];
    player.addEventListener('hv-error', (event: any) => errors.push(event.detail.message));
    player.addEventListener('hv-frame', (event: any) => frames.push(event.detail.frame));
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const blocked = new Promise<void>((resolve) => { entered = resolve; });
    const prefetch = r.prefetchMedia.bind(r); let first = true;
    r.prefetchMedia = async (evaluation: any, signal: AbortSignal) => { if (first) { first = false; entered(); await gate; } await prefetch(evaluation, signal); };
    try {
      const latest = new Promise<void>((resolve) => player.addEventListener('hv-frame', (event: any) => { if (event.detail.frame === 20) resolve(); }));
      const seek = player.querySelector('.hv-seek'); seek.value = '10'; seek.dispatchEvent(new Event('input')); await blocked;
      seek.value = '20'; seek.dispatchEvent(new Event('input')); release(); await latest;
      await Promise.resolve(); return { frames, errors, errorPanel: !!player.querySelector('.hv-error-panel') };
    } finally { release(); player.remove(); await new Promise((resolve) => setTimeout(resolve, 0)); await r.dispose(); await c.dispose(); }
  });
  expect(result.frames).toEqual([20]); expect(result.errors).toEqual([]); expect(result.errorPanel).toBe(false);
});
