# Current architecture

The library has three boundaries: the geometry/editing core, the MapLibre adapter,
and the host application. Drawing, vertex editing, selection, import, transactions,
undo/redo, splitting, snapping, group translation, duplication, polygon holes, multipart geometry, polygon union, difference, intersection, single-ring reshape, boundary tracing, shared-boundary editing selection rotation, scaling, simplification, buffers, line offsets and drawing constraints use these same boundaries.
The [roadmap](roadmap.md) separates implemented capabilities from planned work.
See the [GeometryEditor guide](geometry-editor.md) for the current public API and
the [code walkthrough](code-walkthrough.md) for the implemented structure.

## Scope

Build a browser geometry editor inspired by the drawing and editing capabilities
of products such as Geoman. Implement our own behavior and API. The initial
scope is 2D lines and polygons on one MapLibre map, including MultiLineString
and MultiPolygon through the documented multipart contract.

CRUD means creating, reading, updating, and deleting features in the editor.
The host application owns databases, network requests, authorization, and saving.
Expose data and change events so applications can integrate their own backend.

## Initial choices

- TypeScript with strict checking, an ESM build, and generated type declarations.
- MapLibre GL JS as the first renderer, supplied by the host as a peer dependency.
- GeoJSON as the external data model, with stable feature IDs and preserved properties.
- One library package, a full playground, and a standalone consuming application.
  The latter has an independent lockfile to verify installation outside the repo.
- A public programmatic API; UI controls call that same API.

[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) provides WebGL-based map
rendering. This is a practical starting choice, not evidence that the editor is
fast at any particular scale. A second renderer should be added only when a real
integration needs it.

Implemented structure:

```text
src/
  core/             Feature storage, validation, edit state, committed changes
  maplibre/         Controller, focused input handlers, events, rendering and cleanup
  index.ts          Deliberate public exports
examples/
  basic/            Full geometry playground
  workspace/        Independent installed-package app with application-owned storage
tests/              Core behavior, architecture and packed-package tests
  browser/          Real Chromium interaction and demo tests
docs/               Integration contracts and maintainer guides
scripts/            Reproducible benchmarks and installed-consumer acceptance
```

`DrawingSession` owns the draft, selection, committed feature store and commit/replay
boundary. Geometry algorithms and import/transaction preparation are separate pure
modules. Keeping the state transitions together ensures that a failed operation
cannot leave selection, history and stored features out of sync.

`GeometryEditor` is the public facade and coordinates the core with MapLibre.
Its public methods are grouped before private coordination code. `EditorEvents`
owns subscriptions and observer-error isolation. `KeyboardInteraction` owns focused
command shortcuts; the vertex, selection and translation handlers own their
respective pointer gestures. All pointer handlers share CSS-coordinate conversion.
`MapLibreRenderer` owns only visual sources/layers; it is never a second data store.

The example imports only `@geo/editor`, just like an external application. Map
creation, basemap configuration, toolbar elements, file dialogs and downloads
belong there. Internal helpers are not exported from the package entry point.

The [area workspace](beta.md) is installed from an npm archive in a temporary
directory outside this checkout, type-checked and built against that installation,
and exercised through browser UI. Its persistence, dirty tracking and recovery
stay in the application. No library APIs were added for those responsibilities.

The core must not import MapLibre, the DOM, or a UI framework. Initially keep the
renderer boundary narrow; a general plugin system, monorepo, and framework
wrappers can wait for demonstrated needs.

[Appearance](appearance.md) is per-editor presentation state, outside the drawing
session and history. Its pure options module validates a common hex/numeric
contract for MapLibre paint and SVG previews. The adapter applies paint changes
to its existing layers, preserving sources, drafts and active drag transfers.
Host applications own any preset selector and persistence of those preferences.

## Automated boundaries

`npm run check` enforces these rules:

- The core compiles with `tsconfig.core.json` without DOM types. ESLint rejects
  MapLibre, adapter and package-entry imports into core modules.
- Library modules cannot import Node.js built-ins, demo code or test fixtures.
- Examples cannot reach into library source or build internals; they use the public
  package entry point. Host-owned MapLibre worker and CSS imports remain allowed.
- Architecture tests exercise both forbidden and allowed import paths. Packed
  consumer tests verify public exports and declarations outside this checkout.
- Workspace acceptance verifies rendering, CRUD and persistence with the installed
  production application, plus worker setup on its development server.

These checks support the module boundaries; they do not replace code review of
state ownership, cancellation or commit atomicity.

## Data and interaction rules

Use [RFC 7946 GeoJSON](https://datatracker.ietf.org/doc/html/rfc7946) for exchange:
longitude precedes latitude, a LineString has at least two positions, and a
polygon ring is closed with at least four positions including the repeated end.
Document the supported GeoJSON subset. Valid GeoJSON structure alone does not
guarantee topological validity.

- Reject non-finite coordinates and unsupported geometry explicitly.
- Apply the documented duplicate-ID, import atomicity, and geometry validity policies.
- Preserve feature identity through edits and property changes.
- Keep a drawing preview separate from committed features; Escape discards only the preview.
- Commit a completed interaction once and emit one corresponding data-change event.
- Record committed feature changes for bounded undo/redo; replay batches without recording another action.
- Prevent external mutation of internal state through returned data references.
- Restore temporarily changed map controls on finish, cancellation, and destruction.
- Remove owned handlers, layers, and sources on destruction; support independent editor instances.

Start with desktop mouse input plus explicit finish/cancel controls and keyboard
shortcuts. Document that initial input scope. Touch support, accessible controls,
interactive multipart construction, antimeridian handling, and other projections
need explicit design and tests before being advertised.

## Performance approach

Keep committed geometry separate from the active preview so pointer movement
does not require serializing the entire dataset. Coalesce preview rendering to
animation frames. Create editing handles only for the active selection.

Once a real draw operation works, record a baseline on fixed browser/hardware
and datasets with both feature counts and vertex counts. Measure load time,
input-to-preview latency, memory after repeated create/destroy cycles, and bundle
size. Include ordinary cases and one large geometry. Define numerical budgets
from target application needs and these measurements before the first beta.

Use profiling to decide when spatial indexes, incremental renderer updates, or
workers are necessary. Do not promise a feature count without reporting geometry
complexity and the conditions under which it was measured.

## Quality for downstream applications

Core tests should cover geometry validation, committed state, identity, and
failure atomicity. Browser tests should cover actual input, map gesture
conflicts, finish/cancel, and lifecycle cleanup. Validate the built package in a
consumer rather than testing only source imports.

Before a stable release, publish API documentation, examples, a compatibility
matrix, performance results, changelogs, a license, and a security reporting
process. Keep dependencies small and releases reproducible. Applications should
be able to choose their own map services; the editor must not require an account
or a hosted persistence service.

## Feature policy

Host-owned [feature locks](feature-locks.md) are typed ID sets in `DrawingSession`,
separate from properties and history. Tool entry and the prepared-commit boundary
protect existing features. History peeks before consuming a blocked entry, with
per-entry policy caching. The adapter cancels gestures when policy changes and
restores the committed view if an active mutation draft is revoked. Reference
snapping/tracing and read-only subtraction inputs stay available.
