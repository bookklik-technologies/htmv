# Audio and captions

Add audio with `hv-audio` or include a video's audio track with `audio="include"`. Use `hv-captions` for inline cues or a WebVTT source. Both follow the composition timeline during preview and export.

## Audio mixing {#canonical-mixer}

The audio engine mixes Float32 PCM in bounded blocks, typically 4,096 samples at a time. This keeps long exports from requiring one buffer for the entire composition. Block size can vary within the declared numerical tolerance. The mixer can run in a dedicated worker; `OfflineAudioContext` is used for small reference tests rather than long exports.

The mixer decodes source audio to PCM, applies source-timeline offsets, resamples to the output clock, maps channels, applies gains and fades, then sums tracks in a fixed order.

- Output defaults to stereo at 48 kHz. Mono and 44.1 kHz are also supported.
- Mono to stereo duplicates the signal at equal amplitude. Stereo to mono uses `(L+R)/2`. Stereo output preserves left/right order.
- Sources with more channels require an explicitly supported downmix adapter.
- Tracks accumulate in `Float64`, then convert to `Float32` with one final clamp to `[−1,1]`. Peaks and clipped-sample counts are reported with `W_AUDIO_CLIPPING`. The mixer does not normalize or limit the signal automatically.

Preview plays the same mixed PCM through an `AudioWorklet` when available, or through bounded, scheduled `AudioBuffer`s. File rendering does not require speaker playback, microphone access, or a user gesture for audio processing.

## Exact sample clock

For composition duration `T` and output rate `R`:

```text
M = ceil(T × R) samples; sample j represents time j/R, 0 ≤ j < M
```

For a media interval `[b, e)` in root time, contributing sample indexes run from `ceil(b×R)` to `ceil(e×R)`, excluding the end and clipped to `[0, M)`. These boundaries use exact rational arithmetic. Audio cuts can occur between video frames.

The resampler maps each output position to exact source time and uses a version-pinned band-limited filter. State carries across chunks, with preroll and postroll handled at trim and loop boundaries. Processing a new block does not restart the filter or accumulate floating-point phase error. Rate is constant within each media node.

## Gains, fades, and overload

| Control | Contract |
|---|---|
| Base gain | `0–4` on `hv-video`/`hv-audio` |
| `audio="mute"` | Gain zero, visual playback unchanged |
| `fade-in` / `fade-out` | Linear amplitude ramps in the node's output-local time; lengths cannot exceed node duration; overlapping fades multiply |
| Transition gains | Equal-power `cos/sin(p·π/2)` on series transitions |
| Gain animation | Evaluated per audio sample with the same easing evaluator as visuals |

Final gain is `clip × transition × master`. When a gain animation contributes, its value replaces the clip's base gain for that interval.

## Exact repetition

For repeating audio (`repeat="true"`) with local output time `l`, rate `r`, trim `[a,b)` and span `S = b−a`:

```text
sourceTime = a + positiveModulo(l × r, S)
```

- Repetition is independent of `hv-loop` and does not change the node duration.
- Fade envelopes span the node's full local duration; repeating the source does not restart them.
- Resampler taps wrap across the trim seam without an added crossfade, gap, or encoder restart. Gain envelopes inside structural loops repeat with the loop; media rate does not speed them up.
- A seam may click when the waveform endpoints differ. Use a seamless source or crossfade separate nodes to avoid this.

To calculate gain for a sample, the engine maps root time through the structural clocks. Gain animation uses its enclosing timeline's clock; clip fades use the media node's local output time. Playback rate affects source sampling, not these envelope clocks.

## Codec delay, priming, padding

Audio encoders can add priming, delay, or padding. Correct synchronization depends on how the browser and container expose that metadata, so encoded output requires validation for each environment.

- Certification uses an impulse/sync fixture to inspect decoded output and container timing, including delay and discard metadata exposed by the adapter.
- An uncertified strict-sync profile reports `E_AUDIO_DELAY_UNVERIFIED` at [preflight](./export.md#capability-preflight). To accept output without verified synchronization, set `syncPolicy: 'allow-unverified'`. The warning remains in the render manifest.

## Captions

Provide captions as inline `hv-cue` children or a UTF-8 WebVTT file. WebVTT support covers timed plain-text cues with optional identifiers. `STYLE` and `REGION` blocks, ruby, voice styling, and inline timestamp or karaoke tags are unsupported and produce diagnostics.

```html
<hv-captions class="caption" duration="300f">
  <hv-cue start="0" end="60f">A story starts here.</hv-cue>
  <hv-cue start="75f" end="135f">One HTML composition.</hv-cue>
</hv-captions>
```

- Cue times are relative to the `hv-captions` local clock; intervals are half-open and clipped by container and ancestors.
- Simultaneous cues stack in source order, each as a text box. Default anchor: bottom-center, 5% viewport inset, max width 90%, solid high-contrast background; author styling replaces these defaults.
- Captions can be burned into the video. `renderCaptions()` produces a separate WebVTT file, expanding finite loops and clipping cues to their effective root-time intervals. Caption sidecars cannot be generated under a freeze, where cue timing is no longer meaningful; frozen captions can still appear in the rendered image.
- Embedded subtitle-track muxing is optional and separately feature-detected.
