import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rational } from '../../packages/core/src/rational.js';
import { CompilationError } from '../../packages/core/src/diagnostics.js';
import { paintFrame, indexBoxes, releasePaintSurfaces, releasePaintSurfacePool } from '../../packages/renderer-canvas/src/painter.js';
import type { Evaluation, NodeState } from '../../packages/renderer-canvas/src/evaluate.js';
import type { LayoutBox } from '../../packages/layout-dom/src/layoutDoc.js';
import { buildLayoutDom, buildLayoutDomAsync, LayoutSession, parseTransformFunctions } from '../../packages/layout-dom/src/snapshot.js';
import type { TimingResult } from '../../packages/compiler/src/timing.js';
import { PLUGIN_TIMEOUT_MS, renderPluginLeaf } from '../../packages/plugins/src/plugins.js';
import type { PluginFrameContext, PreparedPlugin } from '../../packages/plugins/src/plugins.js';
import { playerErrorDetail } from '../../packages/player/src/engine.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function canvases() {
  const created: FakeCanvas[] = [];
  const text: string[] = [];
  class FakeCanvas {
    width = 100;
    height = 100;
    ctx: CanvasRenderingContext2D;
    constructor(..._size: number[]) {
      const state = {
        canvas: this, globalAlpha: 1, globalCompositeOperation: 'source-over',
        save: vi.fn(), restore: vi.fn(), reset: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
        fillText: vi.fn((value: string) => { text.push(value); }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      };
      this.ctx = new Proxy(state, { get(target, property) { return property in target ? Reflect.get(target, property) : vi.fn(); } }) as unknown as CanvasRenderingContext2D;
      created.push(this);
    }
    getContext() { return this.ctx; }
  }
  vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  return { FakeCanvas, created, text };
}

function box(id: string, children: LayoutBox[] = [], opacity = 1): LayoutBox {
  return {
    id, tag: 'div', kind: 'text', x: 0, y: 0, width: 100, height: 100, children,
    display: true, visibility: 'visible', overflowHidden: false, borderRadiusPx: [0, 0, 0, 0],
    lines: [{ text: id, x: 0, y: 10, width: 10 }],
    computed: {
      opacity, backgroundColor: 'transparent', backgroundImage: null, color: 'black',
      borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,
      fontStyle: 'normal', fontWeight: '400', fontSize: 10, fontFamily: 'sans-serif',
      direction: 'ltr', textDecorationLine: ''
    } as LayoutBox['computed']
  };
}

function evaluation(boxes: LayoutBox[]): Evaluation {
  return {
    frame: 0, time: Rational.zero(), states: new Map(boxes.map((entry) => [entry.id, {} as NodeState])),
    animatedValues: new Map(), captionsVisible: [], transitions: [], mediaRequests: new Map(), warnings: []
  };
}

