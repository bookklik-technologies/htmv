/**
 * Public compile() implementation (spec 12.2 stages, 13.1 API).
 */
import {
  CompilationError,
  CompositionMetadata,
  Diagnostic,
  error,
  JsonObject,
  JsonValue,
  Rational,
  parseFps,
  parseTimeAttribute,
  framesForSeconds
} from '@htmv/core';
import type { CompositionIR, AssetDescriptor as CoreAssetDescriptor } from '@htmv/core';
import { CNode, parseHtml, sanitizeDocument } from './parse.js';
import { VISUAL_CONTAINERS, TEXT_LEAVES, IMAGE_ELEMENTS, ENUMERATED_BOOLEAN } from './grammar.js';
import { ExpansionContext, collectDeclarations, expandNode, DEFAULT_LIMITS, ExpansionLimits } from './expand.js';
import { resolveBindingPath, parseBindingPath, BindingScope } from './bindings.js';
import { validateSchemaSubset } from './schema.js';
import { validateStylesheet, parseInlineStyle, rewriteCssUrls, StyleValidationResult } from './css.js';
import { TimingResolver, TimingResult, ResolvedNode, MediaExtentResolver } from './timing.js';
import { AssetLoader, AssetLoadResult, FetchingAssetLoader, AssetAdmission } from './assets.js';
import { ResourcePolicy, resolveResourcePolicy } from './resources.js';
import { parseVtt } from './vtt.js';
import { lowerToIR, finalizeRevisionHash } from './ir.js';
import { Hasher } from './hash.js';
import { getRegisteredPlugin, HtmvPlugin } from '@htmv/plugins';
import { svgImage } from './svg.js';

export interface CompileOptions {
  baseURL?: string;
  props?: JsonObject;
  assets?: Record<string, Blob | File>;
  styles?: readonly string[];
  stylePolicy?: 'strict' | 'ignore-unsupported';
  fontPolicy?: 'portable' | 'system-allowed';
  plugins?: readonly import('@htmv/plugins').HtmvPlugin[];
  signal?: AbortSignal;
  limits?: Partial<ExpansionLimits>;
  assetLoader?: AssetLoader;
  resourcePolicy?: Partial<ResourcePolicy>;
  mediaExtents?: MediaExtentResolver;
  /** Source may be a string of inert HTML or an element. Strings never execute scripts. */
}

export interface NormalizedStyle {
  rules: StyleValidationResult['rules'];
  diagnostics: { property: string; value: string; message: string; selector: string }[];
  origins: string[];
  /** Deterministic CSS text for the layout document (spec 8.1 step 3). */
  normalizedCss: string;
}

export class CompiledCompositionImpl {
  readonly metadata: CompositionMetadata;
  readonly diagnostics: readonly Diagnostic[];
  readonly revisionHash: string;
  readonly ir: CompositionIR;
  readonly timing: TimingResult;
  readonly styles: NormalizedStyle;
  readonly resolvedAssets: Map<string, AssetLoadResult>;
  private disposed = false;
  private references = 0;
  readonly pluginInstances: readonly import('@htmv/plugins').HtmvPlugin[];
  readonly fontPolicy: 'portable' | 'system-allowed';
  readonly resourcePolicy: Readonly<ResourcePolicy>;

