/**
 * Offline export scheduler (spec 11.3, 13.6).
 * Merged A/V schedule: advance the next-smallest output timestamp; await
 * writer/encoder capacity; never drop output frames; bounded queues.
 */
import { Rational, Diagnostic, FrameRange } from '@htmv/core';
import type { CompiledCompositionImpl } from '@htmv/compiler';
import { RendererSession } from './session.js';
import { Evaluation } from '@htmv/renderer-canvas';
import { MediabunnyMuxer, MuxerPlan, getMediabunnyAdapter } from '@htmv/media-mediabunny';
import { createWriterSession, WriterSession, writerQuotaError } from './writers.js';
import { ExportConfiguration, OutputTarget, ExportResult, RenderProgress, RenderManifest, DEFAULT_MEMORY_ADMISSION_BYTES } from './types.js';
import { buildManifest } from './manifest.js';
import { transitionGains } from '@htmv/audio';

const SCHEDULER_POLICY = {
  keyframeIntervalSeconds: 2,
  audioBlockSamples: 4096,
  encoderQueueTarget: 3
} as const;

interface SchedulerDeps {
  composition: CompiledCompositionImpl;
  configuration: ExportConfiguration;
  target: OutputTarget;
  signal?: AbortSignal;
  session: RendererSession;
}

