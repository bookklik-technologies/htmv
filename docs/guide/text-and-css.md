# Text and CSS

HTMV uses the browser to measure supported HTML and CSS, then draws the result with Canvas 2D. The supported subset is checked at compile time so the painter receives content it can render.

## The browser constraint

Canvas `drawImage()` can draw images, video frames, canvases, and bitmaps. It cannot draw an arbitrary DOM element. HTMV therefore measures the source and paints the supported content itself:

1. Parse and sanitize the source into a consistent internal tree.
2. Expand templates and bindings, and freeze the assets and style inputs.
3. Create the layout in a separate same-origin document at the composition's dimensions. It uses a fixed reset, zero body margin, normal zoom, border-box sizing, and disabled scripts.
4. Measure box geometry in the browser. The [text-layout routine](#text-is-a-subsystem) supplies intrinsic dimensions for plain text leaves.
5. Record the untransformed boxes, styles, transforms, clips, and drawing order in a paint tree.
6. Draw the paint tree with Canvas 2D. Preview and export use the same evaluator, painter, and loaded fonts.

The separate document isolates layout. It cannot protect against malicious JavaScript already running on the host page.

## HTML subset

| Kind | Supported elements |
|---|---|
| Containers | `div, section, article, header, footer, main, aside` |
| Plain text leaves | `h1–h6, p, span, label` |
| Images | `img` |
| Declarations | native `template`, `style`, approved inert JSON blocks |
| SVG | restricted serialized subtree (see below) |
| Media | `hv-video` / `hv-audio` |
| Canvas | registered deterministic plugin output only |

- Containers may contain containers and text leaves. Direct non-whitespace container text becomes an anonymous leaf with inherited text style.
- A text leaf contains text and `br` elements only. Use separate leaves for text with different styles within a paragraph.
- Rejected: `iframe, object, embed`, form controls, executable scripts, navigation behavior, native video/audio, unknown custom elements, arbitrary shadow roots, unseekable animated images.

## Supported CSS profile

The following properties are supported after shorthand expansion. CSS variables and `calc()` can supply values for these properties; they do not extend the set of supported properties.

| Family | Supported properties and values |
|---|---|
| Layout | `display: block/flex/grid/none`; `position: static/relative/absolute`; `left/top/right/bottom`; `width/height` and min/max; `margin/padding`; `box-sizing: border-box` |
| Flex | direction/wrap/grow/shrink/basis, justify-content, align-items/content/self, row/column-gap; `order` must remain `0` |
| Grid | `grid-template-columns/rows`, `grid-auto-columns/rows/flow`, `grid-column/row`, `gap`, align/justify items/self/content; no subgrid/masonry |
| Geometry | px, %, em, rem, resolvable calc(); `vw/vh` use the composition dimensions |
| Background | color; one background-image layer: validated raster URL or linear-gradient with sRGB stops; `background-size/position`; `no-repeat` |
| Border | solid/none, per-edge width/color, circular or elliptical `border-radius` px/%; no border-image |
| Clip | `overflow: visible/hidden` and rounded border clips; no `clip-path` |
| Transform | finite 2D translate/rotate/scale/skew/matrix; `transform-origin` px/%; [animation restrictions](./animation.md#property-registry) apply |
| Alpha | `opacity` 0–1 applied to isolated groups |
| Text | font-family/size/weight/style; `line-height` numeric/px; `text-align left/right/center/start/end`; `direction ltr/rtl`; `white-space normal/pre/pre-wrap`; `overflow-wrap normal/anywhere`; `text-transform none/uppercase/lowercase` with frozen locale |
| Decoration | `text-decoration-line none/underline/line-through`, solid current-color decoration |
| Image | `object-fit fill/contain/cover`, `object-position` px/% |
| Visibility | `visibility: visible/hidden` (hidden retains geometry); `display: none` removes subtree |

The browser calculates flex and grid geometry. When boxes overlap, HTMV draws them in DOM order; browser stacking-context rules do not apply.

Strict validation rejects `z-index`, floats, sticky or fixed positioning, CSS order changes, 3D transforms, perspective, filters, backdrop filters, blend modes, shadows, masks, pseudo-elements, list markers, vertical writing, columns, justification, hyphenation, rich inline text, variable-font-axis animation, scrolling, and native CSS animations or transitions.

For debugging, set `stylePolicy: 'ignore-unsupported'` to omit unsupported declarations and report diagnostics. This policy applies to both preview and export.

## Geometry and compositing

- Boxes are measured with transforms neutralized, then drawn with their resolved transforms. A rotated bounding rectangle is not used to infer the original size.
- DOM writes and layout reads are batched. Fractional coordinates are retained.
- One composition pixel maps to one export pixel. Player scaling and `devicePixelRatio` do not change export dimensions.
- Scenes and opacity groups use bounded, reusable surfaces. Overflow does not expand them to the size of an arbitrary page.

### Rounded corners

Corner radii retain separate horizontal and vertical values. For example, `border-radius: 24px / 12px` creates elliptical corners. Percentage radii resolve against the border-box width horizontally and height vertically, so `border-radius: 50%` on a rectangular box creates an ellipse.

When adjacent corner radii exceed an edge length, all horizontal and vertical radii are reduced by one common factor to fit the box, following CSS overlap reduction. Background fills and `overflow: hidden` clips use the resolved corner shape. Solid borders with equal widths on all four edges follow the rounded outline; unequal edge widths use rectangular edge painting.

## Text layout {#text-is-a-subsystem}

Canvas shapes and draws a line of text, but it does not wrap paragraphs. HTMV calculates the line breaks, then draws each complete line to preserve kerning, ligatures, and script shaping:

1. Resolve the content width, font bytes, style, weight, size, direction, and locale.
2. Normalize whitespace for the selected mode and preserve explicit line breaks.
3. Find break opportunities with a version-pinned Unicode line-break implementation. Emergency wrapping uses grapheme boundaries.
4. Fit lines greedily using the same Canvas font and context used for drawing. Remove trailing collapsed spaces before measuring and painting.
5. Position baselines using a fixed metrics policy and the line height. In `normal` mode, an unbreakable word may overflow.
6. Draw each complete line with its direction and alignment. The `maxWidth` argument to `fillText()` is not used for wrapping.
7. Cache by text, font hash, style, locale, direction, and width. Invalidate the cache when text or layout changes.

Uniform-style RTL and complex-script lines use the browser's Canvas shaping. V1 does not support mixed styled bidirectional text or vertical writing. Pixel reference images are specific to the browser and font environment.

## SVG and images

An SVG renders as one image leaf. The supported subset includes paths, basic shapes, gradients, `viewBox`, and validated text with registered fonts where supported. Scripts, event handlers, `foreignObject`, animation, external references, filters, and unresolved URLs are rejected. Use path-only SVG when portability matters.

Images must finish decoding before rendering. Convert animated GIF or WebP files to supported video, or use a plugin that can seek to an arbitrary frame. The static image path rejects them. Failed assets produce errors rather than empty frames.

## Neutral defaults

After template expansion, sequence, series, loop, and freeze wrappers use internal `display: contents` markers. They create no containing block and cannot receive author styles. Add a supported `div` when you need a layout or transform group. Scenes use absolutely positioned, composition-sized boxes.

Browser defaults for headings and paragraphs are reset. Margins and padding start at zero; font and color inherit. The root defaults are 16px sans-serif, black text, and `line-height: 1.2`. Headings are not bold automatically, so set their styles explicitly. The root font size defines `rem`.

On `hv-video`, use the `fit` and `position` attributes. Omit CSS `object-fit` and `object-position` on that element. For `img`, use the CSS properties.
