/**
 * Canonical canvas playback engine (spec 13.4): audio-clock or monotonic-clock
 * stepping, exact-frame seek resolution, loop ranges, and CustomEvents.
 * Export always renders every output frame; preview may skip to stay synced.
 */
import { Rational } from '@htmv/core';
import type { CompiledCompositionImpl } from '@htmv/compiler';
import type { RendererSession, FrameResult, FrameRange } from '@htmv/exporter';
import { Diagnostic } from '@htmv/core';

export type PlayerEventName = 'hv-ready' | 'hv-frame' | 'hv-play' | 'hv-pause' | 'hv-ended' | 'hv-diagnostic' | 'hv-error' | 'hv-level';

export interface PlayerOptions {
  target: HTMLCanvasElement;
  onEvent: (name: PlayerEventName, detail: unknown) => void;
  /** Preview presentation may skip visual frames to remain synchronized (spec 13.4). */
  skipFramesInPreview?: boolean;
  loop?: boolean;
}

interface PresentationRequest {
  frame: number;
  kind: 'playback' | 'seek';
  controller: AbortController;
  resolve(): void;
  reject(reason: unknown): void;
}

export class PlayerEngine {
  readonly revisionHash: string;
  private renderer: RendererSession | null;
  private compiled: CompiledCompositionImpl;
  private canvas: HTMLCanvasElement;
  private onEvent: PlayerOptions['onEvent'];
  private raf = 0;
  private playing = false;
  private currentFrame = 0;
  private range: FrameRange | null = null;
  private startedAt = 0; // performance.now
  private startFrame = 0;
  private lastRendered = -1;
  private activeRequest: PresentationRequest | null = null;
  private pendingRequest: PresentationRequest | null = null;
  private seekGeneration = 0;
  private audioCtx: AudioContext | null = null;
  private previewAudioEnabled = true;
  private audioEpoch: number | null = null;
  private audioGeneration = 0;
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  private audioSources = new Set<AudioBufferSourceNode>();
  private looping: boolean;
  private closed = false;
  private lastFrameResult: FrameResult | null = null;

  constructor(compiled: CompiledCompositionImpl, renderer: RendererSession | null, options: PlayerOptions) {
    this.compiled = compiled;
    this.renderer = renderer;
    this.canvas = options.target;
    this.onEvent = options.onEvent;
    this.revisionHash = compiled.revisionHash;
    this.looping = options.loop ?? false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get frame(): number {
    return this.currentFrame;
  }

  async start(range?: FrameRange): Promise<void> {
    if (!this.renderer || this.closed) return;
    if (this.playing) return;
    if (range && (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.toExclusive) || range.from < 0 || range.from >= range.toExclusive || range.toExclusive > this.compiled.metadata.durationFrames)) throw new RangeError('Invalid playback range.');
    this.range = range ?? null;
    if (this.currentFrame < (range?.from ?? 0) || this.currentFrame >= (range?.toExclusive ?? this.compiled.metadata.durationFrames) - 1) this.currentFrame = range?.from ?? 0;
    this.playing = true;
    this.startFrame = this.currentFrame;
    this.startedAt = performance.now();
    this.onEvent('hv-play', { frame: this.currentFrame });
    // audio clock when sound is active, otherwise monotonic performance clock
    const hasAudio = [...this.compiled.timing.nodes.values()].some(
      (n) => n.kind === 'audio' || (n.kind === 'video' && n.media?.audio === 'include')
    );
    if (hasAudio && this.previewAudioEnabled) {
      await this.startPreviewAudio();
    }
    this.tick();
  }

  pause(): void {
    this.invalidateRequests('playback');
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopPreviewAudio();
    this.onEvent('hv-pause', { frame: this.currentFrame });
  }