export async function exportRange(deps: SchedulerDeps, callbacks?: { onProgress?: (p: RenderProgress) => void }): Promise<ExportResult> {
  const { composition, configuration, target, signal, session } = deps;
  const fps = Rational.of(BigInt(configuration.fps.numerator), BigInt(configuration.fps.denominator));
  const from = configuration.range.from;
  const toExclusive = configuration.range.toExclusive;
  const N = composition.metadata.durationFrames;
  if (!(Number.isInteger(from) && Number.isInteger(toExclusive) && 0 <= from && from < toExclusive && toExclusive <= N)) {
    throw new Error(`Invalid export range [${from}, ${toExclusive}); must satisfy 0 <= from < toExclusive <= ${N}.`);
  }
  const a = Rational.fromInteger(BigInt(from)).div(fps);
  const e = Rational.fromInteger(BigInt(toExclusive)).div(fps);
  const D = e.sub(a);

  const totalFrames = toExclusive - from;
  const sampleRate = composition.metadata.sampleRate;
  const totalSamples = configuration.audio ? D.mul(Rational.fromInteger(BigInt(sampleRate))).ceil().num : 0n;
  const estimate = Math.ceil((configuration.video.bitrate + (configuration.audio?.bitrate ?? 0)) * D.toNumber() / 8);
  if (target.kind === 'memory' && estimate > (target.maxBytes ?? DEFAULT_MEMORY_ADMISSION_BYTES)) throw new Error('E_RESOURCE_LIMIT: estimated output exceeds the memory target admission limit; select a streaming target.');

  const warnings: string[] = [];
  if (configuration.syncCertification === 'unverified') warnings.push('E_AUDIO_DELAY_UNVERIFIED: encoded synchronization is not certified in this environment.');
  session.resetResourceMeasurements();
  const highWater: Record<string, number | null> = {
    encoderQueueMax: null,
    decodedFramesMax: 0,
    pcmBlockBytesMax: 0,
    muxQueueBytesMax: null
  };

  let writer: WriterSession | undefined;
  let muxer: MediabunnyMuxer | undefined;
  const muxPlan: MuxerPlan = {
    profile: configuration.profile,
    width: configuration.width,
    height: configuration.height,
    fps: configuration.fps,
    videoCodec: configuration.video.codec as MuxerPlan['videoCodec'],
    videoBitrateKbps: configuration.video.bitrate,
    keyframeIntervalSeconds: configuration.video.keyframeIntervalSeconds,
    audio: configuration.audio
      ? {
          codec: configuration.audio.codec,
          channels: configuration.audio.channels,
          sampleRate: configuration.audio.sampleRate,
          bitrateKbps: configuration.audio.bitrate
        }
      : null
  };

  let completedFrames = 0;
  let mixedSamples = 0;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    writer = await createWriterSession(target);
    muxPlan.destination = { appendOnly: target.kind === 'append-only', write: async (position, bytes) => {
      if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
      await writer!.write(position, bytes);
    } };
    muxer = getMediabunnyAdapter().createMuxer(muxPlan);

    let videoIndex = 0;
    let audioIndex = 0;
    const videoTotalUs = endpointUs(toExclusive, fps);
    let guard = 0;

    while (videoIndex < totalFrames || audioIndex < Number(totalSamples)) {
      if (guard++ > (totalFrames + 1000000) * 4) throw new Error('E_RESOURCE_LIMIT: export scheduling did not terminate.');
      if (aborted || signal?.aborted) {
        throw new DOMException('Export aborted', 'AbortError');
      }
      const nextVideoUs: bigint | null = videoIndex < totalFrames ? rangeLocalUs(videoIndex, fps) : null;
      const nextAudioUs: bigint | null = audioIndex < Number(totalSamples) ? sampleUs(audioIndex, sampleRate) : null;

      if (nextVideoUs !== null && (nextAudioUs === null || nextVideoUs <= nextAudioUs)) {
        const rootFrame = from + videoIndex;
        const evaluation = session.evaluate(rootFrame);
        await session.prefetchMedia(evaluation, signal);
        const ts = rangeLocalUs(videoIndex, fps); // independently rounded range-local endpoints (spec 13.6)
        const keyframe = videoIndex === 0 || isNearKeyframe(videoIndex, configuration.fps, SCHEDULER_POLICY.keyframeIntervalSeconds);
        await muxer.addVideoFrame({
          paint: (ctx: CanvasRenderingContext2D) => session.paintTo(ctx, evaluation),
          width: configuration.width,
          height: configuration.height,
          timestampMicroseconds: ts,
          durationMicroseconds: rangeLocalUs(videoIndex + 1, fps) - ts,
          keyframe
        });
        completedFrames++;
        videoIndex++;
        if (videoIndex % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        callbacks?.onProgress?.(progress('painting', completedFrames, totalFrames, mixedSamples, Number(totalSamples)));
      } else if (nextAudioUs !== null) {
        const count = Math.min(SCHEDULER_POLICY.audioBlockSamples, Number(totalSamples) - audioIndex);
        const blockStartRoot = a.add(Rational.fromInteger(BigInt(audioIndex)).div(Rational.fromInteger(BigInt(sampleRate))));
        const block = await session.mixAudioBlockForExport(blockStartRoot, count, audioIndex, composition.metadata, warnings);
        await muxer.addAudioBlock(block.left, block.right, sampleUs(audioIndex, sampleRate));
        mixedSamples += count;
        audioIndex += count;
        if (block.clippedSamples > 0 && !warnings.includes('W_AUDIO_CLIPPING')) {
          warnings.push(`W_AUDIO_CLIPPING: ${block.clippedSamples} sample(s) hit the final hard clamp; peak ${block.peak.toFixed(4)}.`);
        }
        callbacks?.onProgress?.(progress('mixing', completedFrames, totalFrames, mixedSamples, Number(totalSamples)));
      } else break;
    }
    void videoTotalUs;

    // finalize: completion reaches 100% only after container/writer finalization (spec 13.4)
    callbacks?.onProgress?.(progress('finalizing', completedFrames, totalFrames, mixedSamples, Number(totalSamples)));
    await muxer.finish();
    if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
    const position = writer.bytesWritten();
    const manifest = buildManifest({
      metadata: {
        id: composition.metadata.id,
        width: composition.metadata.width,
        height: composition.metadata.height,
        fps: composition.metadata.fps,
        durationFrames: composition.metadata.durationFrames,
        sampleRate: composition.metadata.sampleRate,
        channels: composition.metadata.channels
      },
      revisionHash: composition.revisionHash,
      sourceMarkupHash: session.sourceHash,
      styleHash: session.styleHash,
      propsHash: session.propsHash,
      assets: composition.ir.assets.map((asset) => ({
        id: asset.id,
        logicalId: asset.id,
        contentHash: composition.resolvedAssets.get(asset.id)?.contentHash ?? null
      })),
      fonts: composition.ir.assets.filter((a) => a.kind === 'font').map((f) => ({ family: f.family ?? '', contentHash: composition.resolvedAssets.get(f.id)?.contentHash ?? null })),
      configuration,
      outputFrameCount: completedFrames,
      outputSampleCount: mixedSamples,
      warnings,
      outputBytes: Number(position),
      highWaterMarks: { ...highWater, ...session.resourceMeasurements() },
      status: 'complete'
    });
    const result = await writer.finish();
    callbacks?.onProgress?.({
      phase: 'finalizing',
      completedFrames,
      totalFrames,
      mixedSamples,
      totalSamples: Number(totalSamples),
      bytesWritten: Number(position),
      estimatedRemainingSeconds: 0
    });
    if (result.kind === 'blob') {
      // label the blob with the selected container MIME (spec 13.3)
      return { kind: 'blob', blob: new Blob([result.blob], { type: muxer.mimeType }), manifest: applyManifest(result.manifest, manifest) };
    }
    if (result.kind === 'opfs') {
      return { kind: 'opfs', file: result.file, cleanup: result.cleanup, manifest: applyManifest(result.manifest, manifest) };
    }
    return { kind: 'file', bytesWritten: Number(position), manifest };
  } catch (err) {
    await muxer?.cancel();
    try { await writer?.abort((err as Error).message); } catch { /* preserve original failure */ }
    const d: Diagnostic = writerQuotaError(err);
    if ((err as Error).name === 'AbortError') {
      throw err; // aborted state, not a success-shaped partial file (spec 11.5)
    }
    void d;
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function applyManifest(_original: RenderManifest, filled: RenderManifest): RenderManifest {
  return filled;
}

function endpointUs(n: number, fps: Rational): bigint {
  return Rational.fromInteger(BigInt(n)).div(fps).mul(Rational.fromInteger(1000000n)).roundHalfUp().num;
}

function rangeLocalUs(n: number, fps: Rational): bigint {
  return endpointUs(n, fps);
}

function sampleUs(j: number, sampleRate: number): bigint {
  return Rational.of(BigInt(j) * 1000000n, BigInt(sampleRate)).roundHalfUp().num;
}

function isNearKeyframe(n: number, fps: { numerator: number; denominator: number }, intervalSeconds: number): boolean {
  const framesPerKey = Math.max(1, Math.round(intervalSeconds * (fps.numerator / fps.denominator)));
  return n % framesPerKey === 0;
}

function progress(phase: RenderProgress['phase'], f: number, tf: number, s: number, ts: number): RenderProgress {
  return {
    phase,
    completedFrames: f,
    totalFrames: tf,
    mixedSamples: s,
    totalSamples: ts,
    bytesWritten: 0,
    estimatedRemainingSeconds: null
  };
}

export type { FrameRange, Evaluation, Diagnostic, WriterSession, transitionGains };

