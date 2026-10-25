# Changelog

User-visible changes are recorded here. There has been no public npm release.
The prepared package is `@jorisvdmije/map-master@0.1.0-beta.0`, pending the
[release prerequisites](docs/releases.md).

## Unreleased — initial beta candidate

### Added

- MapLibre geometry editing for GeoJSON points, lines and polygons, including
  imported multipart features and polygon holes.
- Selection, atomic deletion, vertex editing, group movement, duplication,
  bounded Undo/Redo, validated import/export and explicit geometry transactions.
- Vertex/edge snapping, drawing constraints, boundary tracing and shared-boundary
  editing; cancellable previews for split, union, difference, intersection,
  reshape, rotation, scaling, simplification, buffer and line offset operations.
- Configurable appearance and host-owned feature locks. Locks govern editor
  interactions and API mutations; server authorization remains the host's job.
- A standalone installed-package workspace demonstrating CRUD, properties,
  explicit browser saving, recovery and stale-tab conflict detection.
- ESM exports and TypeScript declarations, isolated package consumer tests,
  Chromium interaction tests, and fixed-workload latency/lifecycle budgets.
- Candidate archive verification and retained checksums, package inventories and
  test reports. This prepares local artifacts and does not publish a package.
- MIT project license, runtime dependency notices and GitHub maintainer/support
  routes, with a security policy for private vulnerability reporting.

### Migration from local snapshots

- The package was renamed from `@geo/editor` to `@jorisvdmije/map-master`. Update
  dependencies, import specifiers and any host aliases; see the
  [migration guide](docs/migration.md). Public exports and geometry behavior are
  unchanged by the rename. The example storage format remains version 1.

### Compatibility and limitations

- The API is experimental. See [migration guidance](docs/migration.md) before
  upgrading from an earlier local snapshot.
- The measured integration uses MapLibre 6.15.0 and desktop Chromium with mouse
  and keyboard. Other browsers, touch and other MapLibre versions remain
  unqualified; see the [compatibility and budget profile](docs/beta-budgets.md).
- Geometry operations have documented topology and coordinate restrictions.
  Mercator-based distances are projected distances, not geodesic measurements.
  Review each operation's guide before using it in a new workload.
- Browser storage is an example persistence mechanism, not a backend or backup.
  Collaboration, server authorization, framework wrappers, trim/extend and
  interactive multipart construction are outside this candidate.
- The GitHub repository, Issues/private security reporting, required hosted CI
  checks and npm publishing access still need to be operational before public
  distribution. `private: true` remains in place pending those release gates.
