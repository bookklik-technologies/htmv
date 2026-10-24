import { build } from 'esbuild';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const workspaces = new Map();
for (const entry of await readdir(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(root, 'packages', entry.name);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  workspaces.set(pkg.name, { directory, name: entry.name, manifest: pkg });
}

// Internal packages are bundled; consumers install only the declared third-party dependencies.
for (const { manifest: pkg } of workspaces.values()) {
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (!workspaces.has(name) && manifest.dependencies?.[name] !== version) {
      throw new Error(`Declare ${name}@${version} in the root runtime dependencies (required by ${pkg.name}).`);
    }
  }
}

const output = resolve(root, 'dist');
if (dirname(output) !== resolve(root) || relative(root, output) !== 'dist') {
  throw new Error('Package output must be the root dist directory.');
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true, logLevel: 'info' };
const alias = Object.fromEntries([...workspaces].map(([name, pkg]) => [name, join(pkg.directory, 'src/index.ts')]));
await build({
  ...common,
  alias,
  external: Object.keys(manifest.dependencies),
  entryPoints: [join(root, 'packages/htmv/src/index.ts')],
  outfile: join(output, 'index.js')
});
// Import the same root module so explicit registration and /auto share one registry and engine.
await build({
  ...common,
  external: ['./index.js'],
  entryPoints: [join(root, 'packages/htmv/src/auto.ts')],
  outfile: join(output, 'auto.js')
});

async function copyDeclarations(directory, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name), target = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDeclarations(source, target);
    } else if (entry.name.endsWith('.d.ts')) {
      const declaration = (await readFile(source, 'utf8'))
        .replace(/(["'])@htmv\/([^"']+)\1/g, (_match, quote, name) => {
          const pkg = workspaces.get(`@htmv/${name}`);
          if (!pkg) throw new Error(`Unknown internal declaration import @htmv/${name} in ${source}.`);
          let path = relative(dirname(target), join(output, 'types', pkg.name, 'index.js')).split(sep).join('/');
          if (!path.startsWith('.')) path = `./${path}`;
          return `${quote}${path}${quote}`;
        })
        // These maps point at workspace source which is intentionally absent from the package.
        .replace(/^\/\/# sourceMappingURL=.*(?:\r?\n|$)/gm, '');
      await writeFile(target, declaration);
    }
  }
}
for (const pkg of workspaces.values()) {
  await copyDeclarations(join(pkg.directory, 'dist'), join(output, 'types', pkg.name));
}

// Tree-shake unused internal exports (including third-party types) out of the public API.
// One declaration entry also preserves nominal class identity between renderer and player.
const declarations = await rollup({
  input: join(output, 'types/htmv/index.d.ts'),
  external: Object.keys(manifest.dependencies),
  plugins: [dts({ respectExternal: true })]
});
try {
  await declarations.write({ file: join(output, 'index.d.ts'), format: 'es' });
} finally {
  await declarations.close();
}
await writeFile(join(output, 'auto.d.ts'), 'export {};\n');
const typeOutput = join(output, 'types');
if (dirname(typeOutput) !== output) throw new Error('Declaration staging must stay inside dist.');
await rm(typeOutput, { recursive: true, force: true });