  constructor(fields: {
    metadata: CompositionMetadata;
    diagnostics: readonly Diagnostic[];
    revisionHash: string;
    ir: CompositionIR;
    timing: TimingResult;
    styles: NormalizedStyle;
    resolvedAssets: Map<string, AssetLoadResult>;
    plugins?: readonly import('@htmv/plugins').HtmvPlugin[];
    fontPolicy?: 'portable' | 'system-allowed';
    resourcePolicy?: Readonly<ResourcePolicy>;
  }) {
    this.metadata = fields.metadata;
    this.diagnostics = fields.diagnostics;
    this.revisionHash = fields.revisionHash;
    this.ir = fields.ir;
    this.timing = fields.timing;
    this.styles = fields.styles;
    this.resolvedAssets = fields.resolvedAssets;
    this.pluginInstances = Object.freeze((fields.plugins ?? []).map((plugin) => Object.freeze({ ...plugin, id: plugin.id, version: plugin.version, execution: plugin.execution, capabilities: Object.freeze([...plugin.capabilities]), validate: plugin.validate.bind(plugin), prepare: plugin.prepare.bind(plugin) })));
    this.fontPolicy = fields.fontPolicy ?? 'system-allowed';
    this.resourcePolicy = fields.resourcePolicy ?? resolveResourcePolicy();
    for (const name of ['metadata', 'diagnostics', 'revisionHash', 'ir', 'timing', 'styles', 'resolvedAssets', 'pluginInstances', 'fontPolicy', 'resourcePolicy']) Object.defineProperty(this, name, { writable: false, configurable: false });
  }

  inspectTimeline(): Readonly<Record<string, unknown>> {
    return this.ir as unknown as Record<string, unknown>;
  }

  serializeIR(): CompositionIR {
    return JSON.parse(JSON.stringify(this.ir)) as CompositionIR;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return; // double disposal harmless (spec 13.1)
    this.disposed = true;
  }
  acquire(): void { if (this.disposed) throw error('E_DISPOSED', 'Compiled composition is disposed.'); this.references++; }
  release(): void { this.references = Math.max(0, this.references - 1); }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

export async function compile(source: string | CNode | HTMLElement | HTMLTemplateElement, options: CompileOptions = {}): Promise<CompiledCompositionImpl> {
  let resourcePolicy: Readonly<ResourcePolicy>;
  try { resourcePolicy = resolveResourcePolicy(options.resourcePolicy); }
  catch (e) { throw new CompilationError([e as Diagnostic]); }
  if (typeof source !== 'string' && 'nodeType' in source) {
    options = { ...options, baseURL: options.baseURL ?? source.baseURI };
    source = source.tagName.toLowerCase() === 'template' ? source.innerHTML : source.outerHTML;
  }
  const diagnostics: Diagnostic[] = [];
  if (options.signal?.aborted) {
    diagnostics.push(error('E_ABORTED', 'Compilation aborted before parsing.'));
    throw new CompilationError(diagnostics);
  }

  // ---- Stage 1/2: parse + sanitize --------------------------------------
  let root: CNode;
  try {
    if (typeof source === 'string') {
      root = parseHtml(source);
    } else {
      root = structuredClone(source);
    }
  } catch (e) {
    throw new CompilationError([
      error('E_PARSE', `Malformed source HTML: ${(e as Error).message}`, {
        suggestion: 'Custom elements must have valid closing syntax; they are not HTML void tags.'
      })
    ]);
  }
  const { removed } = sanitizeDocument(root);
  if (removed.length > 0) {
    diagnostics.push(
      error('E_SCRIPT', `Executable source was stripped/rejected during sanitization (found: ${[...new Set(removed)].join(', ')}).`)
    );
  }

  const comp = root.children.find((c) => c.kind === 'element' && c.tag === 'hv-composition');
  if (!comp) {
    throw new CompilationError([error('E_ROOT', 'Source must contain exactly one hv-composition element as a descendant of the document root.')]);
  }
  const compositionId = comp.attributes['id'] ?? '';
  if (!compositionId || root.children.filter((c) => c.tag === 'hv-composition').length !== 1) throw new CompilationError([error('E_ROOT', 'Exactly one composition with a nonempty id is required.')]);

  // ---- Required attributes / numeric root config (spec 4.3) -------------
  for (const attr of ['width', 'height', 'fps', 'duration']) {
    if (!(attr in comp.attributes)) {
      throw new CompilationError([error('E_ROOT', `hv-composition requires attribute "${attr}".`, { attribute: attr })]);
    }
  }
  const width = Number(comp.attributes['width']);
  const height = Number(comp.attributes['height']);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new CompilationError([error('E_ROOT', 'width/height must be positive integer CSS-pixel dimensions.')]);
  }
  let fps: Rational;
  try {
    fps = parseFps(comp.attributes['fps']);
  } catch (e) {
    if (e instanceof CompilationError) throw e;
    throw new CompilationError([(e as Diagnostic)]);
  }
  let durationParsed;
  try {
    durationParsed = parseTimeAttribute(comp.attributes['duration']);
  } catch (e) {
    if (e instanceof CompilationError) throw e;
    throw new CompilationError([(e as Diagnostic)]);
  }
  if (durationParsed.kind !== 'frames') {
    // Must resolve to an exact positive integer number of frames (spec 3.1)
    const dFrames = durationParsed.value.mul(fps);
    if (dFrames.den !== 1n || dFrames.lte(Rational.zero())) {
      throw new CompilationError([
        error('E_ROOT_FRAME_ALIGNMENT', `Root duration "${comp.attributes['duration']}" is not frame-aligned at ${fps.toString()} fps.`, {
          suggestion: `Use an explicit frame count such as ${(dFrames.floor().num + 1n).toString()}f.`
        })
      ]);
    }
    if (dFrames.num > Number.MAX_SAFE_INTEGER) {
      throw new CompilationError([error('E_RESOURCE_LIMIT', 'Root duration exceeds safe integer frame counts.')]);
    }
  }
  const durationFrames =
    durationParsed.kind === 'frames'
      ? durationParsed.value.num
      : durationParsed.value.mul(fps).num; // already validated exact integer
  if (durationFrames <= 0n) {
    throw new CompilationError([error('E_ROOT', 'Root duration must be positive.')]);
  }
  if (durationFrames > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 8192 || height > 8192 || fps.lt(Rational.of(1n)) || fps.gt(Rational.of(240n))) throw new CompilationError([error('E_RESOURCE_LIMIT', 'Standard profile requires safe frame counts, dimensions <=8192, and FPS 1–240.')]);
  if (!['44100', '48000'].includes(comp.attributes['sample-rate'] ?? '48000') || !['1', '2'].includes(comp.attributes.channels ?? '2')) throw new CompilationError([error('E_ROOT', 'sample-rate must be 44100/48000 and channels must be 1/2.')]);

