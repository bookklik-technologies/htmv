import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile } from '../../packages/compiler/src/compile.js';
import { FetchingAssetLoader } from '../../packages/compiler/src/assets.js';
import { DEFAULT_RESOURCE_POLICY } from '../../packages/compiler/src/resources.js';
import { parseInlineStyle, rewriteCssUrls, resolveCssAssetUrls, validateStylesheet } from '../../packages/compiler/src/css.js';
import { PlayerEngine } from '../../packages/player/src/engine.js';
import type { RendererSession } from '@htmv/exporter';

const source = (children = '') => `<hv-composition id="c" width="100" height="100" fps="30" duration="300f">${children}</hv-composition>`;
const asset = { id: 'data', kind: 'json' as const, src: 'https://fixture.test/data' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('CSS asset admission', () => {
  it('parses escaped/case-insensitive URLs and nested fallback URLs without splitting strings', async () => {
    const urls: string[] = [];
    const value = await rewriteCssUrls(String.raw`var(--photo,u\72l("/a(b);c.png"))`, async (url) => { urls.push(url); return 'asset:photo'; });
    expect(urls).toEqual(['/a(b);c.png']); expect(value).toContain('asset:photo');
    const inline = parseInlineStyle('--label:"semi;colon";background-image:URL("/a.png");color:red');
    expect(inline.diagnostics).toEqual([]); expect(inline.declarations).toHaveLength(3);
  });
  it('routes every custom-property/fallback URL through the configured loader', async () => {
    const load = vi.fn(async () => { throw new Error('denied by host'); });
    await expect(compile(source('<div style="--photo:URL(/secret.png);background-image:var(--photo)"></div>'), { baseURL: 'https://fixture.test/', assetLoader: { load } })).rejects.toThrow('denied by host');
    expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][0].src).toBe('https://fixture.test/secret.png');
  });
  it('resolves complete asset IDs and refuses raw or missing layout URLs', () => {
    const urls = new Map([['asset:photo.with.dot', 'blob:fixture']]);
    expect(resolveCssAssetUrls('background-image:url("asset:photo.with.dot")', urls, 'declarationList')).toContain('blob:fixture');
    for (const url of ['https://fixture.test/raw', 'asset:missing']) expect(() => resolveCssAssetUrls(`background-image:url("${url}")`, urls, 'declarationList')).toThrow(/prepared resource/);
  });
  it('drops unsupported fetching syntax in permissive mode and rejects imports in strict mode', async () => {
    expect(validateStylesheet('@import "/secret.css";div{color:red}').diagnostics.length).toBeGreaterThan(0);
    await expect(compile(source('<style>@import "/secret.css";</style>'))).rejects.toThrow('E_STYLE_UNSUPPORTED');
    const load = vi.fn();
    const c = await compile(source('<div style="--bad:image-set(\'/secret.png\' 1x);background-image:var(--bad);color:red"></div>'), { stylePolicy: 'ignore-unsupported', assetLoader: { load } });
    expect(load).not.toHaveBeenCalled(); expect([...c.timing.nodes.values()].find((n) => n.tag === 'div')!.attributes.style).not.toContain('image-set');
    await c.dispose();
  });
});

