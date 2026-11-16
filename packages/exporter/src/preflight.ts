/**
 * Capability preflight (spec 11.1) and profile selection (11.2).
 */
import {
  Diagnostic, error, Rational, FrameRange, warning
} from '@htmv/core';
import { ExportCandidateReport, CapabilityReport, ExportConfiguration } from './types.js';
import { VideoProbeRequest, AudioProbeRequest, canEncodeVideoProbe, canEncodeAudioProbe, firstEncodableVideo } from './probe.js';

export interface PreflightInput {
  width: number;
  height: number;
  fps: Rational;
  range: FrameRange;
  revisionHash: string;
  hasAudio: boolean;
  audio?: { channels: 1 | 2; sampleRate: 44100 | 48000 };
  requested: 'mp4' | 'webm' | 'auto';
  allowedProfiles?: readonly ('mp4' | 'webm')[];
  videoBitrate?: number;
  audioBitrate?: number;
  syncPolicy?: 'certified' | 'allow-unverified';
}

export interface PreflightDefaults {
  videoBitrate: 8_000_000;
  audioAacKbps: 192;
  audioOpusKbps: 160;
  keyframeIntervalSeconds: 2;
}

export const DEFAULTS = {
  videoBitrate: 8_000_000,
  aacKbps: 192,
  opusKbps: 160,
  keyframeIntervalSeconds: 2
};

const candidatesFor = (req: PreflightInput): ('mp4' | 'webm')[] => {
  const base: ('mp4' | 'webm')[] = req.requested === 'auto' ? ['mp4', 'webm'] : [req.requested];
  if (req.allowedProfiles) {
    return base.filter((p) => req.allowedProfiles!.includes(p));
  }
  return base;
};