  const sampleRate = ((comp.attributes['sample-rate'] ?? '48000') === '44100' ? 44100 : 48000) as 44100 | 48000;
  const channels = ((comp.attributes['channels'] ?? '2') === '1' ? 1 : 2) as 1 | 2;
  const seed = comp.attributes['seed'] ?? '0';

  // ---- Stage 3: props/schema/defaults -----------------------------------
  const ctx = new ExpansionContext(options.props ?? {}, { ...DEFAULT_LIMITS, ...options.limits });
  const decls = collectDeclarations(comp, ctx);
  let rootProps: JsonObject = {};
  if (decls.propsBlock) {
    try {
      rootProps = JSON.parse(decls.propsBlock) as JsonObject;
    } catch {
      diagnostics.push(error('E_JSON', 'Inert data-hv-props block is not valid JSON.'));
    }
  }
  // Root-key-level replace with caller props (spec 7.1), then validate.
  const mergedProps: JsonObject = structuredClone({ ...rootProps, ...(options.props ?? {}) });
  ctx.rootProps = mergedProps;
  ctx.scopeStack = [{ props: mergedProps }];
  function validateRootSchema(schemaText: string): void {
    let schema: JsonValue | undefined;
    try {
      schema = JSON.parse(schemaText) as JsonValue;
    } catch {
      diagnostics.push(error('E_JSON', 'Inert data-hv-schema block is not valid JSON.'));
      return;
    }
    const res = validateSchemaSubset(mergedProps as JsonValue, schema);
    diagnostics.push(...res.diagnostics);
  }
  if (decls.schemaBlock) validateRootSchema(decls.schemaBlock);

