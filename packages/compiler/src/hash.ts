import { sha256Hex } from '@htmv/core';
/** Version-pinned SHA-256 for revision, manifest and cache fingerprints. */
export const Hasher = {
  sha256HexSync(text: string): string {
    return sha256Hex(text);
  }
};
