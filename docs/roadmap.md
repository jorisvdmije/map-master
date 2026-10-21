# Incremental roadmap

Steps 0, 1, and 2 have been implemented locally; subsequent steps are planned. The
workflow still needs a GitHub remote to run in hosted CI. Each row describes
a reviewable change or a milestone that can be split further when needed. Create
each branch from updated `main` after its dependencies have merged.

| Step | Suggested branch | Deliverable and acceptance criteria |
| --- | --- | --- |
| 0 | `docs/project-foundation` | Agree on initial scope, architecture, and contribution workflow. |
| 1 | `chore/tooling` | Strict TypeScript, package build, linting, test runner, lockfile, and CI configuration. A minimal consumer can import the built package and its declarations. |
| 2 | `feat/draw-line` | Implemented: MapLibre demo, draft preview, finish/cancel, GeoJSON export, core/package tests, and real Chromium interaction tests. See the [API guide](line-editor.md). |
| 3 | `feat/draw-polygon` | Draw a single outer ring, close it correctly, reject degenerate shapes, and document/test the self-intersection policy. Holes are deferred. |
| 4 | `feat/select-feature` | Select one feature with visible feedback and deselect it. Hit testing works at different zoom levels; selection does not change feature data. |
| 5 | `feat/delete-feature` | Delete the selected feature through the API and controls. Clear selection consistently and emit one committed deletion event. |
| 6 | `feat/edit-vertices` | Move, insert, and remove vertices while preserving IDs and valid geometry. Cancel restores the geometry from before the interaction. |
| 7 | `feat/import-geojson` | Import supported features, preserve IDs/properties, reject invalid data without partial writes, and test export/import round trips. |
| 8 | `feat/history` | Undo/redo committed create, edit, and delete actions. One drag is one history entry; cancellation adds none. |

Steps 2–7 produce the first small CRUD editor. Step 8 adds recovery from user
mistakes. Later candidates include snapping, touch interactions, feature dragging,
holes, multipart geometry, rotation, cutting, splitting, and framework wrappers.
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

The demo includes Start, Finish, Cancel, and Export controls. Polygon drawing,
selection, deletion, and vertex editing each follow in their own changes.

## Beta and stable release gates

After the first line demo, establish the performance baseline described in the
[architecture](architecture.md). Expand it as editing operations are added.
Before beta, agree on numerical performance budgets and supported browsers,
input methods, and MapLibre versions; record measured results against them.

Before public distribution, choose the package name and open-source license and
configure the repository's contribution and release checks. Before 1.0, complete
the documented compatibility policy, migration guidance, security reporting
process, and validation in real consuming applications.
