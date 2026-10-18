# Player and events

The `hv-player` element displays a rendered composition and provides optional playback controls. Place it outside the composition; its controls do not appear in exported video.

## Element usage

```html
<hv-player for="hello" controls></hv-player>
```

| Attribute | Behavior |
|---|---|
| `for` | Composition id to request an auto-managed compiled renderer |
| `controls` | Native-style boolean attribute |
| `loop` | Boolean attribute; restarts the selected playback range without changing the composition's export duration |
| `fit` | Default `contain` |

## Element interface

```ts
interface HtmvPlayerElement extends HTMLElement {
  renderer: Renderer | null;
  readonly currentFrame: number;
  readonly playing: boolean;
  play(options?: {range?: FrameRange}): Promise<void>;
  pause(): void;
  seekToFrame(frame: number): Promise<void>;
}
```

- `for="composition-id"` creates an auto-managed renderer for that composition. Assigning `renderer` explicitly takes precedence and leaves ownership with the application. Clearing it restores automatic binding. Disconnecting the player releases only sessions it owns.
- Each auto-managed player has an independent session, even when several players reference the same composition.

## Playback semantics

- The player follows an audio clock when sound is active and a monotonic performance clock otherwise. It calculates the desired frame from absolute elapsed time.
- Preview may skip displayed frames to stay synchronized. Export renders every output frame.
- A seek resolves when the requested frame has finished rendering. Superseded seeks cannot replace the newer frame.
- Pause keeps the current frame visible. Seeking cancels queued preview audio and rebuilds the mix at the new position.

## Events

Player events are `CustomEvent`s with a `detail` payload:

| Event | Detail |
|---|---|
| `hv-ready` | Compiled renderer ready |
| `hv-frame` | `{ frame, time }` — frame index and exact rational time |
| `hv-play` / `hv-pause` / `hv-ended` | Playback state transitions |
| `hv-diagnostic` | A runtime `Diagnostic` |
| `hv-error` | A fatal player error |

Export progress is delivered through the export callback rather than player events. It includes the phase, completed and total frames, mixed and total samples, bytes written, and an estimated time remaining when available. Progress reaches 100% after the container and writer are finalized.

## State machines

Renderer session:

```text
initializing → ready → rendering/exporting → ready
error → ready only after explicit recoverable reset/recreation
any state → disposing → disposed
```

An aborted export returns the renderer to ready after cleanup. A fatal codec failure puts it in an error state and requires recreating the session.

Compilation:

```text
parsing → validating → loading → lowering → ready | failed
```

Player controls display loading, busy, and error states.

## Range export audio and captions

For export range `[from, toExclusive)` with `a = time(from)`, `e = time(toExclusive)`, `D = e − a`:

- Visual output frame `n` evaluates original root frame `from + n`. Encoder timestamps come from independently rounded range-local `n/fps` endpoints. Subtracting already-rounded root timestamps could introduce a rounding error.
- Audio output has `ceil(D×R)` samples. Output sample `j` evaluates the mix at root time `a + j/R` and is emitted at output time `j/R`. Gain envelopes, fades, loop phase, transitions, and captions keep their position on the original timeline.
- `renderCaptions({ range })` clips root cues to `[a, e)`, discards empty cues and subtracts `a`, quantizing millisecond endpoints independently; zero-length cues introduced by quantization are omitted with a warning.
