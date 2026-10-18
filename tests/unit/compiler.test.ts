import { describe, it, expect } from 'vitest';
import { parseHtml, sanitizeDocument } from '../../packages/compiler/src/parse.js';
import { parseBindingPath, resolveBindingPath } from '../../packages/compiler/src/bindings.js';
import { validateSchemaSubset } from '../../packages/compiler/src/schema.js';
import { validateDeclaration, validateStylesheet, parseInlineStyle, expandShorthand } from '../../packages/compiler/src/css.js';
import { parseVtt } from '../../packages/compiler/src/vtt.js';
import { compile } from '../../packages/compiler/src/compile.js';
import { Rational } from '@htmv/core';
import { CompilationError } from '@htmv/core';

function compileOpts(): { props?: Record<string, unknown> } {
  return {};
}

describe('sanitize', () => {
  it('strips scripts and on* attributes', () => {
    const root = parseHtml(`<hv-composition id="c" width="100" height="100" fps="30" duration="30f"><script>alert(1)</script><div style="color:red" onclick="x()"></div></hv-composition>`);
    const { removed } = sanitizeDocument(root);
    expect(removed).toContain('script');
    expect(removed).toContain('onclick');
  });
});

describe('bindings', () => {
  it('rejects prototype traversal and non-root paths', () => {
    expect(parseBindingPath('__proto__.x')).toBeNull();
    expect(parseBindingPath('window.alert')).toBeNull();
    expect(parseBindingPath('props.x[0].y')).toEqual({ root: 'props', segments: ['x', 0, 'y'] });
  });
  it('resolves paths', () => {
    const scope = { props: { a: { b: [10, 'x'] } }, item: 'z' };
    expect(resolveBindingPath(parseBindingPath('props.a.b')!, scope)).toEqual([10, 'x']);
    expect(resolveBindingPath(parseBindingPath('item')!, scope)).toBe('z');
    expect(resolveBindingPath(parseBindingPath('props.a.q')!, scope)).toBeUndefined();
  });
});

describe('schema subset', () => {
  it('validates object with required', () => {
    const res = validateSchemaSubset({ title: 'T' }, { type: 'object', required: ['title', 'n'] } as never);
    expect(res.valid).toBe(false);
    expect(res.diagnostics[0].code).toBe('E_SCHEMA_REQUIRED');
  });
  it('diagnoses unsupported keywords', () => {
    const res = validateSchemaSubset('x', { type: 'string', pattern: '^x$' } as never);
    expect(res.diagnostics.some((d) => d.code === 'E_SCHEMA_KEYWORD')).toBe(true);
  });
});

describe('CSS profile', () => {
  it('admits listed properties, rejects unsupported', () => {
    expect(validateDeclaration('display', 'flex').ok).toBe(true);
    expect(validateDeclaration('position', 'absolute').ok).toBe(true);
    expect(validateDeclaration('z-index', '10').ok).toBe(false);
    expect(validateDeclaration('filter', 'blur(2px)').ok).toBe(false);
    expect(validateDeclaration('position', 'sticky').ok).toBe(false);
    expect(validateDeclaration('transform', 'rotate(30deg) translateX(10px)').ok).toBe(true);
    expect(validateDeclaration('transform', 'perspective(100px)').ok).toBe(false);
  });
  it('expands shorthands', () => {
    const m = expandShorthand('margin', '1px 2px');
    expect(m).toEqual([['margin-top', '1px'], ['margin-bottom', '1px'], ['margin-right', '2px'], ['margin-left', '2px']]);
  });
  it('stylesheet validation collects diagnostics', () => {
    const res = validateStylesheet('.a { color: red; float: left; } .b::before { content: ""; }');
    expect(res.diagnostics.some((d) => d.property === 'float')).toBe(true);
    expect(res.diagnostics.some((d) => d.message.includes('Pseudo-elements'))).toBe(true);
    expect(res.rules[0].declarations.some(([p]) => p === 'color')).toBe(true);
  });
});

describe('VTT subset', () => {
  it('parses ordinary cues', () => {
    const res = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n\n00:00:03.500 --> 00:00:04.000\nWorld\n');
    expect(res.cues).toHaveLength(2);
    expect(res.cues[0].start).toBe('0');
    expect(res.cues[0].end).toBe('2');
  });
  it('diagnoses unsupported blocks', () => {
    const res = parseVtt('WEBVTT\n\nSTYLE\n.big { color: red; }\n\n00:00:00.000 --> 00:00:01.000\nHi');
    expect(res.diagnostics.some((d) => d.includes('STYLE'))).toBe(true);
  });
});

