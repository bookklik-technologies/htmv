/**
 * Version-pinned mediabunny adapter (spec 9.1/12.1). The pinned dependency release
 * is recorded in manifests. HTMV does not expose mediabunny types across this API.
 */
import {
  Input,
  BlobSource,
  UrlSource,
  VideoSampleSink,
  AudioSampleSink,
  VideoSample,
  ALL_FORMATS
} from 'mediabunny';
import type { InputVideoTrack, InputAudioTrack } from 'mediabunny';
import type {
  HtmvMediaAdapter, MediaInspection, MediaVideoTrackInfo, MediaAudioTrackInfo,
  MediaReader, MediaReaderOpenOptions, DecodedVideoFrame
} from '@htmv/media';
import { RESOURCE_LIMITS } from '@htmv/media';
import { MediabunnyMuxer, MuxerPlan } from './muxer.js';

export const ADAPTER_VERSION = 'mediabunny@1.61.6';
export const ADAPTER_NAME = '@htmv/media-mediabunny';

interface ReaderEntry {
  input: Input<BlobSource | UrlSource>;
  videoTrack: InputVideoTrack | null;
  audioTrack: InputAudioTrack | null;
  videoSink: VideoSampleSink | null;
  audioSink: AudioSampleSink | null;
  cache: Map<number, DecodedVideoFrame>;
  activeGeneration: number;
  wantVideoTrackIndex: number;
  wantAudioTrackIndex: number;
}

/**
 * Shared normalized movie origin (spec 9.7): one shared earliest presentable,
 * non-preroll timestamp across selected tracks; never normalize tracks separately.
 */
function computeSharedOrigin(videoTracks: MediaVideoTrackInfo[], audioTracks: MediaAudioTrackInfo[]): number {
  const firsts: number[] = [
    ...videoTracks.slice(0, 1).map((v) => v.firstTimestampSeconds),
    ...audioTracks.slice(0, 1).map((a) => a.firstTimestampSeconds)
  ].filter((t) => Number.isFinite(t));
  if (firsts.length === 0) return 0;
  const shared = Math.min(...firsts);
  return shared < 0 ? 0 : shared; // negative preroll may be decoded but is not presented early
}

class MediabunnyAdapterImpl {
  async inspect(source: Blob | URL): Promise<MediaInspection> {
    const input = new Input({
      formats: ALL_FORMATS,
      source: source instanceof URL ? new UrlSource(source) : new BlobSource(source)
    });
    const videoTracks: MediaVideoTrackInfo[] = [];
    const audioTracks: MediaAudioTrackInfo[] = [];
    try {
    let audioIndex = 0;
    const videoTracksRaw = await input.getVideoTracks();
    const audioTracksRaw = await input.getAudioTracks();
    for (const vt of videoTracksRaw) {
      const codec = await vt.getCodec();
      videoTracks.push({
        index: videoTracks.length,
        codec: codec ?? null,
        codecConfigDescription: (await vt.getCodecParameterString()) ?? null,
        width: vt.codedWidth,
        height: vt.codedHeight,
        rotation: (vt.rotation ?? 0) as number,
        pixelAspectRatio: (vt.pixelAspectRatio?.num ?? 1) / (vt.pixelAspectRatio?.den ?? 1),
        firstTimestampSeconds: (await vt.getFirstTimestamp()) ?? 0,
        durationSeconds: (await vt.computeDuration()) ?? 0,
        frameCountEstimated: null
      });
    }
    for (const at of audioTracksRaw) {
      const codec = await at.getCodec();
      audioTracks.push({
        index: audioIndex++,
        codec: codec ?? null,
        numberOfChannels: at.numberOfChannels,
        sampleRate: at.sampleRate,
        firstTimestampSeconds: (await at.getFirstTimestamp()) ?? 0,
        durationSeconds: (await at.computeDuration()) ?? 0
      });
    }
    const durationSeconds = (await input.computeDuration()) || Math.max(
      0, ...videoTracks.map((v) => v.durationSeconds), ...audioTracks.map((a) => a.durationSeconds)
    );
    return {
      kind: videoTracks.length > 0 ? 'video' : 'audio',
      videoTracks,
      audioTracks,
      movieOriginSeconds: computeSharedOrigin(videoTracks, audioTracks),
      durationSeconds
    };
    } finally {
      input.dispose();
    }
  }

