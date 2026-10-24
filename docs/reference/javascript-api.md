# JavaScript API

Import the public API from `@htmv/htmv`. Compile a source document, create a renderer, then use that renderer to preview frames or export files. Dispose both objects when the application is finished with them.

## Entry points

```js
import { compile, createRenderer, registerElements,
         Rational, DiagnosticCodes, parseEasing } from '@htmv/htmv';
import '@htmv/htmv/auto'; // browser auto-registration (side-effectful)
```

`compile`, `createRenderer`, and `registerElements` are the main entry points. The package also re-exports `Rational`, `DiagnosticCodes`, and `parseEasing` from `@htmv/core`. Importing `auto` registers the custom elements; omit it when registering them explicitly.

### Easing evaluation

```ts
function parseEasing(text: string, durationSeconds?: number): {
  fn: (progress: number) => number;
  spring?: (elapsedSeconds: number) => number;
  diagnostics: Diagnostic[];
};
```

`durationSeconds` defaults to `1`. Supported strings are `linear`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(x1,y1,x2,y2)`, `steps(n,start)`, `steps(n,end)`, and `spring(mass,stiffness,damping,initialVelocity)`. Use the compact spelling shown for `steps`; its parser does not accept spaces inside the parentheses.

`fn(progress)` evaluates normalized animation progress, normally from `0` to `1`. For a spring, it evaluates the response at `progress × durationSeconds`; the optional `spring(elapsedSeconds)` evaluates that response directly in seconds. Results may overshoot. `diagnostics` can contain `W_SPRING_UNSETTLED` when the spring still has residual motion at the supplied duration. See the [animation guide](/guide/animation.md#easing) for easing and spring behavior.

Unknown easing strings, malformed Bézier expressions, Bézier x controls outside `[0,1]`, nonpositive step counts, and invalid spring parameters throw an `Error`; they are not returned as diagnostics.

```js
const { fn, diagnostics } = parseEasing('ease-out');
const halfway = fn(0.5);
```

## Source and compile

`compile()` accepts an HTML string, a template, or a composition element. The options control props, assets, styles, fonts, plugins, and resource limits.

### CompileOptions

```ts
type Source = HTMLElement | HTMLTemplateElement | string;

interface CompileOptions {
  baseURL?: string;
  props?: JsonObject;
  assets?: Record<string, Blob | File>;
  styles?: readonly string[];
  stylePolicy?: 'strict' | 'ignore-unsupported'; // default strict
  fontPolicy?: 'portable' | 'system-allowed';   // default system-allowed
  plugins?: readonly HtmvPlugin[];
  signal?: AbortSignal;
  resourcePolicy?: ResourcePolicy;
}

function compile(source: Source, options?: CompileOptions): Promise<CompiledComposition>;
```

- An HTML string is parsed as inert source; scripts do not execute. A template contributes its content. An `HTMLElement` source snapshots the supported subtree and is intended for trusted host applications.
- Compilation prepares the metadata and resources needed to resolve timing and initial layout. Failures reject with a `CompilationError` containing [diagnostics](./diagnostics.md).
- `styles` adds CSS strings in the supplied order. They follow the same composition-local CSS rules as inline style blocks. The compiler does not copy host-page stylesheets or load external `@import` rules.
- Fonts load through declared [assets](/guide/templates.md#assets). `fontPolicy: 'portable'` requires registered fonts; the default, `system-allowed`, permits system fonts and reports portability warnings.

### ResourcePolicy

Set `resourcePolicy` to override the input limits. Values must be positive safe integers:

```ts
interface ResourcePolicy {
  maxAssetBytes?: number;      // default 256 MiB
  maxTotalAssetBytes?: number; // default 512 MiB
  maxImageDimension?: number;  // default 8192
  maxImagePixels?: number;     // default 33_554_432
}
```

### CompiledComposition

```ts
interface CompiledComposition {
  readonly metadata: CompositionMetadata;
  readonly diagnostics: readonly Diagnostic[];
  readonly revisionHash: string;
  inspectTimeline(): Readonly<TimelineInspection>;
  serializeIR(): CompositionIR;
  dispose(): Promise<void>;
}
```

A compiled revision is immutable. Its IR records the revision hash, schema version, timing and sample-rate metadata, and dependency versions. Calling `dispose()` prevents new renderer sessions; existing sessions remain valid until disposed. Repeated disposal is safe.

## Renderer sessions

```ts
function createRenderer(compiled: CompiledComposition): Promise<Renderer>;