describe('transition painting and isolated surfaces', () => {
  it.each(['crossfade', 'slide', 'wipe'])('paints an incoming-first %s pair once', (type) => {
    const { FakeCanvas, text } = canvases();
    const target = new FakeCanvas();
    const incoming = box('incoming'); const outgoing = box('outgoing');
    const root = box('root', [incoming, outgoing]); const boxes = [root, incoming, outgoing];
    const frame = evaluation(boxes);
    frame.transitions.push({ type, direction: 'left', progress: 0.5, outgoingId: outgoing.id, incomingId: incoming.id });
    paintFrame({ ctx: target.ctx, width: 100, height: 100, background: 'black', boxIndex: indexBoxes(boxes), media: null }, frame);
    expect(text.filter((value) => value === 'incoming')).toHaveLength(1);
    expect(text.filter((value) => value === 'outgoing')).toHaveLength(1);
  });

  it('does not hide an incoming node when its outgoing node is inactive', () => {
    const { FakeCanvas, text } = canvases(); const target = new FakeCanvas();
    const incoming = box('incoming'); const outgoing = box('outgoing');
    const root = box('root', [incoming, outgoing]); const boxes = [root, incoming, outgoing];
    const frame = evaluation(boxes); frame.states.delete('outgoing');
    frame.transitions.push({ type: 'crossfade', direction: 'left', progress: 0.5, outgoingId: 'outgoing', incomingId: 'incoming' });
    paintFrame({ ctx: target.ctx, width: 100, height: 100, background: 'black', boxIndex: indexBoxes(boxes), media: null }, frame);
    expect(text).toEqual(['root', 'incoming']);
  });

  it('reuses surfaces across groups and frames, then releases backing storage explicitly', () => {
    const { FakeCanvas, created } = canvases(); const target = new FakeCanvas();
    const children = Array.from({ length: 12 }, (_, index) => box(`group-${index}`, [], 0.5));
    const root = box('root', children); const boxes = [root, ...children];
    const paint = { ctx: target.ctx, width: 100, height: 100, background: 'black', boxIndex: indexBoxes(boxes), media: null };
    paintFrame(paint, evaluation(boxes)); paintFrame(paint, evaluation(boxes));
    expect(created).toHaveLength(2); expect(created[1].width).toBe(100); expect(created[1].height).toBe(100);
    expect(created[1].ctx.reset).toHaveBeenCalledTimes(23);
    expect(target.ctx.drawImage).toHaveBeenCalledTimes(24);
    releasePaintSurfaces(target as unknown as HTMLCanvasElement);
    expect(created[1].width).toBe(0); expect(created[1].height).toBe(0);
    paintFrame(paint, evaluation(boxes)); expect(created).toHaveLength(3);
    releasePaintSurfaces(target as unknown as HTMLCanvasElement);
  });

  it('resizes idle entries rather than exhausting the pool after dimension changes', () => {
    const { FakeCanvas, created } = canvases(); const target = new FakeCanvas();
    const root = box('root', [], 0.5);
    for (let size = 100; size < 120; size++) {
      paintFrame({ ctx: target.ctx, width: size, height: size, background: 'black', boxIndex: indexBoxes([root]), media: null }, evaluation([root]));
    }
    expect(created).toHaveLength(2); expect(created[1].width).toBe(119);
    releasePaintSurfaces(target as unknown as HTMLCanvasElement);
  });

  it('returns borrowed surfaces after hitting the nesting budget and releases them on disposal', () => {
    const { FakeCanvas, created } = canvases(); const target = new FakeCanvas();
    const boxes = [box('deepest', [], 0.5)];
    for (let index = 0; index < 9; index++) boxes.push(box(`parent-${index}`, [boxes[boxes.length - 1]], 0.5));
    boxes.reverse();
    let failure: unknown;
    try { paintFrame({ ctx: target.ctx, width: 100, height: 100, background: 'black', boxIndex: indexBoxes(boxes), media: null }, evaluation(boxes)); }
    catch (reason) { failure = reason; }
    expect(failure).toMatchObject({ code: 'E_RESOURCE_LIMIT' });
    expect(created).toHaveLength(9);
    expect(target.ctx.save).toHaveBeenCalledTimes(1); expect(target.ctx.restore).toHaveBeenCalledTimes(1);
    const shallow = box('shallow', [], 0.5);
    paintFrame({ ctx: target.ctx, width: 100, height: 100, background: 'black', boxIndex: indexBoxes([shallow]), media: null }, evaluation([shallow]));
    expect(created).toHaveLength(9);
    releasePaintSurfaces(target as unknown as HTMLCanvasElement);
    expect(created.slice(1).every((surface) => surface.width === 0 && surface.height === 0)).toBe(true);
  });

  it('keeps destination pools independent when one renderer is disposed', () => {
    const { FakeCanvas, created } = canvases(); const first = new FakeCanvas(); const second = new FakeCanvas();
    const root = box('root', [], 0.5);
    const paint = { width: 100, height: 100, background: 'black', boxIndex: indexBoxes([root]), media: null };
    paintFrame({ ...paint, ctx: first.ctx }, evaluation([root]));
    paintFrame({ ...paint, ctx: second.ctx }, evaluation([root]));
    releasePaintSurfaces(first as unknown as HTMLCanvasElement);
    expect(created[2].width).toBe(0); expect(created[3].width).toBe(100);
    paintFrame({ ...paint, ctx: second.ctx }, evaluation([root])); expect(created).toHaveLength(4);
    releasePaintSurfaces(second as unknown as HTMLCanvasElement);
  });

  it('reuses an explicit session pool across fresh export destinations', () => {
    const { FakeCanvas, created } = canvases(); const surfacePool: HTMLCanvasElement[] = [];
    const root = box('root', [], 0.5);
    let retained: HTMLCanvasElement | undefined;
    for (let frame = 0; frame < 4; frame++) {
      const target = new FakeCanvas();
      paintFrame({ ctx: target.ctx, width: 100, height: 100, background: 'black', boxIndex: indexBoxes([root]), media: null, surfacePool }, evaluation([root]));
      retained ??= surfacePool[0];
      expect(surfacePool).toHaveLength(1); expect(surfacePool[0]).toBe(retained);
    }
    expect(created).toHaveLength(5);
    releasePaintSurfacePool(surfacePool);
    expect(surfacePool).toHaveLength(0); expect(retained!.width).toBe(0); expect(retained!.height).toBe(0);
  });
});

