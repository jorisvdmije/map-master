# Incremental roadmap

Steps 0–12 have been implemented locally; subsequent steps are planned. The
workflow still needs a GitHub remote to run in hosted CI. Each row describes
a reviewable change or a milestone that can be split further when needed. Create
each branch from updated `main` after its dependencies have merged.

| Step | Suggested branch | Deliverable and acceptance criteria |
| --- | --- | --- |
| 0 | `docs/project-foundation` | Agree on initial scope, architecture, and contribution workflow. |
| 1 | `chore/tooling` | Strict TypeScript, package build, linting, test runner, lockfile, and CI configuration. A minimal consumer can import the built package and its declarations. |
| 2 | `feat/draw-line` | Implemented: MapLibre demo, draft preview, finish/cancel, GeoJSON export, core/package tests, and real Chromium interaction tests. See the [API guide](line-editor.md). |
| 3 | `feat/draw-polygon` | Implemented: unified GeometryEditor API, single outer ring, automatic closure/CCW winding, explicit validity policy, mixed export, demo, and core/browser/package tests. See the [API guide](geometry-editor.md). Holes are deferred. |
| 4 | `feat/select-feature` | Implemented: click/API selection, blue highlight, empty-space/Escape/API deselection, zoom-independent click margin, explicit overlap policy, style restoration, unchanged exports, and core/browser/package tests. |
| 5 | `feat/delete-feature` | Implemented: deleteSelected/onDelete API, Delete control and focused Delete/Backspace, atomic selection cleanup, unchanged survivors, stale-hit protection, updated export, and core/browser/package tests. Undo added in step 8. |
| 6 | `feat/edit-vertices` | Implemented: cancellable vertex editing, move/insert/remove via API and mouse, stable IDs, validity checks, onUpdate, gesture cleanup, and core/browser/package/demo tests. |
| 7 | `feat/import-geojson` | Implemented: atomic append of supported GeoJSON, typed IDs/nested properties, validation errors, onImport, file-picker demo, round trips, and core/browser/package tests. |
| 8 | `feat/history` | Implemented: bounded undo/redo for create, saved edits, delete, and import batches; stable IDs/properties/order, onHistory, clearHistory, UI/shortcuts, and core/browser/package tests. Cancellation adds no action. |
| 9 | `feat/snapping` | Implemented: drawing snaps to committed vertices/edges, pixel tolerance, vertex priority, indicator, Alt bypass, toggle/API/events, camera/revision cache invalidation, and core/browser/package/demo tests plus a benchmark. |
| 10 | `refactor/geometry-transactions` | Implemented: shared commit/replay boundary, atomic create/update/delete batches, explicit ID rules, onTransaction, exact undo/redo ordering, failure isolation, core/browser/package tests and benchmark. See the [transaction guide](transactions.md). |
| 11 | `feat/split-features` | Implemented: split one selected single-ring polygon with a simple outside-to-outside cutting line and two proper edge crossings, colored preview, validation, correction/cancel, ID/property policy, atomic history, tests and benchmark. See the [split guide](splitting.md). |
| 12 | `feat/edit-snapping` | Implemented: snap dragged corners and inserted midpoints to other committed features, exclude the edited feature, reuse the index, Alt/live toggles, exact release, validation/cancel/history, browser/demo tests and benchmark. |
| 13a | `feat/multi-select` | Planned: Shift+click and rectangle selection, typed IDs, visible selection, atomic group actions. |
| 13b | `feat/move-features`, then `feat/duplicate-features` | Planned: preview group movement, confirm/cancel, one transaction; duplicates receive new IDs. |
| 14 | `feat/polygon-holes`, then `feat/multipart` | Planned: extend geometry validation, import/export, vertex addressing, snapping and history before adding holes/parts tools. |
| 15 | Separate merge/difference/intersection branches | Planned: preview and atomic overlay operations after holes and multipart support. |
| 16 | Separate reshape/tracing/topology branches | Planned: reshape boundaries, trace existing edges, then edit shared boundaries together. |
| 17 | Separate precision/geometry-operation branches | Planned: rotate, scale, constraints, buffer/offset, simplify and trim/extend with explicit measurement units. |

Steps 2–7 produce the first small CRUD editor. Step 8 adds recovery from user
mistakes. Step 9 adds precise placement against existing shapes. Later candidates include touch interactions, feature dragging,
holes, multipart geometry, rotation, broader cutting/splitting support, and framework wrappers.
Prioritize those using actual application requirements.

## First working milestone: draw one line

The first demo should make one complete library workflow verifiable:

1. Mount the editor on a MapLibre map and activate line drawing through the public API.
2. Click to add coordinates and move the pointer to preview the next segment.
3. Finish using Enter or an explicit Finish control after at least two distinct positions.
4. Keep the completed line on the map and emit exactly one creation event with a stable ID.
5. Export a GeoJSON FeatureCollection containing completed features only.
6. Cancel another drawing with Escape or Cancel; exported data remains unchanged.
7. Destroy and remount the editor without duplicate listeners or leftover owned map resources.

Finishing too early must not commit an invalid line. Keyboard shortcuts must not
intercept typing in unrelated form fields. Tests should establish how map panning
and other gestures behave while drawing, and verify that previous map interaction
settings are restored after leaving the mode.

The demo now includes line/polygon tools, Start, Finish, Cancel, and Export
controls, plus click selection, Deselect, Delete, Edit vertices, Remove vertex, Save, GeoJSON import, Undo, Redo, and a snapping toggle.

## Beta and stable release gates

After the first line demo, establish the performance baseline described in the
[architecture](architecture.md). Expand it as editing operations are added.
Before beta, agree on numerical performance budgets and supported browsers,
input methods, and MapLibre versions; record measured results against them.

Before public distribution, choose the package name and open-source license and
configure the repository's contribution and release checks. Before 1.0, complete
the documented compatibility policy, migration guidance, security reporting
process, and validation in real consuming applications.
