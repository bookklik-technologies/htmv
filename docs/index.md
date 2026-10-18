---
layout: home

hero:
  name: HTMV
  text: HyperText Markup Video
  tagline: Build video compositions with HTML, preview them in the browser, and export MP4 or WebM.
  image:
    src: /logo.svg
    alt: HTMV timeline mark
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Introduction
      link: /guide/introduction
    - theme: alt
      text: Element reference
      link: /reference/elements

features:
  - icon: 🎞️
    title: HTML authoring
    details: Define scenes, clips, and animations with hv-* elements. Style the visuals with supported HTML and CSS.
  - icon: ⏱️
    title: Frame-based timing
    details: Use exact frame counts and fractional frame rates. Seek directly to a frame without playing through the timeline first.
  - icon: 🔒
    title: Strict validation
    details: The compiler checks markup, timing, and CSS before rendering. Diagnostics identify unsupported input and suggest a fix.
  - icon: 📦
    title: Export in the browser
    details: Render MP4 or WebM with WebCodecs, using the encoders available in the browser. Media stays on the device during export.
  - icon: 🧩
    title: Reusable templates
    details: Pass JSON data into components, repeat items, and include content conditionally. Templates expand once when the composition compiles.
  - icon: 🔊
    title: Audio and captions
    details: Mix tracks with gain, fades, and transition crossfades. Burn captions into the video or export a separate WebVTT file.
---
