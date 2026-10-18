/** Inert declarations and an owning, mutation-aware canonical player element. */
import { Diagnostic, FrameRange } from '@htmv/core';
import { CompiledCompositionImpl, CompileOptions, parseHtml, CNode } from '@htmv/compiler';
import { RendererSession, PreflightOptions, ExportOptions, compileBrowser } from '@htmv/exporter';
import { PlayerEngine, PlayerEventName } from '@htmv/player';

export interface RegisterOptions { prefix?: string }
let registered = false; let activePrefix = 'hv';
export function isRegistered(): boolean { return registered; }
export function registeredPrefix(): string { return activePrefix; }
export interface HtmvPlayerElement extends HTMLElement {
  renderer: RendererSession | null; readonly currentFrame: number; readonly playing: boolean;
  play(options?: { range?: FrameRange }): Promise<void>; pause(): void; seekToFrame(frame: number): Promise<void>;
}
export function registerElements(options?: RegisterOptions): void {
  const prefix = options?.prefix ?? 'hv';
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(prefix)) throw new Error('Invalid custom element prefix.');
  if (registered) { if (prefix === activePrefix) return; throw new Error(`Elements already registered with prefix ${activePrefix}.`); }
  const names = ['composition', 'assets', 'asset', 'scene', 'sequence', 'series', 'transition', 'loop', 'freeze', 'video', 'audio', 'animation', 'keyframe', 'captions', 'cue', 'use', 'player'];
  for (const suffix of names) if (customElements.get(`${prefix}-${suffix}`)) throw new Error(`Custom element ${prefix}-${suffix} is already defined.`);
  for (const suffix of names.filter((n) => n !== 'player')) customElements.define(`${prefix}-${suffix}`, class extends HTMLElement {});
  const sourceStyle = document.createElement('style'); sourceStyle.textContent = `${prefix}-composition { display:none !important; }`; document.head.appendChild(sourceStyle);
  activePrefix = prefix;

  customElements.define(`${prefix}-player`, class extends HTMLElement implements HtmvPlayerElement {
    static observedAttributes = ['for', 'controls', 'loop', 'fit'];
    private engine: PlayerEngine | null = null;
    private explicit: RendererSession | null = null;
    private auto: { compiled: CompiledCompositionImpl; renderer: RendererSession } | null = null;
    private observer: MutationObserver | null = null;
    private generation = 0;
    private lastSource: string | null = null;
    private scheduled = false;
    private visibility = () => { if (document.hidden) { this.pause(); this.emit('hv-diagnostic', { message: 'Preview suspended while the document is hidden.' }); } };
    get renderer(): RendererSession | null { return this.explicit ?? this.auto?.renderer ?? null; }
    set renderer(value: RendererSession | null) { if (this.explicit === value) return; this.explicit = value; this.lastSource = null; this.schedule(); }
    get currentFrame(): number { return this.engine?.frame ?? 0; }
    get playing(): boolean { return this.engine?.isPlaying ?? false; }
    async play(options?: { range?: FrameRange }): Promise<void> { if (!this.engine) await this.attach(); await this.engine?.start(options?.range); }
    pause(): void { this.engine?.pause(); }
    async seekToFrame(frame: number): Promise<void> { if (!this.engine) await this.attach(); await this.engine?.seekToFrame(frame); }
    connectedCallback(): void { document.addEventListener('visibilitychange', this.visibility); this.schedule(); }
    attributeChangedCallback(): void { this.lastSource = null; this.schedule(); }
    disconnectedCallback(): void {
      queueMicrotask(() => {
        if (this.isConnected) return;
        this.generation++; this.observer?.disconnect(); this.observer = null;
        document.removeEventListener('visibilitychange', this.visibility);
        this.engine?.stop(); this.engine = null;
        const auto = this.auto; this.auto = null; this.lastSource = null;
        if (auto) void auto.renderer.dispose().then(() => auto.compiled.dispose());
      });
    }
    private schedule(): void {
      if (this.scheduled) return; this.scheduled = true;
      queueMicrotask(() => { this.scheduled = false; if (this.isConnected) void this.attach(); });
    }
    private async retire(auto: { compiled: CompiledCompositionImpl; renderer: RendererSession } | null): Promise<void> {
      if (!auto) return; await auto.renderer.whenIdle(); await auto.renderer.dispose(); await auto.compiled.dispose();
    }
    private async attach(): Promise<void> {
      const generation = ++this.generation;
      const explicit = this.explicit;
      if (explicit) {
        this.observer?.disconnect(); this.observer = null;
        const previous = this.auto; this.auto = null;
        try { await this.bind(explicit, explicit.composition); this.emit('hv-ready', { revisionHash: explicit.revisionHash }); } catch (e) { this.showError(e); }
        void this.retire(previous); return;
      }
      const id = this.getAttribute('for'); const composition = id ? document.getElementById(id) : null;
      if (!composition) { this.showError(new Error(`hv-player for="${id ?? ''}" did not match a composition.`)); return; }
      this.observer?.disconnect();
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(composition, { attributes: true, childList: true, characterData: true, subtree: true });
      const source = composition.outerHTML;
      if (source === this.lastSource && this.auto) return;
      let compiled: CompiledCompositionImpl | null = null; let renderer: RendererSession | null = null;
      this.setAttribute('aria-busy', 'true');
      try {
        let input: string | CNode = source;
        if (prefix !== 'hv') {
          input = parseHtml(source);
          const normalize = (node: CNode): void => { if (node.tag.startsWith(`${prefix}-`)) node.tag = `hv-${node.tag.slice(prefix.length + 1)}`; for (const child of node.children) normalize(child); };
          normalize(input);
        }
        compiled = await compileBrowser(input, { baseURL: composition.baseURI });
        renderer = new RendererSession(compiled); await renderer.initialize();
        const first = await renderer.renderFrame(0); first.close();
        if (!this.isConnected || generation !== this.generation) { await renderer.dispose(); await compiled.dispose(); return; }
        const previous = this.auto;
        await this.bind(renderer, compiled);
        this.auto = { renderer, compiled }; this.lastSource = source;
        this.emit('hv-ready', { revisionHash: compiled.revisionHash });
        this.querySelector('.hv-error-panel')?.remove();
        void this.retire(previous);
      } catch (e) { await renderer?.dispose(); await compiled?.dispose(); if (generation === this.generation) this.showError(e); }
      finally { if (generation === this.generation) this.setAttribute('aria-busy', 'false'); }
    }
    private async bind(renderer: RendererSession, compiled: CompiledCompositionImpl): Promise<void> {
      this.engine?.stop();
      let canvas = this.querySelector('canvas'); if (!canvas) { canvas = document.createElement('canvas'); this.appendChild(canvas); }
      canvas.width = compiled.metadata.width; canvas.height = compiled.metadata.height;
      Object.assign(canvas.style, { width: '100%', height: 'auto', display: 'block', objectFit: this.getAttribute('fit') ?? 'contain' });
      const engine = new PlayerEngine(compiled, renderer, { target: canvas, loop: this.hasAttribute('loop'), onEvent: (name, detail) => {
        if (name === 'hv-frame') {
          const frame = (detail as { frame: number }).frame;
          const seek = this.querySelector<HTMLInputElement>('.hv-seek'); if (seek) seek.value = String(frame);
          const label = this.querySelector('.hv-frame-label'); if (label) label.textContent = String(frame);
        }
        this.emit(name, detail);
      } });
      this.engine = engine; this.querySelector('.hv-controls')?.remove();
      if (this.hasAttribute('controls')) {
        const controls = document.createElement('div'); controls.className = 'hv-controls';
        const play = document.createElement('button'); play.textContent = 'Play / Pause'; play.setAttribute('aria-label', 'Play or pause');
        play.addEventListener('click', () => { if (engine.isPlaying) engine.pause(); else void engine.start().catch((e) => this.showError(e)); });
        const seek = document.createElement('input'); seek.className = 'hv-seek'; seek.type = 'range'; seek.min = '0'; seek.max = String(compiled.metadata.durationFrames - 1); seek.step = '1'; seek.value = '0'; seek.setAttribute('aria-label', 'Frame');
        seek.addEventListener('input', () => { void engine.seekToFrame(Number(seek.value)).catch((e) => this.showError(e)); });
        const label = document.createElement('span'); label.className = 'hv-frame-label'; label.textContent = '0';
        controls.append(play, seek, label); this.appendChild(controls);
      }
      await engine.seekToFrame(0);
    }
    private showError(e: unknown): void {
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      const diagnostics = (e as { diagnostics?: readonly Diagnostic[] }).diagnostics;
      this.emit('hv-error', { diagnostics, message: (e as Error).message });
      let panel = this.querySelector('.hv-error-panel'); if (!panel) { panel = document.createElement('div'); panel.className = 'hv-error-panel'; panel.setAttribute('role', 'alert'); this.appendChild(panel); }
      panel.textContent = diagnostics?.map((d) => `${d.code}: ${d.message}`).join('\n') ?? (e as Error).message;
    }
    private emit(name: PlayerEventName, detail: unknown): void { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); }
  });
  registered = true;
}
export type { PreflightOptions, ExportOptions, CompileOptions, Diagnostic };
