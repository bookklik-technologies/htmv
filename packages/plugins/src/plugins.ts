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
 * Unregistered canvas is rejected. Engine save/restore protects painter state;
 * frame readiness awaits async render completion — timeout is an error.
 */
export const PLUGIN_TIMEOUT_MS = 5000;

export async function renderPluginLeaf(
  plugin: PreparedPlugin,
  context: PluginFrameContext
): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Plugin exceeded its ${PLUGIN_TIMEOUT_MS}ms render budget.`)), PLUGIN_TIMEOUT_MS);
  });
  context.ctx.save();
  try { await Promise.race([Promise.resolve().then(() => plugin.render(context)), timeout]); }
  finally { clearTimeout(timer!); context.ctx.restore(); }
}
