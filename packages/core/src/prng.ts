/**
 * Random algorithm version 1 (spec 3.6):
 * UTF-8 encode a JSON array of string fields [seed, nodeStableKey, channel, sampleIndexDecimal],
 * hash with SHA-256, interpret the first 53 digest bits as an unsigned integer, divide by 2^53.
 * Inputs are normalized canonical engine-generated strings.
 * Iteration-varying channels append the full nested iteration path to the channel field.
 */

const textEncoder = new TextEncoder();
import { sha256 } from '@noble/hashes/sha256';

export function sha256Hex(text: string): string { return [...sha256(textEncoder.encode(text))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
export function randomV1Sync(seed: string, nodeStableKey: string, channel: string, sampleIndex: bigint | number): number {
  if (typeof sampleIndex === 'number' && !Number.isSafeInteger(sampleIndex)) throw new RangeError('Random sample index must be a safe integer.');
  const digest = sha256(textEncoder.encode(JSON.stringify([seed, nodeStableKey, channel, sampleIndex.toString()])));
  let value = 0n;
  for (let i = 0; i < 6; i++) value = value << 8n | BigInt(digest[i]);
  return Number(value << 5n | BigInt(digest[6] >> 3)) / 2 ** 53;
}

export function normalizeChannel(channel: string, iterationPath?: readonly number[]): string {
  if (iterationPath && iterationPath.length > 0) {
    return `${channel}#${iterationPath.join('.')}`;
  }
  return channel;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(digest);
}

export async function randomV1(
  seed: string,
  nodeStableKey: string,
  channel: string,
  sampleIndex: bigint | number
): Promise<number> {
  const payload = JSON.stringify([seed, nodeStableKey, channel, sampleIndex.toString()]);
  const digest = await sha256Bytes(textEncoder.encode(payload));
  // First 53 bits: 6 full bytes (48 bits) + 5 bits of the 7th byte.
  let value = 0n;
  for (let i = 0; i < 6; i++) {
    value = (value << 8n) | BigInt(digest[i]);
  }
  value = (value << 5n) | BigInt(digest[6] >> 3);
  return Number(value) / 2 ** 53;
}

export async function randomV1Batch(
  seed: string,
  nodeStableKey: string,
  channel: string,
  sampleIndexes: readonly (bigint | number)[]
): Promise<number[]> {
  return Promise.all(sampleIndexes.map((i) => randomV1(seed, nodeStableKey, channel, i)));
}

/** Canonical seed normalization: any JSON value stringified canonically. */
export function canonicalSeedString(seed: string | number): string {
  return String(seed);
}
