# Getting started

## Prerequisites

- A modern desktop browser (Chromium, Firefox, or Safari).
- An HTTPS server for deployment, or a local HTTP server for development. Serve the page through the server; opening it with `file://` is unsupported.

## Installation

### Script tag {#script-tag-no-build-step}

The repository examples use prebuilt browser bundles. From the repository root, install dependencies and build them:

```sh
npm install
npm run build
npm run serve:examples
```

Open `http://127.0.0.1:8899/examples/hello/index.html` to try the title animation. The page loads `examples/shared/htmv/auto.js`, which registers the custom elements. To use this bundle in another page, copy the generated `shared/htmv` directory and adjust the script URL to match its location.

The following composition runs for five seconds at 30 fps:

```html
<script type="module" src="./shared/htmv/auto.js"></script>

<hv-composition id="hello" width="1280" height="720"
                fps="30" duration="150f" background="#102030">
  <style>
    .title {
      position: absolute;
      left: 100px; top: 250px;
      width: 1080px; height: 120px;
      font-family: sans-serif;
      font-size: 80px; line-height: 1.2;
      color: white;
    }
  </style>

  <hv-scene duration="150f">
    <h1 id="headline" class="title">Made with HTML</h1>
    <hv-animation target="#headline" property="opacity"
                  duration="24f" from="0" to="1"
                  easing="cubic-bezier(0.22,1,0.36,1)"
                  fill="both"></hv-animation>
  </hv-scene>
</hv-composition>

<hv-player for="hello" controls></hv-player>
```

Write an explicit closing tag for every `hv-*` element. HTML does not treat custom elements as void tags.

This example uses `sans-serif`, so its appearance depends on the system font. Register a [font asset](./templates.md#assets) when the composition needs a specific typeface across environments.

### npm

In an application with a bundler, install the public package:

```sh
npm install @bookklik/htmv
```

Then import its public API:

```js
import { compile, createRenderer, registerElements } from '@bookklik/htmv';
```

Call `registerElements()` if the page uses the custom elements. For programmatic rendering, pass the source to `compile()` and create a renderer from the result. See the [JavaScript API reference](/reference/javascript-api.md#usage) for an export example.

Alternatively, `import '@bookklik/htmv/auto'` registers the custom elements on import.
The root import does not register them. The npm package includes compiled JavaScript,
TypeScript declarations, and runtime dependencies, so no engine checkout or internal
workspace packages are required. Canvas playback and media inspection are available
as `PlayerEngine` and `getMediabunnyAdapter` from the same root import.

## Timed ordinary elements

Add `data-hv-start` and `data-hv-duration` to a supported HTML element to control when it appears. These attributes affect visibility without adding a layout box:

```html
<p data-hv-start="30f" data-hv-duration="60f">Visible for two seconds.</p>
```

At 30 fps, this paragraph appears at one second and stays visible for two seconds. Without timing attributes, it inherits its containing scene's active interval. Other supported `data-hv-*` attributes are listed under [data binding](./templates.md#binding-vocabulary); unknown names fail validation.

## Source versus presentation

The composition element holds the source. Adding it to the page does not start playback. The `<hv-player>` displays the rendered canvas and provides playback controls.

Use the player to check the rendered result. A DOM layout or debug view may show browser styling that HTMV's painter does not support.

## Next steps

- [Time model](./time-model.md) — frames, rational fps, half-open intervals, determinism.
- [Composition and elements](./composition.md) — document grammar and defaults.
- [Animation](./animation.md) — declarations, keyframes, easing and springs.
- [Exporting video](./export.md) — capability preflight and MP4/WebM output.
- [Recipes](/reference/recipes.md) — complete, runnable compositions.
