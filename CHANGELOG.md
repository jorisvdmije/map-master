# Changelog

All notable changes to `@jorisvdmije/map-master` are recorded here. The project
follows [semantic versioning](https://semver.org/); see the
[migration guide](docs/migration.md) for upgrade steps.

## Unreleased

### Added

- Shapes: `draw('Rectangle')`, `draw('Circle')`, `draw('Ellipse')` and
  `draw('Freehand')` create polygons from two clicks, a center and radius, or a
  press-and-drag outline (also with one finger on touch screens). See
  [shapes](docs/shapes.md).
- Snapping to your own map layers, such as basemap buildings, with
  `snapping: { layers: [...] }`. Snaps to a layer report its ID in `SnapResult.layer`.
- Arrow keys move the selected shapes by 1 pixel, or 10 with Shift.
- Live measurements: segment lengths, totals, areas and perimeters while drawing and
  editing, and for the selected feature, in metric or imperial units and any locale.
  Turn them on with the `measurements` option or `setMeasurements()`. The exported
  `measure()`, `formatDistance()` and `formatArea()` functions measure geometry in
  your own code. See [measurements](docs/measurements.md).
- Cut: `drawCut()` and `finishCut()` cut a drawn polygon out of the selected
  features, or every unlocked feature, as one transaction. See [cut](docs/cut.md).
- Multipart tools: `drawPart()` adds a part to a line or polygon,
  `explodeSelection()` turns multipart features into one feature per part, and
  `combineSelection()` combines polygons or lines into one multipart feature. See
  [multipart geometry](docs/multipart.md).
- `zoomToFeatures(ids?, options?)` fits the camera to features, the selection or
  everything.
- The `createId` option generates IDs for new features, for example from a
  database sequence. With it, the editor also works outside secure contexts.
- Toolbar: buttons for rectangles, circles, ellipses, freehand, adding parts, cutting,
  combining and separating parts, measurements and zooming to features; application
  buttons with the `buttons` option; and a collapse button with `collapsible`.
- Guides for [React, Vue, Svelte and Angular](docs/frameworks.md), and live examples
  for shapes, measurements, cutting and multipart tools.

### Changed

- `EditorMode` has six new modes: `draw-rectangle`, `draw-circle`, `draw-ellipse`,
  `draw-freehand`, `draw-cut` and `draw-part`. Exhaustive `switch` statements over the
  mode need cases for them.
- `SnappingOptions` has a `layers` field; `getSnapping()` returns it as an empty array
  by default.
- With a selection and the map focused, the arrow keys move the selection instead of
  panning the map. Press Escape to clear the selection first to pan.

## 0.1.0 — 2026-11-01

First regular release. It is backwards compatible with 0.1.0-beta.0; see the
[migration guide](docs/migration.md#upgrading-from-010-beta0).

### Added

- `EditorToolbar`: a ready-made MapLibre control with buttons for drawing, editing,
  every geometry tool, snapping, angle constraints, tracing and Undo/Redo. Buttons
  enable themselves for qualifying selections, and an action panel beside the active
  tool offers Finish/Apply, Remove last point, Cancel and the tool's distance, angle
  or factor. Choose and translate the buttons with the `tools` and `labels` options;
  theme it with CSS custom properties. See the [toolbar guide](docs/toolbar.md).
- `GeometryEditor.onDataChange(listener)`: one stream of every committed data change
  (drawing, edits, deletions, imports, transactions, geometry tools and undo/redo)
  with its `source`, before/after `changes` and the new `dataRevision`. Applications
  no longer need six listeners to save their data.
- `GeometryEditor.getFeature(id)` returns one committed feature.
- Exported `EditorMode`, `DataChangeEvent` and `DataChangeSource` types.
- TSDoc for every public `GeometryEditor` member and public type, shown in editors
  and IDEs.
- Guides for [saving and loading data](docs/persistence.md),
  [compatibility and limits](docs/compatibility.md) and [testing](docs/testing.md).
- Searchable documentation website with syntax-highlighted code, a complete
  quickstart and a live example on a real OpenStreetMap basemap for every feature.
- Verification of the published release in the example application, and
  Firefox/WebKit checks of its workflows on Linux and macOS.

### Changed

- The package no longer declares a Node.js `engines` range, so installing it never
  warns on other Node.js versions. The supported development versions moved to
  `devEngines`.
- The package declares `"sideEffects": false` for tree shaking, exports
  `./package.json` and no longer ships the Markdown guides; they are online.
- `npm run benchmark -- <name>` replaces the 32 separate `benchmark:*` scripts.

### Deprecated

- `LineEditor`. Use `GeometryEditor`; the [LineEditor page](docs/line-editor.md) maps
  each method. It will be removed in a future release.

## 0.1.0-beta.0 — 2026-10-28

### Fixed

- Cold snapping-index construction partitions one candidate array instead of
  repeatedly sorting and copying subtrees. Nearest-target, tie-breaking and
  exclusion rules are unchanged.

- Vertex dragging submits its preview in the same animation frame as the coalesced
  movement, removing an extra frame of latency while preserving snapping and
  explicit Save/Undo behavior.

### Added

- Playground workflow controls: a fixed action/status bar, grouped selection tools
  with disabled-action explanations, contextual settings and responsive panel
  scrolling. Direct examples append fresh geometry as one Undo action, and a
  built user guide explains drawing, selection, editing and geometry tools.
  Library APIs and operation semantics are unchanged.

- Touch/pen editing of existing vertices and midpoint handles, enlarged acquisition,
  offset-preserving movement, map gesture separation and second-contact rollback.
  Chromium input-emulation, demo and installed-consumer checks cover this first
  touch milestone; physical-device and other touch tool qualification remain open.

- Keyboard vertex navigation with one focusable control, point/group pixel nudges,
  selection toggles, held-key cancellation, accessible status and visible focus.
  Editing, locks, validation and atomic Save/Undo retain their existing contracts.

- Optional per-feature styles, partial selection overrides and drawing order via
  `styling`, `setStyling`, `refreshStyling` and diagnostic snapshots.
- Diagonal overlap stripes with stable automatic colors or explicit/callback
  palettes, width, direction and opacity; cached disjoint regions, bounded work
  and ordinary-fill fallback. Demo object color/order controls use transactions
  and Undo; presentation settings keep exported geometry unchanged.

- Compact playground selection toolbar and accessible overlap chooser, including
  group checkboxes and lock status. `GeometryEditor.queryFeatures()` exposes
  independent rendered candidates; selected underlying shapes can be dragged
  through overlaps with the existing cancellation and Undo behavior.

- Split/reshape boundary-contact markers, localized problem points and dashed
  problem segments, original-outline comparison and a demo legend. The additive
  `getCutFeedback()` API returns independent diagnostic snapshots for host UIs.

- Polygon split cuts may start/end on outer edges or corners, with selected-boundary
  attachment ahead of neighbouring geometry. Outside endpoints remain supported;
  only the selected polygon changes, with one atomic Apply/Undo.

- Simplification slider with exact numeric input, keyboard adjustments, vertex
  reduction summary and invalid-result feedback. A faint original outline reuses
  committed map data beneath the preview; Apply remains one transaction/Undo.

- Shift+drag rectangle selection of corners within the active edit ring/component,
  preserving previous selections and fixed shared-boundary junctions. Captured
  gestures support cancellation, camera/style cleanup and API interruption.

- Multi-vertex edit selection with Shift+click, group dragging and whole-edge
  dragging between handles. Selected corners move together using one snap anchor;
  Escape restores the active gesture and Save records one edit/Undo.
- `selectedVertexIndices`, `selectVertices`, `moveVertices`,
  `translateSelectedVertices` and `removeSelectedVertices` on both editors.
  Delete/Backspace removes the entire corner selection atomically.

- Group dragging snaps a fixed vertex of the grabbed feature to unselected
  vertices/edges, with Alt bypass, live snapping options and a displacement ruler.
  Press Shift during dragging for a fixed geographic axis; release commits one
  Undo step. The live label measures anchor displacement in Mercator meters.

- Movable rotation/scale pivots with original-vertex/centre snapping, Alt bypass,
  keyboard positioning, reset controls and interrupted-drag rollback. Added
  `setRotationPivot` and `setScalePivot`; the demo supports fixed scale corners.
  Pivot changes retain absolute angles/factors and the session's single Apply/Undo.

- Direct buffer/offset distance dragging with an attached handle, measured ruler,
  original outline and signed Mercator-meter label. Keyboard distance steps and
  interrupted-drag rollback share numeric validation and explicit Apply/Undo.

- Mouse scaling with eight attached frame handles: proportional corners and
  independent horizontal/vertical side handles, keyboard resizing, drag rollback
  and a single explicit Undo transaction. Added `setScaleFactors(x, y)`,
  `scaleFactorX` / `scaleFactorY` state and separate demo axis inputs.
  `scaleFactor` is null when the two axis factors differ.

- Mouse rotation handle with a horizontal/vertical screen-aligned selection
  frame, original outline, live angle, Shift 15° steps and keyboard adjustment.
  Pointer release keeps the preview; explicit confirmation remains one Undo step.
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

### Fixed

- Keep the rotation handle attached to the selection frame by a fixed-length,
  visible stem during dragging. Pointer movement changes only the rotation angle.

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
  unqualified; see [compatibility and limits](docs/compatibility.md).
- Geometry operations have documented topology and coordinate restrictions.
  Mercator-based distances are projected distances, not geodesic measurements.
  Review each operation's guide before using it in a new workload.
- Browser storage is an example persistence mechanism, not a backend or backup.
  Collaboration, server authorization, framework wrappers, trim/extend and
  interactive multipart construction are outside this candidate.
