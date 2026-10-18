/**
 * Codec probes (spec 11.1): WebCodecs isConfigSupported with exact configs;
 * probe support never reserves hardware; encode/decode support are distinct.
 */
import { canEncodeVideo, canEncodeAudio, getFirstEncodableVideoCodec } from 'mediabunny';

export type VideoCodecProbe = 'avc' | 'vp9' | 'vp8';
export type AudioCodecProbe = 'aac' | 'opus';

export interface VideoProbeRequest {
  codec: VideoCodecProbe;
  width: number;
  height: number;
  fps: { numerator: number; denominator: number };
  bitrate: number;
}

export interface AudioProbeRequest {
  codec: AudioCodecProbe;
  channels: 1 | 2;
  sampleRate: 44100 | 48000;
  bitrate: number;
}

export async function canEncodeVideoProbe(req: VideoProbeRequest): Promise<boolean> {
  try {
    return await canEncodeVideo(req.codec, {
      width: req.width,
      height: req.height,
      frameRate: req.fps.numerator / req.fps.denominator,
      bitrate: req.bitrate
    });
  } catch {
    return false;
  }
}

export async function canEncodeAudioProbe(req: AudioProbeRequest): Promise<boolean> {
  try {
    return await canEncodeAudio(req.codec, {
      numberOfChannels: req.channels,
      sampleRate: req.sampleRate,
      bitrate: req.bitrate
    });
  } catch {
    return false;
  }
}

/** Capability-generated candidate list for actual dimensions/rate (spec 11.2). */
export async function firstEncodableVideo(req: VideoProbeRequest, candidates: VideoCodecProbe[]): Promise<VideoCodecProbe | null> {
  return await getFirstEncodableVideoCodec(candidates as never, {
    width: req.width,
    height: req.height,
    frameRate: req.fps.numerator / req.fps.denominator,
    bitrate: req.bitrate
  }) as VideoCodecProbe | null;
}

export { canEncodeVideo, canEncodeAudio };