  /** Seek resolves only when canonical pixels for that frame are ready (spec 13.4). */
  async seekToFrame(frame: number): Promise<void> {
    const N = this.compiled.metadata.durationFrames;
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= N) throw new RangeError(`Frame must lie in [0, ${N - 1}].`);
    if (this.closed) throw new DOMException('Player stopped', 'AbortError');
    const generation = ++this.seekGeneration;
    this.invalidateRequests();
    const clamped = frame;
    const wasPlaying = this.playing; this.stopPreviewAudio();
    this.currentFrame = clamped;
    cancelAnimationFrame(this.raf);
    await this.renderAndShow(clamped, 'seek');
    if (generation !== this.seekGeneration || this.closed) throw new DOMException('Seek superseded', 'AbortError');
    if (this.playing) {
      this.startFrame = clamped;
      this.startedAt = performance.now();
      if (wasPlaying && this.previewAudioEnabled) await this.startPreviewAudio();
      this.tick();
    }
  }

  stop(): void {
    this.closed = true;
    this.seekGeneration++;
    this.invalidateRequests();
    this.pause();
    if (this.audioCtx) { void this.audioCtx.close(); this.audioCtx = null; }
    if (this.lastFrameResult) {
      this.lastFrameResult.close();
      this.lastFrameResult = null;
    }
  }

  private invalidateRequests(kind?: PresentationRequest['kind']): void {
    for (const request of [this.activeRequest, this.pendingRequest]) {
      if (!request || kind && request.kind !== kind) continue;
      request.controller.abort(); request.reject(new DOMException('Presentation superseded', 'AbortError'));
      if (request === this.pendingRequest) this.pendingRequest = null;
    }
  }

  private renderAndShow(frame: number, kind: PresentationRequest['kind'] = 'playback'): Promise<void> {
    if (!this.renderer || this.closed) return Promise.reject(new DOMException('Player stopped', 'AbortError'));
    if (this.pendingRequest) {
      this.pendingRequest.controller.abort();
      this.pendingRequest.reject(new DOMException('Presentation superseded', 'AbortError'));
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingRequest = { frame, kind, controller: new AbortController(), resolve, reject };
      void this.presentNext();
    });
  }

  private async presentNext(): Promise<void> {
    if (this.activeRequest || !this.pendingRequest || !this.renderer) return;
    const request = this.pendingRequest; this.pendingRequest = null; this.activeRequest = request;
    let result: FrameResult | null = null;
    try {
      result = await this.renderer.renderFrame(request.frame, { signal: request.controller.signal });
      if (this.closed || request.controller.signal.aborted || request.kind === 'playback' && !this.playing) throw new DOMException('Presentation superseded', 'AbortError');
      const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(result.image, 0, 0);
      this.lastFrameResult?.close(); this.lastFrameResult = result; result = null;
      this.lastRendered = request.frame;
      this.onEvent('hv-frame', { frame: request.frame, time: frameTimeRational(request.frame, this.compiled) });
      request.resolve();
    } catch (e) { request.reject(e); }
    finally { result?.close(); this.activeRequest = null; void this.presentNext(); }
  }

  private tick = (): void => {
    if (!this.playing || this.closed) return;
    const elapsed = this.audioCtx && this.audioEpoch !== null ? Math.max(0, this.audioCtx.currentTime - this.audioEpoch) : (performance.now() - this.startedAt) / 1000;
    const fpsN = this.compiled.metadata.fps.numerator / this.compiled.metadata.fps.denominator;
    let desired = this.startFrame + Math.floor(elapsed * fpsN);
    const to = this.range?.toExclusive ?? this.compiled.metadata.durationFrames;
    const from = this.range?.from ?? 0;
    if (desired >= to) {
      if (this.looping) {
        // preview loop restarts the selected finite range (spec 13.4)
        this.startFrame = from;
        this.startedAt = performance.now();
        desired = from;
        this.stopPreviewAudio();
        if (this.previewAudioEnabled) void this.startPreviewAudio();
      } else {
        this.currentFrame = to - 1;
        this.playing = false; this.invalidateRequests('playback');
        this.onEvent('hv-ended', { frame: this.currentFrame });
        this.stopPreviewAudio();
        return;
      }
    }
    this.currentFrame = Math.max(from, Math.min(to - 1, desired));
    // render at presentation opportunity; skip stale visual frames if behind
    if (this.currentFrame !== this.lastRendered && this.activeRequest?.frame !== this.currentFrame && this.pendingRequest?.frame !== this.currentFrame && this.activeRequest?.kind !== 'seek' && this.pendingRequest?.kind !== 'seek') {
      void this.renderAndShow(this.currentFrame).catch((e) => { if ((e as Error).name === 'AbortError') return; this.pause(); this.onEvent('hv-error', { message: (e as Error).message }); });
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private async startPreviewAudio(): Promise<void> {
    // Canonical PCM routes through an AudioWorklet when available; a bounded
    // scheduled AudioBuffer fallback may be used without changing mix math (spec 10.3).
    if (!this.renderer) return;
    try {
      this.audioCtx = this.audioCtx ?? new AudioContext({ sampleRate: this.compiled.metadata.sampleRate });
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      const ctx = this.audioCtx;
      const generation = ++this.audioGeneration;
      const sampleRate = this.compiled.metadata.sampleRate;
      const fps = Rational.of(BigInt(this.compiled.metadata.fps.numerator), BigInt(this.compiled.metadata.fps.denominator));
      const rootStart = Rational.of(BigInt(this.currentFrame)).div(fps);
      const end = Rational.of(BigInt(this.range?.toExclusive ?? this.compiled.metadata.durationFrames)).div(fps);
      const total = end.sub(rootStart).mul(Rational.of(BigInt(sampleRate))).ceil().toSafeInteger();
      let index = 0;
      this.audioEpoch = null;
      const fill = async (): Promise<void> => {
        if (!this.playing || generation !== this.audioGeneration || !this.renderer) return;
        try {
          while (index < total && (this.audioEpoch === null || this.audioEpoch + index / sampleRate < ctx.currentTime + 0.25)) {
            const count = Math.min(4096, total - index);
            const block = await this.renderer.mixAudioBlockForExport(rootStart.add(Rational.of(BigInt(index), BigInt(sampleRate))), count, index, this.compiled.metadata, []);
            this.onEvent('hv-level', { peak: block.peak, clippedSamples: block.clippedSamples });
            if (!this.playing || generation !== this.audioGeneration) return;
            if (this.audioEpoch === null) { this.audioEpoch = ctx.currentTime + 0.03; this.startedAt = performance.now(); }
            if (this.audioEpoch + index / sampleRate < ctx.currentTime) {
              this.onEvent('hv-diagnostic', { message: 'Preview audio buffering; playback clock is suspended.' });
              this.audioEpoch = ctx.currentTime + 0.03 - index / sampleRate;
            }
            const buffer = ctx.createBuffer(this.compiled.metadata.channels, count, sampleRate);
            buffer.copyToChannel(block.left as Float32Array<ArrayBuffer>, 0);
            if (this.compiled.metadata.channels === 2) buffer.copyToChannel(block.right as Float32Array<ArrayBuffer>, 1);
            const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination);
            this.audioSources.add(source); source.onended = () => { this.audioSources.delete(source); source.disconnect(); };
            source.start(this.audioEpoch + index / sampleRate); index += count;
          }
          if (index < total) this.audioTimer = setTimeout(() => { void fill(); }, 25);
        } catch (e) { this.onEvent('hv-error', { message: (e as Error).message }); this.pause(); }
      };
      await fill();
    } catch (e) {
      this.onEvent('hv-diagnostic', { diagnostic: (e as Error).message });
    }
  }

  private stopPreviewAudio(): void {
    this.audioGeneration++; this.audioEpoch = null;
    if (this.audioTimer !== null) clearTimeout(this.audioTimer); this.audioTimer = null;
    for (const source of this.audioSources) { try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
    this.audioSources.clear();
    if (this.audioCtx) {
      void this.audioCtx.suspend();
    }
  }

  /** Preview audio bridge prepared for the AudioWorklet path. */
  enablePreviewAudio(): void {
    this.previewAudioEnabled = true;
  }
}

function frameTimeRational(frame: number, compiled: CompiledCompositionImpl): { numerator: string; denominator: string } {
  const fps = Rational.of(BigInt(compiled.metadata.fps.numerator), BigInt(compiled.metadata.fps.denominator));
  return Rational.fromInteger(BigInt(frame)).div(fps).toJSON();
}

export type { Diagnostic, FrameRange };
