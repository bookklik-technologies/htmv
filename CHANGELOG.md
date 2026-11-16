# Changelog

## 0.1.3 - release candidate

### Added

- Optional `@bookklik/htmv/senangstart` entrypoint with icon and shape SVG
  catalogs, TypeScript declarations, and bundled upstream MIT notices.
- Creative Studio example and a guide to freeform creative compositions.
- Portable font validation and configuration-specific audio synchronization
  certification evidence.
- Build-time synchronization of the render-manifest library version with the
  root package version.

### Fixed

- Compiler resource-limit validation, timing expansion, CSS handling, and asset
  resolution.
- Audio resampling, mixing, and split-clip fade handling.
- Export scheduling, cancellation, writer cleanup, and manifest reporting.
- Canvas rendering, layout snapshots, plugin lifecycle, and player ownership.

### Distribution

- Ships ESM and declarations for the root, `/auto`, and `/senangstart` entrypoints.
- Internal `@htmv/*` workspaces remain bundled implementation details and do not
  need independent publication or version bumps.

### Release gates

- Unit and browser regression suites require execution and review before release;
  adding coverage does not establish that the suites passed.
- Formal v1 conformance, browser/profile certification, long-export memory and
  drift evidence, and dependency/license review remain open. See
  [implementation status](docs/implementation-status.md#remaining-release-evidence).
- No audio profile is pre-certified. Strict-sync audio export still requires
  evidence for the exact browser, OS, and codec configuration.
