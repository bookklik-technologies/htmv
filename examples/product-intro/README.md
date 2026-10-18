# Meet HTMV — in one minute

A product introduction made with the product itself: **1280 × 720, 30 fps,
exactly 1,800 frames (60 seconds)**. Eight scenes use crossfade, slide, and wipe
overlaps. The film stays silent and text-led, with actual media decoding,
caption cues, reusable components, and a deterministic particle plugin.

The [rendered MP4](htmv-product-introduction.mp4) and
[render manifest](render-manifest.json) are included for viewing and inspection.
The recorded manifest describes this render environment, not cross-browser certification.

## Run it

```sh
npm run build
npm run serve:examples
```

Open **http://127.0.0.1:8899/examples/product-intro/index.html**, or use the
gallery at the server root. Any static HTTP server, including WAMP, works from
the repository root. All clips, fonts, and the logo are local.

Play, pause, step frames, or jump to a chapter. **Play selected chapter** stops
at that chapter's exclusive endpoint. **Export selected chapter** renders only
that range, while **Export full video** always renders all 1,800 frames.
Both export actions preflight MP4/WebM support and offer progress/cancellation.
**Download PNG** captures the current frame; **Download WebVTT** saves the
media chapter's caption cues with their root timeline timing. Successful video
exports offer a downloadable manifest.

## Chapters

| Chapter | Frames [start, end) | What actually renders |
|---|---|---|
| Meet | [0, 195) | Animated title and positioning |
| Compose | [195, 420) | Live opacity animation beside its declaration |
| Time | [420, 690) | Frozen decoded video and a five-iteration title loop |
| Personalize | [690, 945) | Three data-bound component instances |
| Media | [945, 1215) | Trimmed video, nested crossfade, and timed captions |
| Export | [1215, 1395) | File graphic introducing the page's working export controls |
| Extend | [1395, 1620) | Actual seeded particle plugin rendering |
| Create | [1620, 1800) | Closing identity |

Scene durations total 1,905 frames; seven 15-frame overlaps resolve to 1,800.
Chapter boundaries derive from those source durations and overlaps. Each
overlap belongs to the incoming chapter; range endpoints are exclusive.

## Edit and regenerate

`index.html` contains the composition and its internal visual styles. `intro.js`
binds the shared studio controls and registers `../seeded-plugin/particles.js`
through the public `compile()` options. The source panel shows the complete
composition; the plugin panel shows its required application registration code.
`../shared/studio.css` styles the surrounding page independently of the film.

After edits, render a fresh video from the page, or run:

```sh
node scripts/generate-examples.mjs --film
```

The development tool requires the local server and installed Playwright Chromium.
Use `--samples` to recreate the original clips/audio and `--posters` to refresh
gallery previews. See [media provenance](../shared/media/README.md).

The supplied logo, Outfit font, blue `#2563EB`, green `#00FF99`, yellow `#FFC000`,
and charcoal palette unify the collection. Outfit's license is bundled in
`../shared/brand/OFL.txt`.

To explore deeper, use the gallery's editable metrics, audiovisual story,
freeze/loop, and plugin examples. Audio exports keep strict synchronization
preflight unless visitors explicitly accept unverified output. The library
does not claim universal codec support, cross-device pixel identity, or
completed browser certification.
