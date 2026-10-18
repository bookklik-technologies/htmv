# Recipes

The first three recipes show compositions for editing clips, generating videos from data, and combining a freeze with a loop. The fourth shows how to save a large export. Supply the media and font files listed for each recipe. See the [JavaScript API](./javascript-api.md#usage) for compilation and export code.

- [Recipe 1 — Edited film with motion graphics, music and captions](#recipe-1-edited-film-with-motion-graphics-music-and-captions)
- [Recipe 2 — Data-driven metrics film](#recipe-2-data-driven-metrics-film)
- [Recipe 3 — Held frame and finite repeated animation](#recipe-3-held-frame-and-finite-repeated-animation)
- [Recipe 4 — Large-file export with a user gesture](#recipe-4-large-file-export-with-a-user-gesture)

## Recipe 1 — Edited film with motion graphics, music and captions

A ten-second edited film: two crossfaded footage scenes, title animations, background music with fades, and burned-in captions.

```html
<script type="module" src="./htmv/auto.js"></script>
<hv-composition id="story" width="1920" height="1080"
                fps="30" duration="300f" background="#0a1520">
  <hv-assets>
    <hv-asset id="font" kind="font" src="./assets/title.woff2"
              family="Story" weight="700"></hv-asset>
    <hv-asset id="clip-a" kind="video" src="./assets/a.mp4"></hv-asset>
    <hv-asset id="clip-b" kind="video" src="./assets/b.mp4"></hv-asset>
    <hv-asset id="music" kind="audio" src="./assets/music.wav"></hv-asset>
  </hv-assets>
  <style>
    .footage { position:absolute; left:0; top:0; width:1920px; height:1080px; }
    .title { position:absolute; left:120px; top:160px; width:1680px;
             height:180px; font-family:Story; font-weight:700;
             font-size:100px; line-height:1.1; color:white; }
    .caption { font-family:Story; font-weight:700; font-size:52px;
               line-height:1.25; color:white; background-color:#102030; }
  </style>

  <hv-series>
    <hv-scene duration="150f">
      <hv-video class="footage" src="asset:clip-a" duration="150f"
                trim-in="2s" trim-out="7s" audio="include"
                gain="0.7"></hv-video>
      <h1 id="first-title" class="title">A story starts here.</h1>
      <hv-animation target="#first-title" property="opacity"
                    duration="24f" from="0" to="1" fill="both"></hv-animation>
      <hv-animation target="#first-title" property="translate-y"
                    duration="24f" from="40px" to="0px"
                    easing="ease-out" fill="both"></hv-animation>
    </hv-scene>
    <hv-transition type="crossfade" duration="15f"></hv-transition>
    <hv-scene duration="165f">
      <hv-video class="footage" src="asset:clip-b" duration="165f"
                trim-in="0" trim-out="5.5s" audio="include"
                gain="0.7"></hv-video>
      <h1 id="second-title" class="title">Built entirely in your browser.</h1>
      <hv-animation target="#second-title" property="opacity"
                    duration="30f" from="0" to="1" fill="both"></hv-animation>
    </hv-scene>
  </hv-series>

  <hv-audio src="asset:music" duration="300f" trim-in="0" trim-out="2s"
            repeat="true" gain="0.18" fade-in="15f" fade-out="30f"></hv-audio>
  <hv-captions class="caption" duration="300f">
    <hv-cue start="0" end="60f">A story starts here.</hv-cue>
    <hv-cue start="75f" end="135f">One HTML composition.</hv-cue>
    <hv-cue start="150f" end="285f">Preview and export in the browser.</hv-cue>
  </hv-captions>
</hv-composition>
<hv-player for="story" controls></hv-player>
```

The output contains 300 frames:

- Scene A root interval `[0,150f)`; scene B `[135f,300f)`; overlap `[135f,150f)`.
- At frame 135, scene B has zero contribution to the crossfade. At frame 150, only scene B remains, at its local frame 15.
- The standalone music is outside the series, so transition gains do not affect it.
- Captions are root-timed because their container starts at zero; the root background stays visible behind transparent pixels.

Clip A needs at least 7 seconds of playable media, clip B at least 5.5 seconds, and music at least 2 seconds. The `Story` font at weight 700 must cover the text's glyphs. A video without an audio track contributes silence.

## Recipe 2 — Data-driven metrics film

A repeated card component displays each metric from JSON props. Each card's counter animates from zero to its supplied value:

```html
<hv-composition id="metrics" width="1280" height="720"
                fps="30" duration="120f" background="#ffffff">
  <script type="application/json" data-hv-props>
    {"items":[
      {"id":"customers","label":"Customers","value":1200},
      {"id":"projects","label":"Projects","value":84},
      {"id":"countries","label":"Countries","value":16}
    ]}
  </script>
  <style>
    .cards { position:absolute; left:70px; top:200px;
             width:1140px; height:300px; display:flex; gap:30px; }
    .card { width:360px; height:300px; padding:24px;
            background-color:#edf3ff; border-radius:16px; }
    .label { width:312px; font-size:28px; line-height:1.2; color:#243247; }
    .number { width:312px; font-size:76px; line-height:1.2; color:#124fd6; }
  </style>
  <template id="metric-card" data-hv-component>
    <div class="card">
      <h2 class="label" data-hv-text="props.label"></h2>
      <p id="value" class="number">0</p>
      <hv-animation target="#value" property="text-number"
                    duration="60f" from="0"
                    data-hv-attr-to="props.value"
                    easing="ease-out" fill="both"></hv-animation>
    </div>
  </template>
  <hv-scene duration="120f">
    <div class="cards">
      <template data-hv-each="props.items" data-hv-as="item" data-hv-key="item.id">
        <hv-use template="#metric-card" duration="120f"
                data-hv-attr-props="item"></hv-use>
      </template>
    </div>
  </hv-scene>
</hv-composition>
```

- The `props` binding passes each item as a JSON object.
- Each `#value` selector is scoped to its component instance. The counters reach their final values at local frame 60 and hold them with `fill="both"`.
- This recipe uses system fonts. For portable export, declare a font asset and apply it to the card text.

## Recipe 3 — Held frame and finite repeated animation

This composition holds the footage at source time `2s` while a badge animation repeats five times. It uses the fractional frame rate `30000/1001`:

```html
<hv-composition id="hold-and-loop" width="1280" height="720"
                fps="30000/1001" duration="300f" background="#101820">
  <style>
    .full { position:absolute; left:0; top:0; width:1280px; height:720px; }
    .badge { position:absolute; left:80px; top:80px; width:200px; height:80px;
             font-size:32px; line-height:1.2; color:white; background-color:#176f5d; }
  </style>
  <hv-freeze at="2s" duration="300f">
    <hv-video class="full" src="./assets/footage.mp4"
              duration="300f" trim-in="0" trim-out="12s"
              audio="mute"></hv-video>
  </hv-freeze>
  <hv-loop iteration-duration="60f" count="5">
    <p id="badge" class="badge">HTML video</p>
    <hv-animation target="#badge" property="opacity" duration="60f">
      <hv-keyframe offset="0" value="0"></hv-keyframe>
      <hv-keyframe offset="0.25" value="1"></hv-keyframe>
      <hv-keyframe offset="0.75" value="1"></hv-keyframe>
      <hv-keyframe offset="1" value="0"></hv-keyframe>
    </hv-animation>
  </hv-loop>
</hv-composition>
```

- At `30000/1001` fps, 300 frames last 10.01 seconds.
- Every output frame shows source footage time `2s`; the badge loop restarts exactly at frames 60, 120, 180, 240.
- The footage asset must support the full 12 s trim interval; `audio="mute"` keeps the freeze valid.

## Recipe 4 — Large-file export with a user gesture

Run preflight before enabling the save button, and show the selected format to the user. Request the file handle inside the click handler, before other asynchronous work can consume the browser's transient user activation:

```js
saveButton.onclick = async () => {
  const config = approvedReport.selected;
  if (!config) return;
  const handle = await window.showSaveFilePicker({
    suggestedName: `film${config.extension}`
  });
  await renderer.exportVideo({ configuration: config, target: { kind: 'file', handle } });
};
```

- Check for `showSaveFilePicker` before using it. Where unavailable, offer memory or OPFS output and a separate download step. OPFS is private site storage, separate from the user's Downloads folder.
- Picker cancellation is not a failed render.
- For larger-than-memory output, prefer `{ kind: 'opfs' }` or a seekable writer — see [writers](/guide/export.md#writers-and-large-output).
