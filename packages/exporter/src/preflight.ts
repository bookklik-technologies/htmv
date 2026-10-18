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
        vDiag = vDiag ?? error('E_CODEC_ENCODE', `Requested audio encoding (${want}) is unavailable; missing audio is a blocking error, not permission to drop sound.`);
      }
    } else {
      aOk = null;
      audioCodec = null;
    }

    const profileDiags: Diagnostic[] = [];
    if (vDiag) profileDiags.push(vDiag);
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

  const firstGood = reports.find((r) => r.videoCodecSupported && (!req.hasAudio || r.audioCodecSupported));
  const isCertified = !req.hasAudio || !!firstGood && certifiedProfiles().has(firstGood.profile);
  const syncCertification: ExportConfiguration['syncCertification'] = isCertified ? 'certified' : 'unverified';
  const strictSyncFailure = !isCertified && req.syncPolicy !== 'allow-unverified';
  if (!isCertified) {
    // Strict-sync gate (spec 10.4): a caller may explicitly accept unverified output.
    diagnostics.push(
      (strictSyncFailure ? error : warning)('E_AUDIO_DELAY_UNVERIFIED', `Profile "${req.requested}" has no certified codec-delay result in this environment.`, {
        suggestion: 'Run the impulse/flash fixture certification, or pass syncPolicy "allow-unverified" to accept a documented non-certified output warning.'
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
  const rangeSeconds = Number(req.range.toExclusive - req.range.from) / req.fps.toNumber();
  const estimatedBytes = Math.ceil(((videoBitrate + (selected?.audio?.bitrate ?? 0)) / 8) * rangeSeconds);

  return {
    supported: !!selected,
    candidates: reports,
    selected,
    diagnostics,
    estimatedBytes
  };
}

/**
 * Certified profile set: populated by the M6 impulse/flash fixture results per
 * environment; empty here means no profile is certified in this browser build.
 * Output must never claim frame-accurate sync without a run certification (spec 10.4).
 */
const certified = new Set<string>();
export function certifiedProfiles(): ReadonlySet<string> {
  return certified;
}
export function certifyProfile(profile: string): void {
  certified.add(profile);
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

