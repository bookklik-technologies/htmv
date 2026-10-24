/**
 * Renderer session (spec 12.6, 13.1): owns layout snapshot, asset registries,
 * font environment, media readers, canonical evaluation/painting. Export pins
 * the revision; interactive rendering pauses during export (spec 12.6).
 */
import { Rational, Diagnostic, error, FrameRange } from '@htmv/core';
import type { CompiledCompositionImpl } from '@htmv/compiler';
import { checkImageDimensions, resolveCssAssetUrls } from '@htmv/compiler';
import type { ResourcePolicy } from '@htmv/compiler';
import { LayoutSession, buildLayoutDom, LayoutBox } from '@htmv/layout-dom';
import { evaluateFrame, Evaluation, MediaRequest } from '@htmv/renderer-canvas';
import { paintFrame, indexBoxes, inspectPaintFrame } from './paint.js';
import { canonicalEasing } from './evaluator.js';
import type { MediaReader, MediaReaderOpenOptions, MediaInspection, DecodedVideoFrame } from '@htmv/media';
import { getMediabunnyAdapter, MediabunnyMuxer, MuxerPlan } from '@htmv/media-mediabunny';
import { runPreflight } from './preflight.js';
import { createWriterSession } from './writers.js';
import { buildManifest } from './manifest.js';
import { mixAudioBlockCanonical, BlockMixResult } from './blockmix.js';
import { renderCaptionsSidecar } from './captions.js';
import { PreparedPlugin, renderPluginLeaf } from '@htmv/plugins';
import { randomV1Sync, sha256Hex, JsonObject } from '@htmv/core';
import type { CapabilityReport, ExportConfiguration, OutputTarget, ExportResult, RenderProgress, RenderManifest } from './types.js';

export type RendererState = 'initializing' | 'ready' | 'rendering' | 'exporting' | 'error' | 'disposing' | 'disposed';

export interface FrameResult {
  readonly frame: number;
  readonly image: ImageBitmap;
  readonly revisionHash: string;
  close(): void;
}

export interface PreflightOptions {
  profile: 'mp4' | 'webm' | 'auto';
  allowedProfiles?: readonly ('mp4' | 'webm')[];
  range?: FrameRange;
  videoBitrate?: number;
  audioBitrate?: number;
  syncPolicy?: 'certified' | 'allow-unverified';
}

export interface ExportOptions {
  configuration: ExportConfiguration;
  target: OutputTarget;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
}

export type { CapabilityReport, ExportConfiguration, OutputTarget, ExportResult, RenderProgress, RenderManifest, FrameRange, Diagnostic };

/** Media reader cache per node id, keyed by src + options. */
interface MediaHandle {
  reader: MediaReader;
  inspection: MediaInspection | null;
  source: string;
  generation: number;
}

