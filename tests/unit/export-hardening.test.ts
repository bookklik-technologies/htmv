import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompilationError, error, Rational } from '@htmv/core';
import type { CompiledCompositionImpl } from '@htmv/compiler';
import type { MediaReader } from '@htmv/media';
import type { ExportConfiguration, SeekableWriter } from '../../packages/exporter/src/types.js';
import { RendererSession } from '../../packages/exporter/src/session.js';
import { exportRange } from '../../packages/exporter/src/scheduler.js';
import { MemoryWriterSession, OpfsWriterSession, writerQuotaError } from '../../packages/exporter/src/writers.js';

const mocks = vi.hoisted(() => ({
  layout: vi.fn(),
  layoutDispose: vi.fn(),
  inspect: vi.fn(),
  open: vi.fn(),
  createMuxer: vi.fn(),
  mix: vi.fn()
}));

vi.mock('@htmv/layout-dom', () => ({
  LayoutSession: class {
    dispose = mocks.layoutDispose;
  },
  buildLayoutDom: mocks.layout,
  buildLayoutDomAsync: mocks.layout,
  layoutText: vi.fn()
}));

vi.mock('@htmv/media-mediabunny', () => ({
  getMediabunnyAdapter: () => ({ adapter: { inspect: mocks.inspect, open: mocks.open }, createMuxer: mocks.createMuxer }),
  ADAPTER_NAME: 'test-adapter',
  ADAPTER_VERSION: 'test'
}));

vi.mock('../../packages/exporter/src/blockmix.js', () => ({ mixAudioBlockCanonical: mocks.mix }));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function composition() {
  return {
    acquire: vi.fn(),
    release: vi.fn(),
    revisionHash: 'revision',
    metadata: { id: 'composition', width: 16, height: 16, fps: { numerator: 1, denominator: 1 }, durationFrames: 1, sampleRate: 48000, channels: 2 },
    ir: { assets: [], props: {} },
    timing: { nodes: new Map(), animations: [] },
    styles: { normalizedCss: '' },
    resolvedAssets: new Map(),
    pluginInstances: [],
    fontPolicy: 'system'
  } as unknown as CompiledCompositionImpl;
}

function configuration(audio = false): ExportConfiguration {
  return {
    token: 'token', revisionHash: 'revision', profile: 'mp4', mimeType: 'video/mp4', extension: '.mp4',
    range: { from: 0, toExclusive: 1 }, width: 16, height: 16, fps: { numerator: 1, denominator: 1 },
    video: { codec: 'avc1.42001f', bitrate: 1000, keyframeIntervalSeconds: 2 },
    audio: audio ? { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 1000 } : null,
    syncCertification: 'certified'
  };
}

function muxer() {
  return {
    mimeType: 'video/mp4', addVideoFrame: vi.fn(async () => {}), addAudioBlock: vi.fn(async () => {}),
    finish: vi.fn(async () => {}), cancel: vi.fn(async () => {})
  };
}

function schedulerSession(compiled = composition()) {
  const renderer = new RendererSession(compiled);
  return {
    compiled,
    session: {
      evaluate: vi.fn(() => ({})), prefetchMedia: vi.fn(async () => {}), paintTo: vi.fn(),
      resetResourceMeasurements: vi.fn(), resourceMeasurements: vi.fn(() => ({})),
      sourceHash: 'source', styleHash: 'style', propsHash: 'props',
      mixAudioBlockForExport: renderer.mixAudioBlockForExport.bind(renderer)
    } as unknown as RendererSession,
    renderer
  };
}

const audioNode = { id: 'audio', kind: 'audio', attributes: { src: 'https://fixture.test/audio.wav' } };

function mediaInternals(session: RendererSession) {
  return session as unknown as {
    ensureMediaHandle(id: string, source: string, node: typeof audioNode): Promise<unknown>;
    mediaHandles: Map<string, unknown>;
    pendingHandles: Map<string, Promise<unknown>>;
  };
}

