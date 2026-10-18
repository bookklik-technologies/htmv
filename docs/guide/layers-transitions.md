# Layers, series and transitions

Use source order to layer content, `hv-series` to arrange clips in sequence, and `hv-transition` to overlap adjacent items. Loops and freezes change the local time passed to their children.

## Layout and visual order

Each scene has its own composition-sized drawing surface. Sequences, series, loops, and timed visibility wrappers add timing without adding layout boxes. Supported HTML and visual media elements provide the boxes that the browser measures.

Within a surface, the painter draws a node's background and border, then its children in expanded DOM order. Parallel scenes are also composited in source order. To place captions over graphics and footage, put the caption node after those elements.

- CSS `z-index` and browser stacking-context rules are unsupported in v1.
- Group opacity applies to the combined group surface. Applying the same opacity separately to overlapping children would produce a different image.
- Parent transforms, rectangular overflow clips, and rounded clips propagate through a resolved transform/clip stack.

## Series

A series lays out its items in sequence with optional overlap transitions. For item lengths `D0…Dk` and transition overlaps `O0…O(k−1)`:

```text
start(i+1)   = start(i) + Di − Oi
seriesLength = sum(Di) − sum(Oi)
```

The compiler checks the following constraints:

- An omitted transition is a hard cut with overlap zero.
- Each overlap must be positive and strictly less than each **neighboring** item's length.
- For a middle item, the incoming and outgoing overlaps together cannot exceed its length. This prevents three items from overlapping at once.
- An explicit `start` on a direct series item is invalid (items are placed by the series).
- Transition progress `p` is `0` at overlap start and approaches `1` at overlap end, computed with exact rational elapsed time and converted to floating point only for paint.

For example, two `90f` items with a `15f` overlap produce a `165f` series. The first item is active over `[0,90f)`, the second over `[75f,165f)`, and the transition over `[75f,90f)`.

## Transition rendering and sound

| Type | Behavior |
|---|---|
| `crossfade` (default) | Blend the outgoing and incoming surfaces in premultiplied RGBA: `C = (1−p)×A + p×B`. For opaque scenes, draw the full outgoing surface and then the incoming surface at alpha `p`. |
| `slide` | Outgoing moves by one viewport extent while incoming enters from the opposite side; direction names describe the outgoing motion; both are clipped to the series viewport. |
| `wipe` | Outgoing stays full-size; the incoming item is revealed through an axis-aligned clip rectangle. |

Audio in the outgoing and incoming items uses equal-power gains: `gOut = cos(p·π/2)` and `gIn = sin(p·π/2)`. A hard cut adds no fade. You can animate clip gain separately; the final gain is the product of clip, transition, and master gains.

- Overlapping parallel scenes without a transition receive no automatic sound crossfade.
- The outgoing scene's clock continues through the overlap. The incoming scene starts at local time zero when the overlap begins and continues from there when the transition ends.
- `direction` is `left | right | up | down` and applies to slide/wipe.

## Loops

`hv-loop` requires `iteration-duration` and `count` (a positive integer ≥ 1); its total length is the product and is always finite.

- Each iteration resets the descendants' local clocks. Nodes keep their compiled IDs and use an iteration index, so large loop counts do not require duplicate media objects.
- Audio follows the mapped source interval at each loop boundary. The engine adds no automatic fade at the seam.
- The last iteration may be clipped by ancestors.
- Seeded randomness repeats each iteration unless a channel is explicitly declared iteration-varying.

## Freeze

`hv-freeze` (requires `at` and `duration`) evaluates its visual descendants at a fixed local time:

- Child media images sample the frozen source time **after** normal trim/rate mapping; child animations receive the frozen local time.
- Audio anywhere under a freeze is rejected with `E_FREEZE_AUDIO`, including video audio included by default. Set `audio="mute"` on the video or place sound outside the freeze.

For example, a freeze at `2s` contains a muted video with `start="1s"`, `trim-in="5s"`, and `rate="2"`. The selected source time is `7s`: `5 + (2−1)×2`. A child is still inactive if its own interval excludes the frozen time.

Children that inherit duration use the freeze's declared duration as their extent. The `at` value must fall within `[0, extent)`. Add an inner sequence with an explicit duration if you need a different sampled extent.
