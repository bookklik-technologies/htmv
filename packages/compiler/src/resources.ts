import { error } from '@htmv/core';

export interface ResourcePolicy {
  maxAssetBytes: number;
  maxTotalAssetBytes: number;
  maxImageDimension: number;
  maxImagePixels: number;
}
export const DEFAULT_RESOURCE_POLICY: Readonly<ResourcePolicy> = Object.freeze({
  maxAssetBytes: 256 * 1024 * 1024,
  maxTotalAssetBytes: 512 * 1024 * 1024,
  maxImageDimension: 8192,
  maxImagePixels: 33_554_432
});
export function resolveResourcePolicy(input: Partial<ResourcePolicy> = {}): Readonly<ResourcePolicy> {
  const policy = { ...DEFAULT_RESOURCE_POLICY, ...input };
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw error('E_RESOURCE_LIMIT', `${key} must be a finite positive safe integer.`);
  }
  return Object.freeze(policy);
}
export function checkAssetBytes(bytes: number, maxBytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) throw error('E_RESOURCE_LIMIT', `Asset bytes ${bytes} exceed the admission limit ${maxBytes}.`);
}
export function checkImageDimensions(width: number, height: number, policy: Readonly<ResourcePolicy>): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > policy.maxImageDimension || height > policy.maxImageDimension || width * height > policy.maxImagePixels) {
    throw error('E_RESOURCE_LIMIT', `Image ${width}x${height} exceeds the admitted dimension/pixel limits.`);
  }
}
