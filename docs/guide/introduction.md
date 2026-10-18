# Introduction

HTMV (HyperText Markup Video) is a browser library for creating videos from HTML. Use it to build motion graphics, combine media clips, or generate videos from templates and data.

Each document describes a composition with a fixed duration. HTMV compiles the document into a timeline that you can inspect, preview, seek, and export. Rendering and encoding run in the user's browser, so export does not require uploading media to a render server.

The library provides the composition engine and a preview player. Applications can build their own timeline editor, asset browser, or authoring tools on top of its APIs.

## Design principle

Use `hv-*` elements for timing and animation, and supported HTML and CSS for the visuals. For example, this five-second composition fades in a heading over its first 24 frames:

```html
<hv-composition id="hello" width="1280" height="720" fps="30" duration="150f">
  <hv-scene duration="150f">
    <h1 id="headline">Made with HTML</h1>
    <hv-animation target="#headline" property="opacity"
                  duration="24f" from="0" to="1" fill="both"></hv-animation>
  </hv-scene>
</hv-composition>
```

## How it works

1. **Compile.** Parse and validate the HTML, expand templates and bindings, and prepare assets. The result is an immutable intermediate representation (IR) with a revision hash.
2. **Evaluate.** Calculate the scene state for a requested frame using exact rational time. The result does not depend on which frames were evaluated before it.
3. **Layout.** Measure supported HTML and CSS in an isolated browser document at the composition's dimensions.
4. **Paint.** Draw the measured content with Canvas 2D. Preview and export use the same painter.
5. **Export.** Check encoder support, render each output frame, and encode an MP4 or WebM file through WebCodecs and the media adapter.

## What v1 covers

| Category | Scope |
|---|---|
| Motion graphics | Typography, images, boxes, gradients, restricted SVG, transform/opacity/color animation, easing and springs |
| Composition | Nested timed sections, sequences, series, parallel layers, finite loops, freezes, reusable components |
| Editing | Local/remote clips, source trims, constant positive playback rates, cuts, overlapping scenes, transitions, clip audio |
| Audio | Multiple tracks, gain, mute, fades, looping, stereo mixdown, deterministic rate/pitch behavior |
| Captions | Inline cues and a defined WebVTT subset, burned-in captions, sidecar VTT generation |
| Templates | Typed input data, safe path bindings, keyed repetition, conditional templates, per-instance component props |
| Playback | Frame seek, play/pause, range playback, time/frame events, fit-to-container presentation |
| Export | Still images, finite video files, A/V synchronization, progress, cancellation, bounded queues, file output |
| Developer experience | Structured validation errors, capability report, inspectable compiled timeline, ESM and script-tag distribution |

## Limits

HTMV renders a defined [HTML and CSS subset](./text-and-css.md). It does not capture arbitrary webpages. Unsupported styling fails validation by default, so check the CSS profile before adapting an existing page.

Compositions must have a finite duration. The first release does not support live capture or streaming, DRM sources, reverse playback, speed ramps, optical flow, pitch-preserving time stretching, HDR, transparent video, or surround output.

You can author compositions without a UI framework. Bindings read data paths rather than execute JavaScript expressions. Lottie, Three.js, and custom canvas integrations can use the [plugin interface](/reference/plugins.md), which requires rendering at arbitrary timeline times.

## Deployment and browsers

The library is written in TypeScript and distributed as browser ES modules. An `auto` entry registers the custom elements for script-tag use.

Serve the application over HTTPS, or use `localhost` during development. Opening the page with `file://` is unsupported.

Desktop Chromium, Firefox, and Safari are target environments, subject to API and codec availability. Run [preflight](./export.md#capability-preflight) to check the actual input, output, and browser configuration. See the [implementation status](/implementation-status.md) for remaining browser validation work.

## Packages

| Package | Responsibility |
|---|---|
| `@htmv/core` | Rational time, timeline evaluator, animation, schema, diagnostics |
| `@htmv/compiler` | HTML parsing, template expansion, style validation, IR lowering |
| `@htmv/layout-dom` | Isolated layout document, box measurement, text layout |
| `@htmv/renderer-canvas` | Paint tree, surfaces, clipping, transitions |
| `@htmv/media` / `@htmv/media-mediabunny` | Adapter contracts; pinned media demux/decode/encode/mux |
| `@htmv/audio` | Block mixer, resampler, envelopes, channel mapping |
| `@htmv/exporter` | Capability selection, scheduler, writers, manifest |
| `@htmv/player` | Canonical canvas playback, audio bridge, controls |
| `@htmv/elements` | `hv-*` custom elements and registration |
| `@htmv/plugins` | Deterministic plugin interface |
| `@htmv/htmv` | Umbrella public API |

Start with `@htmv/htmv`, which exports the public API. The [JavaScript API reference](/reference/javascript-api.md) covers compilation, rendering, and export.

## Implementation status

The [implementation status](/implementation-status.md) lists implemented behavior, regression coverage, and remaining release checks. For the formal language and runtime requirements, see [`SPEC.md`](https://github.com/bookklik-technologies/htmv/blob/main/SPEC.md) in the repository.
