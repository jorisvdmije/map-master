# Architecture proposal

Status: proposed starting point, not an implemented API.

## Scope

Build a browser geometry editor inspired by the drawing and editing capabilities
of products such as Geoman. Implement our own behavior and API. The initial
scope is 2D LineString and Polygon features on one MapLibre map.

CRUD means creating, reading, updating, and deleting features in the editor.
The host application owns databases, network requests, authorization, and saving.
Expose data and change events so applications can integrate their own backend.

## Initial choices

- TypeScript with strict checking, an ESM build, and generated type declarations.
- MapLibre GL JS as the first renderer, supplied by the host as a peer dependency.
- GeoJSON as the external data model, with stable feature IDs and preserved properties.
- One package, a small demo, and a single dependency lockfile.
- A public programmatic API; UI controls call that same API.

[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) provides WebGL-based map
rendering. This is a practical starting choice, not evidence that the editor is
fast at any particular scale. A second renderer should be added only when a real
integration needs it.

Suggested structure, created incrementally:

```text
src/
  core/             Feature storage, validation, edit state, committed changes
  modes/            Draw, select, and edit interactions as each is introduced
  maplibre/         Map input, rendering, hit testing, lifecycle cleanup
  index.ts          Deliberate public exports
examples/
  basic/            Small executable consumer of the library
tests/              Behavior and integration tests
```

The core must not import MapLibre, the DOM, or a UI framework. Initially keep the
renderer boundary narrow; a general plugin system, monorepo, and framework
wrappers can wait for demonstrated needs.

## Data and interaction rules

Use [RFC 7946 GeoJSON](https://datatracker.ietf.org/doc/html/rfc7946) for exchange:
longitude precedes latitude, a LineString has at least two positions, and a
polygon ring is closed with at least four positions including the repeated end.
Document the supported GeoJSON subset. Valid GeoJSON structure alone does not
guarantee topological validity.

- Reject non-finite coordinates and unsupported geometry explicitly.
- Establish duplicate-ID, import atomicity, and geometry validity policies before import ships.
- Preserve feature identity through edits and property changes.
- Keep a drawing preview separate from committed features; Escape discards only the preview.
- Commit a completed interaction once and emit one corresponding data-change event.
- Route mutations through a common commit boundary so later undo/redo can use the same path.
- Prevent external mutation of internal state through returned data references.
- Restore temporarily changed map controls on finish, cancellation, and destruction.
- Remove owned handlers, layers, and sources on destruction; support independent editor instances.

Start with desktop mouse input plus explicit finish/cancel controls and keyboard
shortcuts. Document that initial input scope. Touch support, accessible controls,
polygon holes, multipart geometry, antimeridian handling, and other projections
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
