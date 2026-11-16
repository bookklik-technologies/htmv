import { describe, expect, it, vi } from 'vitest';
import { CompilationError, Rational } from '@htmv/core';
import { compile, CompileOptions } from '../../packages/compiler/src/compile.js';
import { expandShorthand, parseInlineStyle, validateDeclaration, validateStylesheet } from '../../packages/compiler/src/css.js';
import { parseHtml } from '../../packages/compiler/src/parse.js';
import { TimingResolver } from '../../packages/compiler/src/timing.js';

function composition(body: string, attributes = ''): string {
  return `<hv-composition id="c" width="100" height="100" fps="30" duration="90f" ${attributes}>${body}</hv-composition>`;
}

function diagnostic(code: string, attribute?: string) {
  return { diagnostics: expect.arrayContaining([expect.objectContaining({ code, ...(attribute ? { attribute } : {}) })]) };
}

const uninspectedMedia: CompileOptions = { assetLoader: { load: async () => ({}) } };

function fontOptions(): CompileOptions {
  return { fontPolicy: 'portable', assetLoader: { load: async () => ({ blob: new Blob(['frozen-font-fixture']) }) } };
}

const fontAsset = '<hv-assets><hv-asset id="font" kind="font" family="Audit Font" src="https://example.test/font.woff2"></hv-asset></hv-assets>';

describe('compiler hardening: declaration enums', () => {
  it.each(['invalid', 'NONE', '', 'forwards backwards'])('rejects animation fill=%j', async (fill) => {
    await expect(compile(composition(`<p id="text">Text</p><hv-animation target="#text" property="opacity" duration="30f" from="0" to="1" fill="${fill}"></hv-animation>`))).rejects.toMatchObject(diagnostic('E_ENUM', 'fill'));
  });

  it('validates animation mode before lowering declarations', async () => {
    await expect(compile(composition('<p id="text">Text</p><hv-animation target="#text" property="opacity" duration="30f" from="0" to="1" mode="add"></hv-animation>'))).rejects.toMatchObject(diagnostic('E_ENUM', 'mode'));
  });

  it.each([['type', 'zoom'], ['direction', 'diagonal'], ['type', ''], ['direction', 'LEFT']])('rejects transition %s=%j', async (attribute, value) => {
    await expect(compile(composition(`<hv-series><hv-scene duration="30f"></hv-scene><hv-transition duration="5f" ${attribute}="${value}"></hv-transition><hv-scene duration="30f"></hv-scene></hv-series>`))).rejects.toMatchObject(diagnostic('E_ENUM', attribute));
  });

  it('keeps valid transition and fill values', async () => {
    const result = await compile(composition('<hv-series><hv-scene duration="30f"><p id="text">Text</p><hv-animation target="#text" property="opacity" duration="10f" from="0" to="1" fill="both"></hv-animation></hv-scene><hv-transition duration="5f" type="slide" direction="right"></hv-transition><hv-scene duration="30f"></hv-scene></hv-series>'));
    expect(result.timing.animations[0].fill).toBe('both');
    expect([...result.timing.nodes.values()].find((node) => node.kind === 'scene')?.transitionAfter).toMatchObject({ type: 'slide', direction: 'right' });
  });

  it('does not apply transition enums to ordinary HTML attributes', async () => {
    await expect(compile(composition('<p direction="rtl" type="text">Text</p>'))).resolves.toBeDefined();
  });
});