function opfs() {
  const stream = { write: vi.fn(async () => {}), truncate: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const file = new Blob(['output']) as File;
  const handle = { createWritable: vi.fn(async () => stream), getFile: vi.fn(async () => file) };
  const root = { getFileHandle: vi.fn(async () => handle), removeEntry: vi.fn(async () => {}) };
  vi.stubGlobal('navigator', { userAgent: 'test', storage: { getDirectory: vi.fn(async () => root) } });
  return { root, stream, file };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.layout.mockReturnValue({ boxes: [] });
  mocks.inspect.mockResolvedValue({ videoTracks: [], audioTracks: [{ sampleRate: 48000, numberOfChannels: 2 }] });
  mocks.mix.mockResolvedValue({ left: new Float32Array(4096), right: new Float32Array(4096), clippedSamples: 2, peak: 2.5, pcmBlockBytes: 32768 });
  mocks.createMuxer.mockReturnValue(muxer());
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('renderer initialization ownership', () => {
  it('shares initialization and waits for asynchronous layout before disposal', async () => {
    const layout = deferred<{ boxes: [] }>();
    mocks.layout.mockReturnValue(layout.promise);
    const compiled = composition();
    const session = new RendererSession(compiled);
    const initialization = session.initialize();
    const duplicate = session.initialize();
    const failure = expect(initialization).rejects.toMatchObject({ name: 'AbortError' });
    const duplicateFailure = expect(duplicate).rejects.toMatchObject({ name: 'AbortError' });
    const disposal = session.dispose();
    expect(session.state).toBe('disposing');
    expect(compiled.release).not.toHaveBeenCalled();
    layout.resolve({ boxes: [] });
    await Promise.all([failure, duplicateFailure, disposal]);
    expect(session.state).toBe('disposed');
    expect(mocks.layout).toHaveBeenCalledTimes(1);
    expect(mocks.layoutDispose).toHaveBeenCalledTimes(1);
    expect(compiled.release).toHaveBeenCalledTimes(1);
    await session.initialize();
    await session.dispose();
    expect(session.state).toBe('disposed');
    expect(compiled.release).toHaveBeenCalledTimes(1);
  });

  it('preserves typed initialization diagnostics and releases the composition', async () => {
    const diagnostic = error('E_RESOURCE_LIMIT', 'Layout admission failed', { nodeId: 'large' });
    mocks.layout.mockRejectedValue(diagnostic);
    const compiled = composition();
    const session = new RendererSession(compiled);
    await expect(session.initialize()).rejects.toBe(diagnostic);
    expect(session.getLastError()).toBe(diagnostic);
    expect(session.state).toBe('disposed');
    expect(compiled.release).toHaveBeenCalledTimes(1);
  });

  it('releases a plugin that finishes preparation after disposal starts', async () => {
    const prepared = deferred<{ dispose: ReturnType<typeof vi.fn> }>();
    const started = deferred<void>();
    const dispose = vi.fn(async () => {});
    const compiled = composition();
    Object.assign(compiled, {
      timing: { nodes: new Map([['plugin', { id: 'plugin', kind: 'plugin', attributes: { 'data-hv-plugin': 'fixture', width: '16', height: '16' } }]]), animations: [] },
      pluginInstances: [{ id: 'fixture', prepare: vi.fn(() => { started.resolve(); return prepared.promise; }) }]
    });
    const session = new RendererSession(compiled);
    const initialization = session.initialize();
    const failure = expect(initialization).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    const disposal = session.dispose();
    prepared.resolve({ dispose });
    await Promise.all([failure, disposal]);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(compiled.release).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('disposed');
  });
});

describe('media reader ownership', () => {
  it('deduplicates inspection and clears rejected pending handles', async () => {
    const inspection = deferred<never>();
    mocks.inspect.mockReturnValue(inspection.promise);
    const session = new RendererSession(composition());
    const internals = mediaInternals(session);
    const first = internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode);
    const second = internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode);
    const diagnostic = error('E_CODEC_DECODE', 'Bad input');
    const failures = [expect(first).rejects.toBe(diagnostic), expect(second).rejects.toBe(diagnostic)];
    inspection.reject(diagnostic);
    await Promise.all(failures);
    expect(mocks.inspect).toHaveBeenCalledTimes(1);
    expect(internals.pendingHandles.size).toBe(0);
    await session.dispose();
  });

  it('drains inspection during disposal without opening a late reader', async () => {
    const inspection = deferred<{ videoTracks: []; audioTracks: [] }>();
    mocks.inspect.mockReturnValue(inspection.promise);
    const compiled = composition();
    const session = new RendererSession(compiled);
    const internals = mediaInternals(session);
    const pending = internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode);
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const disposal = session.dispose();
    expect(compiled.release).not.toHaveBeenCalled();
    inspection.resolve({ videoTracks: [], audioTracks: [] });
    await Promise.all([failure, disposal]);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(internals.pendingHandles.size).toBe(0);
    expect(internals.mediaHandles.size).toBe(0);
    await expect(internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.inspect).toHaveBeenCalledTimes(1);
  });

  it('disposes readers released synchronously while opening instead of registering them', async () => {
    const dispose = vi.fn(async () => { throw new Error('secondary dispose failure'); });
    mocks.open.mockImplementation((_source, _options, release) => { release(); return { dispose }; });
    const session = new RendererSession(composition());
    const internals = mediaInternals(session);
    await expect(internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode)).rejects.toMatchObject({ code: 'E_CODEC_DECODE' });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(internals.mediaHandles.size).toBe(0);
    expect(internals.pendingHandles.size).toBe(0);
    await session.dispose();
  });

  it('releases a reader when disposal is triggered during open', async () => {
    const session = new RendererSession(composition());
    const dispose = vi.fn(async () => {});
    let disposal: Promise<void> | undefined;
    mocks.open.mockImplementation(() => { disposal = session.dispose(); return { dispose }; });
    const internals = mediaInternals(session);
    await expect(internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode)).rejects.toMatchObject({ name: 'AbortError' });
    await disposal;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(internals.mediaHandles.size).toBe(0);
    expect(internals.pendingHandles.size).toBe(0);
    expect(session.state).toBe('disposed');
  });

  it('does not let a stale release callback delete a replacement reader', async () => {
    const releases: (() => void)[] = [];
    const readers: { dispose: ReturnType<typeof vi.fn> }[] = [];
    mocks.open.mockImplementation((_source, _options, release) => {
      releases.push(release);
      const reader = { dispose: vi.fn(async () => release()) };
      readers.push(reader);
      return reader as unknown as MediaReader;
    });
    const session = new RendererSession(composition());
    const internals = mediaInternals(session);
    await internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode);
    internals.mediaHandles.delete(audioNode.id);
    const replacement = await internals.ensureMediaHandle(audioNode.id, audioNode.attributes.src, audioNode);
    releases[0]();
    expect(internals.mediaHandles.get(audioNode.id)).toBe(replacement);
    await readers[0].dispose();
    await session.dispose();
    expect(readers[1].dispose).toHaveBeenCalledTimes(1);
    expect(internals.pendingHandles.size).toBe(0);
  });
});

