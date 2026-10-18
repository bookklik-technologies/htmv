# Plugins

Plugins add custom rendering or media integrations. Use them for tools such as Lottie or Three.js, or for your own canvas renderer. A plugin must produce the requested frame from the supplied timeline time, without relying on previous playback.

## Interface

```ts
interface HtmvPlugin {
  id: string;
  version: string;
  execution: 'main' | 'worker' | 'either';
  capabilities: readonly string[];
  validate(input: JsonObject): readonly Diagnostic[];
  prepare(context: PrepareContext): Promise<PreparedPlugin>;
}

interface PreparedPlugin {
  render(context: PluginFrameContext): void | Promise<void>;
  dispose(): void | Promise<void>;
}

interface PluginFrameContext {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  rootTime: RationalTime;
  localTime: RationalTime;
  frame: number;
  iteration: number;                    // innermost loop index; 0 outside loops
  iterationPath?: readonly number[];    // all nested indexes, read-only
  props: Readonly<JsonObject>;
  random(channel: string, sampleIndex: number): number;
  signal: AbortSignal;
}
```

Register plugins with `compile(source, { plugins: [...] })`. See [CompileOptions](./javascript-api.md#compileoptions).

## Using a plugin in HTML

Plugin output occupies a canvas leaf declared inside a composition:

```html
<canvas data-hv-plugin="my-registered-plugin" width="640" height="360"
        data-hv-plugin-props='{"speed":0.5}'></canvas>
```

- `data-hv-plugin` must reference a registered plugin id; unregistered canvases are rejected.
- `data-hv-plugin-props` is inert JSON.
- Explicit logical width/height are required.
- `render()` draws into a separate surface. The engine then applies box fitting, transforms, ancestor opacity, clips, and transitions as it does for other image leaves.
- Each render starts with a cleared surface and has a finite time budget. The engine saves and restores painter state, and waits for asynchronous rendering to finish before marking the frame ready. A timeout fails the frame.

## Determinism requirements

- Declare and fetch network assets during `prepare()`. Rendering must not fetch additional undeclared resources.
- `PrepareContext` provides asset readers, frozen props, dimensions, an abort signal, and a diagnostic sink.
- Support arbitrary local times and verify rendering in shuffled frame order. Immutable caches are allowed; a previous frame's simulation state must not affect the output.
- Use `random(channel, sampleIndex)` for seeded randomness. It follows the engine's SHA-256 scheme.

## Freeze, clocks, and geometry

- Plugins under freeze receive the frozen local timeline time after descendant start offsets.
- The engine composes plugin leaf output through the standard paint pipeline (transforms, clips, group opacity, transition surfaces).
- Main-only plugins prevent that subtree from moving into a render worker; GPU-dependent plugins must report it during preflight.

## Trust

Plugins run as trusted application JavaScript. The engine does not sandbox them. Source-document isolation, CSS URL validation, and composition resource limits do not constrain what plugin code can do internally.

Adapter guidance:

- Lottie, Three.js, and WAAPI adapters must pause their own clocks, sample the requested time directly, and wait for rendering to finish.
- Keep plugin dependency versions pinned; record them in the render manifest (`dependencies`).
