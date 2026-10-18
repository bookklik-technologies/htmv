/**
 * Media metadata loading readiness hooks (spec 7.5, 12.2 stage 5).
 * The compiler resolves asset URLs and freezes absolute references.
 */
import { JsonValue, AssetDescriptor, error } from '@htmv/core';
import { Rational } from '@htmv/core';
import { checkAssetBytes, checkImageDimensions, resolveResourcePolicy, ResourcePolicy } from './resources.js';

export interface AssetLoadContext { maxBytes: number; signal?: AbortSignal }

export interface AssetLoader {
  /**
   * Fully load/inspect an asset before compilation readiness.
   * Returns decode metadata: playable extents in seconds, natural dimensions, font face, etc.
   */
  load(asset: AssetDescriptor, context?: AssetLoadContext): Promise<AssetLoadResult>;
}

export interface AssetLoadResult {
  blob?: Blob;
  contentHash?: string;
  videoExtent?: Rational;
  audioExtent?: Rational;
  videoTracks?: number;
  audioTracks?: number;
  imageWidth?: number;
  imageHeight?: number;
  fontFace?: unknown;
  parsedText?: string;
}

export class FetchingAssetLoader implements AssetLoader {
  constructor(private options?: { integrityVerify?: boolean; signal?: AbortSignal; resourcePolicy?: Partial<ResourcePolicy>; inspectMedia?: (blob: Blob, kind: 'video' | 'audio') => Promise<{ videoExtent?: Rational; audioExtent?: Rational; videoTracks?: number; audioTracks?: number }> }) {}