  // ---- Stage 3b: template expansion + bindings --------------------------
  const expanded = expandNode(comp, ctx, 0, '');
  if (ctx.diagnostics.length > 0) {
    throw new CompilationError(ctx.diagnostics);
  }
  if (!expanded || expanded.tag !== 'hv-composition') {
    throw new CompilationError([error('E_ROOT', 'Compilation failed before expansion completed.')]);
  }

  // ---- Stage 4: styles ---------------------------------------------------
  const styles = await validateStyleInputs(expanded, options, diagnostics);
  const effectivePlugins = new Map<string, HtmvPlugin>((options.plugins ?? []).map((p) => [p.id, p]));
  const admitLeaves = (node: CNode): void => {
    if (node.tag === 'canvas') {
      const id = node.attributes['data-hv-plugin']; const plugin = effectivePlugins.get(id) ?? getRegisteredPlugin(id);
      if (!plugin) diagnostics.push(error('E_ELEMENT_UNSUPPORTED', 'Canvas requires an admitted deterministic plugin.'));
      else {
        effectivePlugins.set(id, plugin);
        try {
          const props = JSON.parse(node.attributes['data-hv-plugin-props'] ?? '{}');
          if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('Plugin props must be an object.');
          diagnostics.push(...plugin.validate(props));
        } catch (e) { diagnostics.push(error('E_JSON', `Plugin ${id}: ${(e as Error).message}`)); }
      }
      if (!['width', 'height'].every((p) => /^\d+$/.test(node.attributes[p] ?? '') && Number(node.attributes[p]) > 0 && Number(node.attributes[p]) <= 8192)) diagnostics.push(error('E_RESOURCE_LIMIT', 'Plugin canvas requires explicit positive width/height <=8192.'));
    }
    if (node.tag === 'svg') {
      try {
        const fonts = new Set<string>(); const collect = (n: CNode): void => { if (n.tag === 'hv-asset' && n.attributes.kind === 'font') fonts.add(n.attributes.family); n.children.forEach(collect); }; collect(expanded);
        const src = svgImage(node, fonts); node.tag = 'img'; node.attributes.src = src; node.children = [];
        for (const name of Object.keys(node.attributes)) if (!['src', 'id', 'class', 'style', 'width', 'height', 'data-hv-start', 'data-hv-duration'].includes(name)) delete node.attributes[name];
      } catch (e) { diagnostics.push(error('E_ELEMENT_UNSUPPORTED', (e as Error).message)); }
      return;
    }
    node.children.forEach(admitLeaves);
  };
  admitLeaves(expanded);

