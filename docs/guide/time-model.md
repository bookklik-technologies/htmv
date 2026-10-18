# Time model

HTMV calculates each frame directly from its position on the timeline. Seeking to frame 90 produces the same scene state whether the previous request was frame 89, frame 200, or no frame at all.

## Canonical time

The engine stores time as reduced fractions with `BigInt` numerators and positive denominators. Serialized IR stores those integers as decimal strings to preserve precision in JSON.

`fps` is a positive integer or a reduced rational string:

```html
<!-- Other required composition attributes omitted. -->
<hv-composition fps="30"></hv-composition>
<hv-composition fps="30000/1001"></hv-composition>
```

Use `30000/1001` for that fractional frame rate. The decimal `29.97` is a different value and is rejected as an `fps` attribute.

## Time values

A time attribute accepts a decimal number followed by `f`, `s`, or `ms`:

| Form | Meaning |
|---|---|
| `150f` | 150 frames at the composition's output frame rate |
| `10s` | 10 seconds, parsed as an exact rational |
| `500ms` | 0.5 seconds, parsed as an exact rational |

Only zero may omit its unit. SMPTE timecode and drop-frame labels are not supported in time attributes.

The root `duration` must resolve to a positive integer number of output frames. For example, `10s` is 300 frames at 30 fps, but falls between frame boundaries at `30000/1001` fps. In that case, use an explicit frame count such as `300f`, or choose another aligned duration. See [`E_ROOT_FRAME_ALIGNMENT`](/reference/diagnostics.md). Nested timings may fall between output frame boundaries.

## Frame sampling

For fps P/Q:

- Frame `n` samples composition time `t(n) = n × Q/P` seconds.
- Valid frames are integers `0 ≤ n < N`.
- Composition duration is `T = N × Q/P`. The endpoint `T` is excluded.
- A still or seek request outside `[0, N−1]` is rejected.

## Active intervals

Timeline and cue intervals include their start and exclude their end: `[start, end)`. A node becomes inactive exactly at its end. Its descendants can paint or emit audio only while the node and all its ancestors are active.

- An absent child duration inherits the parent's remaining interval (except where a series needs a finite, independently resolvable child length).
- Negative starts are allowed on explicit scenes/sequences to begin before the root; negative durations are never valid. A node starting beyond its parent's end has an empty effective interval and emits a warning.
- Inactive visual nodes keep their layout geometry. Changing timeline activity therefore does not reflow neighboring content.

## Local clocks

Given parent time `tp` and node start `b`:

| Node kind | Local time |
|---|---|
| Ordinary timed node | `local = tp − b` |
| Sequence / scene | Pass that local time to descendants |
| Loop | `iteration = floor(local/L)`, `childTime = local − iteration×L` |
| Freeze | Descendants receive the fixed sample time declared by `at` |
| Media | `sourceTime = trimIn + local × rate` (after structural clocks resolve) |

Example: an outer scene starts at `60f` and an inner sequence at `15f`; at root frame 90 the inner local time is `15f`. A loop boundary at exactly `L` belongs to the next iteration, time zero.

In v1, `rate` is supported on media elements only. Containers do not scale their descendants' clocks.

## Determinism and random seeking

Frame evaluation uses frozen inputs and does not depend on playback history. Engine and plugin code must follow these rules:

- Never integrate animation by accumulated delta time.
- Never use wall-clock time, unconstrained `Math.random()`, timers, layout-dependent network requests, or media playheads as render inputs.
- Random functions derive from `(compositionSeed, nodeStableKey, userChannel, sampleIndex)` through a versioned SHA-256 PRNG — random v1 UTF-8 encodes those fields as a JSON array, hashes with SHA-256, and takes the first 53 digest bits divided by 2⁵³. Loop iteration affects a channel only when it is explicitly declared iteration-varying.
- Pixel comparisons require the same browser, fonts, and dependencies. Timeline state must remain identical across environments; pixels and encoded file bytes may differ.

## Timestamp quantization

WebCodecs timestamps use integer microseconds. Each endpoint is computed independently:

```text
us(n) = roundHalfUp(1,000,000 × n × Q/P)
```

Frame `n` lasts `us(n+1) − us(n)` microseconds. Computing each endpoint separately avoids the drift that would result from repeatedly adding a rounded frame duration. Audio uses its own rational sample clock.

## Numeric guards

- All JavaScript-facing frame counts/indexes must be safe integers.
- Standard export profiles accept 1–240 fps. Higher frame rates require a separate profile.
- Configurations that produce a zero or negative integer-microsecond frame duration are rejected.
- Integer timestamp endpoints must match the specified rounding result exactly.
