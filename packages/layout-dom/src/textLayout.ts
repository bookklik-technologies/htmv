import { TextLine } from './layoutDoc.js';
import LineBreaker from 'linebreak';

export interface FontSpec { family: string; px: number; weight: string; style: string }
export interface MetricsPolicy { baselineRatio: number }
export const DEFAULT_METRICS: MetricsPolicy = { baselineRatio: 0.85 };
export const BREAK_POLICY_VERSION = 'linebreak-1.1.0';
const measureCanvasCache = new WeakMap<Document, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();
export function getMeasureContext(doc: Document): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let entry = measureCanvasCache.get(doc);
  if (!entry) { const canvas = doc.createElement('canvas'); entry = { canvas, ctx: canvas.getContext('2d')! }; measureCanvasCache.set(doc, entry); }
  return entry;
}
export function canvasFontString(name: string): string { return name; }
export interface BreakCandidates { words: { start: number; end: number }[] }
export function breakCandidates(text: string): BreakCandidates {
  const breaker = new LineBreaker(text); const words: { start: number; end: number }[] = [];
  let start = 0; let next: { position: number; required: boolean } | null;
  while ((next = breaker.nextBreak())) { words.push({ start, end: next.position }); start = next.position; }
  if (start < text.length) words.push({ start, end: text.length });
  return { words };
}
export interface GraphemeSegments { segments: string[] }
export function graphemes(text: string): string[] {
  if (!Intl.Segmenter) throw new Error('E_TEXT_LAYOUT: grapheme segmentation is unavailable.');
  return [...new Intl.Segmenter('en-US', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
}
export interface TextLayoutInput {
  text: string; font: FontSpec; lineHeightPx: number; maxWidthPx: number;
  measure(doc: Document): CanvasRenderingContext2D;
  align: string; direction: string; whiteSpace: string; overflowWrap: string; textTransform?: string;
}
export interface TextLayoutResult { lines: string[]; metrics: { ascent: number; descent: number; lineHeightPx: number }; lineLayout: TextLine[] }
const layoutCache = new Map<string, TextLayoutResult>();
export function layoutText(input: TextLayoutInput): TextLayoutResult {
  // Include exact width, font environment and locale; never round away geometry changes.
  const ctx = input.measure(document);
  const key = JSON.stringify([input.text, input.font, input.lineHeightPx, input.maxWidthPx, input.align, input.direction, input.whiteSpace, input.overflowWrap, input.textTransform]);
  // Font bytes are session-local: a context-local cache avoids cross-session font collisions.
  const cached = contextCaches.get(ctx)?.get(key); if (cached) return cached;
  if (!Number.isFinite(input.maxWidthPx) || input.maxWidthPx <= 0) throw new Error('E_TEXT_LAYOUT: finite positive content width required.');
  ctx.font = `${input.font.style} ${input.font.weight} ${input.font.px}px ${input.font.family}`;
  ctx.direction = input.direction === 'rtl' ? 'rtl' : 'ltr';
  let text = input.text;
  if (input.textTransform === 'uppercase') text = text.toLocaleUpperCase('en-US');
  if (input.textTransform === 'lowercase') text = text.toLocaleLowerCase('en-US');
  const paragraphs = input.whiteSpace === 'normal'
    ? text.split('\u2028').map((part) => part.replace(/\s+/g, ' ').trim())
    : text.replace(/\r\n?/g, '\n').split(/[\n\u2028]/);
  const lines: string[] = []; const lineLayout: TextLine[] = [];
  const push = (raw: string): void => {
    const line = input.whiteSpace === 'normal' ? raw.replace(/ +$/, '') : raw;
    const width = ctx.measureText(line).width; const free = Math.max(0, input.maxWidthPx - width);
    const right = input.align === 'right' || (input.align === 'end' && input.direction !== 'rtl') || (input.align === 'start' && input.direction === 'rtl');
    const x = input.align === 'center' ? free / 2 : right ? free : 0;
    lineLayout.push({ text: line, width, x, y: lines.length * input.lineHeightPx + input.lineHeightPx * DEFAULT_METRICS.baselineRatio }); lines.push(line);
  };
  for (const paragraph of paragraphs) {
    if (input.whiteSpace === 'pre' || !paragraph) { push(paragraph); continue; }
    let line = '';
    for (const candidate of breakCandidates(paragraph).words) {
      let piece = paragraph.slice(candidate.start, candidate.end);
      const measure = (value: string): number => ctx.measureText(input.whiteSpace === 'normal' ? value.replace(/ +$/, '') : value).width;
      if (line && measure(line + piece) > input.maxWidthPx) { push(line); line = ''; if (input.whiteSpace === 'normal') piece = piece.replace(/^ +/, ''); }
      if (input.overflowWrap === 'anywhere' && measure(piece) > input.maxWidthPx) {
        for (const grapheme of graphemes(piece)) {
          if (line && measure(line + grapheme) > input.maxWidthPx) { push(line); line = ''; }
          line += grapheme;
        }
      } else line += piece;
    }
    if (line) push(line);
  }
  const metrics = ctx.measureText('Hx');
  const result = { lines, metrics: { ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent, lineHeightPx: input.lineHeightPx }, lineLayout };
  let cache = contextCaches.get(ctx); if (!cache) { cache = new Map(); contextCaches.set(ctx, cache); }
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!); cache.set(key, result);
  return result;
}
let contextCaches = new WeakMap<CanvasRenderingContext2D, Map<string, TextLayoutResult>>();
export function invalidateTextCache(): void { contextCaches = new WeakMap(); layoutCache.clear(); }
