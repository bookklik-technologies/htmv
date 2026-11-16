# Creative compositions and SenangStart

HTMV is a composition engine, not a fixed design system. The example gallery is
not a layout whitelist. Author your own supported HTML, flex/grid layouts,
absolute-positioned layers, typography, images, SVG artwork, and frame-based
animation in any combination. Keep within the [supported CSS profile](./text-and-css.md),
not within an example's visual style.

## Vary the composition, not just the palette

Choose spatial structure, visual language, and motion independently:

| Dimension | Directions to explore |
| --- | --- |
| Structure | Asymmetric editorial columns, oversized type, orbiting motifs, overlapping paper, modular arrangements, diagonal bands, full-bleed media |
| Hierarchy | One dominant word, quiet captions, a large icon as the subject, shapes framing negative space, image-led storytelling |
| Shape language | Geometric, botanical, organic, orbital, angular, stepped, outlined, duotone |
| Palette | Warm paper and ink, high-contrast monochrome, muted earth tones, saturated primaries, custom brand colors |
| Format | Landscape presentation, portrait story, square announcement, or any supported composition dimensions |
| Motion | Staggered entrances, restrained translation, rotating accents, scale changes, scene transitions, or custom deterministic plugins |

These are prompts, not required categories. Avoid giving every scene the same
centered heading and repeated card grid. Vary alignment, scale, content density,
negative space, and motif placement while keeping text readable. Decorative
assets should support the message rather than compete with it. For a new custom
layout, begin with a blank `hv-scene`; no preset registration is necessary.

The [creative studio](../examples.md#creative-studio) offers twelve editable starting
directions, independent palettes, and landscape/portrait/square adaptations.
Copy its currently applied composition source, then move, remove, resize, or
replace any layer. Adjust the local font URL when moving source into another project.

### More starting directions

The original split, poster, orbit, collage, gallery, and banner are joined by:

| Layout | Composition idea |
| --- | --- |
| Pull-quote editorial | Oversized quotation mark, left-hand rule, and a quiet attribution line |
| Event ticket | Inset paper panel and a perforated stub that moves below the message in portrait |
| Three-step journey | Numbered, staggered entrances along a horizontal or vertical connecting line |
| Object showcase | A single shape on a pedestal, beside the title or below it in portrait |
| Kinetic type bands | Opposing horizontal word motion around a stationary headline |
| Illustrated report | Three illustrative bars, explicitly labeled sample data, and a small shape accent |

All twelve share the headline, supporting line, palette, and asset controls.
Journey labels and band words are editable in the copied source; report bars
are illustrative geometry, not measured values or live analytics. Playback and
export use the same six-second, frame-based composition.

## SenangStart Icons and Shapes

Use the optional entrypoint from a build containing this integration:

```js
import {
  senangIcon, senangShape, senangIconNames, senangShapeCatalog
} from '@bookklik/htmv/senangstart';

const iconSource = senangIcon('sparkles', {
  color: '#232c28',
  thickness: 1.5
});
const shapeSource = senangShape('soft-nova', {
  variant: 'duotone',
  primary: '#cf492e',
  secondary: '#dfb96e'
});

const composition = `<hv-composition id="creative" width="1280" height="720"
  fps="30" duration="180f" background="#f5f0e8">
  <hv-scene duration="180f">
    <img id="shape" src="${shapeSource}" alt=""
      style="position:absolute;left:760px;top:130px;width:420px;height:420px">
    <img id="icon" src="${iconSource}" alt=""
      style="position:absolute;left:100px;top:100px;width:96px;height:96px">
    <hv-animation target="#shape" property="rotate" duration="180f"
      from="-12deg" to="12deg" fill="both"></hv-animation>
  </hv-scene>
</hv-composition>`;
```

Pass `composition` to the normal `compile()` / `createRenderer()` API. In this
repository's browser examples, import from `../shared/htmv/senangstart.js` after
running `npm run build`. When distributing a copied browser bundle, also include
`dist/senangstart.LICENSE.txt`. This entrypoint is separate from the core and
`/auto`: applications that do not import it do not load the catalogs. The integration is
an addition to the local source, not a claim that previously published releases
already provide the entrypoint.

### Discover assets and variants

- `senangIconNames` is a sorted, read-only list of supported icon names.
- `senangShapeCatalog` contains `name`, human-readable `label`, `category`,
  `variants`, and `defaultVariant` for every shape.
- `senangIcon(name, options?)` returns an SVG data URL. Set `color` and optionally
  a finite, positive `thickness` in source SVG units.
- `senangShape(name, options?)` returns an SVG data URL. Set `color` for
  monochrome shapes, `primary` / `secondary` for duotones, and an available
  `variant` (`solid`, `outline`, `duotone`, or `tonal`, depending on the shape).
  Omit `variant` to use that shape's catalog default. Optional `thickness`
  replaces existing strokes; it does not turn a filled shape into an outline.
- Unknown names and unavailable variants throw descriptive errors instead of
  silently rendering empty artwork.

Colors accept hex, named colors, `transparent`, and comma-separated numeric
`rgb()` / `rgba()` values in range. CSS variables and inherited `currentColor`
are not inputs: each selected SVG receives explicit colors before rendering.
Resize via the image's CSS `width` and `height`. Recreate the source to change
artwork colors; animate the image or its container for motion and opacity.

### Why image sources instead of live components?

SenangStart's browser web components and CSS masks are useful in normal web UI,
but HTMV does not execute source scripts, capture shadow DOM, or paint arbitrary
browser CSS. Placing `<ss-icon>`, `<ss-shape>`, icon-font classes, or mask classes
directly inside a composition is not this integration's authoring contract.

The helpers bundle the pinned upstream SVG collections, resolve their color
tokens, and give each SVG intrinsic dimensions. Returned data URLs use ordinary
`img` leaves, so HTMV admits and freezes their bytes with its usual image path.
The same source can be used for playback, frame capture, and video export without
a runtime CDN request. Portable font requirements still apply to text, and
browser codec/preflight constraints still apply to exports.

The source collections are `@bookklik/senangstart-icons@1.0.17` and
`@bookklik/senangstart-shapes@0.1.2`. Their MIT license notices ship alongside
the optional module in `dist/senangstart.LICENSE.txt`.