describe('compiler hardening: CSS profile', () => {
  it.each(['display', 'position', 'flex-direction', 'overflow', 'text-align', 'direction', 'object-fit', 'visibility'])('rejects numeric bypasses for %s', (property) => {
    for (const value of ['123', '10px', '50%', '1garbage', 'calc(1 + 2)']) expect(validateDeclaration(property, value).ok).toBe(false);
  });

  it('preserves numeric geometry and background-size values', () => {
    expect(validateDeclaration('width', '10px').ok).toBe(true);
    for (const value of ['cover', 'contain', 'auto', '100%', '10px 20px', '100% auto']) expect(validateDeclaration('background-size', value).ok).toBe(true);
    expect(validateDeclaration('background-size', '100garbage').ok).toBe(false);
  });

  it.each(['100% auto', '100%auto', '50% 25%', 'auto 100%', '0 auto', '.5em 25vh', '10px\t20px'])('validates background-size components after normalization: %s', (value) => {
    expect(validateDeclaration('background-size', value).ok).toBe(true);
    expect(parseInlineStyle(`background-size:${value}`).diagnostics).toEqual([]);
    expect(validateStylesheet(`p{background-size:${value}}`).diagnostics).toEqual([]);
  });

  it.each(['100% auto auto', 'cover auto', '-10px auto', '100garbage', 'auto,auto'])('rejects unsupported background-size components: %s', (value) => {
    expect(validateDeclaration('background-size', value).ok).toBe(false);
  });

  it('rejects font shorthand rather than corrupting font-family', () => {
    expect(validateDeclaration('font', 'italic bold 16px/1.4 "Audit Font"').ok).toBe(false);
    expect(expandShorthand('font', '16px serif')).toEqual([]);
    expect(parseInlineStyle('font:16px serif;color:red').diagnostics).toHaveLength(1);
    expect(validateStylesheet('p{font:16px serif}').diagnostics).toHaveLength(1);
  });

  it('drops unsupported shorthand only under ignore-unsupported', async () => {
    await expect(compile(composition('<p style="font:16px serif">Text</p>'))).rejects.toMatchObject(diagnostic('E_STYLE_UNSUPPORTED'));
    const result = await compile(composition('<p style="font:16px serif;color:red">Text</p>'), { stylePolicy: 'ignore-unsupported' });
    expect([...result.timing.nodes.values()].find((node) => node.kind === 'text')?.attributes.style).toBe('color:red');
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E_STYLE_UNSUPPORTED', severity: 'warning' })]));
  });
});

describe('compiler hardening: trims and unknown extents', () => {
  it.each(['hv-video', 'hv-audio'])('validates %s trim syntax and ranges without metadata', async (tag) => {
    for (const [attributes, code] of [
      ['trim-in=""', 'E_TIME_UNIT'], ['trim-out=""', 'E_TIME_UNIT'],
      ['trim-in="auto"', 'E_TIME_UNIT'], ['trim-out="invalid"', 'E_TIME_UNIT'],
      ['trim-in="-1s"', 'E_DURATION'], ['trim-out="-1s"', 'E_DURATION'],
      ['trim-in="2s" trim-out="1s"', 'E_DURATION'], ['trim-in="1s" trim-out="1s"', 'E_DURATION']
    ]) {
      await expect(compile(composition(`<${tag} src="https://example.test/media" duration="30f" ${attributes}></${tag}>`), uninspectedMedia)).rejects.toMatchObject(diagnostic(code));
    }
  });

  it('checks trims even when TimingResolver has no inspector', () => {
    const resolver = new TimingResolver(Rational.of(30n), 90n, null);
    resolver.resolveTree(parseHtml(composition('<hv-video src="clip.mp4" trim-in="2s" trim-out="1s"></hv-video>')));
    resolver.validateAll();
    expect(resolver.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E_DURATION' })]));
  });

  it('warns about unknown bounds for explicit media duration', async () => {
    const result = await compile(composition('<hv-video src="https://example.test/clip.mp4" duration="30f" trim-out="2s"></hv-video>'), uninspectedMedia);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'W_MEDIA_EXTENT_UNKNOWN', severity: 'warning' })]));
  });

  it('does not claim unknown metadata proves a decode failure', async () => {
    try {
      await compile(composition('<hv-video src="https://example.test/clip.mp4" duration="auto"></hv-video>'), uninspectedMedia);
      expect.unreachable('Unknown extent must not resolve duration=auto.');
    } catch (cause) {
      expect(cause).toBeInstanceOf(CompilationError);
      expect(cause).toMatchObject(diagnostic('E_ASSET_FETCH'));
      expect((cause as CompilationError).diagnostics.some((item) => item.code === 'E_CODEC_DECODE')).toBe(false);
    }
  });

  it('uses explicit metadata fallback and rejects trims beyond known extents', async () => {
    const options: CompileOptions = { ...uninspectedMedia, mediaExtents: { getExtent: () => ({ videoExtent: Rational.of(2n) }) } };
    const source = (trim: string) => composition(`<hv-video src="https://example.test/clip.mp4" duration="30f" trim-out="${trim}"></hv-video>`);
    const result = await compile(source('2s'), options);
    expect(result.diagnostics.some((item) => item.code === 'W_MEDIA_EXTENT_UNKNOWN')).toBe(false);
    await expect(compile(source('3s'), options)).rejects.toMatchObject(diagnostic('E_DURATION', 'trim-out'));
  });
});