  open(source: Blob | URL, options: MediaReaderOpenOptions, release: () => void): MediaReader {
    let disposed = false;
    let decoderPreparation: Promise<void> | null = null;
    let origin = 0;
    const entry: ReaderEntry = {
      input: new Input({
        formats: ALL_FORMATS,
        source: source instanceof URL ? new UrlSource(source) : new BlobSource(source)
      }),
      videoTrack: null,
      audioTrack: null,
      videoSink: null,
      audioSink: null,
      cache: new Map(),
      activeGeneration: 0,
      wantVideoTrackIndex: options.kind === 'video' ? options.videoTrack ?? 0 : -1,
      wantAudioTrackIndex: options.kind === 'audio'
        ? options.audioTrack ?? options.videoTrack ?? 0
        : options.audioTrack ?? 0
    };

    async function ensureDecoders(): Promise<void> {
      if (decoderPreparation) return decoderPreparation;
      decoderPreparation = (async () => {
      const videoTracks = await entry.input.getVideoTracks();
      const audioTracks = await entry.input.getAudioTracks();
      entry.videoTrack = entry.wantVideoTrackIndex >= 0 ? (videoTracks[entry.wantVideoTrackIndex] ?? null) : null;
      entry.audioTrack = entry.wantAudioTrackIndex >= 0 ? (audioTracks[entry.wantAudioTrackIndex] ?? null) : null;
      entry.videoSink = entry.videoTrack ? new VideoSampleSink(entry.videoTrack) : null;
      entry.audioSink = entry.audioTrack ? new AudioSampleSink(entry.audioTrack) : null;
      const firsts = await Promise.all([(videoTracks[options.videoTrack ?? 0])?.getFirstTimestamp(), entry.audioTrack?.getFirstTimestamp()]);
      origin = Math.max(0, Math.min(...firsts.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))));
      if (!Number.isFinite(origin)) origin = 0;
      })();
      return decoderPreparation;
    }

    const reader: MediaReader = {
      // Frame selection uses source presentation timestamps via the sink â€” the last
      // frame with PTS <= target (spec 9.3); never round(sourceTime * sourceFPS).
      async getVideoSample(sourceTimeSeconds, cancellation) {
        if (disposed) return null;
        await ensureDecoders();
        if (disposed || !entry.videoSink) return null;
        const generation = cancellation.generation;
        entry.activeGeneration = generation; // scrubbing cancels obsolete seeks (spec 9.4)
        const sample = await entry.videoSink.getSample(sourceTimeSeconds + origin);
        // generation token: late decode results cannot repaint a newer request (spec 9.4)
        if (disposed || generation !== entry.activeGeneration) {
          sample?.close();
          return null;
        }
        if (!sample) return null;
        if (sample.timestamp > sourceTimeSeconds + origin || sample.timestamp + sample.duration <= sourceTimeSeconds + origin) {
          sample.close();
          return null;
        }
        return sampleToOwnedFrame(sample, origin);
      },

      async getAudioBlock(sourceStartSeconds, lengthSeconds, outChannels, outSampleRate) {
        if (disposed) return 0;
        await ensureDecoders();
        if (disposed || !entry.audioSink) return 0;
        sourceStartSeconds += origin;
        // Presentation-order streaming over [sourceStart, sourceStart+length): each
        // AudioSample is decoded once and its PCM appended at its exact position
        // (rational sample clock handled by the audio engine, spec 10.2).
        const targetFrames = Math.max(0, Math.round(lengthSeconds * outSampleRate));
        if (targetFrames === 0) return 0;
        for (const ch of outChannels) ch.fill(0);
        let written = 0;
        const iterator = entry.audioSink.samples(Math.max(0, sourceStartSeconds), Math.max(0, sourceStartSeconds) + lengthSeconds);
        for await (const sample of iterator) {
          if (disposed) {
            sample.close();
            break;
          }
          try {
            const chCount = sample.numberOfChannels;
            const frames = sample.numberOfFrames;
            const timestamp = sample.timestamp;
            // position of this sample's first frame within the requested window
            if (sample.sampleRate !== outSampleRate) throw new Error('E_CODEC_DECODE: PCM reads must use the source sample rate; resample in the canonical mixer.');
            const relStart = Math.round((timestamp - sourceStartSeconds) * outSampleRate);
            const skip = Math.max(0, -relStart);
            const first = Math.max(0, relStart);
            const copyFrames = Math.min(frames - skip, targetFrames - first);
            if (copyFrames <= 0) {
              continue;
            }
            for (let c = 0; c < outChannels.length; c++) {
              const srcCh = Math.min(c, chCount - 1);
              const plane = new Float32Array(frames);
              sample.copyTo(plane, { planeIndex: srcCh, format: 'f32-planar' });
              const out = outChannels[c];
              for (let j = 0; j < copyFrames; j++) {
                const idx = first + j;
                if (idx >= 0 && idx < targetFrames) out[idx] = plane[skip + j];
              }
            }
            written = Math.max(written, first + copyFrames);
          } finally {
            sample.close();
          }
        }
        return written;
      },

      async dispose() {
        if (disposed) return;
        disposed = true;
        for (const f of entry.cache.values()) f.close();
        entry.cache.clear();
        entry.audioSink = null;
        entry.videoSink = null;
        entry.audioTrack = null;
        entry.videoTrack = null;
        try {
          entry.input.dispose();
        } catch {
          // input may already be closed by its own lifetime rules (spec 9.5)
        }
        release();
      }
    };
    return reader;
  }
}

function sampleToOwnedFrame(sample: VideoSample, origin: number): DecodedVideoFrame {
  const ts = sample.timestamp - origin;
  let closed = false;
  return {
    draw: 'owned',
    width: sample.displayWidth,
    height: sample.displayHeight,
    timestampSeconds: ts,
    // Apply metadata rotation once, then flip (spec 9.3/S3); fit remains the painter's job
    paint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
      if (closed) throw new Error('E_DISPOSED: decoded sample is closed.');
      sample.draw(ctx, x, y, w, h);
    },
    close(): void {
      if (!closed) { closed = true; sample.close(); }
    }
  };
}

export interface MediabunnyAdapterPublic {
  adapter: HtmvMediaAdapter;
  createMuxer(plan: MuxerPlan): MediabunnyMuxer;
}

/** Public factory keeps the pinned dependency behind the HTMV adapter boundary. */
export function getMediabunnyAdapter(): MediabunnyAdapterPublic {
  const impl = new MediabunnyAdapterImpl();
  return {
    adapter: {
      inspect: (source) => impl.inspect(source),
      open: (source, options, release) => impl.open(source, options, release)
    } satisfies HtmvMediaAdapter,
    createMuxer: (plan) => new MediabunnyMuxer(plan)
  };
}

export { RESOURCE_LIMITS };



