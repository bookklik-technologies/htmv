# Media sources and clips

Use `hv-video` and `hv-audio` to add clips from URLs or user-selected files. Trims and playback rate map each clip's source time to the composition timeline.

## Adapter boundary

The media adapter uses a pinned Mediabunny version to read and write containers, and WebCodecs for platform encoding and decoding. Adapter classes are internal; applications use the HTMV API. The adapter version is recorded in the [render manifest](/reference/diagnostics.md#render-manifest).

### Source forms

- User-selected `File`/`Blob` objects from application file inputs.
- URLs fetched with normal same-origin/CORS rules.
- Declared `asset:ID` references resolving to either form.

Files must be supplied by the application; the library cannot read arbitrary disk paths. Remote URLs must allow fetching under the page's CORS policy. A URL that plays in a native video element may still be unavailable for decoding and export.

## Inspection

Before rendering, HTMV inspects the tracks, codec configuration, timestamps, playable extent, duration, rotation, display dimensions, pixel aspect ratio, and audio format. It also checks decoder support. The file extension alone cannot establish support: an MP4 file may contain a codec the browser cannot decode.

The first release reads these containers when the selected tracks are decodable:

- **Video:** MP4/MOV, WebM.
- **Audio:** MP4/MOV, WebM, WAV, MP3, Ogg — only when the selected track is decodable.

HEVC and AV1 inputs depend on the browser's decoder support and must pass probing. Encrypted tracks, malformed edit lists, unsupported channel configurations, and live playlists are rejected.

## Timeline mapping

Asset time zero is the start of the normalized movie presentation timeline, after applying container edit lists. Video and audio retain their relative offsets, including intentional delayed starts. Negative preroll may be decoded, but it is not emitted before its playable time.

For a media node at local time `l` and constant rate `r`:

```text
sourceTime = trimIn + l × r
```

Output has a constant frame rate. Variable-frame-rate input does not change the composition's `fps`.

### Frame selection

The engine selects frames by source presentation timestamp (PTS). It chooses the last presentable frame with `PTS ≤ target` whose duration, or next-PTS boundary, covers the requested time. Multiplying source time by a nominal frame rate would give incorrect results for variable-frame-rate footage.

- Before the first presentable frame or across a genuine presentation gap: transparent pixels.
- Running beyond the source is an error by default. Explicit video `hold` extends the image only; audio becomes silent after its selected interval.
- `trim-out` is exclusive: the last held image is the last valid frame before `trimOut`, never a frame starting exactly at it.

## Seeking and decode order

To seek, the adapter starts at a preceding sync or key sample and decodes packets forward in decode order. It retains the container's presentation timestamps. B-frame timestamps may be out of order, so sorting compressed packets by PTS before decoding would be incorrect.

- Sequential export uses forward iteration/windowed decode instead of reopening a decoder every frame.
- Random scrubbing cancels obsolete seeks with a generation token; a late decode result cannot repaint a newer request.

## Media lifetime

The engine releases frames, samples, bitmaps, codecs, object URLs, and intermediate surfaces when their consumers finish. Transferring a resource transfers ownership; the sender must stop using it. This explicit cleanup keeps native media resources from waiting for garbage collection.

The default scheduler targets at most two concurrently decoding video tracks, one for each side of a transition. More layers are allowed, but may decode serially. The scheduler does not drop output frames to stay within the concurrency limit.

## Rate semantics

Media `rate` is a finite constant in `0.25–4`.

- Video frames are selected through the source-time mapping, without optical-flow interpolation.
- Resampling changes audio pitch with playback rate. Preview and export use the same behavior. V1 does not support pitch-preserving time stretching.

## Normalized asset origin

When the container defines movie presentation time zero and edit-list mapping, the adapter uses that timeline, including leading gaps. Otherwise, it finds the earliest presentable, non-preroll timestamp across the selected tracks and subtracts that shared origin from every track. The chosen origin is recorded in inspection and manifest metadata. Normalizing each track separately would lose their relative timing.

- A track beginning after source zero contributes transparent video/silent audio before it begins.
- The selected video extent governs `trim` validation; included audio's shorter interval never invalidates playable video and contributes silence outside its own coverage.
- Metadata needed for `duration="auto"` loads during compilation, before series durations are resolved.