describe('compiler hardening: bindings after sanitization', () => {
  it.each(['onclick', 'onerror', 'style', 'srcdoc', 'data-hv-style-color', 'hv-instance-key'])('rejects executable or control attribute target %s', async (target) => {
    await expect(compile(composition(`<div data-hv-attr-${target}="props.value"></div>`), { props: { value: 'url(javascript:alert(1))' } })).rejects.toMatchObject(diagnostic('E_BINDING_ATTRIBUTE'));
  });

  it.each(['javascript:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)', 'vbscript:alert(1)'])('rejects unsafe bound URL %j', async (value) => {
    for (const binding of ['data-hv-src', 'data-hv-attr-src', 'data-hv-attr-href']) {
      await expect(compile(composition(`<div ${binding}="props.value"></div>`), { props: { value } })).rejects.toMatchObject(diagnostic('E_BINDING_URL'));
    }
  });

  it('keeps harmless bound attributes', async () => {
    const result = await compile(composition('<p data-hv-attr-title="props.title">Text</p>'), { props: { title: 'A title' } });
    expect([...result.timing.nodes.values()].find((node) => node.kind === 'text')?.attributes.title).toBe('A title');
  });
});

describe('compiler hardening: limits, URLs, and phantom nodes', () => {
  it.each([NaN, Infinity, -1, 0, 1.5, 257, Number.MAX_SAFE_INTEGER])('rejects unsafe maxDepth=%j', async (maxDepth) => {
    await expect(compile(composition(''), { limits: { maxDepth } })).rejects.toMatchObject(diagnostic('E_RESOURCE_LIMIT'));
  });

  it('enforces the configured depth and accepts the safe ceiling', async () => {
    await expect(compile(composition('<div><p>Text</p></div>'), { limits: { maxDepth: 1 } })).rejects.toMatchObject(diagnostic('E_RESOURCE_LIMIT'));
    await expect(compile(composition('<p>Text</p>'), { limits: { maxDepth: 256 } })).resolves.toBeDefined();
  });

  it.each([NaN, Infinity, -1, 0, 1.5])('rejects invalid maxNodes=%j', async (maxNodes) => {
    await expect(compile(composition(''), { limits: { maxNodes } })).rejects.toMatchObject(diagnostic('E_RESOURCE_LIMIT'));
  });

  it.each([
    '<hv-assets><hv-asset id="media" kind="video" src="http://["></hv-asset></hv-assets>',
    '<hv-video src="http://[" duration="30f"></hv-video>',
    '<p style="background-image:url(\'http://[\')">Text</p>',
    '<style>p{background-image:url("http://[")}</style><p>Text</p>'
  ])('wraps malformed resource URLs as compiler diagnostics', async (body) => {
    const load = vi.fn(async () => ({}));
    await expect(compile(composition(body), { assetLoader: { load } })).rejects.toMatchObject(diagnostic('E_ASSET_URL'));
    expect(load).not.toHaveBeenCalled();
  });

  it('wraps invalid base URLs and preserves relative custom-loader sources', async () => {
    await expect(compile(composition('<hv-video src="clip.mp4"></hv-video>'), { ...uninspectedMedia, baseURL: 'http://[' })).rejects.toMatchObject(diagnostic('E_ASSET_URL'));
    const load = vi.fn(async () => ({}));
    await compile(composition('<hv-video src="./clip.mp4" duration="30f"></hv-video>'), { assetLoader: { load } });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ src: './clip.mp4' }), expect.anything());
  });

  it.each(['hv-player', 'hv-unknown', 'constructor', 'tostring'])('rejects <%s> without registering phantom timeline nodes', (tag) => {
    const resolver = new TimingResolver(Rational.of(30n), 90n, null);
    expect(() => resolver.resolveTree(parseHtml(composition(`<${tag} id="phantom"></${tag}>`)))).not.toThrow();
    expect(resolver.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E_ELEMENT_UNSUPPORTED' })]));
    expect(resolver.nodes.has('phantom')).toBe(false);
    expect(resolver.order).not.toContain('phantom');
    expect(resolver.nodes.get('c')?.childIds).not.toContain('phantom');
  });
});

