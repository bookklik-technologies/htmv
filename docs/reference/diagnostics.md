# Diagnostics and limits

HTMV reports validation and runtime problems as structured diagnostics. Use the code to handle a known failure, and display the message and suggestion to help the author fix it.

## Diagnostic shape

```ts
interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  compositionId?: string;
  nodeId?: string;
  instancePath?: string;
  attribute?: string;
  sourceLocation?: { line: number; column: number };
  suggestion?: string;
  recoverable: boolean;
}
```

Compilation collects independent validation errors where practical. Source locations may be unavailable for DOM inputs. Public diagnostic messages exclude authentication headers, private URL tokens, file contents, and uncontrolled user HTML.

## Code reference

| Code | Meaning and response |
|---|---|
| `E_TIME_UNIT` | Nonzero unitless or malformed time; use a valid form (`150f`, `10s`, `500ms`) |
| `E_ROOT_FRAME_ALIGNMENT` | Root duration is not an exact output-frame count |
| `E_DURATION_CYCLE` | A series item's length depends on the series/parent remainder |
| `E_STYLE_UNSUPPORTED` | Unsupported authored CSS under strict policy |
| `E_ANIMATION_CONFLICT` | More than one contributor to one property/time |
| `E_ASSET_FETCH` / `E_CORS` | Source inaccessible through permitted fetch |
| `E_CODEC_DECODE` / `E_CODEC_ENCODE` | Exact input/output codec configuration unavailable |
| `E_AUDIO_DELAY_UNVERIFIED` | Strict sync profile cannot be certified for this environment |
| `E_FREEZE_AUDIO` | Audio would be evaluated under freeze |
| `E_RESOURCE_LIMIT` | Memory/node/decoder/output budget exceeded |
| `E_STORAGE_QUOTA` / `E_WRITER` | Storage unavailable or output write failed |
| `E_BUSY` / `E_DISPOSED` | Invalid renderer lifecycle operation |
| `E_ABORTED` | The user or application cancelled the operation |
| `W_NONPORTABLE_FONT` | System/fallback font makes pixels environment-dependent |
| `W_AUDIO_CLIPPING` | Final mix exceeded allowed amplitude |
| `W_SPRING_UNSETTLED` | Spring has meaningful residual motion at the declared endpoint |

## Resource policy

Compilation enforces these defaults. Override them with [`resourcePolicy`](./javascript-api.md#resourcepolicy), using positive safe integers:

| Limit | Default |
|---|---|
| Max bytes per asset | 256 MiB |
| Max total bytes per composition | 512 MiB |
| Max image dimension | 8,192 px |
| Max image pixels | 33,554,432 |

- Bytes are checked during streaming, regardless of `Content-Length`. Supplied Blobs and custom-loader results undergo the same checks. Exceeding a limit rejects compilation with `E_RESOURCE_LIMIT`.
- Repeated references share resource fetching and preparation.
- A custom `AssetLoader` receives an optional second argument, `{ maxBytes, signal }`, and manages its own allocations. Metadata-only results cannot establish the size of privately retained resources. Image results must include frozen Blob bytes so layout can reuse them without fetching again.
- The limits cover input bytes and image dimensions. Hashing, inspection, rendering, and native codecs require additional memory.
- Template expansion defaults to a maximum depth of 32 and 10,000 nodes. Larger expansions require an explicit resource policy.
- In-memory export defaults to a 128 MiB limit, checked during export. This is an engine limit rather than a universal browser limit.

## Sync certification

Audio synchronization must be certified with impulse/flash fixtures for the specific browser, operating system, and codec configuration. Until then, preflight blocks the profile with `E_AUDIO_DELAY_UNVERIFIED` under the default policy.

Set `syncPolicy: 'allow-unverified'` if the application accepts output without verified synchronization. The render manifest retains the warning, and the output does not satisfy strict-sync release requirements.

## Lifecycle rules

- `E_BUSY`: frame and still requests reject while the same renderer is exporting. Preview accepts one active render and one replaceable pending request; superseded seeks reject with `AbortError`. Use separate sessions for concurrent preview and export.
- `E_ABORTED`: cancellation returns a cancelled state after cleanup. A partial file is not reported as a successful export.
- Resource ownership, storage, codec, and writer failures release owned resources and report diagnostics. Recoverability depends on the failure; fatal codec errors require a new session.

## Render manifest

The render manifest identifies the exported revision and records:

- Language, IR, library, dependency, and plugin versions.
- Revision, source, style, and props hashes; asset IDs and content hashes; font families and hashes.
- Dimensions, frame rate, duration, exported range, selected container and encoder settings, and timestamp policy.
- Output frame and sample counts, color profile, synchronization status, warnings, byte count, and completion status.
- Peak resource measurements and a redacted environment profile. Measurements are `null` where native encoder or muxer internals cannot be measured.

Raw source bytes, credentials, and private paths are excluded. Wall-clock render duration appears only as diagnostic information.

## Trust policy

- String sources compile as inert HTML. Scripts, event-handler attributes, `javascript:` URLs, external imports, unsafe SVG features, and unsupported nodes are removed or rejected before layout.
- Accepted URL forms are HTTPS, host-approved local HTTP for development, engine-created blob URLs, asset references, and bounded image data URLs. Cross-origin fetches omit credentials by default. Use a host-supplied asset provider for authenticated loading.
- Bindings do not use `eval`, `new Function`, raw HTML interpolation, or prototype traversal. CSP does not require `unsafe-eval`.
- CSS `url()` values must pass the asset URL policy, even for a supported property.
- The core does not upload media or send telemetry automatically.
- Keep media decoders and dependencies updated; source sanitization does not address vulnerabilities in those components.