describe('export completion and diagnostics', () => {
  it('keeps a completed OPFS artifact when the final progress observer throws', async () => {
    const { root } = opfs();
    const fixture = schedulerSession();
    const onProgress = vi.fn((progress) => { if (progress.estimatedRemainingSeconds === 0) throw new Error('observer failed'); });
    const result = await exportRange({ composition: fixture.compiled, configuration: configuration(), target: { kind: 'opfs' }, session: fixture.session }, { onProgress });
    expect(result.kind).toBe('opfs');
    expect(result.manifest.status).toBe('complete');
    expect(root.removeEntry).not.toHaveBeenCalled();
    expect(mocks.createMuxer.mock.results[0].value.cancel).not.toHaveBeenCalled();
    if (result.kind === 'opfs') await result.cleanup();
    expect(root.removeEntry).toHaveBeenCalledTimes(1);
    await fixture.renderer.dispose();
  });

  it('aggregates all clipping blocks into one accurate warning', async () => {
    const fixture = schedulerSession();
    const result = await exportRange({ composition: fixture.compiled, configuration: configuration(true), target: { kind: 'memory' }, session: fixture.session });
    const blocks = Math.ceil(48000 / 4096);
    expect(mocks.mix).toHaveBeenCalledTimes(blocks);
    expect(result.manifest.warnings).toEqual([`W_AUDIO_CLIPPING: ${blocks * 2} sample(s) hit the final hard clamp; peak 2.5000.`]);
    await fixture.renderer.dispose();
  });

  it('does not append clipping warnings from the session mixer', async () => {
    const session = new RendererSession(composition());
    const warnings: string[] = [];
    await session.mixAudioBlockForExport(Rational.zero(), 4096, 0, { sampleRate: 48000, channels: 2 }, warnings);
    expect(warnings).toEqual([]);
    await session.dispose();
  });

  it.each([error('E_RESOURCE_LIMIT', 'Original admission failure'), new DOMException('Original abort', 'AbortError')])('preserves original typed failures when cancel and abort both fail: %s', async (original) => {
    const activeMuxer = muxer();
    activeMuxer.addVideoFrame.mockRejectedValue(original);
    activeMuxer.cancel.mockRejectedValue(new Error('secondary cancel failure'));
    mocks.createMuxer.mockReturnValue(activeMuxer);
    const writer: SeekableWriter = { kind: 'seekable', writeAt: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => { throw new Error('secondary abort failure'); }) };
    const fixture = schedulerSession();
    await expect(exportRange({ composition: fixture.compiled, configuration: configuration(), target: { kind: 'writer', writer }, session: fixture.session })).rejects.toBe(original);
    expect(activeMuxer.cancel).toHaveBeenCalledTimes(1);
    expect(writer.abort).toHaveBeenCalledWith(original.message);
    await fixture.renderer.dispose();
  });

  it('returns a typed diagnostic for unknown encoder failures', async () => {
    const activeMuxer = muxer();
    activeMuxer.addVideoFrame.mockRejectedValue(null);
    activeMuxer.cancel.mockRejectedValue(new Error('secondary failure'));
    mocks.createMuxer.mockReturnValue(activeMuxer);
    const fixture = schedulerSession();
    await expect(exportRange({ composition: fixture.compiled, configuration: configuration(), target: { kind: 'memory' }, session: fixture.session })).rejects.toMatchObject({ code: 'E_CODEC_ENCODE', message: 'null', severity: 'error' });
    await fixture.renderer.dispose();
  });

  it('maps writer finalization quota failures without masking them during abort', async () => {
    const writer: SeekableWriter = { kind: 'seekable', writeAt: vi.fn(async () => {}), close: vi.fn(async () => { throw new Error('storage quota exhausted'); }), abort: vi.fn(async () => { throw new Error('secondary abort failure'); }) };
    const fixture = schedulerSession();
    await expect(exportRange({ composition: fixture.compiled, configuration: configuration(), target: { kind: 'writer', writer }, session: fixture.session })).rejects.toMatchObject({ code: 'E_STORAGE_QUOTA', message: expect.stringContaining('storage quota exhausted') });
    expect(writer.abort).toHaveBeenCalledTimes(1);
    await fixture.renderer.dispose();
  });

  it('preserves writer AbortError identity even when abort cleanup fails', async () => {
    const original = new DOMException('Writer cancelled', 'AbortError');
    const writer: SeekableWriter = { kind: 'seekable', writeAt: vi.fn(async () => {}), close: vi.fn(async () => { throw original; }), abort: vi.fn(async () => { throw new Error('secondary abort failure'); }) };
    const fixture = schedulerSession();
    await expect(exportRange({ composition: fixture.compiled, configuration: configuration(), target: { kind: 'writer', writer }, session: fixture.session })).rejects.toBe(original);
    expect(writer.abort).toHaveBeenCalledWith(original.message);
    await fixture.renderer.dispose();
  });
});