  const admission = new AssetAdmission(options.assetLoader ?? new FetchingAssetLoader({ integrityVerify: true, signal: options.signal, resourcePolicy }), resourcePolicy, options.signal);
  const loadAsset = async (asset: CoreAssetDescriptor, supplied?: Blob): Promise<AssetLoadResult> => {
    try { return await admission.load(asset, supplied); }
    catch (e) {
      const code = (e as { code?: unknown }).code;
      throw new CompilationError([error(typeof code === 'string' ? code : (e as Error).name === 'AbortError' ? 'E_ABORTED' : 'E_ASSET_FETCH', `Asset ${asset.id}: ${(e as Error).message}`)]);
    }
  };
  const assetDeclarations: CoreAssetDescriptor[] = [];
  const resolvedAssets = new Map<string, AssetLoadResult>();
  const assetsBlock = expanded.children.find((c) => c.kind === 'element' && c.tag === 'hv-assets');
  if (assetsBlock) {
    for (const assetEl of assetsBlock.children) {
      if (assetEl.kind !== 'element' || assetEl.tag !== 'hv-asset') continue;
      const id = assetEl.attributes['id'];
      const kind = assetEl.attributes['kind'];
      const src = assetEl.attributes['src'];
      if (!id || !kind || !src) {
        diagnostics.push(error('E_ASSET', 'hv-asset requires id, kind, and src.', { attribute: 'src' }));
        continue;
      }
      if (!['image', 'video', 'audio', 'font', 'captions', 'json'].includes(kind)) {
        diagnostics.push(error('E_ASSET', `Unknown asset kind "${kind}".`, { attribute: 'kind' }));
        continue;
      }
      if (kind === 'font' && !assetEl.attributes['family']) {
        diagnostics.push(error('E_ASSET', 'Font assets require a family.', { attribute: 'family' }));
        continue;
      }
      const baseURL = options.baseURL ?? (typeof location !== 'undefined' ? location.href : undefined);
      let absolute = src;
      if (!/^(asset:|data:|blob:|https?:)/i.test(src) && baseURL) {
        absolute = new URL(src, baseURL).href;
      } else if (/^\//.test(src) && baseURL) {
        absolute = new URL(src, baseURL).href;
      }
      const descriptor: CoreAssetDescriptor = {
        id,
        kind: kind as CoreAssetDescriptor['kind'],
        src: absolute,
        family: assetEl.attributes['family'],
        weight: assetEl.attributes['weight'],
        fontStyle: assetEl.attributes['font-style'],
        integrity: assetEl.attributes['integrity']
      };
      if (kind === 'font' && options.fontPolicy === 'portable' && !options.assets?.[id]) {
        // portable mode requires pinned font bytes — declarations are pinned here
      }
      assetDeclarations.push(descriptor);
      // Reserve programmatic assets: local file blobs override declarations (spec 7.5)
      resolvedAssets.set(id, await loadAsset(descriptor, options.assets?.[id]));
    }
  }

  // Freeze undeclared leaf URLs too; sessions must never refetch mutable source bytes.
  const loadLeafAssets = async (node: CNode): Promise<void> => {
    const kind = node.tag === 'img' ? 'image' : node.tag === 'hv-video' ? 'video' : node.tag === 'hv-audio' ? 'audio' : node.tag === 'hv-captions' ? 'captions' : null;
    if (kind && node.attributes.src?.startsWith('asset:')) {
      const id = node.attributes.src.slice(6);
      if (!resolvedAssets.has(id) && options.assets?.[id]) {
        const descriptor: CoreAssetDescriptor = { id, kind, src: `asset:${id}` }; assetDeclarations.push(descriptor);
        resolvedAssets.set(id, await loadAsset(descriptor, options.assets[id]));
      }
      if (!resolvedAssets.has(id)) diagnostics.push(error('E_ASSET_FETCH', `Asset ${id} is not declared or supplied.`));
    } else if (kind && node.attributes.src) {
      const id = `hv-inline-asset-${assetDeclarations.length}`;
      const base = options.baseURL ?? (typeof location !== 'undefined' ? location.href : undefined);
      const descriptor: CoreAssetDescriptor = { id, kind, src: base ? new URL(node.attributes.src, base).href : node.attributes.src };
      assetDeclarations.push(descriptor);
      resolvedAssets.set(id, await loadAsset(descriptor));
      node.attributes.src = `asset:${id}`;
    }
    for (const child of node.children) if (child.kind === 'element') await loadLeafAssets(child);
  };
  await loadLeafAssets(expanded);

  // captions src VTT parse
  const mediaExtents: MediaExtentResolver = options.mediaExtents ?? {
    getExtent: () => undefined
  };

  // ---- Stage 6/7: timing resolution + conflict detection ----------------
  const resolver = new TimingResolver(fps, durationFrames, {
    getExtent: (src, kind) => {
      if (src.startsWith('asset:')) {
        const id = src.slice('asset:'.length);
        const r = resolvedAssets.get(id);
        if (r) return { videoExtent: r.videoExtent, audioExtent: r.audioExtent };
      }
      return mediaExtents.getExtent(src, kind);
    }
  });
  resolver.resolveTree(expanded);
  resolver.validateAll();
  diagnostics.push(...resolver.diagnostics);