export async function runPreflight(req: PreflightInput): Promise<CapabilityReport> {
  const diagnostics: Diagnostic[] = [];
  // Even dimensions for certified 4:2:0 profiles (spec 11.2)
  if (req.width % 2 !== 0 || req.height % 2 !== 0) {
    diagnostics.push(
      error('E_VIDEO_DIMENSIONS', `Odd width/height are rejected for certified 4:2:0 video profiles; received ${req.width}x${req.height}.`, {
        suggestion: `Adjust to even dimensions, e.g. ${req.width - (req.width % 2)}x${req.height - (req.height % 2)}.`
      })
    );
    return { supported: false, candidates: [], diagnostics, estimatedBytes: 0 };
  }

  const profiles = candidatesFor(req);
  if (profiles.length === 0) {
    diagnostics.push(error('E_CODEC_ENCODE', 'No export profiles remain after applying allowedProfiles.'));
    return { supported: false, candidates: [], diagnostics, estimatedBytes: 0 };
  }
  const reports: ExportCandidateReport[] = [];
  const videoBitrate = req.videoBitrate ?? DEFAULTS.videoBitrate;
  const videoReq: VideoProbeRequest = {
    codec: 'avc',
    width: req.width,
    height: req.height,
    fps: { numerator: Number(req.fps.num), denominator: Number(req.fps.den) },
    bitrate: videoBitrate
  };

  for (const profile of profiles) {
    const videoCodec: VideoProbeRequest['codec'] = profile === 'mp4' ? 'avc' : 'vp9';
    const vReq: VideoProbeRequest = { ...videoReq, codec: videoCodec };
    const vOk = await canEncodeVideoProbe(vReq);
    let vCodec: VideoProbeRequest["codec"] | "vp8" | null = vOk ? videoCodec : null;
    let vDiag: Diagnostic | null = null;
    if (!vOk && profile === 'webm') {
      // VP8 fallback only when the caller allows (spec 11.2)
      const vp8 = await firstEncodableVideo(vReq, ['vp8']);
      if (vp8) vCodec = 'vp8';
    }
    if (!vCodec) {
      vDiag = error('E_CODEC_ENCODE', `No admitted ${profile} video encoder configuration is available at ${req.width}x${req.height} @ ${req.fps.toString()}fps (browser API presence is not codec support).`);
    }

    let audioCodec: 'aac' | 'opus' | null = null;
    let aOk: boolean | null = null;
    let aDiag: Diagnostic | null = null;
    if (req.hasAudio) {
      const want = profile === 'mp4' ? 'aac' : 'opus';
      const aReq: AudioProbeRequest = {
        codec: want,
        channels: req.audio?.channels ?? 2,
        sampleRate: req.audio?.sampleRate ?? 48000,
        bitrate: req.audioBitrate ?? (want === 'aac' ? DEFAULTS.aacKbps * 1000 : DEFAULTS.opusKbps * 1000)
      };
      aOk = await canEncodeAudioProbe(aReq);
      if (aOk) {
        audioCodec = want;
      } else {
        aOk = null; // will be a blocking error below (spec 11.2: missing audio encoding is blocking)
        aDiag = error('E_CODEC_ENCODE', `Requested audio encoding (${want}) is unavailable; missing audio is a blocking error, not permission to drop sound.`);
      }
    } else {
      aOk = null;
      audioCodec = null;
    }

    const profileDiags: Diagnostic[] = [];
    if (vDiag) profileDiags.push(vDiag);
    if (aDiag) profileDiags.push(aDiag);
    reports.push({
      profile,
      mimeType: profile === 'mp4' ? 'video/mp4' : 'video/webm',
      extension: profile === 'mp4' ? '.mp4' : '.webm',
      videoCodec: vCodec ?? 'unavailable',
      videoCodecSupported: !!vCodec,
      audioCodec,
      audioCodecSupported: req.hasAudio ? !!audioCodec : null,
      diagnostics: profileDiags
    });
  }

  const supported = reports.filter((report) => report.videoCodecSupported && (!req.hasAudio || report.audioCodecSupported));
  const rangeSeconds = Number(req.range.toExclusive - req.range.from) / req.fps.toNumber();
  const certificationFor = (report: ExportCandidateReport): boolean => (certified.get(certificationKey({
    profile: report.profile,
    videoCodec: report.videoCodec,
    width: req.width,
    height: req.height,
    fps: { numerator: Number(req.fps.num), denominator: Number(req.fps.den) },
    videoBitrate,
    audioCodec: report.audioCodec!,
    sampleRate: req.audio?.sampleRate ?? 48000,
    channels: req.audio?.channels ?? 2,
    audioBitrate: req.audioBitrate ?? (report.audioCodec === 'aac' ? DEFAULTS.aacKbps * 1000 : DEFAULTS.opusKbps * 1000)
  }))?.durationSeconds ?? 0) >= rangeSeconds;
  const firstGood = (req.hasAudio ? supported.find(certificationFor) : undefined) ?? supported[0];
  const isCertified = !req.hasAudio || !!firstGood && certificationFor(firstGood);
  const syncCertification: ExportConfiguration['syncCertification'] = isCertified ? 'certified' : 'unverified';
  const strictSyncFailure = !isCertified && req.syncPolicy !== 'allow-unverified';
  if (firstGood && !isCertified) {
    // Strict-sync gate (spec 10.4): a caller may explicitly accept unverified output.
    diagnostics.push(
      (strictSyncFailure ? error : warning)('E_AUDIO_DELAY_UNVERIFIED', `Profile "${req.requested}" has no certified codec-delay result in this environment.`, {
        suggestion: 'Register independently measured impulse/flash evidence with certifyProfile(configuration, evidence), or pass syncPolicy "allow-unverified" to accept non-certified output.'
      })
    );
  }

  let selected: ExportConfiguration | undefined;
  if (firstGood && !strictSyncFailure) {
    const profile = firstGood.profile;
    selected = {
      token: makeToken(req.revisionHash, profile, req.range, req.width, req.height),
      revisionHash: req.revisionHash,
      profile,
      mimeType: firstGood.mimeType,
      extension: firstGood.extension,
      range: Object.freeze({ ...req.range }),
      width: req.width,
      height: req.height,
      fps: { numerator: Number(req.fps.num), denominator: Number(req.fps.den) },
      video: {
        codec: firstGood.videoCodec,
        bitrate: videoBitrate,
        keyframeIntervalSeconds: DEFAULTS.keyframeIntervalSeconds
      },
      audio: req.hasAudio && firstGood.audioCodec
        ? {
            codec: firstGood.audioCodec as 'aac' | 'opus',
            channels: req.audio?.channels ?? 2,
            sampleRate: (req.audio?.sampleRate ?? 48000) as 44100 | 48000,
            bitrate: req.audioBitrate ?? (firstGood.audioCodec === 'aac' ? DEFAULTS.aacKbps * 1000 : DEFAULTS.opusKbps * 1000)
          }
        : null,
      syncCertification
    };
    Object.freeze(selected.fps); Object.freeze(selected.video); if (selected.audio) Object.freeze(selected.audio); Object.freeze(selected);
  }
  if (!firstGood) diagnostics.push(...reports.flatMap((r) => r.diagnostics));

  // rough byte estimate: bitrate * duration + audio
  const estimatedBytes = Math.ceil(((videoBitrate + (selected?.audio?.bitrate ?? 0)) / 8) * rangeSeconds);

  return {
    supported: !!selected,
    candidates: reports,
    selected,
    diagnostics,
    estimatedBytes
  };
}

