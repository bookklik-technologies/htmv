/**
 * Public re-exports wiring (kept separate so `auto` registration stays
 * side-effectful and tree-shakable ESM entries remain clean, spec 12.1).
 */
export { registerElements, registerElements as registerElementsImpl } from '@htmv/elements';
export { RendererSession } from '@htmv/exporter';
