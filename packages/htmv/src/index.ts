/**
 * Umbrella public API (spec 13.1): compile / createRenderer / registerElements.
 * `auto` is the only intentionally side-effectful registration entry.
 */
export { CompiledCompositionImpl } from '@htmv/compiler';
export { compileBrowser as compile } from '@htmv/exporter';
export type { CompileOptions, ResourcePolicy, AssetLoadContext } from '@htmv/compiler';
export { RendererSession as createRendererImpl, registerElements } from './public.js';
export type { RendererSession } from '@htmv/exporter';
export { Rational, DiagnosticCodes, parseEasing } from '@htmv/core';
export type { Diagnostic, CompositionIR, FrameRange, JsonObject } from '@htmv/core';

/** createRenderer acquires session state against a compiled composition (spec 13.1). */
import type { CompiledCompositionImpl } from '@htmv/compiler';
import type { RendererSession } from '@htmv/exporter';
export async function createRenderer(compiled: CompiledCompositionImpl): Promise<RendererSession> {
  const renderer = new (await import('@htmv/exporter')).RendererSession(compiled);
  await renderer.initialize();
  return renderer;
}
