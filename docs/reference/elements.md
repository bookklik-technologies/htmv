# Elements and attributes

Use this reference to look up `hv-*` attributes and defaults. The [guides](/guide/introduction.md) explain how timing, layout, and media rules interact.

## Content model

```text
hv-composition
  ├─ style, inert JSON data, template definitions, hv-assets
  ├─ hv-scene / hv-sequence / hv-series / hv-loop / hv-freeze
  └─ supported visual HTML, hv-video, hv-audio, hv-captions, hv-use

hv-series → alternating timed visual items and optional hv-transition
hv-animation → zero or more hv-keyframe children
hv-captions → hv-cue children OR one caption source
hv-assets → hv-asset declarations only
```

Scenes create separate drawing surfaces at the composition's dimensions. Sequences group timing without adding layout boxes. Composition roots cannot be nested; use templates to reuse content.

## Common structural attributes

| Attribute | Values and default | Behavior |
|---|---|---|
| `id` | Optional nonempty identifier | Stable diagnostic/reference ID |
| `start` | Time; `0` outside a series | Relative to parent; forbidden on direct series items; negative only on `hv-scene`/`hv-sequence` |
| `duration` | Positive time or `auto` (media only) | Omitted means parent remainder unless element overrides |

On ordinary HTML, use `data-hv-start` and `data-hv-duration`. Boolean-valued library attributes require the literal strings `true` or `false`; the player's `controls` and `loop` attributes use HTML presence semantics.

## Elements

| Element | Required attributes | Optional attributes and defaults | Behavior and children |
|---|---|---|---|
| `hv-composition` | `id`, `width`, `height`, `fps`, `duration` | `background="#000000"`, `sample-rate="48000"`, `channels="2"`, `seed="0"` | Root only. Positive integer CSS-pixel dimensions. Sample rate 44100 or 48000; channels 1 or 2 |
| `hv-assets` | none | none | One root-level asset registry; no visual output |
| `hv-asset` | `id`, `kind`, `src` | Fonts: `family`, `weight="400"`, `font-style="normal"`; optional `integrity` | `kind`: image/video/audio/font/captions/json; font requires family; no children; `integrity` uses `sha256-BASE64` digests |
| `hv-scene` | none | Common timing | Isolated surface; fills composition viewport; nested scenes use the same unscaled logical viewport |
| `hv-sequence` | none | Common timing | Transparent time scope; no independent CSS layout box |
| `hv-series` | none | `start="0"` | Duration derived from items minus overlaps; clips to parent; rejects author `duration` |
| `hv-transition` | `duration` | `type="crossfade"`, `direction="left"` | Only between direct series items; type `crossfade`/`slide`/`wipe`; direction `left/right/up/down` applies to slide/wipe |
| `hv-loop` | `iteration-duration`, `count` | `start="0"` | Positive iteration duration; integer count ≥ 1; total is the product; finite only; rejects author `duration` |
| `hv-freeze` | `at`, `duration` | `start="0"` | Visual descendants evaluated at fixed local time; audio descendants forbidden (`E_FREEZE_AUDIO`) |
| `hv-video` | `src` | Common timing, `trim-in="0"`, `trim-out`, `rate="1"`, `audio="include"`, `gain="1"`, `fit="cover"`, `position="50% 50%"`, `end-behavior="error"`, `track`, `audio-track` | Visual leaf; `audio` `include`/`mute`; rate 0.25–4; fit `cover`/`contain`/`fill` |
| `hv-audio` | `src` | Common timing, `trim-in`/`trim-out`/`rate`/`gain` as video, `repeat="false"`, `fade-in="0"`, `fade-out="0"`, `track` | Nonvisual leaf; rate 0.25–4; pitch follows rate; repetition only via explicit `repeat` |
| `hv-animation` | `target`, `property`, `duration` | `start="0"`, `from`, `to`, `easing="linear"`, `fill="none"`, `mode="replace"` | Use either `from`/`to` attributes or `hv-keyframe` children |
| `hv-keyframe` | `offset`, `value` | `easing="linear"` | Declaration; offset number 0–1, strictly increasing |
| `hv-captions` | inline cues OR `src` | `start="0"`, `duration` | Timed viewport-size caption overlay; source VTT times relative to this node; cue content is safe plain text |
| `hv-cue` | `start`, `end` | none | `end > start`; plain text; half-open window relative to the captions node |
| `hv-use` | `template` | Common timing, `props="{}"` | Instantiates a template component; `props` is a strict JSON object |
| `hv-player` | `for` | Boolean `controls`, `loop`; `fit="contain"` | Host UI outside the composition; no output pixels/controls are baked into the film |

Additional rules:

- `track` is a zero-based index for the relevant media kind. If omitted, it selects the adapter's primary track. On `hv-video`, `audio-track` selects the audio track independently.
- `src` is a URL or `asset:ID`; `template` is a component ID reference such as `#stat-card`.
- `end-behavior` accepts `error` or `hold`. Holding extends the video image; audio becomes silent after its selected interval. To repeat audio, set `repeat="true"` on an audio element.
- Media `trim-out` defaults to the end of the selected primary playable extent; trims are validated against the video/movie playable extent (`duration="auto"` resolves to `(trimOut − trimIn)/rate`).
- Supported visual boxes/leaves, `hv-scene`, `hv-video`, `hv-audio` gain, and registered plugin leaves are animation targets; structural wrappers (sequence/series/loop/freeze/use) are not.
- Supported visual nodes accept `id`, `class`, `style`, `lang`, and `dir`. Inline styles follow the [CSS profile](/guide/text-and-css.md#supported-css-profile). Unknown library attributes fail validation.

## Time value grammar

```text
<decimal>f   frames at the composition's output rate    e.g. 150f
<decimal>s   seconds, parsed as an exact rational       e.g. 10s
<decimal>ms  milliseconds, parsed as an exact rational  e.g. 500ms
0           the only unitless time value
fps         positive integer or reduced fraction      e.g. 30, 30000/1001
```

Root `duration` must resolve to an exact positive integer frame count.
