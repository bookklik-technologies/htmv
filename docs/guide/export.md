# Exporting video

Export renders and encodes the composition in the browser. Run preflight first to select a format supported by the current browser, input media, and output settings.

::: tip Quick example
For export code, see [JavaScript API usage](/reference/javascript-api.md#usage). The [recipes](/reference/recipes.md) provide example compositions.
:::

## Capability preflight

Call `renderer.preflight()` before creating an output writer. It checks:

1. Secure-context and isolation prerequisites for the chosen adapters.
2. Canvas creation at requested dimensions, font loading, asset fetch and decode.
3. Every input track's actual decoder configuration.
4. Every candidate video encoder config: dimensions, frame rate, profile/level, bitrate, acceleration preference.
5. The requested audio encoder at its actual rate/channels/bitrate (unless no audible track is requested).
6. Container/codec compatibility, output target semantics, storage/memory estimates, and strict-sync certification.

Codec probes call `isConfigSupported` with the requested configuration. Encoding and decoding are checked separately. A successful probe does not reserve hardware, so initialization or encoding can still fail later.

## Output profiles

| Profile | Video | Audio (when present) | Notes |
|---|---|---|---|
| `mp4` | AVC/H.264, supported 8-bit profile/level | AAC-LC | Requires encoder support and, for audio, sync certification under the default policy |
| `webm` | VP9, then VP8 if allowed by the caller | Opus | Requires support for the selected video and audio configurations |
| `auto` | Evaluates profiles before export | Matches selected container | Returns selected MIME/extension/config before writer creation |
| Still | PNG or JPEG | None | Same frame painter; transparency only when explicitly enabled for stills |

- Available profiles vary by browser and operating system.
- `profile: 'mp4'` requires MP4 output. Use `auto` with an allowlist if the application can accept more than one format.
- If audio is requested but cannot be encoded, preflight fails. Compositions without audio omit the audio track.
- Video frames are opaque SDR, composited against the root background. Certified 4:2:0 profiles require even width and height; diagnostics suggest a correction for odd dimensions.
- The suggested presets are 1080p30 at 8 Mb/s video, AAC at 192 kb/s, and Opus at 160 kb/s. Adjust them for the content and output requirements.

## Scheduler

The export scheduler renders every frame and waits for decoder, encoder, and writer capacity as needed. It processes timeline time independently of playback speed:

```text
validate and freeze source/data/styles/assets
compile exact timeline; initialize decoders/painter/mixer
select and certify output configuration
open caller-authorized writer; initialize mux and tracks
while output video frames or audio blocks remain:
  select the next output time in the merged A/V schedule
  await resource and writer capacity
  evaluate exact timeline state; paint one frame OR mix one PCM block
  submit sample with endpoint-derived timestamps; release owned temporaries
close completed sources; drain encoder work
finalize container and writer; publish result and render manifest
```

- Samples within a track are submitted in required encode order; B-frame PTS metadata is preserved.
- The first video frame and frames near the keyframe interval request keyframes (default interval: 2 seconds, rounded to valid frame boundaries).
- The encoder queue holds at most three pending raw frames, and each source caches at most four decoded frames. When a queue fills, export waits rather than dropping frames.

## Writers and large output

| Target | Behavior |
|---|---|
| `{kind:'memory'}` | In-memory Blob, with a default 128 MiB limit. Use a streaming target or override the limit for larger output |
| `{kind:'file', handle}` | A save-picker handle obtained by the application during a user gesture, before asynchronous work consumes transient activation |
| `{kind:'opfs', name?}` | Quota-aware private storage; returns a `File` plus explicit `cleanup()`; site-data clearing can evict OPFS files |
| `{kind:'writer', writer}` | Caller-supplied seekable writer (`writeAt(position, bytes)`, `close()`, `abort(reason)`) |
| `{kind:'append-only', stream}` | Only with append-only-compatible fragmented mux configurations declared by the adapter |

A generic `WritableStream` is not seekable, so it cannot support muxing configurations that rewrite earlier MP4 bytes. Use an append-only target only with a compatible fragmented configuration. Custom seekable and append-only writers return `kind: 'file'` to indicate completed external output. They do not return a Blob. See the [large-file recipe](/reference/recipes.md#recipe-4-large-file-export-with-a-user-gesture) for save-picker handling.

## Cancellation, errors, and page lifetime

- Pass an `AbortSignal` to cancel export. Cancellation stops scheduling, invalidates pending work, closes codecs and frames, aborts the writer, and removes temporary resources. A cancelled export does not return a successful partial file. See the [lifecycle diagnostics](/reference/diagnostics.md).
- V1 cannot resume interrupted exports. Closing or reloading the page stops the export, and background tabs may be throttled or suspended. Export speed depends on the composition and available resources.
- Storage, quota, codec, and writer failures trigger cleanup and structured diagnostics. The engine does not retry in another format automatically.
- During export, `renderFrame` and `renderStill` on the same renderer reject with `E_BUSY`. Create a separate session if preview must continue.

## Resource policy

Compilation enforces the following asset limits. Override them with [`resourcePolicy`](/reference/javascript-api.md#resourcepolicy):

| Limit | Default |
|---|---|
| Max bytes per asset | 256 MiB |
| Max bytes per composition | 512 MiB |
| Max image dimension | 8,192 px |
| Max image pixels | 33,554,432 |

The loader checks bytes as they arrive, even when `Content-Length` is missing or incorrect. Blobs and custom-loader results use the same limits. Exceeding a limit rejects compilation with `E_RESOURCE_LIMIT`.

These limits cover input bytes and image dimensions. Rendering, hashing, inspection, and native codecs use additional memory, so they do not establish a total browser-memory cap.