describe('bounded asset loading', () => {
  it('uses the selected desktop defaults', () => {
    expect(DEFAULT_RESOURCE_POLICY).toEqual({ maxAssetBytes: 256 * 1024 * 1024, maxTotalAssetBytes: 512 * 1024 * 1024, maxImageDimension: 8192, maxImagePixels: 33_554_432 });
  });
  it.each([0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid policy value %s', async (value) => {
    await expect(compile(source(), { resourcePolicy: { maxAssetBytes: value } })).rejects.toThrow('E_RESOURCE_LIMIT');
  });
  it.each([undefined, '1'])('cancels streamed overflow with content-length %s', async (length) => {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: length ? { 'content-length': length } : {} })));
    await expect(new FetchingAssetLoader({ resourcePolicy: { maxAssetBytes: 5 } }).load(asset)).rejects.toMatchObject({ code: 'E_RESOURCE_LIMIT' });
    expect(cancelled).toBe(true);
  });
  it('cancels an oversized declared response without reading it', async () => {
    let cancelled = false; let reads = 0;
    const body = new ReadableStream({ pull() { reads++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-length': '6' } })));
    await expect(new FetchingAssetLoader({ resourcePolicy: { maxAssetBytes: 5 } }).load(asset)).rejects.toMatchObject({ code: 'E_RESOURCE_LIMIT' });
    expect(reads).toBe(0); expect(cancelled).toBe(true);
  });
  it('accepts the exact limit and hashes integrity-checked bytes once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('12345')));
    const digest = vi.spyOn(crypto.subtle, 'digest');
    const result = await new FetchingAssetLoader({ integrityVerify: true, resourcePolicy: { maxAssetBytes: 5 } }).load({ ...asset, integrity: '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5' });
    expect(result.blob?.size).toBe(5); expect(digest).toHaveBeenCalledTimes(1);
  });
  it('aborts a stalled response and cancels its reader', async () => {
    let cancelled = false;
    const controller = new AbortController();
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const pending = new FetchingAssetLoader({ signal: controller.signal }).load(asset);
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cancelled).toBe(true);
  });
  it('preserves a string cancellation diagnostic through compilation', async () => {
    await expect(compile(source('<hv-assets><hv-asset id="a" kind="json" src="https://fixture.test/a"></hv-asset></hv-assets>'), { assetLoader: { load: async () => { throw new DOMException('fixture cancellation', 'AbortError'); } } })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'E_ABORTED' })] });
  });
  it('applies aggregate limits to custom loaders and reuses duplicate references', async () => {
    const declarations = '<hv-assets><hv-asset id="a" kind="json" src="https://fixture.test/a"></hv-asset><hv-asset id="b" kind="json" src="https://fixture.test/b"></hv-asset></hv-assets>';
    const load = vi.fn(async () => ({ blob: new Blob(['12345']) }));
    await expect(compile(source(declarations), { assetLoader: { load }, resourcePolicy: { maxAssetBytes: 5, maxTotalAssetBytes: 9 } })).rejects.toThrow('E_RESOURCE_LIMIT');
    const duplicate = declarations.replace('https://fixture.test/b', 'https://fixture.test/a'); load.mockClear();
    const c = await compile(source(duplicate), { assetLoader: { load }, resourcePolicy: { maxAssetBytes: 5, maxTotalAssetBytes: 5 } });
    expect(load).toHaveBeenCalledTimes(1); expect(c.resolvedAssets.get('a')).toBe(c.resolvedAssets.get('b')); await c.dispose();
    const raised = await compile(source(declarations), { assetLoader: { load }, resourcePolicy: { maxAssetBytes: 5, maxTotalAssetBytes: 10 } }); await raised.dispose();
  });
  it('rejects oversized supplied Blobs before invoking the loader', async () => {
    const load = vi.fn();
    await expect(compile(source('<hv-audio src="asset:music"></hv-audio>'), { assets: { music: new Blob(['123456']) }, assetLoader: { load }, resourcePolicy: { maxAssetBytes: 5 } })).rejects.toThrow('E_RESOURCE_LIMIT');
    expect(load).not.toHaveBeenCalled();
  });
  it('shares image admission between inline and CSS references and counts distinct CSS bytes', async () => {
    const load = vi.fn(async () => ({ blob: new Blob(['1234']), imageWidth: 1, imageHeight: 1 }));
    const children = '<img src="https://fixture.test/a"><div style="background-image:URL(https://fixture.test/a)"></div>';
    const c = await compile(source(children), { assetLoader: { load }, resourcePolicy: { maxAssetBytes: 4, maxTotalAssetBytes: 4 } });
    expect(load).toHaveBeenCalledTimes(1); await c.dispose();
    await expect(compile(source(children.replace('URL(https://fixture.test/a)', 'URL(https://fixture.test/b)')), { assetLoader: { load }, resourcePolicy: { maxAssetBytes: 4, maxTotalAssetBytes: 7 } })).rejects.toThrow('E_RESOURCE_LIMIT');
  });
  it('counts a reused supplied Blob once across declaration IDs', async () => {
    const blob = new Blob(['12345']); const load = vi.fn(async () => ({ blob }));
    const declarations = '<hv-assets><hv-asset id="a" kind="json" src="a"></hv-asset><hv-asset id="b" kind="json" src="b"></hv-asset></hv-assets>';
    const c = await compile(source(declarations), { assets: { a: blob, b: blob }, assetLoader: { load }, resourcePolicy: { maxTotalAssetBytes: 5 } });
    expect(load).toHaveBeenCalledTimes(1); await c.dispose();
  });
  it('closes rejected image bitmaps without trying another decoder', async () => {
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 8193, height: 1, close })));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('image')));
    await expect(new FetchingAssetLoader().load({ ...asset, kind: 'image' })).rejects.toMatchObject({ code: 'E_RESOURCE_LIMIT' }); expect(close).toHaveBeenCalledTimes(1);
  });
  it('checks custom image metadata against dimension and pixel limits', async () => {
    for (const [width, height] of [[8193, 1], [8192, 8192]]) {
      await expect(compile(source('<img src="https://fixture.test/image">'), { assetLoader: { load: async () => ({ blob: new Blob(['image']), imageWidth: width, imageHeight: height }) } })).rejects.toThrow('E_RESOURCE_LIMIT');
    }
    const imageSource = source('<img src="https://fixture.test/image">');
    const assetLoader = { load: async () => ({ blob: new Blob(['image']), imageWidth: 8193, imageHeight: 1 }) };
    const c = await compile(imageSource, { assetLoader, resourcePolicy: { maxImageDimension: 9000, maxImagePixels: 9000 } }); await c.dispose();
  });
  it('does not authorize unfrozen image URLs from metadata-only custom loaders', async () => {
    await expect(compile(source('<img src="https://fixture.test/image">'), { assetLoader: { load: async () => ({ imageWidth: 1, imageHeight: 1 }) } })).rejects.toThrow('frozen Blob');
  });
});

