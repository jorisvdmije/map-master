# Incremental roadmap

Steps 0–17c.4 and beta milestones 18a–18d have been implemented locally;
trim/extend is deferred and milestone 18e has local release preparation, with
repository setup, hosted checks and public distribution pending. The remote URL
is configured; the GitHub repository still needs to be established. Each row describes
a reviewable change or a milestone that can be split further when needed. Create
each branch from updated `main` after its dependencies have merged.

| Step | Suggested branch | Deliverable and acceptance criteria |
| --- | --- | --- |
| 0 | `docs/project-foundation` | Agree on initial scope, architecture, and contribution workflow. |
| 1 | `chore/tooling` | Strict TypeScript, package build, linting, test runner, lockfile, and CI configuration. A minimal consumer can import the built package and its declarations. |
| 2 | `feat/draw-line` | Implemented: MapLibre demo, draft preview, finish/cancel, GeoJSON export, core/package tests, and real Chromium interaction tests. See the [API guide](line-editor.md). |
| 3 | `feat/draw-polygon` | Implemented: unified GeometryEditor API, single outer ring, automatic closure/CCW winding, explicit validity policy, mixed export, demo, and core/browser/package tests. See the [API guide](geometry-editor.md). Interior rings were added in step 14a. |
| 4 | `feat/select-feature` | Implemented: click/API selection, blue highlight, empty-space/Escape/API deselection, zoom-independent click margin, explicit overlap policy, style restoration, unchanged exports, and core/browser/package tests. |
| 5 | `feat/delete-feature` | Implemented: deleteSelected/onDelete API, Delete control and focused Delete/Backspace, atomic selection cleanup, unchanged survivors, stale-hit protection, updated export, and core/browser/package tests. Undo added in step 8. |
| 6 | `feat/edit-vertices` | Implemented: cancellable vertex editing, move/insert/remove via API and mouse, stable IDs, validity checks, onUpdate, gesture cleanup, and core/browser/package/demo tests. |
| 7 | `feat/import-geojson` | Implemented: atomic append of supported GeoJSON, typed IDs/nested properties, validation errors, onImport, file-picker demo, round trips, and core/browser/package tests. |
| 8 | `feat/history` | Implemented: bounded undo/redo for create, saved edits, delete, and import batches; stable IDs/properties/order, onHistory, clearHistory, UI/shortcuts, and core/browser/package tests. Cancellation adds no action. |
| 9 | `feat/snapping` | Implemented: drawing snaps to committed vertices/edges, pixel tolerance, vertex priority, indicator, Alt bypass, toggle/API/events, camera/revision cache invalidation, and core/browser/package/demo tests plus a benchmark. |
| 10 | `refactor/geometry-transactions` | Implemented: shared commit/replay boundary, atomic create/update/delete batches, explicit ID rules, onTransaction, exact undo/redo ordering, failure isolation, core/browser/package tests and benchmark. See the [transaction guide](transactions.md). |
| 11 | `feat/split-features` | Implemented: split one selected single-ring polygon with a simple outside-to-outside cutting line and two proper edge crossings, colored preview, validation, correction/cancel, ID/property policy, atomic history, tests and benchmark. See the [split guide](splitting.md). |
| 12 | `feat/edit-snapping` | Implemented: snap dragged corners and inserted midpoints to other committed features, exclude the edited feature, reuse the index, Alt/live toggles, exact release, validation/cancel/history, browser/demo tests and benchmark. |
| 13a | `feat/multi-select` | Implemented: Shift+click toggle and additive rectangle selection, typed IDs, changed-only highlights, selectMany/getSelection/toggleSelection, atomic deleteSelection and undo, gesture cleanup, demo/core/browser/package tests and benchmark. |
| 13b | `feat/move-features` | Implemented: drag selected lines/polygons as a group, selected-only preview, release/cancel, degree-offset API, atomic validation/history, lifecycle cleanup, tests and benchmark. |
| 13c | `feat/duplicate-features` | Implemented: duplicate single/mixed selections with reserved fresh IDs, isolated properties, optional degree offset, selection of copies, atomic validation/history, demo/core/browser/package tests and benchmark. |
| 14a | `feat/polygon-holes` | Implemented: strict ring topology, winding normalization, hole drawing/deletion, active-ring editing, import/export, ring-aware snapping, split preservation, history, demo and tests. |
| 14b | `feat/multipart` | Implemented: MultiLineString/MultiPolygon import and transactions, strict component topology, component/ring editing, hole commands, whole-feature selection/translation/duplication/history, snapping, demo, tests and benchmark. See [multipart](multipart.md). Part construction tools and multipart splitting remain planned. |
| 15a | `feat/union` | Implemented: polygon union with selection-order identity, holes/multipart results, cancellable preview, one transaction and exact Undo/Redo, demo, core/browser/package tests and benchmark. See [union](union.md). |
| 15b | `feat/difference` | Implemented: subtract selected cutters from the first selected target; preserve cutters, holes/multipart, explicit empty preview and target deletion, exact no-ops, atomic Undo/Redo, demo, core/browser/package tests and benchmark. See [difference](difference.md). |
| 15c | `feat/intersection` | Implemented: common area of all selected polygons, holes/multipart, explicit empty output, cancellable preview, atomic replacement and exact Undo/Redo, demo, core/browser/package tests and benchmark. See [intersection](intersection.md). |
| 16a | `feat/reshape-polygon` | Implemented: replace one arc of a single-ring polygon, boundary attachments, shorter/longer choice, cancellable preview, atomic update and exact Undo/Redo, demo, tests and benchmark. See [reshape](reshape.md). |
| 16b | `feat/trace-boundaries` | Implemented: trace one existing line/ring while drawing, exact source corners, partial-edge attachments, shorter/longer preview, Alt bypass, whole-section correction, unchanged sources, normal drawing history, demo, tests and benchmark. See [tracing](tracing.md). |
| 16c | `feat/shared-boundaries` | Implemented: edit one exactly matching shared chain of two single-ring polygons, fixed junctions, two-result preview, validation, snapping exclusions, atomic save/Undo, demo, tests and benchmark. See [shared boundaries](shared-boundaries.md). |
| 17a | `feat/rotate-features` | Implemented: clockwise Mercator rotation of mixed selections, fixed/default or explicit pivot, numeric preview, validity checks, atomic save/Undo, demo, tests and benchmark. See [rotation](rotation.md). |
| 17a.1 | `feat/rotation-handle` | Implemented: mouse rotation handle, screen-aligned bounds around the current geometry, original outline, live angle, Shift 15° steps, keyboard handle control, interrupted-drag rollback and camera/lifecycle cleanup. Explicit Apply retains one Undo for the session; interactive pivot movement remains a follow-up. |
| 17b | `feat/scale-features` | Implemented: uniform positive Mercator scaling of mixed selections, fixed/default or explicit pivot, numeric preview, validation, atomic save/Undo, demo, tests and benchmark. See [scaling](scaling.md). |
| 17c.1 | `feat/drawing-constraints` | Implemented: optional 45°/90° Mercator drawing directions, exact snapping/tracing/closure precedence, Alt bypass, live controls, tests and benchmark. See [drawing constraints](drawing-constraints.md). |
| 17c.2 | `feat/simplify-features` | Implemented: mixed-selection simplification with Mercator-meter tolerance, frozen originals, validated preview, exact retained coordinates, atomic Undo, demo, tests and benchmark. See [simplification](simplification.md). |
| 17c.3 | `feat/buffer-features` | Implemented: positive Mercator buffers of mixed selections, rounded polygonal caps/joins, validated preview, per-feature replacement and atomic Undo, demo, tests and benchmark. See [buffers](buffer.md). |
| 17c.4 | `feat/offset-lines` | Implemented: signed Mercator offsets of simple open lines, limited miter joins, perpendicular endpoints, validated preview, atomic replacement/Undo, demo, tests and benchmark. See [line offsets](offset.md). |
| 17c.5 | `feat/trim-extend` | Deferred until a real application needs it: trim/extend lines to target geometry with preview and atomic Undo. |
| 18a | `feat/beta-workspace` | Implemented: standalone area-workspace app installed from a fresh npm archive outside the repo; CRUD, names via transactions, local save/restore, dirty state, recovery, conflict detection, independent dependency lockfile, production browser acceptance and dev rendering smoke. See [beta integration](beta.md). No public release yet. |
| 18b | `feat/editor-appearance` | Implemented: typed constructor/live appearance patches for committed/selected features, draft/translation previews, vertices/midpoints and snap/pivot markers; atomic validation, unchanged data/history, style-reload restoration, presets in both demos and installed-consumer acceptance. See [appearance](appearance.md). |
| 18c | `feat/feature-restrictions` | Implemented: host-owned feature locks across tool entry, atomic transactions, pointer/keyboard actions and Undo/Redo; active-draft revocation, reference snapping/tracing, locked subtraction cutters, demo controls and installed-consumer acceptance. See [feature locks](feature-locks.md). |
| 18c.1 | `feat/draw-markers` | Implemented: GeoJSON Point placement, rendering, selection, movement/editing, snapping, typed import/export, locks, atomic history, both demos and installed workspace acceptance. See [markers](markers.md). |
| 18d | `test/beta-budgets` | Implemented locally: fixed 1,000-feature installed-consumer workload, explicit latency and lifecycle heap/DOM/listener gates, raw reports, CI artifact retention and a bounded Chromium/mouse/keyboard/MapLibre compatibility matrix. Hosted CI awaits repository setup. See [beta budgets](beta-budgets.md). |
| 18e | `chore/public-beta` | Local preparation implemented: one verified archive, checksum/report retention, changelog, migration policy and [release procedure](releases.md). Identity set to `@jorisvdmije/map-master@0.1.0-beta.0`, MIT license, maintainer @jorisvdmije and GitHub reporting policy. Pending: operational repository/private reporting, hosted CI and required checks, npm access and public distribution. |

Steps 2–7 produce the first small CRUD editor. Step 8 adds recovery from user
mistakes. Step 9 adds precise placement against existing shapes. Later candidates include touch interactions,
interactive multipart construction, movable rotation pivots, broader cutting/splitting support, and framework wrappers.
Prioritize those using actual application requirements. The next sequence is the
beta gates above; specialized geometry tools no longer automatically take priority.

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

The package identity and MIT license are established. Before public distribution,
activate the repository's reporting channels, contribution and release checks. Before 1.0, complete
the documented compatibility policy, migration guidance, security reporting
process, and validation in real consuming applications.
