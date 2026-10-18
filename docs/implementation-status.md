# Implementation and validation status

This page separates implemented behavior and regression coverage from the
validation still needed for release. The formal requirements are defined in
[`SPEC.md`](https://github.com/bookklik-technologies/htmv/blob/main/SPEC.md),
especially the release criteria in §16. Passing a local test suite
does not establish certification across browsers, operating systems, or codecs.

## Implemented behavior

- Composition timing uses exact rational seconds. Evaluation checks half-open
  intervals at every ancestor and applies nested offsets, loops, freezes,
  animation fill, and media clock mappings.
- Isolated layout preserves supported inline styles and the paint hierarchy.
  Boxes are measured with transforms neutralized. Clipping and group opacity
  apply through descendants; layout and numeric-text animation trigger remeasurement.
- Compiled revisions retain programmatic asset bytes. Images, restricted static
  SVG, registered fonts, and background images reuse prepared resources.
- Media readers initialize before use, preserve presentation timestamps, select
  tracks, close owned samples and release inspection inputs.
- Audio mixing uses bounded source pages, exact source phase, a pinned
  fractional-phase sinc filter, separate stereo channels, Float64 accumulation,
  per-sample envelopes, and one final clamp. Preview schedules bounded AudioBuffers.
- Muxing writes directly to positioned or append-only destinations with awaited
  backpressure. File streams remain open for the session. Failure/cancellation
  aborts the owned writer; memory output enforces an admission limit.
- Strict audio synchronization preflight requires certification evidence.
  Applications that accept unverified output receive a warning in the render manifest.
- IR/revision hashes include text, attributes, media settings, assets, styles,
  props, background and plugin versions. Published render inputs are immutable.
- Sidecar captions expand finite loops, apply ancestor/range clipping and reject
  freeze timelines. Burned-in cues are scoped to their caption container.
- Plugin preparation and rendering finish before a frame is marked ready, and
  plugin resources are disposed with the session. Random v1 uses synchronous
  SHA-256; asynchronous rendering has a finite timeout.
- Players support element and template sources, explicit renderer binding,
  source updates, and last-working revisions after failed recompilation.
  Control bounds and session ownership are handled by the player lifecycle.
- Package project references and declaration entry points are explicit. The auto
  browser entry imports the main bundle so the media runtime is loaded once.

## Regression coverage

### Resource handling and lifecycle

- CSSTree parses styles, declarations, and URL nodes, including escaped identifiers,
  mixed-case URL functions, custom properties and fallbacks. Every accepted URL
  passes through asset loading before layout; unsafe or unparsed declarations and
  imports cannot enter the layout document in either style mode.
- Transparent still rendering shares frame validation, cancellation, and export
  exclusion with opaque rendering. Regression coverage decodes a red/blue export
  to verify snapshot pixels while concurrent still calls reject with `E_BUSY`.
- Preview permits one active render and one replaceable pending request. Pause,
  stop and superseding seeks discard stale presentations and close their bitmaps.
- `resourcePolicy` defaults to 256 MiB per asset, 512 MiB aggregate, 8,192 pixels
  per image dimension and 33,554,432 pixels per image. Streaming reads enforce
  limits even with absent/incorrect length headers. Custom loaders receive a
  remaining-byte context and their returned resources are validated; their
  private allocations remain host-owned. Image/native inspection is not a hard
  total-memory guarantee.
- The elements auto subpath resolves to compiled JavaScript. A browser smoke test
  bundles through actual package exports without source aliases.
- Manifest peak resource measurements are nullable. Prepared video canvases and
  PCM block arrays are measured; encoder/muxer internals report `null`. See the
  README for measurement boundaries.

`tests/unit/readiness.test.ts` covers CSS admission, byte/aggregate/image limits,
overflow cancellation, deduplication, image cleanup, bounded playback and seeks.
`tests/browser/readiness.spec.ts` covers credential-free CSS fetches, denied-loader
bypasses, export isolation, still cancellation/ordering and built auto registration.
These checks cover six review findings. The remaining release requirements are
listed below.

After installing dependencies, `npm run build` builds the library, `npm test`
runs unit tests, and `npm run test:browser` runs browser checks. Obtain any
approval required by the workspace's `AGENTS.md` before running tests.

`tests/unit/parity.test.ts` covers exact activity and clock boundaries, looped
animation, revision identity/immutability, caption expansion/clipping, positioned
writes, resampler DC gain and component timing/selector scope.

`tests/browser/parity.spec.ts` checks rendered pixels, group opacity/clipping,
prepared image/SVG rendering, dynamic layout, plugin readiness, stereo resampling,
sync preflight, explicit/automatic player ownership, failed source updates,
writer failure/cancellation, and concurrent preview/export admission. Its media
fixture creates a source video, decodes shuffled frames, adds a title and repeated
audio, exports through a slow positioned writer, and decodes the resulting file.

For an externally managed local server, run `npm run serve:examples`, then set
`HTMV_TEST_EXTERNAL_SERVER=1` when invoking Playwright. This avoids the runner
owning server-process shutdown in restricted Windows environments.

## Remaining release evidence

- The full T01–T34 matrix still needs certification, including independent pixel
  references and numerical resampler references. Existing regression tests do
  not certify every fixture.
- Impulse/flash roundtrip measurements and ten-minute drift measurements must be
  recorded per exact browser, OS and codec configuration. No audio profile is
  pre-certified by this repository.
- Chromium, Firefox and Safari current/previous stable desktop profiles, mobile
  memory tiers, font/script fixtures, long-file memory bounds, quota pressure,
  background-page behavior and performance budgets require their own reports.
- Dependency and license review, along with distribution documentation, remain
  release work. SVG text support requires independently verified font behavior
  in each environment; paths and basic shapes are the portable SVG fixtures.

A successful short-video export demonstrates that one configuration works. Full
v1 conformance and browser certification require the evidence listed above.
