/** Browser facade wires metadata inspection without putting codecs in the pure compiler. */
import { compile, CompileOptions, CompiledCompositionImpl, FetchingAssetLoader } from '@htmv/compiler';
import { Rational } from '@htmv/core';
import { getMediabunnyAdapter } from '@htmv/media-mediabunny';

export async function compileBrowser(source: Parameters<typeof compile>[0], options: CompileOptions = {}): Promise<CompiledCompositionImpl> {
  return compile(source, { ...options, assetLoader: options.assetLoader ?? new FetchingAssetLoader({
    integrityVerify: true, signal: options.signal, resourcePolicy: options.resourcePolicy,
    inspectMedia: async (blob) => {
      const inspection = await getMediabunnyAdapter().adapter.inspect(blob);
      return {
        videoExtent: inspection.videoTracks.length ? Rational.fromDecimalString(String(Math.max(0, inspection.videoTracks[0].durationSeconds - inspection.movieOriginSeconds))) : undefined,
        audioExtent: inspection.audioTracks.length ? Rational.fromDecimalString(String(Math.max(0, inspection.audioTracks[0].durationSeconds - inspection.movieOriginSeconds))) : undefined,
        videoTracks: inspection.videoTracks.length, audioTracks: inspection.audioTracks.length
      };
    }
  }) });
}
