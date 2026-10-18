/** Pinned codec/mux adapter with awaited, positioned output writes. */
import { Output, BufferTarget, StreamTarget, AppendOnlyStreamTarget, Mp4OutputFormat, WebMOutputFormat, VideoSampleSource, AudioSampleSource, VideoSample, AudioSample } from 'mediabunny';
import type { Target } from 'mediabunny';
import type { EncodedMuxer } from '@htmv/media';

export interface MuxerDestination { write(position: bigint | null, bytes: Uint8Array): Promise<void>; appendOnly?: boolean }
export interface MuxerPlan {
  profile: 'mp4' | 'webm'; width: number; height: number; fps: { numerator: number; denominator: number };
  videoCodec: 'avc' | 'vp9' | 'vp8'; videoBitrateKbps: number; keyframeIntervalSeconds: number;
  audio: { codec: 'aac' | 'opus'; channels: 1 | 2; sampleRate: number; bitrateKbps: number } | null;
  destination?: MuxerDestination;
}
export class MediabunnyMuxer implements EncodedMuxer {
  private output: Output<Mp4OutputFormat | WebMOutputFormat, Target>;
  private videoSource: VideoSampleSource;
  private audioSource: AudioSampleSource | null = null;
  private target: Target;
  private started: Promise<void>;
  readonly mimeType: string;
  readonly extension: '.mp4' | '.webm';
  private finished = false;
  constructor(private plan: MuxerPlan) {
    const destination = plan.destination;
    this.target = destination
      ? destination.appendOnly
        ? new AppendOnlyStreamTarget(new WritableStream<Uint8Array>({ write: (bytes) => destination.write(null, bytes) }))
        : new StreamTarget(new WritableStream({ write: (chunk: { position: number; data: Uint8Array }) => destination.write(BigInt(chunk.position), chunk.data) }), { chunked: false })
      : new BufferTarget();
    const format = plan.profile === 'mp4' ? new Mp4OutputFormat({ fastStart: 'fragmented' }) : new WebMOutputFormat({ appendOnly: !!destination?.appendOnly });
    this.output = new Output({ format, target: this.target });
    this.videoSource = new VideoSampleSource({ codec: plan.videoCodec, bitrate: plan.videoBitrateKbps, keyFrameInterval: plan.keyframeIntervalSeconds });
    this.output.addVideoTrack(this.videoSource, { frameRate: plan.fps.numerator / plan.fps.denominator });
    if (plan.audio) {
      this.audioSource = new AudioSampleSource({ codec: plan.audio.codec, bitrate: plan.audio.bitrateKbps });
      this.output.addAudioTrack(this.audioSource);
    }
    this.mimeType = plan.profile === 'mp4' ? 'video/mp4' : 'video/webm'; this.extension = plan.profile === 'mp4' ? '.mp4' : '.webm';
    this.started = this.output.start();
  }
  async addVideoFrame(frame: { paint(ctx: CanvasRenderingContext2D): void; width: number; height: number; timestampMicroseconds: bigint; durationMicroseconds?: bigint; keyframe: boolean }): Promise<void> {
    await this.started;
    if (this.finished) throw new Error('E_DISPOSED: output is closed.');
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    frame.paint(canvas.getContext('2d') as unknown as CanvasRenderingContext2D);
    const sample = new VideoSample(canvas, { timestamp: Number(frame.timestampMicroseconds) / 1e6, duration: frame.durationMicroseconds === undefined ? this.plan.fps.denominator / this.plan.fps.numerator : Number(frame.durationMicroseconds) / 1e6 });
    try { await this.videoSource.add(sample, { keyFrame: frame.keyframe }); }
    finally { sample.close(); canvas.width = canvas.height = 0; }
  }
  async addAudioBlock(left: Float32Array, right: Float32Array | null, timestamp: bigint): Promise<void> {
    await this.started;
    if (!this.audioSource || !this.plan.audio) return;
    const data = new Float32Array(left.length * this.plan.audio.channels); data.set(left);
    if (this.plan.audio.channels === 2) data.set(right ?? left, left.length);
    const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: this.plan.audio.channels, sampleRate: this.plan.audio.sampleRate, timestamp: Number(timestamp) / 1e6 });
    try { await this.audioSource.add(sample); } finally { sample.close(); }
  }
  async finish(): Promise<Blob> {
    await this.started;
    if (!this.finished) { this.videoSource.close(); this.audioSource?.close(); await this.output.finalize(); this.finished = true; }
    return new Blob(this.target instanceof BufferTarget && this.target.buffer ? [this.target.buffer] : [], { type: this.mimeType });
  }
  async cancel(): Promise<void> { this.finished = true; try { await this.started; await this.output.cancel(); } catch { /* already failed */ } }
}
export { AudioSample as MediabunnyAudioSample };