  // ---- Inline style validation on every node -----------------------------
  for (const node of resolver.nodes.values()) {
    const styleText = node.attributes['style'];
    if (styleText) {
      const inline = parseInlineStyle(styleText);
      node.attributes.style = inline.declarations.map(([p, v]) => `${p}:${v}`).join(';');
      for (const message of inline.diagnostics) {
        diagnostics.push(
          options.stylePolicy === 'ignore-unsupported'
            ? { severity: 'warning', code: 'E_STYLE_UNSUPPORTED', message, attribute: 'style', nodeId: node.id, recoverable: true }
            : error('E_STYLE_UNSUPPORTED', message, { attribute: 'style', nodeId: node.id })
        );
      }
    }
  }
  for (const d of styles.diagnostics) {
    diagnostics.push(
      options.stylePolicy === 'ignore-unsupported'
        ? { severity: 'warning', code: 'E_STYLE_UNSUPPORTED', message: `${d.message} (selector "${d.selector}")`, recoverable: true }
        : error('E_STYLE_UNSUPPORTED', `${d.message} (selector "${d.selector}")`)
    );
  }

  const backgroundAssets = new Map<string, string>();
  const freezeBackground = async (value: string): Promise<string> => {
    return rewriteCssUrls(value, async (src) => {
      if (src.startsWith('asset:')) {
        const id = src.slice(6);
        if (!resolvedAssets.has(id) && options.assets?.[id]) {
          const descriptor: CoreAssetDescriptor = { id, kind: 'image', src };
          assetDeclarations.push(descriptor); resolvedAssets.set(id, await loadAsset(descriptor, options.assets[id]));
        }
        if (!resolvedAssets.has(id) || !assetDeclarations.some((a) => a.id === id && a.kind === 'image')) throw new CompilationError([error('E_ASSET_FETCH', `CSS image ${src} is not an admitted image asset.`)]);
        return src;
      }
      let id = backgroundAssets.get(src);
      if (!id) {
        id = `hv-background-${assetDeclarations.length}`;
        const base = options.baseURL ?? (typeof location !== 'undefined' ? location.href : undefined);
        const descriptor: CoreAssetDescriptor = { id, kind: 'image', src: base ? new URL(src, base).href : src };
        assetDeclarations.push(descriptor); backgroundAssets.set(src, id);
        resolvedAssets.set(id, await loadAsset(descriptor));
      }
      return `asset:${id}`;
    });
  };
  for (const rule of styles.rules) for (const declaration of rule.declarations) declaration[1] = await freezeBackground(declaration[1]);
  styles.normalizedCss = styles.rules.map((r) => `${r.selector}{${r.declarations.map(([p, v]) => `${p}:${v}`).join(';')}}`).join('');
  for (const node of resolver.nodes.values()) {
    if (node.attributes.style) {
      const declarations = parseInlineStyle(node.attributes.style).declarations;
      for (const declaration of declarations) declaration[1] = await freezeBackground(declaration[1]);
      node.attributes.style = declarations.map(([p, v]) => `${p}:${v}`).join(';');
    }
  }

  // ---- Captions src resolve (sidecar source) -----------------------------
  for (const node of resolver.nodes.values()) {
    if (node.kind === 'captions' && node.attributes['src']) {
      const srcRef = node.attributes['src'];
      const id = srcRef.startsWith('asset:') ? srcRef.slice(6) : null;
      const parsed = id ? resolvedAssets.get(id)?.parsedText : undefined;
      if (parsed !== undefined) {
        const vtt = parseVtt(parsed);
        const cues = vtt.cues.map((c) => ({
          start: Rational.parse(c.start),
          end: Rational.parse(c.end),
          text: c.text
        }));
        node.captions = { cues: [...(node.captions?.cues ?? []), ...cues] };
        diagnostics.push(
          ...vtt.diagnostics.map((m) => ({ severity: 'warning' as const, code: 'W_VTT', message: m, recoverable: true }))
        );
      } else if (id) {
        diagnostics.push(error('E_ASSET_FETCH', `Caption source "${srcRef}" is not a declared, loaded captions asset.`));
      }
    }
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    throw new CompilationError(errors);
  }

