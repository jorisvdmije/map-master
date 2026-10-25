# Changelog

User-visible changes are recorded here. There has been no public npm release.
The working package version remains `0.0.0`; the first proposed public version
is `0.1.0-beta.0`, pending the [release prerequisites](docs/releases.md).

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
- Package identity, license, actual maintainer/security contacts and hosted CI
  still need to be established before public distribution.
