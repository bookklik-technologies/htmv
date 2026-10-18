import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkgAliases: Record<string, string> = {};
const packages = ['core', 'compiler', 'layout-dom', 'renderer-canvas', 'audio', 'media', 'media-mediabunny', 'exporter', 'player', 'elements', 'plugins'];
for (const p of packages) {
  const name = p === 'core' ? '@htmv/core' : p === 'renderer-canvas' ? '@htmv/renderer-canvas' : p === 'layout-dom' ? '@htmv/layout-dom' : p === 'media-mediabunny' ? '@htmv/media-mediabunny' : `@htmv/${p}`;
  pkgAliases[name] = fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: pkgAliases
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
});