  // ---- Stage 8: lower to IR + revision hash ------------------------------
  const metadata: CompositionMetadata = {
    id: compositionId,
    width,
    height,
    fps: { numerator: Number(fps.num), denominator: Number(fps.den) },
    durationFrames: Number(durationFrames),
    sampleRate,
    channels,
    seed,
    background: comp.attributes['background'] ?? '#000000'
  };
  const ir = lowerToIR(
    resolver,
    { compositionId, width, height, fps, durationFrames, sampleRate, channels, seed },
    assetDeclarations,
    mergedProps
  );
  ir.assets = assetDeclarations.map((a) => (a.src.startsWith('blob:') ? { ...a, src: 'blob:[redacted]' } : a));
  ir.background = metadata.background;
  ir.plugins = [...effectivePlugins.values()].map((p) => ({ id: p.id, version: p.version }));
  ir.assetHashes = Object.fromEntries([...resolvedAssets].map(([id, asset]) => [id, asset.contentHash ?? null]));
  const revisionHash = await finalHash(ir);
  ir.revisionHash = revisionHash;
  deepFreeze(ir); deepFreeze(metadata); deepFreeze(mergedProps);
  for (const node of resolver.nodes.values()) deepFreeze(node);
  resolver.nodes = immutableMap(resolver.nodes);
  deepFreeze(resolver.animations); deepFreeze(styles);
  for (const asset of resolvedAssets.values()) deepFreeze(asset);
  Object.freeze(resolver);

  return new CompiledCompositionImpl({
    metadata,
    diagnostics,
    revisionHash,
    ir,
    timing: resolver,
    styles,
    resolvedAssets: immutableMap(resolvedAssets), plugins: [...effectivePlugins.values()], fontPolicy: options.fontPolicy, resourcePolicy
  });

  async function finalHash(ir: CompositionIR): Promise<string> {
    const base = await finalizeRevisionHash(ir);
    // include style/DIAGnostics fingerprint for cache invalidation (12.4)
    const extra = Hasher.sha256HexSync(JSON.stringify(styles));
    let h = '';
    try {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base + extra) as unknown as BufferSource));
      h = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      h = base;
    }
    return h;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
function immutableMap<K, V>(map: Map<K, V>): Map<K, V> {
  return new Proxy(map, { get(target, key) {
    if (key === 'set' || key === 'delete' || key === 'clear') return () => { throw new Error('Compiled revision is immutable.'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/** The compiler never executes host scripts; source elements snapshot their admitted subtree. */

async function validateStyleInputs(
  expanded: CNode,
  options: CompileOptions,
  diagnostics: Diagnostic[]
): Promise<NormalizedStyle> {
  const rules: NormalizedStyle['rules'] = [];
  const styleDiags: NormalizedStyle['diagnostics'] = [];
  const origins: string[] = [];
  void diagnostics;
  const collect = (element: CNode) => {
    if (element.kind === 'element' && element.tag === 'style') {
      const res = validateStylesheet(element.text ?? '');
      rules.push(...res.rules);
      styleDiags.push(...res.diagnostics);
      origins.push('inline-style-block');
    }
    for (const child of element.children) {
      if (child.kind === 'element') collect(child);
    }
  };
  collect(expanded);
  if (options.styles) {
    for (const css of options.styles) {
      const res = validateStylesheet(css);
      rules.push(...res.rules);
      styleDiags.push(...res.diagnostics);
      origins.push('compile-options');
    }
  }
  // Serialized back in deterministic order; class selectors stay composition-local (spec 7.6)
  const normalizedCss = rules
    .map((r) => `${r.selector}{${r.declarations.map(([p, v]) => `${p}:${v}`).join(';')}}`)
    .join('');
  return { rules, diagnostics: styleDiags, origins, normalizedCss };
}
