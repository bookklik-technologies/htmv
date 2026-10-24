# HTMV — HyperText Markup Video

Create video compositions with HTML and CSS. Preview them in the browser, seek
to exact frames, and export MP4 or WebM with Canvas 2D and WebCodecs.
No render server, headless browser, or server-side FFmpeg is required at runtime.

[Documentation](https://bookklik-technologies.github.io/htmv/) ·
[Getting started](docs/guide/getting-started.md) ·
[Examples](docs/examples.md) ·
[API reference](docs/reference/javascript-api.md)

## Meet HTMV in 60 seconds

[![Watch the HTMV product introduction: Write HTML. Make video.](examples/shared/posters/product-intro.png)](examples/product-intro/htmv-product-introduction.mp4)

[Watch the introduction (MP4)](examples/product-intro/htmv-product-introduction.mp4).
Made with HTMV: eight chapters covering composition, timing, templates, media,
export, and plugins. See the [film source and chapter guide](examples/product-intro/README.md).

> **Status:** implements [SPEC.md](SPEC.md), revision 1.0 (17 October 2026),
> with automated regression coverage. Full conformance, long-export budgets,
> and browser/profile certification remain release gates.
> See [implementation and validation status](docs/implementation-status.md).

## What you can build

- **HTML compositions:** scenes, clips, and animations using `hv-*` elements and supported CSS.
- **Exact timelines:** frame counts, rational frame rates, loops, freezes, and transitions.
- **Reusable templates:** JSON props, components, repeated items, and conditional content.
- **Media and captions:** trimmed video, layered audio, gain and fades, burned-in captions, and WebVTT.
- **Browser exports:** MP4/WebM, still images, progress, cancellation, and render manifests.
- **Custom rendering:** deterministic plugins with seeded randomness.

## Quick start

For a browser application with a bundler, install the published package:

```sh
npm install @bookklik/htmv
```

```js
import { compile, createRenderer, PlayerEngine, getMediabunnyAdapter } from '@bookklik/htmv';
// Optional: register hv-* elements automatically in the browser.
import '@bookklik/htmv/auto';
```

The root import does not register custom elements. Call `registerElements()` explicitly
or import `/auto` when using them. Version `0.1.2` includes compiled ESM, TypeScript
declarations, and runtime dependencies; no sibling checkout or internal `@htmv/*`
packages are needed. The npm package contains the runtime, while the repository
contains the examples and documentation.

From the repository root, install dependencies, build the browser bundles, and
start the example server:

```sh
npm install
npm run build
npm run serve:examples
```

Open **http://127.0.0.1:8899/** for the gallery, or
**http://127.0.0.1:8899/examples/hello/index.html** for a title animation.
Any static HTTP server serving the repository root, including WAMP, also works.

The examples load `examples/shared/htmv/auto.js`, which registers the custom
elements. To use the bundle in another page, copy the generated `shared/htmv`
directory and adjust the script URL. This composition runs for five seconds:

```html
<script type="module" src="./shared/htmv/auto.js"></script>

<hv-composition id="hello" width="1280" height="720"
                fps="30" duration="150f" background="#102030">
  <hv-scene duration="150f">
    <h1 id="headline"
        style="position:absolute;left:100px;top:250px;font-size:80px;color:#fff">
      Made with HTML
    </h1>
    <hv-animation target="#headline" property="opacity"
                  duration="24f" from="0" to="1" fill="both"></hv-animation>
  </hv-scene>
</hv-composition>

<hv-player for="hello" controls></hv-player>
```

For programmatic use, import `compile` and `createRenderer` from `@bookklik/htmv`.
See the [API usage example](docs/reference/javascript-api.md#usage) for compilation,
capability preflight, export, and resource cleanup.

## Examples

All six examples include local assets, composition source, frame stepping,
PNG capture, and cancellable MP4/WebM export with capability preflight.

| Example | Explore |
| --- | --- |
| [Product introduction](examples/product-intro/index.html) | A 60-second film with chapter preview/export, real media, templates, and plugins. Includes a rendered MP4 and manifest. |
| [Hello](examples/hello/index.html) | Edit a headline and see automatic player recompilation. |
| [Data template](examples/data-template/index.html) | Drive repeated components and number animations with typed metrics. Invalid revisions preserve the working preview. |
| [Edited story](examples/edited-story/index.html) | Trim video, crossfade clips, mix audio, adjust gain/fades/repetition, and download captions. |
| [Hold and loop](examples/hold-and-loop/index.html) | Change frozen source time and loop count; inspect rational frame times at `30000/1001` fps. |
| [Seeded plugin](examples/seeded-plugin/index.html) | Change particle counts and compare pixels when rendering frames in shuffled order. |

Audio examples use strict synchronization preflight and offer an explicit option
to accept unverified output. Successful exports offer a render manifest.
See [media provenance and regeneration](examples/shared/media/README.md) to recreate
the clips, synthesized audio, posters, and introduction film.

## Documentation

- [Getting started](docs/guide/getting-started.md): installation and your first composition.
- [Element reference](docs/reference/elements.md): supported elements and attributes.
- [JavaScript API](docs/reference/javascript-api.md): compilation, rendering, and export.
- [Recipes](docs/reference/recipes.md): complete composition examples.
- [Implementation status](docs/implementation-status.md): regression coverage and remaining release evidence.

## Packages

`@bookklik/htmv` is the installable public package. The following internal workspace
packages are bundled into it and do not need separate installation:

| Package | Responsibility |
| --- | --- |
| `@htmv/htmv` | Public API: `compile()`, `createRenderer()`, and `registerElements()`. |
| `@htmv/core` | Rational timing, clock transforms, easing, seeded randomness, and diagnostics. |
| `@htmv/compiler` | HTML/CSS validation, template expansion, timing resolution, and immutable IR. |
| `@htmv/layout-dom` | Isolated DOM measurement and text layout. |
| `@htmv/renderer-canvas` | Canvas 2D painting, clipping, text, captions, and transitions. |
| `@htmv/audio` | Bounded-block mixing, fades, repetition, resampling, and clipping reports. |
| `@htmv/media` | Media adapter contracts and bounded resource limits. |
| `@htmv/media-mediabunny` | Media inspection, frame decoding, and MP4/WebM muxing via `mediabunny@1.61.6`. |
| `@htmv/exporter` | Codec preflight, offline A/V scheduling, output writers, and render manifests. |
| `@htmv/player` | Playback, seeking, range loops, and events. |
| `@htmv/elements` | `hv-*` custom elements and player controls. |
| `@htmv/plugins` | Plugin preparation, seeded randomness, and isolated rendering. |

## Development

```sh
npm run typecheck     # TypeScript across all packages
npm run build         # Packages and browser ESM bundles
npm run build:package # npm runtime and self-contained declarations only
npm run docs:dev      # Local documentation server
npm run docs:build    # Static documentation site
```

Test commands, subject to any permission requirements in `AGENTS.md`:

```sh
npm test              # Unit tests
npm run test:browser  # Playwright conformance and parity regressions
```

`npm pack` runs the package build through `prepack` and creates
`bookklik-htmv-0.1.2.tgz`. See the [npm release guide](https://bookklik-technologies.github.io/htmv/reference/npm-package.html)
for isolated consumer verification and publication instructions. Packaging does not
run unit tests or publish a release.

## Limits

- Only the supported HTML/CSS subset renders; strict validation rejects unsupported CSS.
- Codec availability depends on the browser. Audio preflight reports
  `E_AUDIO_DELAY_UNVERIFIED` until the profile has synchronization evidence.
  Use `syncPolicy: 'allow-unverified'` only when explicitly accepting that warning.
- Timeline evaluation is exact; cross-device pixel and byte identity are not promised.
- Version 1 excludes reverse playback, time ramps, pitch preservation, HDR,
  transparent-video export, and resumable renders.
- Input limits default to **256 MiB per asset**, **512 MiB per composition**,
  **8,192 pixels per image dimension**, and **33,554,432 pixels per image**.
  These do not cap total browser memory.

<details>
<summary>Resource policies, concurrency, and measurement boundaries</summary>

Override input limits through [`resourcePolicy`](docs/reference/javascript-api.md#resourcepolicy):

```js
const compiled = await compile(source, {
  resourcePolicy: {
    maxAssetBytes: 256 * 1024 * 1024,
    maxTotalAssetBytes: 512 * 1024 * 1024,
    maxImageDimension: 8192,
    maxImagePixels: 33_554_432
  }
});
```

Values must be finite positive safe integers. Response bytes are checked while
streaming, regardless of `Content-Length`; supplied Blobs and custom-loader results
also undergo admission checks. Repeated resource references reuse preparation.
Limit failures reject compilation with `E_RESOURCE_LIMIT`.

A custom `AssetLoader` receives an optional second argument `{ maxBytes, signal }`
and remains responsible for its own allocations before returning. Metadata-only
results cannot establish a byte-memory bound for resources retained by the loader.
Image results must include frozen Blob bytes so layout never refetches a raw URL.
CSS URLs, including custom properties and `var()` fallbacks, use the configured
loader before layout. Unsupported fetching functions and imports never reach the
layout document, including in permissive style mode.

Hashing, image inspection, rendering, and native codecs need additional memory.
Image inspection can allocate native decode resources before dimensions are
available; rejected bitmaps are closed before renderer surface allocation.

Interactive frame/still requests reject with `E_BUSY` during an export on the same
renderer. Use a separate session for concurrent previews. Playback keeps one render
active and replaces pending presentation work with the latest desired frame;
superseded seeks reject with `AbortError`.

Render-manifest high-water values have type `number | null`. A `null` value means
adapter/native internals cannot be measured. `decodedFramesMax` measures
library-owned prepared video canvases, including a replacement canvas while the
previous canvas is held. `pcmBlockBytesMax` measures canonical mixer block arrays
(accumulators, output, and resampler windows), excluding source PCM caches and
browser codec memory. `encoderQueueMax` and `muxQueueBytesMax` are currently `null`.
These metrics do not certify total memory.

</details>