export class RendererSession {
  readonly revisionHash: string;
  state: RendererState = 'initializing';
  private compiled: CompiledCompositionImpl;
  private layout = new LayoutSession();
  private boxIndex = new Map<string, LayoutBox>();
  private imageCache = new Map<string, ImageBitmap | HTMLImageElement>();
  private mediaHandles = new Map<string, MediaHandle>();
  private pendingHandles = new Map<string, Promise<MediaHandle | null>>();
  private fonts: FontFace[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private inspectionContext: CanvasRenderingContext2D | null = null;
  private errorState: Diagnostic | null = null;
  private imageURLs = new Map<string, string>();
  private imageSizes = new Map<string, { width: number; height: number }>();
  private ownedURLs: string[] = [];
  private frameQueue: Promise<unknown> = Promise.resolve();
  private lifetime = new AbortController();
  private configurations = new WeakSet<ExportConfiguration>();
  private pluginLeaves = new Map<string, { prepared: PreparedPlugin; width: number; height: number; props: JsonObject }>();
  private pluginSurfaces = new Map<string, OffscreenCanvas>();
  private exportTask: Promise<ExportResult> | null = null;
  private resourcePeaks = { decodedFramesMax: 0, pcmBlockBytesMax: 0 };
  resetResourceMeasurements(): void { this.resourcePeaks = { decodedFramesMax: this.decodedVideo.size, pcmBlockBytesMax: 0 }; }
  resourceMeasurements(): Readonly<typeof this.resourcePeaks> { return { ...this.resourcePeaks }; }
  private disposalTask: Promise<void> | null = null;
  get metadata() { return this.compiled.metadata; }
  get composition(): CompiledCompositionImpl { return this.compiled; }
  async whenIdle(): Promise<void> { await this.frameQueue; try { await this.exportTask; } catch { /* already reported */ } }

  constructor(compiled: CompiledCompositionImpl) {
    compiled.acquire();
    this.compiled = compiled;
    this.revisionHash = compiled.revisionHash;
  }

  async initialize(options?: { assets?: Record<string, Blob | File> }): Promise<void> {
    if (this.state !== 'initializing') return;
    try {
      // exact font faces registered into the layout document's font set (spec 7.5)
      const fontAssets = this.compiled.ir.assets.filter((a) => a.kind === 'font');
      for (const font of fontAssets) {
        const blob = options?.assets?.[font.id] ?? this.compiled.resolvedAssets.get(font.id)?.blob;
        if (!blob) throw error('E_ASSET_FETCH', `Font ${font.id} has no frozen bytes.`);
        const bytes = await blob.arrayBuffer();
        const face = new FontFace(font.family ?? 'Htmv', bytes, { weight: font.weight ?? '400', style: font.fontStyle ?? 'normal' });
        await face.load();
        document.fonts.add(face);
        this.fonts.push(face);
        const doc = this.layout.ensureDocument(this.compiled.metadata.width, this.compiled.metadata.height);
        doc.fonts.add(face);
      }
      // images must finish decode before use (spec 8.6)
      const preparedImages = new Map<Blob, { src: string; bitmap: ImageBitmap | HTMLImageElement }>();
      for (const asset of this.compiled.ir.assets.filter((a) => a.kind === 'image')) {
        const srcKey = `asset:${asset.id}`;
        const blob = this.assetBlob(srcKey);
        const prepared = blob ? preparedImages.get(blob) : undefined;
        const src = prepared?.src ?? (blob ? this.ownURL(blob) : resolveSrc(srcKey, this.compiled, options?.assets));
        if (!src) {
          throw error('E_ASSET_FETCH', `Image asset "${srcKey}" could not be resolved.`);
        }
        const bitmap = prepared?.bitmap ?? await loadImage(src, this.compiled.resourcePolicy);
        if (blob) preparedImages.set(blob, { src, bitmap });
        this.imageCache.set(srcKey, bitmap);
        this.imageCache.set(src, bitmap);
        this.imageURLs.set(srcKey, src);
        this.imageSizes.set(srcKey, { width: bitmap.width, height: bitmap.height });
      }
      for (const node of this.compiled.timing.nodes.values()) if (node.kind === 'image') {
        const image = this.imageCache.get(node.attributes.src); if (image) this.imageCache.set(node.id, image);
      }
      // layout snapshot in the isolated document (spec 8.1 step 3)
      const result = buildLayoutDom(this.layout, this.compiled.timing, {
        width: this.compiled.metadata.width,
        height: this.compiled.metadata.height,
        background: this.compiled.metadata.background,
        cssText: this.layoutCss,
        rootFontPx: 16, imageURLs: this.imageURLs, imageSizes: this.imageSizes
      });
      this.boxIndex = indexBoxes(result.boxes);
      if (this.compiled.fontPolicy === 'portable') {
        const families = new Set(fontAssets.map((font) => font.family));
        for (const box of this.boxIndex.values()) if (box.kind === 'text' || box.kind === 'captions') {
          const family = box.computed.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
          if (!families.has(family)) throw error('E_ASSET_FETCH', `Portable rendering requires an admitted exact font for ${box.id}; ${family} is a system/fallback font.`);
        }
      }
      for (const node of this.compiled.timing.nodes.values()) {
        if (node.kind !== 'plugin') continue;
        const plugin = this.compiled.pluginInstances.find((p) => p.id === node.attributes['data-hv-plugin']);
        if (!plugin) throw error('E_ELEMENT_UNSUPPORTED', `Plugin for ${node.id} is unavailable.`);
        const width = Number(node.attributes.width); const height = Number(node.attributes.height);
        const props = Object.freeze(JSON.parse(node.attributes['data-hv-plugin-props'] ?? '{}')) as JsonObject;
        const prepared = await plugin.prepare({ width, height, props, signal: this.lifetime.signal, diagnostic: (d) => { if (d.severity === 'error') throw d; }, readAsset: async (id) => await this.compiled.resolvedAssets.get(id)?.blob?.arrayBuffer() ?? null });
        this.pluginLeaves.set(node.id, { prepared, width, height, props });
      }
      this.state = 'ready';
    } catch (e) {
      this.state = 'error';
      this.errorState = error('E_ASSET_FETCH', `Renderer initialization failed: ${(e as Error).message}`);
      await this.dispose();
      throw e;
    }
  }

  getLastError(): Diagnostic | null {
    return this.errorState;
  }

  /** renderFrame returns a caller-owned bitmap; calls are serialized (spec 13.1). */
  async renderFrame(frame: number, options?: { signal?: AbortSignal }): Promise<FrameResult> {
    return this.requestFrame(frame, options);
  }

  private async requestFrame(frame: number, options?: { signal?: AbortSignal }, transparent = false): Promise<FrameResult> {
    this.assertReady();
    if (this.exportTask) {
      throw error('E_BUSY', 'Interactive frame rendering is paused during export; create a separate rendering session.');
    }
    const N = this.compiled.metadata.durationFrames;
    if (!Number.isInteger(frame) || frame < 0 || frame >= N) {
      throw error('E_TIME_UNIT', `Frame ${frame} is outside [0, ${N - 1}]; requests outside the range are rejected, not clamped.`);
    }
    const operation = this.frameQueue.then(() => this.renderFrameNow(frame, options, transparent));
    this.frameQueue = operation.catch(() => undefined);
    return operation;
  }

  private async renderFrameNow(frame: number, options?: { signal?: AbortSignal }, transparent = false): Promise<FrameResult> {
    this.assertReady();
    if (options?.signal?.aborted || this.lifetime.signal.aborted) throw new DOMException('Render aborted', 'AbortError');
    this.state = 'rendering';
    try {
      const evaluation = this.evaluate(frame);
      await this.prefetchMedia(evaluation, options?.signal);
      if (options?.signal?.aborted || this.lifetime.signal.aborted) throw new DOMException('Render aborted', 'AbortError');
      const canvas = this.ensureCanvas();
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      this.paintTo(ctx, evaluation, transparent);
      const image = await createImageBitmap(canvas);
      if (options?.signal?.aborted || this.lifetime.signal.aborted) { image.close(); throw new DOMException('Render aborted', 'AbortError'); }
      return {
        frame,
        image,
        revisionHash: this.revisionHash,
        close: () => {
          image.close();
        }
      };
    } finally {
      if (this.state === 'rendering') this.state = 'ready';
    }
  }

  async renderStill(options: { frame: number; type: 'png' | 'jpeg'; quality?: number; transparent?: boolean; signal?: AbortSignal }): Promise<Blob> {
    if (options.transparent && options.type !== 'png') throw error('E_ROOT', 'Transparent stills require PNG.');
    const result = await this.requestFrame(options.frame, { signal: options.signal }, options.transparent);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.compiled.metadata.width;
      canvas.height = this.compiled.metadata.height;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(result.image, 0, 0);
      return await canvasToBlob(canvas, options.type, options.quality ?? 0.92);
    } finally {
      result.close();
    }
  }

