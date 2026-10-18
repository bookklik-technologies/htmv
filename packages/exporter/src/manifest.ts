/**
 * Render manifest (spec 13.7): records versions, hashes, encoder configs,
 * counts, and completion status. Raw source bytes, credentials, secret URL
 * query strings, and private file paths are excluded by default.
 */
import type { RenderManifest, ExportConfiguration } from './types.js';
import { Rational } from '@htmv/core';
import { Hasher } from '@htmv/compiler';
import { ADAPTER_VERSION, ADAPTER_NAME } from '@htmv/media-mediabunny';

export const LIBRARY_VERSION = '0.1.0';
export const LANGUAGE_VERSION = 'htmv-language-1';

export interface ManifestInput {
  metadata: { id: string; width: number; height: number; fps: { numerator: number; denominator: number }; durationFrames: number; sampleRate: number; channels: number };
  revisionHash: string;
  sourceMarkupHash: string;
  styleHash: string;
  propsHash: string;
  assets: readonly { id: string; logicalId: string; contentHash: string | null }[];
  fonts: readonly { family: string; contentHash: string | null }[];
  configuration: ExportConfiguration;
  outputFrameCount: number;
  outputSampleCount: number;
  warnings: readonly string[];
  outputBytes: number;
  highWaterMarks: Record<string, number | null>;
  status: RenderManifest['status'];
}

export function buildManifest(input: ManifestInput): RenderManifest {
  return {
    languageVersion: LANGUAGE_VERSION,
    irSchemaVersion: '1',
    libraryVersion: LIBRARY_VERSION,
    dependencies: [
      { name: ADAPTER_NAME, version: ADAPTER_VERSION },
      { name: 'mediabunny', version: '1.61.6' }
    ],
    revisionHash: input.revisionHash,
    sourceHash: input.sourceMarkupHash,
    styleHash: input.styleHash,
    propsHash: input.propsHash,
    assets: input.assets.map((a) => ({ id: a.id, logicalId: a.logicalId, contentHash: a.contentHash })),
    fonts: input.fonts,
    width: input.metadata.width,
    height: input.metadata.height,
    fps: input.metadata.fps,
    fullDurationFrames: input.metadata.durationFrames,
    exportedRange: input.configuration.range,
    container: input.configuration.profile,
    mimeType: input.configuration.mimeType,
    videoEncoderConfig: {
      codec: input.configuration.video.codec,
      bitrate: input.configuration.video.bitrate,
      keyframeIntervalSeconds: input.configuration.video.keyframeIntervalSeconds
    },
    audioEncoderConfig: input.configuration.audio
      ? { codec: input.configuration.audio.codec, bitrate: input.configuration.audio.bitrate, channels: input.configuration.audio.channels, sampleRate: input.configuration.audio.sampleRate }
      : null,
    outputFrameCount: input.outputFrameCount,
    outputSampleCount: input.outputSampleCount,
    timestampPolicy: 'endpoint-roundhalfup-microseconds-v1',
    colorProfile: 'opaque-8bit-sdr',
    syncCertification: input.configuration.syncCertification,
    warnings: input.warnings,
    outputBytes: input.outputBytes,
    resourceHighWaterMarks: input.highWaterMarks,
    environment: {
      userAgentHash: Hasher.sha256HexSync(typeof navigator !== 'undefined' ? navigator.userAgent : 'node'),
      redacted: true
    },
    status: input.status
  };
}

export function hashRational(r: Rational): string {
  return r.toString();
}


