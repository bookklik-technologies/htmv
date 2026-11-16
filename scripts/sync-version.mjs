import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(manifest.version)) {
  throw new Error('The package version must be a semantic version.');
}
const file = new URL('packages/exporter/src/version.ts', root);
const source = 'export const LIBRARY_VERSION = ' + JSON.stringify(manifest.version) + ';\n';
if (await readFile(file, 'utf8').catch(() => '') !== source) await writeFile(file, source);
