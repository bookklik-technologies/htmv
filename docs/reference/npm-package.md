# npm distribution and releases

`@bookklik/htmv` ships ESM for browser bundlers, with TypeScript declarations.
Install it with `npm install @bookklik/htmv`. Import `compile`, `createRenderer`,
`PlayerEngine`, and `getMediabunnyAdapter` from the package root. Import
`@bookklik/htmv/auto` only when automatic custom-element registration is wanted.

Version `0.1.3` also provides optional `@bookklik/htmv/senangstart`, with
`senangIcon`, `senangShape`, `senangIconNames`, and `senangShapeCatalog`.
It bundles the pinned SVG catalogs separately from the root module, includes
TypeScript declarations and upstream MIT notices, and needs no consumer-side
SenangStart dependency. See [creative compositions](../guide/creative-compositions.md).

## Build and pack

From the engine repository root:

```sh
npm ci
npm run typecheck
npm run build
npm run docs:build
npm pack --pack-destination releases
```

`build:package` compiles the workspaces, bundles their implementations into
`dist/index.js`, builds `dist/auto.js` against that same module, and stages
declarations in a shared tree with relative internal imports. The declaration
bundler then emits `dist/index.d.ts` containing only the public API and its
referenced types, preserving class identity across renderer and player and
excluding unused third-party type exports. The staging tree is removed.
Third-party runtime dependencies retain their workspace versions
and are declared in the root manifest. The build rejects missing or mismatched
runtime dependency declarations.

`prepack` invokes `build:package`. The tarball contains only `dist/`, the manifest,
README, changelog, and license. No consumer lifecycle build is required. These commands do
not invoke unit tests; obtain permission before running unit tests in this workspace.

The root manifest, lockfile, and generated render-manifest version must agree on
`0.1.3`. Internal `@htmv/*` workspace versions are not public release versions;
their implementations are bundled rather than published separately. Release
notes are maintained in the repository's `CHANGELOG.md`.

## Verify the tarball

Install `bookklik-htmv-0.1.3.tgz` in an isolated consumer with no engine checkout or
workspace links. Check the root, `/auto`, and `/senangstart` entrypoints with TypeScript using
`skipLibCheck: false` and `types: []` (to avoid automatically loading unrelated
ambient types installed by dependencies). Pass the result of `compile()` to `createRenderer()` and
then `PlayerEngine` to check shared type identity. Check media adapter types too.

Build the editor against that installed tarball and exercise preview, seeking,
frame inspection, animation trim/split boundaries, media import, thumbnails,
waveforms, stills, video exports, and embedding in a browser. Verify the root
import does not register custom elements and `/auto` does.

Confirm that the archive includes `dist/senangstart.LICENSE.txt` and that the
optional SVG catalogs do not require consumer-side SenangStart dependencies.
Record the archive's SHA-512 hash and npm integrity alongside the verification
results. Do not reuse evidence from the `0.1.2` archive for this release.

Build and packaging checks alone do not establish regression or browser
certification. Review the [remaining release evidence](../implementation-status.md#remaining-release-evidence)
and obtain permission before running regression suites. Do not claim formal v1
conformance or pre-certified audio synchronization for this release.

## Publish and finish the editor migration

Publication is a maintainer action. After verification, publish the exact tarball
so the verified bytes are the released bytes:

```sh
npm publish ./releases/bookklik-htmv-0.1.3.tgz --access public
```

Once `0.1.3` is available from npm, migrate the editor's imports to the root
`@bookklik/htmv` API, use peer range `^0.1.3` and development version `0.1.3`, and
remove sibling build commands, aliases, and TypeScript path overrides. Regenerate
the editor lockfile against npm and verify a clean `npm ci`, type check, and build
without a sibling engine checkout. Do not substitute the incomplete `0.1.1`
tarball or introduce a permanent local-file dependency.
