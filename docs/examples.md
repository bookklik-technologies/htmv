# Examples

Six working examples demonstrate HTMV's authoring, playback, and export capabilities.
They share a responsive studio page and ship all required media and fonts locally.

```sh
npm run build
npm run serve:examples
```

Open **http://127.0.0.1:8899/** for the gallery. Individual pages remain available
at `/examples/<name>/index.html`. WAMP or any static HTTP server from the
repository root also works; opening files directly from disk does not.

## Explore the collection

| Example | Try it | Actual HTMV capabilities |
|---|---|---|
| `hello` | Edit the headline, replay, step one frame | HTML/CSS composition, declarative opacity/translation, automatic player updates |
| `data-template` | Change three labels and values; Apply or Reset | Typed JSON props, repeated components, scoped IDs, animated numbers, revision replacement |
| `edited-story` | Play with sound, change music gain, download captions | Decoded video trims, crossfade, layered audio, repeat/fades/gain, burned-in cues and WebVTT |
| `hold-and-loop` | Change the freeze time and repetition count | Frozen media, independent finite loops, exact `30000/1001` frame timing |
| `product-intro` | Jump between chapters, preview or export one chapter | A complete 60-second film with real media, templates, transitions, captions, and plugin rendering |
| `seeded-plugin` | Change the count and verify a repeatable frame | Custom canvas rendering, seeded randomness, direct time sampling, shuffled-frame reproducibility |

Every example provides a collapsible, copyable composition source view reflecting
the currently applied inputs. Plugin pages also show the trusted application
JavaScript required to register their renderer. Apply creates a new revision;
failed validation keeps the last working preview and source.

## The one-minute film

The product introduction is **1,800 frames at 30 fps**, at 1280 × 720. It stays
silent and text-led while showing real decoded video and timed captions. Its
eight scenes use crossfade, slide, and wipe overlaps.

| Chapter | Root frame range (end excluded) | Demonstration |
|---|---|---|
| Meet | 0–195 | Animated title and browser-only authoring |
| Compose | 195–420 | A live opacity animation beside its declaration |
| Time | 420–690 | Frozen video beneath a title that loops five times |
| Personalize | 690–945 | Repeated, data-bound component instances |
| Media | 945–1215 | Trimmed video clips, nested crossfade, caption cues |
| Export | 1215–1395 | Browser export workflow, available on the page |
| Extend | 1395–1620 | Seeded custom particle renderer |
| Create | 1620–1800 | Closing identity |

Navigation, selected-chapter playback, and range export derive their boundaries
from the scene durations and transition overlaps in the composition. The overlap
belongs to the incoming chapter. A rendered MP4 and its manifest are included in
[`examples/product-intro/`](https://github.com/bookklik-technologies/htmv/tree/main/examples/product-intro).

## Download the result

- **Download PNG** captures the currently displayed frame at composition resolution.
- **Export full video** probes MP4 and WebM support, reports progress, and supports cancellation.
- **Export selected chapter** renders that half-open frame range with range-local timestamps.
- **Download WebVTT** exports caption timing independently of burned-in visuals.
- **Download manifest** becomes available after a successful video export and describes that output revision and configuration.

Editing and conflicting frame requests are disabled during export. The source,
props, and selected range used for an export stay fixed until it completes.

## Audio and environment support

The edited story has two synthesized audio layers. Press Play to hear them; it
does not autoplay sound. Strict synchronization preflight is the default. An
uncertified profile reports `E_AUDIO_DELAY_UNVERIFIED`. The unchecked opt-in
**I accept unverified audio synchronization for this export** supplies
`syncPolicy: 'allow-unverified'` only when selected, and the resulting warning
remains in the downloadable manifest.

Encoding requires supported browser WebCodecs encoders. Unsupported configurations
show diagnostics; a working preview alone does not establish export support.
Exact timeline evaluation does not promise identical fonts, pixels, or encoded
bytes across devices. See [implementation status](/implementation-status.md)
for remaining conformance and certification work.

## Local assets and regeneration

The two silent, 12-second abstract clips are original HTMV renders. The music
bed and chime are original synthesized stereo PCM. No stock media or external
services are needed. Outfit retains its bundled SIL Open Font License.

With the example server running and Playwright Chromium installed:

```sh
node scripts/generate-examples.mjs --samples
node scripts/generate-examples.mjs --posters
node scripts/generate-examples.mjs --film
```

`--all` performs those steps together. `HTMV_EXAMPLES_URL` overrides the default
local server. Generation is development-only; visitors load committed media.
See the [media provenance and regeneration guide](https://github.com/bookklik-technologies/htmv/tree/main/examples/shared/media).