interface Renderer {
  readonly state: RendererState;
  readonly revisionHash: string;
  inspectFrame(frame: number): FrameInspection;
  renderFrame(frame: number, options?: {signal?: AbortSignal}): Promise<FrameResult>;
  renderStill(options: {
    frame: number; type: 'png'|'jpeg'; quality?: number;
    transparent?: boolean; signal?: AbortSignal;
  }): Promise<Blob>;
  preflight(options: PreflightOptions): Promise<CapabilityReport>;
  exportVideo(options: ExportOptions): Promise<ExportResult>;
  renderCaptions(options?: {range?: FrameRange}): Promise<Blob>;
  dispose(): Promise<void>;
}

interface FrameResult {
  readonly frame: number;
  readonly image: ImageBitmap;
  readonly revisionHash: string;
  close(): void; // caller-owned bitmap; idempotent
}
```

- `renderFrame` returns a bitmap owned by the caller. Call the result's `close()` method when finished with it. A renderer serializes requests and may abort superseded interactive requests. Export operations are not replaced by newer requests.
- `renderCaptions()` without options exports full root timing; with `range` it clips cues to the range and re-times them ([details](./player.md#range-export-audio-and-captions)).

### Frame inspection

`inspectFrame(frame)` synchronously evaluates the requested frame and returns geometry, animated values, and active transitions without painting or decoding media. The following interfaces describe its returned shape:

```ts
interface FrameInspection {
  frame: number;
  revisionHash: string;
  nodes: FrameGeometryNode[];
  transitions: {
    type: string;
    direction: string;
    progress: number;
    outgoingId: string | null;
    incomingId: string;
  }[];
}

interface FrameGeometryNode {
  id: string;
  x: number; y: number;
  width: number; height: number;
  rotation: number;
  scaleX: number; scaleY: number;
  opacity: number;
  corners: { x: number; y: number }[];
  values: Record<string, number | string>;
}
```

- `frame` must be a safe integer in `[0, metadata.durationFrames)`; otherwise the call throws `E_TIME_UNIT`. Disposing/disposed sessions throw `E_DISPOSED`; initializing or error sessions throw `E_BUSY`.
- Visual entries come from active, displayed, visible layout subtrees. `x`/`y` are layout coordinates plus animated translation; `width`/`height` are untransformed layout dimensions. `rotation` (degrees) and scales describe the node's animated channels, defaulting to `0` and `1`; they do not decompose static or inherited CSS transforms.
- `corners` contains the four transformed border-box corners in top-left, top-right, bottom-right, bottom-left order, including ancestor transforms and slide offsets. They describe geometry before clipping, not the visible pixel bounds. `opacity` accumulates ancestor opacity and crossfade weights.
- `values` maps contributing animated property names to evaluated numeric or string values; it is not a complete computed-style or base-gain snapshot. Active audio nodes have zero position, dimensions, and opacity, identity rotation/scales, and empty `corners`, with any animated gain in `values`.
- Inspection uses the renderer's existing layout snapshot. For `width`, `height`, `left`, `top`, or `text-number` animations, render the requested frame first to refresh layout, then inspect it before rendering another frame.

```js
const rendered = await renderer.renderFrame(30);
try {
  const inspection = renderer.inspectFrame(30);
  console.log(inspection.nodes, inspection.transitions);
} finally {
  rendered.close();
}
```

### PreflightOptions

```ts
interface PreflightOptions {
  profile: 'mp4' | 'webm' | 'auto';
  allowedProfiles?: readonly ('mp4'|'webm')[];
  range?: FrameRange;              // { from, toExclusive }
  videoBitrate?: number;
  audioBitrate?: number;
  syncPolicy?: 'certified' | 'allow-unverified'; // default certified
}
```

Check the returned [capability report](#capability-and-result-shapes) before exporting. The [export guide](/guide/export.md#capability-preflight) explains the probes and synchronization policy.

### ExportOptions

```ts
type OutputTarget =
  | {kind:'memory'; maxBytes?:number}
  | {kind:'file'; handle: FileSystemFileHandle}
  | {kind:'opfs'; name?:string}
  | {kind:'writer'; writer:SeekableWriter}
  | {kind:'append-only'; stream:WritableStream<Uint8Array>};