export interface AudioSyncEvidence {
  fixtureId: string;
  measuredOffsetSeconds: number;
  measuredDriftSeconds: number;
  durationSeconds: number;
  toleranceSeconds: number;
}

interface CertificationConfiguration {
  profile: string;
  videoCodec: string;
  width: number;
  height: number;
  fps: { numerator: number; denominator: number };
  videoBitrate: number;
  audioCodec: string;
  sampleRate: number;
  channels: number;
  audioBitrate: number;
}

const certified = new Map<string, Readonly<AudioSyncEvidence>>();
export function certifiedProfiles(): ReadonlySet<string> {
  return new Set([...certified.keys()].map((key) => JSON.parse(key)[1] as string));
}
export function certifyProfile(configuration: ExportConfiguration, evidence: AudioSyncEvidence): void {
  if (!configuration.audio) throw error('E_AUDIO_DELAY_UNVERIFIED', 'Audio sync certification requires an audio configuration.');
  const frameSeconds = configuration.fps.denominator / configuration.fps.numerator;
  if (!evidence.fixtureId.trim() || !Number.isFinite(frameSeconds) || frameSeconds <= 0 ||
      ![evidence.measuredOffsetSeconds, evidence.measuredDriftSeconds, evidence.durationSeconds, evidence.toleranceSeconds].every(Number.isFinite) ||
      evidence.durationSeconds <= 0 || evidence.toleranceSeconds <= 0 || evidence.toleranceSeconds > frameSeconds ||
      Math.abs(evidence.measuredOffsetSeconds) > evidence.toleranceSeconds || Math.abs(evidence.measuredDriftSeconds) > evidence.toleranceSeconds) {
    throw error('E_AUDIO_DELAY_UNVERIFIED', 'Sync evidence must include a fixture ID, positive measured duration, and finite offset/drift within a tolerance of at most one output frame.');
  }
  certified.set(certificationKey({
    profile: configuration.profile,
    videoCodec: configuration.video.codec,
    width: configuration.width,
    height: configuration.height,
    fps: configuration.fps,
    videoBitrate: configuration.video.bitrate,
    audioCodec: configuration.audio.codec,
    sampleRate: configuration.audio.sampleRate,
    channels: configuration.audio.channels,
    audioBitrate: configuration.audio.bitrate
  }), Object.freeze({ ...evidence }));
}

export function clearProfileCertifications(): void {
  certified.clear();
}

function certificationKey(configuration: CertificationConfiguration): string {
  const fps = Rational.of(BigInt(configuration.fps.numerator), BigInt(configuration.fps.denominator));
  return JSON.stringify([
    typeof navigator === 'undefined' ? 'non-browser' : navigator.userAgent,
    configuration.profile, configuration.videoCodec, configuration.width, configuration.height,
    fps.toString(), configuration.videoBitrate, configuration.audioCodec, configuration.sampleRate,
    configuration.channels, configuration.audioBitrate
  ]);
}

function makeToken(revisionHash: string, profile: string, range: FrameRange, width: number, height: number): string {
  const t = `${revisionHash}|${profile}|${range.from}-${range.toExclusive}|${width}x${height}`;
  // Opaque immutable engine-issued token (spec 13.2)
  return btoaSafe(t);
}

function btoaSafe(s: string): string {
  try {
    return btoa(s);
  } catch {
    return s;
  }
}

