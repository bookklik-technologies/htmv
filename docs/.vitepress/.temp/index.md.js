import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"HTMV","text":"HyperText Markup Video","tagline":"Describe videos in HTML. Evaluate any frame exactly. Export MP4/WebM — entirely in the browser, with no server.","actions":[{"theme":"brand","text":"Get started","link":"/guide/getting-started"},{"theme":"alt","text":"Why HTMV?","link":"/guide/introduction"},{"theme":"alt","text":"Element reference","link":"/reference/elements"}]},"features":[{"icon":"🎞️","title":"Declarative authoring","details":"Custom hv-* elements for timelines, media and animation; ordinary HTML/CSS for visuals. No render loop, no framework runtime."},{"icon":"⏱️","title":"Deterministic time","details":"Exact rational clock math with BigInt precision. Every seek, scrub and export evaluates the same immutable, versioned IR."},{"icon":"🔒","title":"Strict validation","details":"An admitted HTML/CSS profile is checked at compile time. Unsupported styling is rejected with actionable diagnostics, not approximated."},{"icon":"📦","title":"Browser-only export","details":"WebCodecs + a pinned media adapter produce MP4/AVC or WebM in the page. No Node.js, CLI, headless browser or server FFmpeg."},{"icon":"🧩","title":"Templates & data binding","details":"Typed JSON props, keyed repetition, conditionals and reusable components — safe paths only, expanded once per compilation."},{"icon":"🔊","title":"Exact audio & captions","details":"Bounded-block PCM mixer, rational sample clock, fades and equal-power transition gains, plus burned-in and sidecar VTT captions."}]},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":1792301625000}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