  async preflight(options: PreflightOptions): Promise<CapabilityReport> {
    this.assertReady();
    const fps = Rational.of(BigInt(this.compiled.metadata.fps.numerator), BigInt(this.compiled.metadata.fps.denominator));
    const hasAudio = [...this.compiled.timing.nodes.values()].some(
      (n) => n.kind === 'audio' || (n.kind === 'video' && n.media?.audio === 'include')
    );
    const range = options.range ?? { from: 0, toExclusive: this.compiled.metadata.durationFrames };
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.toExclusive) || range.from < 0 || range.from >= range.toExclusive || range.toExclusive > this.compiled.metadata.durationFrames) throw error('E_TIME_UNIT', 'Invalid export range.');
    const report = await runPreflight({
      width: this.compiled.metadata.width,
      height: this.compiled.metadata.height,
      fps,
      range: options.range ?? { from: 0, toExclusive: this.compiled.metadata.durationFrames },
      revisionHash: this.revisionHash,
      hasAudio,
      audio: { channels: this.compiled.metadata.channels, sampleRate: this.compiled.metadata.sampleRate },
      requested: options.profile,
      allowedProfiles: options.allowedProfiles,
      videoBitrate: options.videoBitrate,
      audioBitrate: options.audioBitrate,
      syncPolicy: options.syncPolicy
    });
    if (report.selected) this.configurations.add(report.selected);
    return report;
  }

  async exportVideo(options: ExportOptions): Promise<ExportResult> {
    this.assertReady();
    if (!this.configurations.has(options.configuration) || options.configuration.revisionHash !== this.revisionHash) throw error('E_BUSY', 'Export requires an unchanged configuration issued by this renderer preflight.');
    if (this.exportTask) {
      throw error('E_BUSY', 'An export is already running on this renderer.');
    }
    const execute = async (): Promise<ExportResult> => {
      await this.frameQueue;
      this.assertReady();
      if (this.lifetime.signal.aborted) throw new DOMException('Export aborted', 'AbortError');
      this.state = 'exporting';
      const { exportRange } = await import('./scheduler.js');
      return exportRange(
        { composition: this.compiled, configuration: options.configuration, target: options.target, signal: AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]), session: this },
        { onProgress: options.onProgress }
      );
    };
    this.exportTask = execute();
    try {
      return await this.exportTask;
    } finally {
      this.exportTask = null;
      if (this.state === 'exporting') this.state = 'ready';
    }
  }

  async renderCaptions(options?: { range?: FrameRange }): Promise<Blob> {
    this.assertReady();
    return renderCaptionsSidecar(this.compiled, options?.range ?? null);
  }

  dispose(): Promise<void> {
    this.disposalTask ??= this.disposeNow(); return this.disposalTask;
  }
  private async disposeNow(): Promise<void> {
    if (this.state === 'disposing' || this.state === 'disposed') return;
    this.state = 'disposing';
    this.lifetime.abort();
    await this.frameQueue;
    try { await this.exportTask; } catch { /* disposal cancels an owned export */ }
    this.layout.dispose();
    this.inspectionContext = null;
    for (const bitmap of new Set(this.imageCache.values())) {
      if ('close' in bitmap) (bitmap as ImageBitmap).close();
      else bitmap.src = '';
    }
    this.imageCache.clear();
    for (const handle of this.mediaHandles.values()) {
      try {
        await handle.reader.dispose();
      } catch {
        // dispose must not throw over already-released decoders (spec 9.5)
      }
    }
    this.mediaHandles.clear();
    for (const leaf of this.pluginLeaves.values()) { try { await leaf.prepared.dispose(); } catch { /* continue releasing session-owned resources */ } }
    this.pluginLeaves.clear(); this.pluginSurfaces.clear();
    this.decodedVideo.clear();
    for (const url of this.ownedURLs) URL.revokeObjectURL(url);
    this.ownedURLs = [];
    for (const font of this.fonts) document.fonts.delete(font);
    this.fonts = [];
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
    this.compiled.release();
    this.state = 'disposed';
  }

  assertReady(): void {
    if (this.state === 'disposed' || this.state === 'disposing') throw error('E_DISPOSED', 'Renderer is disposed.');
    if (this.state === 'error') throw error('E_BUSY', 'Renderer is in error state; recreate it after an explicit recoverable reset.');
    if (this.state === 'initializing') throw error('E_BUSY', 'Renderer is still initializing.');
  }

  // ---- evaluation/paint ---------------------------------------------------

  evaluate(frame: number): Evaluation {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= this.compiled.metadata.durationFrames) throw error('E_TIME_UNIT', 'Frame is outside the composition.');
    const fps = Rational.of(BigInt(this.compiled.metadata.fps.numerator), BigInt(this.compiled.metadata.fps.denominator));
    return evaluateFrame(this.compiled.timing, {
      frame,
      fps,
      durationFrames: this.compiled.metadata.durationFrames,
      easing: (name, p, d) => canonicalEasing.evaluate(name, p, d)
    });
  }

  /** Read-only geometry, values, and activity for the canonical evaluated frame. */
  inspectFrame(frame: number) {
    this.assertReady();
    const evaluation = this.evaluate(frame);
    if (!this.inspectionContext) { const surface = document.createElement('canvas'); surface.width = surface.height = 1; this.inspectionContext = surface.getContext('2d')!; }
    const nodes = inspectPaintFrame(this.inspectionContext, this.boxIndex, evaluation, this.metadata.width, this.metadata.height);
    for (const [id, state] of evaluation.states) if (state.node.kind === 'audio' && !nodes.some(n => n.id === id)) nodes.push({ id, x: 0, y: 0, width: 0, height: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 0, corners: [], values: Object.fromEntries((evaluation.animatedValues.get(id) ?? []).map(v => [v.property, v.value])) });
    return { frame, revisionHash: this.revisionHash, nodes, transitions: evaluation.transitions.map(t => ({ ...t })) };
  }

  ensureCanvas(): HTMLCanvasElement {
    if (this.canvas) return this.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = this.compiled.metadata.width;
    canvas.height = this.compiled.metadata.height;
    this.canvas = canvas;
    return canvas;
  }

  paintTo(ctx: CanvasRenderingContext2D, evaluation: Evaluation, transparent = false): void {
    const changesLayout = this.compiled.timing.animations.some((a) => ['width', 'height', 'left', 'top', 'text-number'].includes(a.property));
    if (changesLayout) this.boxIndex = indexBoxes(buildLayoutDom(this.layout, this.compiled.timing, {
      ...this.compiled.metadata, cssText: this.layoutCss, rootFontPx: 16,
      imageURLs: this.imageURLs, imageSizes: this.imageSizes, animatedValues: evaluation.animatedValues
    }).boxes);
    paintFrame(
      {
        ctx,
        width: this.compiled.metadata.width,
        height: this.compiled.metadata.height,
        background: transparent ? 'transparent' : this.compiled.metadata.background,
        boxIndex: this.boxIndex,
        media: {
          getVideoSample: (id: string, request: MediaRequest) => this.getVideoSample(id, request),
          getImageSample: (id: string) => this.pluginSurfaces.get(id) ?? this.imageCache.get(id) ?? null
        }
      },
      evaluation
    );
  }

  // ---- media --------------------------------------------------------------

  /** MediaSurfaceProvider: returns the predecoded sample for painting, or null for transparent frames. */
  getVideoSample(id: string, _request: MediaRequest): CanvasImageSource | null {
    void _request;
    const cached = this.decodedVideo.get(id);
    if (!cached) return null;
    return cached.imageSource;
  }

  async prefetchMedia(evaluation: Evaluation, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.lifetime.signal.aborted) throw new DOMException('Render aborted', 'AbortError');
    const videoIds = new Set([...evaluation.mediaRequests].filter(([, request]) => request.kind === 'video').map(([id]) => id));
    if (videoIds.size > 2) throw error('E_RESOURCE_LIMIT', 'At most two simultaneous video decoders are admitted.');
    for (const [id, decoded] of this.decodedVideo) if (!videoIds.has(id)) {
      const surface = decoded.imageSource as OffscreenCanvas; surface.width = surface.height = 0; this.decodedVideo.delete(id);
    }
    for (const [id, leaf] of this.pluginLeaves) {
      const state = evaluation.states.get(id); if (!state) { this.pluginSurfaces.delete(id); continue; }
      const surface = new OffscreenCanvas(leaf.width, leaf.height);
      await renderPluginLeaf(leaf.prepared, {
        ctx: surface.getContext('2d')!, width: leaf.width, height: leaf.height,
        rootTime: evaluation.time, localTime: state.nodeLocal, frame: evaluation.frame,
        iteration: state.iteration, iterationPath: Object.freeze([...state.iterationPath]), props: leaf.props,
        random: (channel, sampleIndex) => randomV1Sync(this.compiled.metadata.seed, id, channel, sampleIndex),
        signal: AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
      });
      if (signal?.aborted || this.lifetime.signal.aborted) throw new DOMException('Render aborted', 'AbortError');
      this.pluginSurfaces.set(id, surface);
    }
    for (const [id, request] of evaluation.mediaRequests) {
      if (request.kind !== 'video') continue;
      const node = this.compiled.timing.nodes.get(id);
      if (!node?.media) continue;
      const sourceKey = node.attributes['src'] ?? '';
      const handle = await this.ensureMediaHandle(id, sourceKey, node);
      if (!handle) continue;
      const trimOut = node.media.trimOut ? node.media.trimOut.toNumber() : null;
      const sourceTime = request.sourceTime.toNumber();
      // trim/hold semantics (spec 9.3): before first PTS or across a gap => transparent
      let target = sourceTime;
      if (trimOut !== null && sourceTime >= trimOut) {
        if (node.media.endBehavior !== 'hold') {
          throw error('E_DURATION', `Video ${id} exhausted its trim interval; use end-behavior="hold" or shorten the clip.`);
        }
        target = Math.max(0, trimOut - 1e-6); // hold pixels: last valid frame before exclusive trimOut
      }
      handle.generation++;
      const frame = await handle.reader.getVideoSample(target, { generation: handle.generation });
      if (signal?.aborted) {
        frame?.close();
        return;
      }
      if (frame) {
        const surface = new OffscreenCanvas(frame.width, frame.height);
        this.resourcePeaks.decodedFramesMax = Math.max(this.resourcePeaks.decodedFramesMax, this.decodedVideo.size + 1);
        const sctx = surface.getContext('2d') as OffscreenCanvasRenderingContext2D;
        try { frame.paint(sctx as unknown as CanvasRenderingContext2D, 0, 0, frame.width, frame.height); } finally { frame.close(); }
        const previous = this.decodedVideo.get(id)?.imageSource as OffscreenCanvas | undefined;
        if (previous) previous.width = previous.height = 0;
        this.decodedVideo.set(id, { imageSource: surface as unknown as CanvasImageSource, frame: null });
      } else {
        this.decodedVideo.delete(id);
      }
    }
  }

  private decodedVideo = new Map<string, { imageSource: CanvasImageSource; frame: DecodedVideoFrame | null }>();

  private async ensureMediaHandle(id: string, sourceKey: string, node: { kind: string; media?: { track?: number; audioTrack?: number; trimIn: Rational; trimOut: Rational | null; rate: Rational } }): Promise<MediaHandle | null> {
    const existing = this.mediaHandles.get(id);
    if (existing) return existing;
    const pending = this.pendingHandles.get(id); if (pending) return pending;
    const operation = this.createMediaHandle(id, sourceKey, node);
    this.pendingHandles.set(id, operation);
    try { return await operation; } finally { this.pendingHandles.delete(id); }
  }
  private async createMediaHandle(id: string, sourceKey: string, node: { kind: string; media?: { track?: number; audioTrack?: number; trimIn: Rational; trimOut: Rational | null; rate: Rational } }): Promise<MediaHandle | null> {
    const blob = this.assetBlob(sourceKey);
    const src = resolveSrc(sourceKey, this.compiled, {});
    if (!src) return null;
    const adapter = getMediabunnyAdapter();
    const handle: MediaHandle = {
      reader: null as unknown as MediaReader,
      inspection: null,
      source: src,
      generation: 0
    };
    handle.inspection = await adapter.adapter.inspect(blob ?? srcAsSource(src));
    if (this.lifetime.signal.aborted) throw new DOMException('Render aborted', 'AbortError');
    if (node.kind === 'video' && !handle.inspection.videoTracks[node.media?.track ?? 0]) throw error('E_CODEC_DECODE', `Video track for ${id} is unavailable.`);
    const audioIndex = node.kind === 'video' ? node.media?.audioTrack : node.media?.track;
    if ((node.kind === 'audio' || audioIndex !== undefined) && !handle.inspection.audioTracks[audioIndex ?? 0]) throw error('E_CODEC_DECODE', `Audio track for ${id} is unavailable.`);
    const opts: MediaReaderOpenOptions = {
      kind: node.kind === 'video' ? 'video' : 'audio',
      assetId: id,
      videoTrack: node.kind === 'video' ? node.media?.track : undefined,
      audioTrack: node.kind === 'video' ? node.media?.audioTrack ?? 0 : node.media?.track ?? 0,
      trimIn: node.media?.trimIn.toNumber() ?? 0,
      trimOut: node.media?.trimOut ? node.media.trimOut.toNumber() : null,
      rate: node.media?.rate.toNumber() ?? 1
    };
    let released = false;
    handle.reader = adapter.adapter.open(blob ?? srcAsSource(src), opts, () => {
      if (!released) {
        released = true;
        this.mediaHandles.delete(id);
      }
    });
    this.mediaHandles.set(id, handle);
    return handle;
  }

  /** Sync accessor for the audio block mixer. */
  openAudioReader(node: ResolvedNodeLike): MediaReader | null {
    const handle = this.mediaHandles.get(node.id);
    return handle ? handle.reader : null;
  }

  async sourceSampleRate(node: ResolvedNodeLike): Promise<number> {
    const handle = this.mediaHandles.get(node.id);
    if (handle?.inspection) return handle.inspection.audioTracks[node.kind === 'video' ? node.media?.audioTrack ?? 0 : node.media?.track ?? 0]?.sampleRate ?? 48000;
    return 48000;
  }

  async sourceChannelCount(node: ResolvedNodeLike): Promise<number> {
    const handle = this.mediaHandles.get(node.id);
    if (handle?.inspection) return handle.inspection.audioTracks[node.kind === 'video' ? node.media?.audioTrack ?? 0 : node.media?.track ?? 0]?.numberOfChannels ?? 2;
    return 2;
  }

  /** Audio block mixing at root phase (spec 13.6). */
  async mixAudioBlockForExport(
    blockStartRoot: Rational,
    count: number,
    audioIndex: number,
    meta: { sampleRate: 44100 | 48000; channels: 1 | 2 },
    warnings: string[]
  ): Promise<BlockMixResult> {
    void audioIndex;
    // ensure audio readers exist
    const audioNodes = [...this.compiled.timing.nodes.values()].filter(
      (n) => n.kind === 'audio' || (n.kind === 'video' && n.media?.audio === 'include')
    );
    for (const node of audioNodes) {
      await this.ensureMediaHandle(node.id, node.attributes['src'] ?? '', node as never);
    }
    const result = await mixAudioBlockCanonical(this.compiled, this, blockStartRoot, count, meta);
    this.resourcePeaks.pcmBlockBytesMax = Math.max(this.resourcePeaks.pcmBlockBytesMax, result.pcmBlockBytes);
    if (result.clippedSamples > 0) {
      warnings.push(`W_AUDIO_CLIPPING: ${result.clippedSamples} sample(s) hit the final hard clamp; peak ${result.peak.toFixed(4)}.`);
    }
    return result;
  }

  // ---- manifest inputs ----------------------------------------------------
  get sourceHash(): string {
    return this.compiled.revisionHash;
  }
  get styleHash(): string {
    return hashOf(this.compiled.styles.normalizedCss);
  }
  get propsHash(): string {
    return hashOf(JSON.stringify(this.compiled.ir.props));
  }
  private assetBlob(src: string): Blob | undefined {
    return this.compiled.resolvedAssets.get(src.startsWith('asset:') ? src.slice(6) : src)?.blob;
  }
  private ownURL(blob: Blob): string { const url = URL.createObjectURL(blob); this.ownedURLs.push(url); return url; }
  private get layoutCss(): string { return resolveCssAssetUrls(this.compiled.styles.normalizedCss, this.imageURLs, 'stylesheet'); }
}