  async load(asset: AssetDescriptor, context?: AssetLoadContext): Promise<AssetLoadResult> {
    const result: AssetLoadResult = {};
    const policy = resolveResourcePolicy(this.options?.resourcePolicy);
    const maxBytes = Math.min(policy.maxAssetBytes, context?.maxBytes ?? policy.maxAssetBytes);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw error('E_RESOURCE_LIMIT', 'Remaining asset bytes must be a nonnegative safe integer.');
    const signals = [this.options?.signal, context?.signal].filter((s): s is AbortSignal => !!s);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    try {
      signal?.throwIfAborted();
      const response = await fetch(asset.src, { credentials: 'omit', signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for asset "${asset.id}" (${asset.kind}) at ${asset.src}`);
      }
      const blob = await readBoundedResponse(response, maxBytes, signal);
      result.contentHash = await hashBlob(blob);
      if (this.options?.integrityVerify && asset.integrity) {
        const hex = result.contentHash;
        const b64 = btoa(String.fromCharCode(...hex.match(/../g)!.map((part) => parseInt(part, 16))));
        if (!asset.integrity.split(/\s+/).some((token) => token === hex || token === `sha256-${b64}`)) {
          throw new Error(`Integrity mismatch for asset "${asset.id}".`);
        }
      }
      result.blob = blob;
      signal?.throwIfAborted();
      switch (asset.kind) {
        case 'image': {
          Object.assign(result, await inspectImageBlob(blob, policy));
          break;
        }
        case 'captions': {
          result.parsedText = await blob.text();
          break;
        }
        case 'audio':
        case 'video': {
          if (this.options?.inspectMedia) Object.assign(result, await this.options.inspectMedia(blob, asset.kind));
          break;
        }
        case 'font': {
          break;
        }
        case 'json':
          break;
      }
      return result;
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TypeError') {
        throw new Error(`Asset fetch blocked (CORS or network error) for "${asset.id}": ${err.message}`);
      }
      throw err;
    }
  }
}

async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Blob> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    await response.body?.cancel(); checkAssetBytes(Number(declared), maxBytes);
  }
  if (!response.body) return new Blob([], { type: response.headers.get('content-type') ?? '' });
  const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; checkAssetBytes(bytes, maxBytes); chunks.push(value.slice());
    }
    signal?.throwIfAborted();
    return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
  } catch (e) { try { await reader.cancel(e); } catch { /* preserve admission/abort failure */ } throw e; }
  finally { signal?.removeEventListener('abort', onAbort); reader.releaseLock(); }
}

async function inspectImageBlob(blob: Blob, policy: Readonly<ResourcePolicy>): Promise<Pick<AssetLoadResult, 'imageWidth' | 'imageHeight'>> {
  try {
    const bitmap = await createImageBitmap(blob);
    try { checkImageDimensions(bitmap.width, bitmap.height, policy); return { imageWidth: bitmap.width, imageHeight: bitmap.height }; }
    finally { bitmap.close(); }
  } catch (e) {
    if ((e as { code?: string }).code === 'E_RESOURCE_LIMIT' || typeof document === 'undefined') throw e;
    const url = URL.createObjectURL(blob); const image = new Image();
    try { image.src = url; await image.decode(); checkImageDimensions(image.naturalWidth, image.naturalHeight, policy); return { imageWidth: image.naturalWidth, imageHeight: image.naturalHeight }; }
    finally { image.src = ''; URL.revokeObjectURL(url); }
  }
}

/** One compilation's byte budget and deduplicated resource preparation. */
export class AssetAdmission {
  private usedBytes = 0;
  private cache = new Map<string, Promise<AssetLoadResult>>();
  private suppliedIds = new WeakMap<Blob, number>();
  private counted = new WeakSet<Blob>();
  private nextSupplied = 0;
  constructor(private loader: AssetLoader, readonly policy: Readonly<ResourcePolicy>, private signal?: AbortSignal) {}
  load(asset: AssetDescriptor, supplied?: Blob): Promise<AssetLoadResult> {
    if (supplied && !this.suppliedIds.has(supplied)) this.suppliedIds.set(supplied, ++this.nextSupplied);
    const key = JSON.stringify([supplied ? this.suppliedIds.get(supplied) : asset.src, asset.kind, asset.integrity, asset.family, asset.weight, asset.fontStyle]);
    let pending = this.cache.get(key);
    if (!pending) { pending = this.loadNow(asset, supplied); this.cache.set(key, pending); }
    return pending;
  }
  private async loadNow(asset: AssetDescriptor, supplied?: Blob): Promise<AssetLoadResult> {
    this.signal?.throwIfAborted();
    const maxBytes = Math.min(this.policy.maxAssetBytes, this.policy.maxTotalAssetBytes - this.usedBytes);
    if (supplied) checkAssetBytes(supplied.size, maxBytes);
    const url = supplied ? URL.createObjectURL(supplied) : null;
    let result: AssetLoadResult;
    try { result = await this.loader.load(url ? { ...asset, src: url } : asset, { maxBytes, signal: this.signal }); }
    finally { if (url) URL.revokeObjectURL(url); }
    this.signal?.throwIfAborted();
    result = { ...result, blob: result.blob ?? supplied };
    const blob = result.blob;
    if (blob) {
      checkAssetBytes(blob.size, this.policy.maxAssetBytes);
      if (!this.counted.has(blob)) { checkAssetBytes(blob.size, this.policy.maxTotalAssetBytes - this.usedBytes); this.usedBytes += blob.size; this.counted.add(blob); }
      result.contentHash ??= await hashBlob(blob);
    } else if (result.parsedText !== undefined) {
      const bytes = new TextEncoder().encode(result.parsedText).byteLength;
      checkAssetBytes(bytes, maxBytes); this.usedBytes += bytes;
    }
    if (asset.kind === 'image') {
      if (!blob) throw error('E_ASSET_FETCH', 'Image loaders must return frozen Blob bytes; metadata alone cannot authorize a layout URL.');
      if (blob && (result.imageWidth === undefined || result.imageHeight === undefined)) Object.assign(result, await inspectImageBlob(blob, this.policy));
      checkImageDimensions(result.imageWidth ?? 0, result.imageHeight ?? 0, this.policy);
    }
    return result;
  }
}

export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON value helper for parse step. */
export function jsonOf(value: JsonValue): JsonValue {
  return value;
}
