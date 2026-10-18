# Composition and elements

A composition combines timeline elements with supported HTML content. This page explains how those elements nest and how their durations resolve. For individual attributes and defaults, see the [elements reference](/reference/elements.md).

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

- `hv-scene` and `hv-sequence` accept the same timeline and visual children. A scene creates a separate drawing surface at the composition's dimensions. A sequence groups timing without adding a layout box.
- Nested composition roots are invalid; reuse [templates](./templates.md) instead.
- All IDs are unique within the expanded instance tree. IDs duplicated by a template are rewritten to instance-local IDs.

## Common structural attributes

| Attribute | Values and default | Contract |
|---|---|---|
| `id` | Optional nonempty identifier | Stable diagnostic/reference ID |
| `start` | Time; `0` outside a series | Relative to parent; forbidden on direct series items |
| `duration` | Positive time or `auto` (media only) | Omitted means parent remainder unless element overrides |

These attributes apply only to the timeline elements listed in the reference. On ordinary HTML, use `data-hv-start` and `data-hv-duration`. Bare `start` or `duration` attributes on ordinary HTML fail validation.

## Duration inference

- Root duration is always explicit and frame-aligned.
- Scene/sequence/use/video/audio may use an explicit duration or the parent-remainder default. Media with `duration="auto"` resolves to `(trimOut − trimIn)/rate` after metadata loads.
- Each direct series item needs a duration that can be resolved independently: an explicit duration, media `auto`, or a length derived from its children. Inheriting the series remainder would create a circular dependency and fails validation.
- `hv-series` and `hv-loop` derive their lengths from their contents and reject a `duration` attribute. Wrap them in a sequence to clip their activity.
- Freeze and animation require explicit positive duration. Caption containers may inherit parent remainder.
- Source trims are nonnegative; `trim-out` is exclusive and cannot exceed the selected playable extent; `trim-in < trim-out`.
- A duration that extends beyond the source trim fails by default. Set `end-behavior="hold"` to hold the last video image, or `repeat="true"` to repeat an audio source.

## Default policy for media attributes

Track selection and timing defaults apply as follows:

- On `hv-video`, `track` selects the video track and `audio-track` selects the audio track. Both use zero-based indexes. With `audio="include"`, a source without audio contributes silence. Requesting an audio-track index that does not exist is an error.
- `start` is nonnegative everywhere except `hv-scene`/`hv-sequence`, which may have negative starts.
- `duration="auto"` is accepted only on media leaves. A timed node whose resolved remaining duration is nonpositive has no activity and produces a warning; a negative explicit duration is always invalid.

## Parsing and invalid input

Write boolean-valued library attributes explicitly, such as `repeat="true"` or `repeat="false"`. The player's `controls` and `loop` attributes follow HTML boolean semantics: their presence enables the option.

Compilation rejects:

- nonfinite numbers, malformed colors, zero dimensions;
- cyclic templates, undeclared assets, duplicate IDs after expansion;
- illegal parents, unsupported attributes, invalid selectors, ambiguous timing.

Diagnostics identify the affected composition, node, instance, and attribute where available, along with an error code and a suggested fix. The compiler collects independent validation errors where practical so you can address them together. See [Diagnostics and limits](/reference/diagnostics.md).

An empty composition is legal: it renders the root background and silence for the explicit root duration.
