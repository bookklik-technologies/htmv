# Original example media

`orbit.mp4` and `ribbons.mp4` are original abstract motion compositions rendered
with HTMV: 640 × 360, 30 fps, 360 frames (12 seconds), no audio track. They are
source clips for the media, freeze, and product-introduction examples.

`pulse.wav` is a seamless two-second harmonic music bed. `chime.wav` is a
two-second decaying stereo accent. Both are synthesized PCM at 48 kHz, stereo,
16 bits. The example demonstrates their repetition, mixing, gains, and fades.

These original samples are dedicated to the public domain under CC0 1.0. No
third-party footage, recordings, or services are used. The Outfit font retains
its separate SIL Open Font License in `../brand/OFL.txt`.

To regenerate, build the library and start the example server, then run:

```sh
node scripts/generate-examples.mjs --samples
node scripts/generate-examples.mjs --posters
node scripts/generate-examples.mjs --film
```

The development tool uses the installed Playwright Chromium and HTMV's MP4
encoder preflight. Install that browser with `npx playwright install chromium`
if needed. Override the server with `HTMV_EXAMPLES_URL`. `--all` performs all
three steps. Encoder bytes can differ between environments; source timing is
fixed. Visitors only load the committed files and never generate sample media.