interface ResolvedNodeLike {
  id: string;
  kind: string;
  media?: {
    trimIn: Rational;
    trimOut: Rational | null;
    rate: Rational;
    track?: number;
    audioTrack?: number;
  };
  attributes: Record<string, string>;
}

function hashOf(text: string): string { return sha256Hex(text); }

function resolveSrc(srcKey: string, compiled: CompiledCompositionImpl, assets: Record<string, Blob | File> | undefined): string | null {
  if (srcKey.startsWith('asset:')) {
    const assetId = srcKey.slice('asset:'.length);
    if (assets?.[assetId]) {
      return URL.createObjectURL(assets[assetId]);
    }
    const descriptor = compiled.ir.assets.find((a) => a.id === assetId);
    if (descriptor) return descriptor.src;
    return null;
  }
  return srcKey;
}

function srcAsSource(src: string): Blob | URL {
  if (/^https?:/i.test(src)) return new URL(src);
  return new URL(src, typeof location !== 'undefined' ? location.href : 'file:///');
}

async function fetchFontBytes(src: string, assets?: Record<string, Blob | File>): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(src, { credentials: 'omit' }); // default omit for cross-origin (spec 14.3)
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    void assets;
    return null;
  }
}

async function loadImage(src: string, policy: Readonly<ResourcePolicy>): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(src, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Image asset failed: HTTP ${res.status}`);
  const blob = await res.blob();
  try {
    const bitmap = await createImageBitmap(blob);
    try { checkImageDimensions(bitmap.width, bitmap.height, policy); return bitmap; }
    catch (e) { bitmap.close(); throw e; }
  } catch (e) {
    if ((e as Diagnostic).code === 'E_RESOURCE_LIMIT') throw e;
    const image = new Image(); image.src = src;
    try { await image.decode(); checkImageDimensions(image.naturalWidth, image.naturalHeight, policy); return image; }
    catch (failure) { image.src = ''; throw failure; }
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: 'png' | 'jpeg', quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Still render failed'))),
      type === 'png' ? 'image/png' : 'image/jpeg',
      quality
    );
  });
}

export type { MediabunnyMuxer, MuxerPlan };
export { RendererSession as Renderer, createWriterSession, buildManifest };
