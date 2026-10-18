/**
 * Capability report and writer abstraction (spec 11.1, 11.4, 13.2, 13.7).
 */
import type { Diagnostic } from '@htmv/core';
import type { canEncodeVideoProbe } from './probe.js';

export interface ExportCandidateReport {
  profile: 'mp4' | 'webm';
  mimeType: string;
  extension: '.mp4' | '.webm';
  videoCodec: string;
  videoCodecSupported: boolean;
  audioCodec: string | null;
  audioCodecSupported: boolean | null; // null when no audible track requested
  diagnostics: readonly Diagnostic[];
}

export interface ExportConfiguration {
  readonly token: string; // binds revision and probed environment (spec 13.2)
  readonly revisionHash: string;
  readonly profile: 'mp4' | 'webm';
  readonly mimeType: string;
  readonly extension: '.mp4' | '.webm';
  readonly range: { from: number; toExclusive: number };
  readonly width: number;
  readonly height: number;
  readonly fps: { numerator: number; denominator: number };
  readonly video: {
    codec: string;
    bitrate: number;
    keyframeIntervalSeconds: number;
  };
  readonly audio: {
    codec: 'aac' | 'opus';
    channels: 1 | 2;
    sampleRate: 44100 | 48000;
    bitrate: number;
  } | null;
  readonly syncCertification: 'certified' | 'unverified';
}

export interface CapabilityReport {
  supported: boolean;
  candidates: readonly ExportCandidateReport[];
  selected?: ExportConfiguration;
  diagnostics: readonly Diagnostic[];
  estimatedBytes: number;
}

export type RenderProgress = {
  phase: 'evaluating' | 'painting' | 'mixing' | 'encoding' | 'muxing' | 'finalizing';
  completedFrames: number;
  totalFrames: number;
  mixedSamples: number;
  totalSamples: number;
  bytesWritten: number;
  estimatedRemainingSeconds: number | null;
};

export interface RenderManifest {
  languageVersion: string;
  irSchemaVersion: string;
  libraryVersion: string;
  dependencies: readonly { name: string; version: string }[];
  revisionHash: string;
  sourceHash: string;
  styleHash: string;
  propsHash: string;
  assets: readonly { id: string; logicalId: string; contentHash: string | null }[];
  fonts: readonly { family: string; contentHash: string | null }[];
  width: number;
  height: number;
  fps: { numerator: number; denominator: number };
  fullDurationFrames: number;
  exportedRange: { from: number; toExclusive: number };
  container: string;
  mimeType: string;
  videoEncoderConfig: Record<string, unknown>;
  audioEncoderConfig: Record<string, unknown> | null;
  outputFrameCount: number;
  outputSampleCount: number;
  timestampPolicy: string;
  colorProfile: 'opaque-8bit-sdr';
  syncCertification: 'certified' | 'unverified';
  warnings: readonly string[];
  outputBytes: number;
  /** null denotes native/adapter internals that cannot be measured by this library. */
  resourceHighWaterMarks: Record<string, number | null>;
  environment: {
    userAgentHash: string;
    redacted: true;
  };
  status: 'complete' | 'cancelled' | 'failed';
}

/** Seekable writer abstraction (spec 11.4): generic WritableStream is not automatically seekable. */
export interface SeekableWriter {
  readonly kind: 'seekable';
  writeAt(position: bigint, bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason: string): Promise<void>;
}

export type OutputTarget =
  | { kind: 'memory'; maxBytes?: number }
  | { kind: 'file'; handle: FileSystemFileHandle }
  | { kind: 'opfs'; name?: string }
  | { kind: 'writer'; writer: SeekableWriter }
  | { kind: 'append-only'; stream: WritableStream<Uint8Array> };

export type ExportResult =
  | { kind: 'blob'; blob: Blob; manifest: RenderManifest }
  | { kind: 'file'; bytesWritten: number; manifest: RenderManifest }
  | { kind: 'opfs'; file: File; cleanup: () => Promise<void>; manifest: RenderManifest };

/** Memory admission default 128 MiB (spec 11.4). */
export const DEFAULT_MEMORY_ADMISSION_BYTES = 128 * 1024 * 1024;

export type ProbeLike = typeof canEncodeVideoProbe;