describe('writer results', () => {
  it('preserves structured layout diagnostics instead of reclassifying them as writer errors', () => {
    const diagnostic = error('E_STYLE_UNSUPPORTED', 'Unsupported 3D transform.');
    expect(writerQuotaError(new CompilationError([diagnostic]))).toBe(diagnostic);
    const resource = error('E_RESOURCE_LIMIT', 'Storage resource admission failed.');
    expect(writerQuotaError(new CompilationError([resource]))).toBe(resource);
  });

  it('returns an artifact without a fabricated manifest', async () => {
    const writer = new MemoryWriterSession();
    await writer.write(null, new Uint8Array([1, 2, 3]));
    const result = await writer.finish();
    expect(result).not.toHaveProperty('manifest');
    expect(result.kind).toBe('blob');
    if (result.kind === 'blob') expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('does not delete committed OPFS output on abort, but retains explicit cleanup', async () => {
    const { root, stream } = opfs();
    const writer = new OpfsWriterSession('fixture');
    const result = await writer.finish();
    await writer.abort('late observer failure');
    expect(root.removeEntry).not.toHaveBeenCalled();
    expect(stream.abort).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('manifest');
    await expect(writer.write(null, new Uint8Array([1]))).rejects.toMatchObject({ code: 'E_WRITER' });
    if (result.kind === 'opfs') await result.cleanup();
    expect(root.removeEntry).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, 'plain rejection', 42])('normalizes non-Error writer failures: %s', (reason) => {
    expect(writerQuotaError(reason)).toMatchObject({ code: 'E_WRITER', message: String(reason), severity: 'error', recoverable: false });
  });

  it('preserves structured diagnostic identity and metadata', () => {
    const diagnostic = error('E_RESOURCE_LIMIT', 'Storage budget exceeded', { nodeId: 'node' });
    expect(writerQuotaError(diagnostic)).toBe(diagnostic);
  });
});