describe('compile: timing language', () => {
  it('T01: root 150f at 30fps => exactly 150 frames, 5s', async () => {
    const c = await compile(`<hv-composition id="t01" width="100" height="100" fps="30" duration="150f"></hv-composition>`);
    expect(c.metadata.durationFrames).toBe(150);
    expect(Rational.of(150n).div(Rational.parse('30')).toString()).toBe('5');
  });

  it('T03: root 10s at 30000/1001 frame-alignment error', async () => {
    await expect(compile(`<hv-composition id="t03" width="100" height="100" fps="30000/1001" duration="10s"></hv-composition>`)).rejects.toThrow(CompilationError);
  });

  it('T04: nested starts 60f + 15f, root frame 90 has inner local 15f', async () => {
    const c = await compile(`<hv-composition id="t04" width="100" height="100" fps="30" duration="120f"><hv-scene start="60f" duration="60f"><hv-sequence start="15f" duration="20f"><p>hi</p></hv-sequence></hv-scene></hv-composition>`);
    const nodes = [...c.timing.nodes.values()];
    const seq = nodes.find((n) => n.kind === 'sequence');
    expect(seq!.start.toString()).toBe('5/2');
    expect(seq!.relativeStart.toString()).toBe('1/2');
    // root frame 90 => root time 3s; scene local = 3-2=1s; inner local = 1 - 0.5 = 0.5s = 15f
    const innerLocal = Rational.of(90n, 1n).div(Rational.parse('30')).sub(seq!.start.sub(seq!.relativeStart)).sub(seq!.relativeStart);
    expect(innerLocal.toString()).toBe('1/2');
  });

  it('T06: loop 60f x5 => exactly 300f', async () => {
    const c = await compile(`<hv-composition id="t06" width="100" height="100" fps="30" duration="300f"><hv-loop iteration-duration="60f" count="5"><p>HTML video</p></hv-loop></hv-composition>`);
    const loop = [...c.timing.nodes.values()].find((n) => n.kind === 'loop');
    expect(loop!.duration!.toString()).toBe('10');
  });

  it('series 90f + 15f crossfade + 90f => 165f, incoming starts 75f', async () => {
    const c = await compile(`<hv-composition id="s1" width="100" height="100" fps="30" duration="165f"><hv-series><hv-scene duration="90f"><p>a</p></hv-scene><hv-transition duration="15f"></hv-transition><hv-scene duration="90f"><p>b</p></hv-scene></hv-series></hv-composition>`);
    const scenes = [...c.timing.nodes.values()].filter((n) => n.kind === 'scene');
    expect(scenes[1].start.toString()).toBe('5/2'); // 75f
    const series = [...c.timing.nodes.values()].find((n) => n.kind === 'series');
    expect(series!.duration!.toString()).toBe('11/2'); // 165f
  });

  it('T09: triple overlap rejected', async () => {
    await expect(compile(`<hv-composition id="s2" width="100" height="100" fps="30" duration="300f"><hv-series><hv-scene duration="90f"><p>a</p></hv-scene><hv-transition duration="80f"></hv-transition><hv-scene duration="90f"><p>b</p></hv-scene><hv-transition duration="80f"></hv-transition><hv-scene duration="90f"><p>c</p></hv-scene></hv-series></hv-composition>`)).rejects.toThrow(CompilationError);
  });

  it('E_FREEZE_AUDIO: included video audio under freeze rejected, mute accepted', async () => {
    const options = { assetLoader: { load: async () => ({ videoExtent: Rational.of(5n), audioExtent: Rational.of(5n) }) } };
    await expect(compile(`<hv-composition id="f1" width="100" height="100" fps="30" duration="90f"><hv-freeze at="1s" duration="3s"><hv-video src="./x.mp4" duration="3s" trim-out="5s" audio="include"></hv-video></hv-freeze></hv-composition>`, options)).rejects.toMatchObject({ diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'E_FREEZE_AUDIO' })]) });
    const c = await compile(`<hv-composition id="f2" width="100" height="100" fps="30" duration="90f"><hv-freeze at="1s" duration="3s"><hv-video src="./x.mp4" duration="3s" trim-out="5s" audio="mute"></hv-video></hv-freeze></hv-composition>`, options);
    expect([...c.timing.nodes.values()].some((n) => n.kind === 'freeze')).toBe(true);
  });

  it('T10: overlapping fill animation conflict rejected', async () => {
    await expect(compile(`<hv-composition id="a1" width="100" height="100" fps="30" duration="90f"><p id="x">t</p><hv-animation target="#x" property="opacity" duration="30f" from="0" to="1" fill="both"></hv-animation><hv-animation target="#x" property="opacity" start="10f" duration="30f" from="1" to="0"></hv-animation></hv-composition>`)).rejects.toThrow(CompilationError);
  });

  it('T10b: keyframe replacement with disjoint fill succeeds', async () => {
    const c = await compile(`<hv-composition id="a2" width="100" height="100" fps="30" duration="120f"><p id="x">t</p><hv-animation target="#x" property="opacity" duration="30f" from="0" to="1"></hv-animation><hv-animation target="#x" property="opacity" start="60f" duration="30f" from="1" to="0" fill="both"></hv-animation></hv-composition>`);
    expect(c.timing.animations).toHaveLength(2);
  });

  it('data-hv timing attributes create timed visibility', async () => {
    const c = await compile(`<hv-composition id="d1" width="100" height="100" fps="30" duration="90f"><p data-hv-start="30f" data-hv-duration="60f">Visible for two seconds.</p></hv-composition>`);
    const p = [...c.timing.nodes.values()].find((n) => n.kind === 'text');
    expect(p!.start.toString()).toBe('1');
    expect(p!.duration!.toString()).toBe('2');
  });

  it('template repetition expands and scopes ids', async () => {
    const c = await compile(`<hv-composition id="tpl" width="640" height="360" fps="30" duration="120f">
      <script type="application/json" data-hv-props>{"items":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}</script>
      <template id="card" data-hv-component><h2 data-hv-text="props.label">x</h2></template>
      <hv-scene duration="120f"><template data-hv-each="props.items" data-hv-as="item" data-hv-key="item.id"><hv-use template="#card" duration="120f" data-hv-attr-props="item"></hv-use></template></hv-scene>
    </hv-composition>`);
    const texts = [...c.timing.nodes.values()].filter((n) => n.kind === 'text');
    expect(texts.length).toBe(2);
  }, 15000);
});