interface ExportOptions {
  configuration: ExportConfiguration; // successful report.selected
  target: OutputTarget;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}
```

## Capability and result shapes

```ts
interface CapabilityReport {
  supported: boolean;
  candidates: readonly ExportCandidateReport[];
  selected?: ExportConfiguration;
  diagnostics: readonly Diagnostic[];
  estimatedBytes: number;
}

interface ExportConfiguration {
  readonly token: string;          // opaque; binds revision and probed environment
  readonly revisionHash: string;
  readonly profile: 'mp4'|'webm';
  readonly mimeType: string;
  readonly extension: '.mp4'|'.webm';
  readonly range: FrameRange;
  readonly width: number; readonly height: number;
  readonly fps: {numerator: number; denominator: number};
  readonly video: Readonly<ResolvedVideoEncoderConfig>;
  readonly audio: Readonly<ResolvedAudioEncoderConfig> | null;
  readonly syncCertification: 'certified'|'unverified';
}

type ExportResult =
  | {kind:'blob'; blob:Blob; manifest:RenderManifest}
  | {kind:'file'; bytesWritten:number; manifest:RenderManifest}
  | {kind:'opfs'; file:File; cleanup:()=>Promise<void>; manifest:RenderManifest};
```

- Pass `report.selected` to export without modifying it. Configuration tokens bind the compiled revision and probed environment. The engine rejects modified tokens, stale revisions, incompatible targets, or significant capability changes; run preflight again when needed.
- A range includes `from` and excludes `toExclusive`, with `0 ≤ from < toExclusive ≤ N`. The default is `[0, N)`. A range export evaluates the original timeline and starts output timestamps at zero.
- The application owns returned `Blob` and `File` objects, download URLs, and save-picker handles.

## Usage

This example compiles a composition, checks export support, reports progress, and releases the session. Connect a cancel control to `controller.abort()` to stop the export:

```js
import { compile, createRenderer } from '@htmv/htmv';

const compiled = await compile(document.querySelector('#hello'), {
  props: { title: 'A personalized film' },
  fontPolicy: 'system-allowed'
});
const renderer = await createRenderer(compiled);
const controller = new AbortController();
try {
  const report = await renderer.preflight({
    profile: 'auto', allowedProfiles: ['mp4', 'webm']
  });
  if (!report.supported || !report.selected) {
    showDiagnostics(report.diagnostics);
  } else {
    const result = await renderer.exportVideo({
      configuration: report.selected,
      target: { kind: 'memory' },
      signal: controller.signal,
      onProgress: showProgress
    });
    if (result.kind === 'blob') {
      offerDownload(result.blob, report.selected.extension);
    }
  }
} finally {
  await renderer.dispose();
  await compiled.dispose();
}
```

Implement `showDiagnostics`, `showProgress`, and `offerDownload` in the application. Use the selected configuration's extension for the download filename. With `profile: 'auto'`, the output may be MP4 or WebM.

For compositions with audio, preflight requires synchronization certification by default. Set `syncPolicy: 'allow-unverified'` only if the application accepts output whose synchronization has not been verified. See [sync certification](./diagnostics.md#sync-certification).

## Element registration

```ts
function registerElements(options?: {prefix?: string}): void;
```

Registers all `hv-*` custom elements. Call this function or import the `auto` entry before using the elements. Registering the same version again is safe; a name already registered by an incompatible version produces an error. A custom prefix applies to the complete element registry and parser mapping, and must be stored with the compiler environment.

## Web-component lifecycle notes

- Elements extend `HTMLElement` directly.
- On connection, parsing and preview compilation are scheduled after children are available.
- On disconnection, auto-owned sessions and listeners are released after a microtask check that allows for DOM moves.
- Source changes are coalesced into new preview revisions. If recompilation fails, the player keeps the last working revision and displays diagnostics. An export keeps the revision, props, assets, CSS, and plugin versions it started with, even if the source changes during rendering.

## Render manifest

Every successful export includes a manifest with the input hashes and versions, selected output configuration, frame and sample counts, synchronization status, warnings, and resource measurements. See [Render manifest](./diagnostics.md#render-manifest) for the recorded fields.

Raw source data, file bytes, credentials, private URLs, and file paths are excluded by default. Render duration may appear in diagnostics but does not affect frame state.
