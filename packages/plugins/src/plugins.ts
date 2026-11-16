/**
 * Deterministic plugin interface (spec 14.1, 14.6). Plugins extend the
 * paint/media system, not the HTML expression language. Plugin JavaScript is
 * trusted application code: it is not sandboxed by the engine.
 */
import { Diagnostic, JsonObject, Rational } from '@htmv/core';

export interface HtmvPlugin {
  id: string;
  version: string;
  execution: 'main' | 'worker' | 'either';
  capabilities: readonly string[];
  validate(input: JsonObject): readonly Diagnostic[];
  prepare(context: PrepareContext): Promise<PreparedPlugin>;
}

export interface PrepareContext {
  width: number;
  height: number;
  props: Readonly<JsonObject>;
  /** Admitted asset readers: fetching is preparation-time only (spec 14.1). */
  readAsset(id: string): Promise<ArrayBuffer | null>;
  signal: AbortSignal;
  diagnostic(d: Diagnostic): void;
}

export interface PreparedPlugin {
  render(context: PluginFrameContext): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export interface PluginFrameContext {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  rootTime: Rational;
  localTime: Rational;
  frame: number;
  iteration: number;
  /** Read-only nested loop index path (spec 14.6). */
  iterationPath: readonly number[];
  props: Readonly<JsonObject>;
  /** Seeded deterministic randomness (spec 3.6): versioned hash/PRNG. */
  random(channel: string, sampleIndex: number): number;
  signal: AbortSignal;
}

export interface PluginRegistration {
  id: string;
  factory: () => HtmvPlugin;
}

const registry = new Map<string, HtmvPlugin>();

export function registerPlugin(plugin: HtmvPlugin): void {
  const existing = registry.get(plugin.id);
  if (existing && existing.version !== plugin.version) {
    throw new Error(`Plugin "${plugin.id}" already registered with a different version.`);
  }
  registry.set(plugin.id, plugin);
}

export function getRegisteredPlugin(id: string): HtmvPlugin | null {
  return registry.get(id) ?? null;
}

export function listRegisteredPlugins(): { id: string; version: string }[] {
  return [...registry.values()].map((p) => ({ id: p.id, version: p.version }));
}

/**
 * Plugin canvas leaves: `data-hv-plugin="registered-id"` with optional inert
 * JSON `data-hv-plugin-props` and explicit logical width/height (spec 14.1).
 * Unregistered canvas is rejected. A private surface protects painter state;
 * frame readiness awaits async render completion — timeout is an error.
 */
export const PLUGIN_TIMEOUT_MS = 5000;

export async function renderPluginLeaf(
  plugin: PreparedPlugin,
  context: PluginFrameContext
): Promise<void> {
  if (context.signal.aborted) throw new DOMException('Plugin render aborted', 'AbortError');
  const surface = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(context.width, context.height)
    : (context.ctx.canvas as HTMLCanvasElement).ownerDocument.createElement('canvas');
  surface.width = context.width; surface.height = context.height;
  const ctx = surface.getContext('2d') as PluginFrameContext['ctx'] | null;
  if (!ctx) { surface.width = surface.height = 0; throw new Error('Plugin rendering requires a 2D context.'); }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(new DOMException('Plugin render aborted', 'AbortError')); };
    context.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Plugin exceeded its ${PLUGIN_TIMEOUT_MS}ms render budget.`));
    }, PLUGIN_TIMEOUT_MS);
  });
  const rendering = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('Plugin render aborted', 'AbortError');
      return plugin.render({ ...context, ctx, signal: controller.signal });
  });
  try {
    await Promise.race([rendering, interrupted]);
    if (context.signal.aborted || controller.signal.aborted) throw new DOMException('Plugin render aborted', 'AbortError');
    context.ctx.save();
    try { context.ctx.drawImage(surface, 0, 0); }
    finally { context.ctx.restore(); }
  } finally {
    clearTimeout(timer); context.signal.removeEventListener('abort', abort);
    controller.abort(); surface.width = surface.height = 0;
    void rendering.then(() => { surface.width = surface.height = 0; }, () => { surface.width = surface.height = 0; });
  }
}