function pluginContext(ctx: CanvasRenderingContext2D, signal = new AbortController().signal): PluginFrameContext {
  return { ctx, width: 100, height: 100, rootTime: Rational.zero(), localTime: Rational.zero(), frame: 0, iteration: 0, iterationPath: [], props: {}, random: () => 0, signal };
}

describe('transactional plugin rendering', () => {
  it('commits once only after asynchronous success, without exposing the destination', async () => {
    const { FakeCanvas, created } = canvases(); const target = new FakeCanvas(); const pending = gate();
    let supplied: PluginFrameContext | undefined;
    const render = vi.fn(async (context: PluginFrameContext) => { supplied = context; context.ctx.fillRect(0, 0, 10, 10); await pending.promise; });
    const completion = renderPluginLeaf({ render, dispose() {} }, pluginContext(target.ctx));
    await Promise.resolve();
    expect(supplied!.ctx).not.toBe(target.ctx); expect(target.ctx.drawImage).not.toHaveBeenCalled();
    pending.release(); await completion;
    expect(target.ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(target.ctx.fillRect).not.toHaveBeenCalled(); expect(created[1].width).toBe(0);
  });

  it.each([false, true])('never commits a failed plugin (async=%s)', async (asyncFailure) => {
    const { FakeCanvas, created } = canvases(); const target = new FakeCanvas();
    const render: PreparedPlugin['render'] = (context) => {
      context.ctx.fillRect(0, 0, 10, 10);
      if (asyncFailure) return Promise.reject(new Error('plugin failure'));
      throw new Error('plugin failure');
    };
    await expect(renderPluginLeaf({ render, dispose() {} }, pluginContext(target.ctx))).rejects.toThrow('plugin failure');
    expect(target.ctx.drawImage).not.toHaveBeenCalled(); expect(created[1].width).toBe(0);
  });

  it('aborts timed-out work and contains late zombie drawing and rejection', async () => {
    vi.useFakeTimers();
    const { FakeCanvas, created } = canvases(); const target = new FakeCanvas(); const pending = gate();
    let supplied: PluginFrameContext | undefined;
    const completion = renderPluginLeaf({ async render(context) {
      supplied = context; await pending.promise;
      context.ctx.canvas.width = 100; context.ctx.fillRect(0, 0, 100, 100);
      throw new Error('late rejection');
    }, dispose() {} }, pluginContext(target.ctx));
    const rejected = expect(completion).rejects.toThrow('render budget');
    await vi.advanceTimersByTimeAsync(PLUGIN_TIMEOUT_MS); await rejected;
    expect(supplied!.signal.aborted).toBe(true); expect(target.ctx.drawImage).not.toHaveBeenCalled();
    pending.release(); await vi.advanceTimersByTimeAsync(0);
    expect(target.ctx.fillRect).not.toHaveBeenCalled(); expect(created[1].width).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects promptly on caller cancellation and does not run an already-aborted render', async () => {
    const { FakeCanvas } = canvases(); const target = new FakeCanvas(); const controller = new AbortController();
    const pending = gate(); let signal: AbortSignal | undefined;
    const render = vi.fn(async (context: PluginFrameContext) => { signal = context.signal; await pending.promise; });
    const completion = renderPluginLeaf({ render, dispose() {} }, pluginContext(target.ctx, controller.signal));
    await Promise.resolve(); controller.abort();
    await expect(completion).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal!.aborted).toBe(true); expect(target.ctx.drawImage).not.toHaveBeenCalled();
    pending.release();
    await expect(renderPluginLeaf({ render, dispose() {} }, pluginContext(target.ctx, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe('layout readiness and diagnostics', () => {
  it('rejects matrix3d with a structured diagnostic instead of silently dropping it', () => {
    expect(parseTransformFunctions('matrix(1, 0, 0, 1, 20, 30)')).toEqual([{ fn: 'matrix', args: [1, 0, 0, 1, 20, 30] }]);
    try { parseTransformFunctions('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)'); throw new Error('accepted matrix3d'); }
    catch (failure) { expect(failure).toBeInstanceOf(CompilationError); expect((failure as CompilationError).diagnostics[0].code).toBe('E_STYLE_UNSUPPORTED'); }
  });

  it('waits for font readiness in async capture and rejects premature synchronous capture', async () => {
    const pending = gate(); const reflow = vi.fn(() => 0);
    const doc = {
      body: { replaceChildren: vi.fn(), get offsetHeight() { return reflow(); } },
      head: { querySelector: () => null, appendChild: vi.fn() },
      createElement: () => ({ setAttribute: vi.fn(), textContent: '' }),
      fonts: { status: 'loading', ready: pending.promise }
    } as unknown as Document;
    const session = new LayoutSession(); vi.spyOn(session, 'ensureDocument').mockReturnValue(doc);
    const timing = { nodes: new Map() } as TimingResult;
    const options = { width: 100, height: 100, background: 'black', cssText: '', rootFontPx: 16 };
    expect(() => buildLayoutDom(session, timing, options)).toThrow('Fonts are still loading');
    let complete = false;
    const result = buildLayoutDomAsync(session, timing, options).then((snapshot) => { complete = true; return snapshot; });
    await Promise.resolve(); expect(complete).toBe(false); expect(reflow).toHaveBeenCalledTimes(2);
    pending.release(); expect((await result).boxes).toEqual([]);
  });
});

describe('player errors and registration', () => {
  it('preserves diagnostic payloads and normalizes thrown primitives', () => {
    const diagnostics = [{ severity: 'error' as const, code: 'E_FIXTURE', message: 'fixture', recoverable: false }];
    expect(playerErrorDetail({ message: 'fixture', diagnostics }).diagnostics).toBe(diagnostics);
    expect(playerErrorDetail('plain failure')).toEqual({ message: 'plain failure', diagnostics: [{ severity: 'error', code: 'E_PLAYER', message: 'plain failure', recoverable: false }] });
    expect(playerErrorDetail({ code: 'E_RESOURCE_LIMIT', message: 'limit' }).diagnostics[0].code).toBe('E_RESOURCE_LIMIT');
    expect(playerErrorDetail(null).message).toBe('null');
  });

  it('makes repeated registration across module instances idempotent but rejects another prefix', async () => {
    const definitions = new Map<string, CustomElementConstructor>();
    const define = vi.fn((name: string, constructor: CustomElementConstructor) => { definitions.set(name, constructor); });
    const canvas = { style: { objectFit: 'contain' } };
    vi.stubGlobal('HTMLElement', class {
      querySelector() { return canvas; }
      getAttribute(name: string) { return name === 'for' ? 'composition' : null; }
    });
    vi.stubGlobal('customElements', { get: (name: string) => definitions.get(name), define });
    vi.stubGlobal('document', { createElement: () => ({ textContent: '' }), head: { appendChild: vi.fn() } });
    const first = await import('../../packages/elements/src/elements.js'); first.registerElements();
    const Player = definitions.get('hv-player')!;
    const player = new Player() as unknown as {
      auto: unknown; lastSource: string; engine: unknown;
      attach(): Promise<void>; schedule(): void;
      attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    };
    const schedule = vi.spyOn(player, 'schedule').mockImplementation(() => {});
    player.attributeChangedCallback('fit', 'contain', 'cover');
    expect(canvas.style.objectFit).toBe('cover'); expect(schedule).not.toHaveBeenCalled();
    const setLoop = vi.fn(); player.engine = { setLoop };
    player.attributeChangedCallback('loop', null, ''); expect(setLoop).toHaveBeenCalledWith(true);
    let sourceColor = 'red'; let playerBusy = false;
    const composition = {
      localName: 'hv-composition',
      cloneNode() {
        let nested = true;
        return {
          querySelectorAll: () => [{ remove: () => { nested = false; } }],
          get outerHTML() { return `<hv-composition style="color:${sourceColor}">${nested ? `<hv-player aria-busy="${playerBusy}"></hv-player>` : ''}</hv-composition>`; }
        };
      }
    };
    Object.assign(document, { getElementById: () => composition });
    let notify!: () => void;
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe() {} disconnect() {}
    });
    player.auto = {}; player.lastSource = '<hv-composition style="color:red"></hv-composition>';
    await player.attach(); playerBusy = true; notify();
    expect(schedule).not.toHaveBeenCalled();
    sourceColor = 'blue'; notify(); expect(schedule).toHaveBeenCalledTimes(1);
    const count = define.mock.calls.length;
    vi.resetModules();
    const second = await import('../../packages/elements/src/elements.js'); second.registerElements();
    expect(define).toHaveBeenCalledTimes(count); expect(second.isRegistered()).toBe(true);
    expect(() => second.registerElements({ prefix: 'other' })).toThrow('already registered');
  });

  it('does not trust registration records belonging to another engine version', async () => {
    vi.resetModules();
    const incompatible = class {} as unknown as CustomElementConstructor;
    vi.stubGlobal('customElements', {
      get: (name: string) => name === 'hv-player' ? incompatible : undefined,
      [Symbol.for('@htmv/elements/registration/0.0.0')]: { prefix: 'hv', player: incompatible }
    });
    const elements = await import('../../packages/elements/src/elements.js');
    expect(() => elements.registerElements()).toThrow('hv-player is already defined');
  });
});
