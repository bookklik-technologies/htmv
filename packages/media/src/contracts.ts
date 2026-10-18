/**
 * HTMV MediaAdapter contracts (spec 9.1). Package changes must not leak across
 * this public API. Public side is browser-shape agnostic; no mediabunny types.
 */
export interface MediaInspection {
  kind: 'video' | 'audio';
  videoTracks: MediaVideoTrackInfo[];
  audioTracks: MediaAudioTrackInfo[];
  /** Normalized movie presentation origin (spec 9.7). */
  movieOriginSeconds: number;
  durationSeconds: number;
}

export interface MediaVideoTrackInfo {
  index: number;
  codec: string | null;
  codecConfigDescription: string | null;
  width: number;
  height: number;
  rotation: number;
  pixelAspectRatio: number;
  firstTimestampSeconds: number;
  durationSeconds: number;
  frameCountEstimated: number | null;
}

export interface MediaAudioTrackInfo {
  index: number;
  codec: string | null;
  numberOfChannels: number;
  sampleRate: number;
  firstTimestampSeconds: number;
  durationSeconds: number;
}

/** Frame selection by presentation timestamps (spec 9.3). */
export interface DecodedVideoFrame {
  /** The caller owns the returned surface; close() releases it (spec 9.5). */
  draw: 'owned';
  width: number;
  height: number;
  timestampSeconds: number;
  /** Draw into a canvas 2d context; implementation may draw via VideoFrame/ImageBitmap layout. */
  paint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void;
  close(): void;
}

export interface MediaReader extends DisposableLike {
  /** Returns last frame with PTS <= sourceTime covering the requested time; null if before first frame. */
  getVideoSample(sourceTimeSeconds: number, cancellation: { generation: number }): Promise<DecodedVideoFrame | null>;
  /** Bounded PCM block fetch, sample-accurate rational handled by caller; time in seconds, linear float stereo. */
  getAudioBlock(sourceStartSeconds: number, lengthSeconds: number, outChannels: Float32Array[], sampleRate: number): Promise<number>;
  dispose(): Promise<void>;
}

export interface DisposableLike {
  dispose(): Promise<void>;
}

export interface MediaReaderOpenOptions {
  kind: 'video' | 'audio';
  assetId: string;
  /** 0-based selection (spec 4.6): video uses track; audio uses track/audio-track. */
  videoTrack?: number;
  audioTrack?: number;
  trimIn: number;
  trimOut: number | null;
  rate: number;
}

export interface MediaSourceRegistryEntry {
  inspection: MediaInspection;
  reader: MediaReader | null;
  readers: number;
}

export interface HtmvMediaAdapter {
  /** Inspect container/tracks/codecs (spec 9.2). Never trust extensions. */
  inspect(source: Blob | URL): Promise<MediaInspection>;
  /** Open a reader for trimmed/rated access. */
  open(source: Blob | URL, options: MediaReaderOpenOptions, release: () => void): MediaReader;
}

/** Encoded muxing contract for the exporter (spec 11). */
export interface EncodedMuxer {
  mimeType: string;
  extension: '.mp4' | '.webm';
  addVideoFrame(frame: { paint(ctx: CanvasRenderingContext2D): void; width: number; height: number; timestampMicroseconds: bigint; durationMicroseconds?: bigint; keyframe: boolean }): Promise<void>;
  addAudioBlock(pcmL: Float32Array, pcmR: Float32Array | null, timestampMicroseconds: bigint): Promise<void>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

export interface MediaAdapterPackage {
  name: string;
  version: string;
  adapter: HtmvMediaAdapter;
}

/**
 * Bounded resource management (spec 9.5): decoded-frame cache <= 4 + current,
 * at most two concurrently decoding video tracks.
 */
export const RESOURCE_LIMITS = {
  maxConcurrentVideoDecoders: 2,
  decodedFrameCachePerSource: 4,
  encoderQueueTarget: 3
} as const;