describe('compiler hardening: portable fonts', () => {
  it('rejects implicit system fonts but preserves the default policy', async () => {
    await expect(compile(composition('<p>Text</p>'), { fontPolicy: 'portable' })).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
    await expect(compile(composition('<p>Text</p>'))).resolves.toMatchObject({ fontPolicy: 'system-allowed' });
  });

  it('accepts frozen declared fonts through static CSS or inherited inline styles', async () => {
    await expect(compile(composition(`${fontAsset}<p>Text</p>`, 'style="font-family:Audit Font"'), fontOptions())).resolves.toBeDefined();
    await expect(compile(composition(`${fontAsset}<style>.copy{font-family:"Audit Font"}</style><div class="copy"><p>Text</p></div>`), fontOptions())).resolves.toBeDefined();
  });

  it.each(['Arial', 'sans-serif', 'Audit Font, serif', 'var(--font)', '"Audit" Font'])('rejects nonportable or unverifiable font-family %j', async (family) => {
    await expect(compile(composition(`${fontAsset}<p style='font-family:${family}'>Text</p>`), fontOptions())).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
  });

  it('requires frozen bytes, not just font metadata', async () => {
    await expect(compile(composition(`${fontAsset}<p style="font-family:Audit Font">Text</p>`), { fontPolicy: 'portable', assetLoader: { load: async () => ({}) } })).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
  });

  it('does not let ignore-unsupported disable portable font enforcement', async () => {
    await expect(compile(composition('<p style="font:16px Arial">Text</p>'), { fontPolicy: 'portable', stylePolicy: 'ignore-unsupported' })).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
  });

  it('fails closed for font selectors requiring browser inspection', async () => {
    await expect(compile(composition(`${fontAsset}<style>p:first-child{font-family:Audit Font}</style><p>Text</p>`), fontOptions())).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
  });

  it('does not infer font coverage from attributes omitted by layout', async () => {
    await expect(compile(composition(`${fontAsset}<style>[lang]{font-family:Audit Font}</style><p lang="en">Text</p>`), fontOptions())).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
  });

  it('matches sibling selectors against the visual DOM with audio omitted', async () => {
    const audio = '<hv-audio src="https://example.test/audio.mp3" duration="30f"></hv-audio>';
    await expect(compile(composition(`${fontAsset}<style>hv-audio+p{font-family:Audit Font}</style>${audio}<p>Text</p>`), fontOptions())).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
    await expect(compile(composition(`${fontAsset}<style>.anchor+p{font-family:Audit Font}</style><div class="anchor"></div>${audio}<p>Text</p>`), fontOptions())).resolves.toBeDefined();
  });

  it('does not confuse generated timeline IDs with explicit empty DOM IDs', async () => {
    await expect(compile(composition(`${fontAsset}<style>#hv-n2{font-family:Audit Font}</style><p id="">Text</p>`), fontOptions())).rejects.toMatchObject(diagnostic('E_FONT_POLICY'));
  });
});
