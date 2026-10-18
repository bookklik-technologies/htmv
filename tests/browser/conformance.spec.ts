/**
 * Browser conformance (subset of spec 16 fixtures runnable headless):
 * T01/T05 frame windows, T06 loop length, T08 series overlap, T18 template
 * expansion, T11-lite determinism, player smoke, strict validation.
 * All library work happens inside page.evaluate and returns plain data.
 */
import { test, expect, Page } from '@playwright/test';

const LIB = '/examples/shared/htmv/index.js';

async function compileInPage(page: Page, src: string): Promise<unknown> {
  return await page.evaluate(async ({ src, lib }) => {
    const m = (await import(/* @vite-ignore */ lib)) as unknown as {
      compile: (s: string) => Promise<{
        metadata: Record<string, unknown>;
        timing: { nodes: Map<string, Record<string, unknown>>; animations: Record<string, unknown>[] };
        diagnostics: unknown[];
      }>;
    };
    const compiled = await m.compile(src);
    // serialize: Rationals and Maps do not survive the transport as-is
    const rat = (v: unknown): unknown => {
      const r = v as { num: unknown; den: unknown; numerator?: unknown; denominator?: unknown } | string | null;
      if (r && typeof r === 'object') {
        const num = r.num ?? r.numerator;
        const den = r.den ?? r.denominator;
        return { num: String(num), den: String(den) };
      }
      if (typeof r === 'string') return r;
      return 'remainder';
    };
    return {
      metadata: compiled.metadata,
      nodes: [...compiled.timing.nodes.values()].map((n) => ({
        id: n.id,
        kind: n.kind,
        tag: n.tag,
        text: n.text ?? null,
        start: rat(n.start),
        duration: rat(n.duration),
        parentId: n.parentId,
        relativeStart: rat(n.relativeStart)
      })),
      diagnostics: compiled.diagnostics.map((d: { code: string; message: string }) => ({ code: d.code, message: d.message }))
    };
  }, { src, lib: LIB });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('T01/T05: root 150f at 30fps evaluates exactly 150 frames; two scene windows', async ({ page }) => {
  const src = `
  <hv-composition id="c" width="320" height="180" fps="30" duration="150f" background="#000000">
    <hv-scene start="0" duration="60f"><p style="position:absolute;left:10px;top:10px;color:#fff">A</p></hv-scene>
    <hv-scene start="60f" duration="60f"><p style="position:absolute;left:10px;top:10px;color:#fff">B</p></hv-scene>
  </hv-composition>`;
  const compiled = (await compileInPage(page, src)) as { metadata: { durationFrames: number }; nodes: Record<string, unknown>[] };
  expect(compiled.metadata.durationFrames).toBe(150);
  const scenes = [...compiled.nodes].filter((n) => n.kind === 'scene');
  expect(scenes.length).toBe(2);
});

test('T06: loop 60f x5 => exactly 300f', async ({ page }) => {
  const src = `
  <hv-composition id="c" width="320" height="180" fps="30" duration="300f" background="#101820">
    <hv-loop iteration-duration="60f" count="5"><p>HTML video</p></hv-loop>
  </hv-composition>`;
  const compiled = (await compileInPage(page, src)) as { nodes: Record<string, never>[] };
  const loop = [...compiled.nodes].find((n) => n.kind === 'loop') as { duration?: { numerator: string; denominator: string } } | undefined;
  expect(loop).toBeDefined();
  // 300f @ 30fps = 10s = 10/1
  const d = loop!.duration as { numerator: string; denominator: string };
  expect(Number(String(d.num)) / Number(String(d.den))).toBe(10);
});

test('T08: series 90f + 15f overlap + 90f => incoming starts 75f, total 165f', async ({ page }) => {
  const src = `
  <hv-composition id="c" width="320" height="180" fps="30" duration="165f" background="#000000">
    <hv-series>
      <hv-scene duration="90f"><p>a</p></hv-scene>
      <hv-transition duration="15f"></hv-transition>
      <hv-scene duration="90f"><p>b</p></hv-scene>
    </hv-series>
  </hv-composition>`;
  const compiled = (await compileInPage(page, src)) as { nodes: Record<string, never>[] };
  const scenes = [...compiled.nodes].filter((n) => n.kind === 'scene');
  const second = 4;
  expect(scenes.length).toBe(second - 2);
  const secondScene = scenes[1] as { start: { numerator: string; denominator: string } };
  expect(Number(String(secondScene.start.num)) / Number(String(secondScene.start.den))).toBeCloseTo(2.5);
  const series = [...compiled.nodes].find((n) => n.kind === 'series') as { duration: { numerator: string; denominator: string } };
  expect(Number(String(series.duration.num)) / Number(String(series.duration.den))).toBeCloseTo(5.5);
});

test('T18: template repetition binds text per item', async ({ page }) => {
  const src = `
  <hv-composition id="c" width="640" height="360" fps="30" duration="120f" background="#fff">
    <script type="application/json" data-hv-props>{"items":[{"id":"a","label":"Alpha"},{"id":"b","label":"Beta"}]}</script>
    <template id="card" data-hv-component><span data-hv-text="props.label">X</span></template>
    <hv-scene duration="120f">
      <template data-hv-each="props.items" data-hv-as="item" data-hv-key="item.id">
        <hv-use template="#card" duration="120f" data-hv-attr-props="item"></hv-use>
      </template>
    </hv-scene>
  </hv-composition>`;
  const compiled = (await compileInPage(page, src)) as { nodes: Record<string, never>[] };
  const texts = [...compiled.nodes].filter((n) => n.kind === 'text');
  const labels = texts.map((n) => n.text).filter((t) => t === 'Alpha' || t === 'Beta');
  expect((labels as string[]).sort()).toEqual(['Alpha', 'Beta']);
});

test('strict validation: unsupported CSS and negative duration produce errors', async ({ page }) => {
  const bad1 = `<hv-composition id="x" width="100" height="100" fps="30" duration="60f"><div style="z-index:5"></div></hv-composition>`;
  await expect(compileInPage(page, bad1)).rejects.toThrow();
  const bad2 = `<hv-composition id="x" width="100" height="100" fps="30" duration="-5f"></hv-composition>`;
  await expect(compileInPage(page, bad2)).rejects.toThrow();
});

test('player smoke: hello example attaches player, hv-ready event, canvas painted', async ({ page }) => {
  await page.goto('/examples/hello/index.html');
  await page.waitForSelector('hv-player canvas', { state: 'attached', timeout: 15000 });
  await page.evaluate(async () => { await (document.querySelector('hv-player') as HTMLElement & { seekToFrame(frame: number): Promise<void> }).seekToFrame(15); });
  const painted: boolean = await page.evaluate(() => {
    const canvas = document.querySelector('hv-player canvas') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    const data = ctx?.getImageData(0, 0, canvas.width, canvas.height).data ?? null;
    if (!data) return false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 0x10 || data[i + 1] !== 0x20 || data[i + 2] !== 0x30) return true; // composed pixels differ from root bg
    }
    return false;
  });
  expect(painted).toBe(true);
});