describe('bounded player presentation', () => {
  async function fixture() {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const c = await compile(source());
    const pending: { frame: number; finish(): void; close: ReturnType<typeof vi.fn> }[] = [];
    const renderer = { renderFrame: vi.fn((frame: number) => new Promise((resolve) => {
      const close = vi.fn(); pending.push({ frame, close, finish: () => resolve({ frame, image: {}, close }) });
    })) };
    const drawImage = vi.fn(); const events: number[] = [];
    const player = new PlayerEngine(c, renderer as unknown as RendererSession, { target: { getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement, onEvent: (name, detail) => { if (name === 'hv-frame') events.push((detail as { frame: number }).frame); } });
    return { c, pending, renderer, drawImage, events, player };
  }
  it('keeps one render active and replaces pending work with the latest frame', async () => {
    const f = await fixture(); await f.player.start(); await vi.advanceTimersByTimeAsync(350);
    expect(f.renderer.renderFrame).toHaveBeenCalledTimes(1);
    f.pending[0].finish(); await vi.advanceTimersByTimeAsync(0);
    expect(f.renderer.renderFrame).toHaveBeenCalledTimes(2); expect(f.pending[1].frame).toBeGreaterThanOrEqual(9);
    f.player.pause(); const shown = f.events.length; f.pending[1].finish(); await vi.advanceTimersByTimeAsync(100);
    expect(f.events).toHaveLength(shown); expect(f.pending[1].close).toHaveBeenCalledTimes(1); expect(f.renderer.renderFrame).toHaveBeenCalledTimes(2);
    f.player.stop(); await f.c.dispose();
  });
  it('rejects superseded seeks and presents only the latest seek while paused', async () => {
    const f = await fixture();
    const old = f.player.seekToFrame(10); const oldError = old.catch((e) => e);
    const latest = f.player.seekToFrame(20);
    expect((await oldError).name).toBe('AbortError');
    f.pending[0].finish(); await vi.advanceTimersByTimeAsync(0);
    expect(f.events).toEqual([]); expect(f.pending[0].close).toHaveBeenCalledTimes(1);
    f.pending[1].finish(); await latest; expect(f.events).toEqual([20]);
    f.player.stop(); expect(f.pending[1].close).toHaveBeenCalledTimes(1); await f.c.dispose();
  });
  it('does not display a late frame after stop', async () => {
    const f = await fixture(); await f.player.start(); f.player.stop(); f.pending[0].finish(); await vi.advanceTimersByTimeAsync(0);
    expect(f.drawImage).not.toHaveBeenCalled(); expect(f.pending[0].close).toHaveBeenCalledTimes(1); await f.c.dispose();
  });
});
