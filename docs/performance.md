# Performance baselines

## Polygon validation

Run `npm run benchmark:polygon` to build and measure the core validator. The
script uses fixed regular rings centered at `[4.895, 52.372]`, radius 0.01 degrees,
with 10, 100, and 1,000 vertices. Valid simple rings exercise all nonadjacent edge
pairs without an early failure. Each size gets 20 warmup calls and 50 samples;
10/100-vertex samples batch 100/10 calls respectively to reduce timer noise.

Local baseline on 2026-10-21: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Corners | Median validation (ms) | p95 validation (ms) |
| --- | ---: | ---: |
| 10 | 0.003 | 0.006 |
| 100 | 0.071 | 0.078 |
| 1,000 | 6.006 | 6.442 |

These are elapsed times for **one complete core validation** on this machine,
including ring copying. This is the first polygon implementation, so there is
no previous polygon baseline to compare against. Future validator changes can
run the same fixtures on the same hardware/runtime. Values are observations,
not CI thresholds or supported dataset guarantees.

The validator is O(n²) per added corner. Drawing all n corners incrementally
does O(n³) total validation work; import validates each complete
ring once instead of replaying every click. Drawing pointer motion uses cached validity and does not invoke the validator.
Moving a corner in an edit does validate the changed draft. For much larger rings, incremental checks or
an intersection index need evaluation against this baseline.

This benchmark does not measure MapLibre rendering, input-to-preview latency,
dataset export, total drawing time, memory retention, or bundle size. It does
not cover near-collinear worst cases or imply that 1,000-corner shapes meet a
browser frame budget. Browser/hardware baselines and application-specific budgets
remain release work, as described in [the architecture](architecture.md#performance-approach).

## Core selection

Run `npm run benchmark:selection`. Fixtures contain 10, 1,000, and 10,000 fixed
two-vertex lines. Each batch alternates selecting the first/last ID and requesting
a selected-feature snapshot 1,000 times. The script runs 20 warmup batches and
50 timed batches. Fixture creation, export, events, and rendering are excluded.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Stored features | Median select + snapshot (µs) | p95 (µs) |
| --- | ---: | ---: |
| 10 | 0.051 | 0.091 |
| 1,000 | 0.056 | 0.102 |
| 10,000 | 0.052 | 0.115 |

These tiny batched timings primarily show that the ID-indexed lookup does not
grow linearly with collection size. Treat them as an optimized JavaScript
microbenchmark, not individual user-interaction timings. Snapshot cost grows
with the selected feature's vertex count, which this fixture holds at two.
This is the first selection baseline; future comparisons should use the same
fixture/runtime/hardware. There are no CI performance thresholds yet.

Browser tests separately verify that selecting/deselecting never calls `setData`
on the committed source, and that highlighting survives style replacement.
Actual hit-query latency, rendering time, event listeners, memory, and complex
selected geometries need browser benchmarks before setting scale guarantees.

## Deletion and export

Run `npm run benchmark:deletion`. It uses the same fixed two-vertex line fixtures
as the selection benchmark: 10, 1,000, and 10,000 features. Every sample starts
with a fresh session and its middle feature selected. The timer measures deletion
plus export of all survivors, reflecting the core work before a renderer update.
Fixture creation/selection, assertions, events, rendering-property mapping, and
MapLibre processing are excluded. Each size gets 10 warmups and 50 timed samples.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Stored features before deletion | Median delete + export (ms) | p95 (ms) |
| --- | ---: | ---: |
| 10 | 0.003 | 0.004 |
| 1,000 | 0.064 | 0.383 |
| 10,000 | 1.904 | 2.853 |

Removing the ID uses the core Map index. Since history was added, deletion
also scans feature IDs to retain the original insertion position; copying the removed snapshot scales
with its vertices. Export then copies all surviving geometries. The current
renderer replaces the committed source once per successful deletion, just as
it does after creation. Large datasets may benefit from incremental source
updates later; these core numbers do not measure browser responsiveness or
guarantee a supported dataset size. Repeat the same fixtures on the same machine
for future comparisons; no earlier deletion baseline or CI threshold exists.

## Core vertex movement

Run `npm run benchmark:editing`. Fixed regular polygons have 10, 100, or 1,000
corners centered at `[4.895, 52.372]` with radius 0.01 degrees. Setup is excluded;
each sample moves the first corner between its original position and a position
0.0001 degrees farther east. The timer includes draft mutation and validation.
There are 20 warmups and 50 samples per size, with validity checked after timing.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Corners | Median move + validation (ms) | p95 (ms) |
| --- | ---: | ---: |
| 10 | 0.013 | 0.040 |
| 100 | 0.107 | 0.130 |
| 1,000 | 7.777 | 10.574 |

This is the first edit baseline; it uses the same ring family as validation.
Pointer moves are coalesced per animation frame, but validation is still O(n²).
These figures exclude handles, previews, UI callbacks, and MapLibre rendering;
they are not frame-rate guarantees. Export and the committed source are unchanged
during dragging; saving a changed edit uploads the full collection once.

## Core GeoJSON import

Run `npm run benchmark:import`. Each sample imports into a fresh empty session.
Line fixtures contain 10, 1,000, or 10,000 two-point lines with explicit string
IDs and nested properties. Polygon fixtures reuse the regular ring family above
with 100 or 1,000 corners. Each case has 10 warmups and 50 timed samples.

The timer includes validation, property/coordinate copying, ID checks, committing
the batch, and copying the returned collection. It excludes parsing JSON text,
fixture construction, export of pre-existing data, events, and MapLibre rendering.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Fixture | Median import (ms) | p95 (ms) |
| --- | ---: | ---: |
| 10 lines | 0.047 | 0.080 |
| 1,000 lines | 1.941 | 2.797 |
| 10,000 lines | 24.616 | 31.411 |
| Polygon, 100 corners | 0.115 | 0.276 |
| Polygon, 1,000 corners | 7.510 | 7.722 |

This is the first import baseline, not a supported dataset limit or a browser
latency guarantee. Import is synchronous. Memory includes a prepared batch and
independent returned copies; polygon validation remains O(n²) per ring. The
controller also exports/uploads all existing and new features once per batch.
Large imports may need worker validation and incremental source updates later.

## Undo and export

Run `npm run benchmark:history`. Fixtures contain 10, 1,000, or 10,000 fixed
two-point lines around `[4.895, 52.372]`, matching the previous selection/deletion
fixture family. Import/setup and assertions are outside the timer. After clearing
setup history and deleting the middle line, measure undo alone and undo plus a
full export in separate samples; redo resets between samples. Each size receives
10 warmups and 50 timed samples. The original feature order is checked.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Stored features before deletion | Median undo (ms) | p95 undo (ms) | Median undo + export (ms) | p95 undo + export (ms) |
| --- | ---: | ---: | ---: | ---: |
| 10 | 0.002 | 0.003 | 0.008 | 0.014 |
| 1,000 | 0.084 | 0.106 | 0.249 | 0.641 |
| 10,000 | 0.615 | 0.699 | 3.723 | 7.754 |

Restoring a deleted middle feature rebuilds Map order in O(n) without cloning
unrelated geometry. Export additionally copies every feature. Editing history
changes only the affected feature versions; imports retain one whole imported
batch. The default 100-action limit bounds the number of entries, not memory in
bytes. No memory or maximum-dataset guarantee is implied by this first baseline.
Events, renderer uploads, MapLibre worker processing, and painting are excluded.
The existing full-source renderer still makes visible undo/redo scale with the
entire collection. These are observations, not CI timing thresholds.

## Drawing snapping

Run `npm run benchmark:snapping`. Fixtures contain 10, 1,000, or 10,000 squares
with four distinct corners, on a fixed 100-column grid. A simple linear test
projection makes each square 50 pixels wide with 100-pixel spacing. Each sample
builds a fresh projected index, then queries 1,000 deterministic positions
5 pixels above an edge midpoint (all must hit an edge). There are 10 warmups
and 50 samples. Query times are per-query averages within a batch; p95 describes
those batch averages, not individual input-event latency.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Polygons | Median build (ms) | p95 build (ms) | Median query (µs) | p95 query (µs) |
| --- | ---: | ---: | ---: | ---: |
| 10 | 0.037 | 0.090 | 0.244 | 0.330 |
| 1,000 | 8.211 | 9.108 | 0.826 | 1.149 |
| 10,000 | 128.993 | 156.724 | 1.779 | 4.859 |

The static bounds hierarchy includes every committed vertex and segment. It
uses O(v) retained space and O(v log² v) construction with recursive sorting.
Queries prune disjoint bounds rather than scanning all features. Worst-case
queries still approach O(v), especially with many overlapping/long edges; this
separated grid is not that worst case. Vertices take priority over edges, and
final distances are Euclidean CSS-pixel distances.

The MapLibre adapter copies committed geometry once per data revision, projects
it on the first query, and reuses the index for subsequent pointer frames. Camera
movement invalidates the projected index; revision changes also refresh source
data. Disabled snapping does no candidate work. Hover never uploads the committed
source; only the draft/indicator source changes. Browser tests verify cache reuse,
camera/data invalidation, and unchanged data/history during pointer motion.

Index construction is synchronous: the 10,000-polygon build already exceeds a
16.7 ms frame budget **before** actual MapLibre projection/rendering costs.
Large datasets or frequent camera movement need a world-space/coarse candidate
index, incremental updates, or worker evaluation before claiming smooth interaction
at that scale. This first baseline excludes source export/copy, MapLibre's actual
projection/unprojection, camera animation, painting, and observer callbacks. It
is a repeatable microbenchmark, not a dataset or frame-rate guarantee.

## Atomic transactions

Run `npm run benchmark:transactions`. Start with 10, 1,000, or 10,000 fixed
2-point lines with nested JSON properties. Each batch replaces the second line,
deletes the last and first lines (in that order), and appends two new lines.
Measure validation + preparation + commit + returned snapshots, then undo in a
separate timer. Undo resets the fixture for the next sample. There are 10 warmups
and 50 samples; setup, assertions, and full exports are outside the timers.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Stored features | Median commit (ms) | p95 commit (ms) | Median undo (ms) | p95 undo (ms) |
| --- | ---: | ---: | ---: | ---: |
| 10 | 0.024 | 0.064 | 0.012 | 0.013 |
| 1,000 | 0.082 | 0.360 | 0.057 | 0.112 |
| 10,000 | 0.851 | 2.132 | 0.665 | 0.869 |

Validation and copying scale with the changed geometry/properties, not all
stored features. Batches containing deletions scan collection IDs once to retain
original positions; this uses O(n) temporary space. Undo restores insertion order
without cloning unchanged geometry. History stores only changed feature versions.
All existing mutation methods now use the same commit/application boundary.

These are the first transaction measurements, not frame-rate or dataset limits.
They exclude controller exports, events, MapLibre source mapping/uploads, worker
processing, and rendering. The controller still exports/uploads the entire
collection once per successful batch. Large polygons also retain the existing
O(v²) validation cost. Browser tests separately verify a single upload/event,
no partial changes on failure, selection, keyboard replay, and updated snapping.

## Polygon splitting

Run `npm run benchmark:split`. Fixed regular rings have 10, 100, or 1,000
corners, centered at `[4.895, 52.372]` with radius 0.01 degrees. The two-point
cut is horizontal at latitude 52.37373, from longitude 4.875 to 4.915, avoiding
ring vertices. There are 20 warmups and 50 individually timed samples. The timer
includes crossing detection, construction of both parts, validation, normalization,
and area comparison. Input construction and assertions are outside the timer.

Local baseline on 2026-10-22: Apple M2 Pro, macOS arm64, Node.js 22.23.1.

| Polygon corners | Median split (ms) | p95 split (ms) |
| --- | ---: | ---: |
| 10 | 0.076 | 0.788 |
| 100 | 0.407 | 7.934 |
| 1,000 | 8.000 | 8.900 |

These first-run observations include runtime variability and are not CI thresholds.
With n polygon corners and m cutting points, crossing search is O(nm), cut
self-intersection checking is O(m²), and the existing output validator is quadratic
in each output's vertex count. Source rings are already validated on creation/import.
The session caches calculated results on placed points; cursor movement does not
repeat split validation. Preview rendering/copying remains proportional to geometry
size. Confirmation validates the two features again through transaction preparation.

The measurements exclude confirmation, snapshots returned by the public API,
MapLibre projection/rendering, observer callbacks, and full collection export/upload.
They do not establish a frame-rate or supported-dataset guarantee. Very complex
cuts/rings may need a general indexed geometry engine or worker execution later.

## Snapping during vertex editing

`npm run benchmark:snapping` also queries the same fixed grids while excluding
feature ID `0`, representing the active edit target. It performs 1,000 queries
per sample on the already-built index, with 10 warmups and 50 samples. Queries
near the excluded square must miss; other squares must still yield edge targets.
The edited feature is skipped during search, so changing the edited ID or moving
a draft vertex does not reproject/rebuild the committed candidate index.

Local measurement on 2026-10-22, Apple M2 Pro, macOS arm64, Node.js 22.23.1
(with Chromium tests running concurrently):

| Polygons | Index build median (ms) | Edit query median (µs) | Edit query p95 (µs) |
| --- | ---: | ---: | ---: |
| 10 | 0.033 | 0.217 | 0.311 |
| 1,000 | 6.132 | 0.607 | 1.363 |
| 10,000 | 105.651 | 0.967 | 1.645 |

These are query timings, not complete pointer-frame timings or performance
guarantees. They exclude real MapLibre projection, polygon validation, draft
copying, handle projection, rendering and callbacks. Changed polygon drafts still
run the existing quadratic validator once per processed movement; see the vertex
editing measurements above. Release also resolves/validates synchronously. Camera
and committed-data changes still rebuild the index, which can stall interaction
on large datasets. Large-dataset indexing/worker work remains a separate task.

## Multiple selection

`npm run benchmark:selection` retains the single-feature benchmark and adds
replacement of two disjoint groups of typed IDs plus an `EditorState` snapshot.
Each group contains half the fixture's two-vertex lines. Each sample alternates
groups 20 times; there are 20 warmup samples and 50 timed samples. Fixture setup,
geometry snapshots, observers and rendering remain outside the timer.

Local measurement on 2026-10-22, Apple M2 Pro, macOS arm64, Node.js 22.23.1
(with Chromium tests running concurrently):

| Stored features | Selected IDs | Median replace + state (ms) | p95 (ms) |
| --- | ---: | ---: | ---: |
| 10 | 5 | <0.001 | <0.001 |
| 1,000 | 500 | 0.019 | 0.039 |
| 10,000 | 5,000 | 0.271 | 0.365 |

The original single-feature benchmark measured median 0.203, 0.225 and 0.171 µs
respectively in this run. Selection replacement validates and copies O(k) IDs;
state reads also copy k selected IDs. `getSelection()` additionally copies selected
geometries/properties. Toggling the core Set is indexed, but UI notification and
renderer diffing still process the selection. The renderer changes only added or
removed feature states and never uploads geometry for selection.

Rectangle dragging updates one DOM overlay; MapLibre hit testing runs once on
release. Query cost depends on visible geometry and is excluded from these core
measurements. Likewise, these numbers exclude per-feature highlight operations,
source worker processing and frame rate. Group deletion reuses the transaction
path with one full collection upload and one history action. Large selections,
complex geometry and full browser performance still need application-specific
budgets; these measurements are not supported-dataset guarantees.

## Group translation

Run `npm run benchmark:translation`. Fixed mixed two-point lines and four-corner
polygons, selected in ID order; 10 warmups and 50 samples, 20 preview calculations
per sample. Translation always starts from a captured baseline. Commit includes
selection snapshots, full transaction validation, history recording and the
returned event snapshots. Undo includes replay and its returned event. Import,
selection setup, export and rendering are outside these timings; each fixture
asserts exact restoration after all samples.

Local Node.js v22.23.1, macOS arm64, Apple M2 Pro (2026-10-22):

| Stored / selected | Preview median / p95 ms | Commit median / p95 ms | Undo median / p95 ms |
| --- | --- | --- | --- |
| 10 / 5 | 0.001 / 0.004 | 0.049 / 0.084 | 0.010 / 0.022 |
| 10,000 / 5 | 0.001 / 0.001 | 0.022 / 0.031 | 0.004 / 0.005 |
| 10,000 / 500 | 0.032 / 0.048 | 1.779 / 2.376 | 0.281 / 0.572 |
| 10,000 / 5,000 | 0.387 / 0.472 | 20.786 / 29.761 | 4.233 / 5.341 |

These are core timings, not end-to-end frame budgets. Preview cost scales with
selected vertices. Browser tests verify that dragging updates only selected SVG
preview paths, hides originals through feature state, and performs no GeoJSON
source upload until release. Explicit dots are measured separately from each edge start, with generation
bounded to the visible range; projection and SVG painting are outside these core
timings. A successful release performs one committed
source upload. That upload/export still scales with the full stored collection;
MapLibre worker/GPU time, SVG rendering, callback overhead, picking and
feature-state updates are not included above. Large groups can exceed a frame budget during the final
validated commit and still need representative application profiling.

## Group duplication

Run `npm run benchmark:duplication`. Fixed mixed two-point lines/four-corner
polygons, 10 warmups and 50 samples. Each sample duplicates a selected group with
an offset, undoes it, redoes it with the same IDs, and undoes again for cleanup.
The benchmark includes generated string IDs, snapshots, transaction validation,
selection replacement, commit/history and returned event snapshots. Import,
selection setup, export and rendering are outside the measurements. Assertions
check exact replay, no ID allocation during Redo, and unchanged originals.

Local Node.js v22.23.1, macOS arm64, Apple M2 Pro (2026-10-22):

| Stored / selected | Duplicate median / p95 ms | Undo median / p95 ms | Redo median / p95 ms |
| --- | --- | --- | --- |
| 10 / 5 | 0.044 / 0.056 | 0.006 / 0.007 | 0.006 / 0.009 |
| 10,000 / 5 | 0.019 / 0.024 | 0.003 / 0.003 | 0.003 / 0.003 |
| 10,000 / 500 | 1.161 / 1.283 | 0.178 / 0.217 | 0.189 / 0.228 |
| 10,000 / 5,000 | 14.126 / 23.076 | 2.845 / 3.349 | 2.744 / 3.319 |

These are core timings with a deterministic ID factory, not browser latency or
UUID-generation measurements. Cost scales with selected vertices and property
size; a large group can exceed a frame budget. Browser tests verify one committed
source upload for the complete operation. Export/upload still scales with all
stored features, and MapLibre worker/GPU work and host callbacks are excluded.

## Polygon holes

Run `npm run benchmark:holes`. Fixtures contain one square exterior and 1, 25,
100 or 400 disjoint square holes. Five warmups and 30 samples measure a complete
core import, and a move/save of one hole vertex. Selection, entering editing,
export and Undo assertions are outside the timed sections. The assertions verify
that each save commits and Undo restores every ring exactly.

Local Node.js v22.23.1, macOS arm64, Apple M2 Pro (2026-10-22):

| Holes | Import median / p95 ms | Move/save median / p95 ms |
| --- | --- | --- |
| 1 | 0.021 / 0.042 | 0.018 / 0.038 |
| 25 | 0.162 / 0.302 | 0.113 / 0.209 |
| 100 | 0.263 / 0.337 | 0.198 / 0.363 |
| 400 | 1.177 / 1.449 | 0.949 / 1.299 |

Validation computes ring bounds once and skips exact comparisons between holes
with disjoint bounds. Equality is included so touching boundaries are still
checked. Every hole is checked against the exterior. Worst-case topology checks
remain quadratic in total vertices; these separated square fixtures do not
represent densely interleaved bounds or very complex rings. Whole-polygon
validation runs after vertex changes, not pointer-only drawing previews. Rendering,
MapLibre worker/GPU work and host callbacks are excluded. Previewing an active
ring still copies/renders all rings of its polygon, preserving the visible holes.

## Multipart geometries

Run `npm run benchmark:multipart`. One MultiPolygon contains 1, 25, 100 or 400
separated square components, each with one square hole. Five warmups precede 30
samples. Timed operations are complete import, moving/saving one vertex in the
last component's hole, and constructing the snapping index (fixed projection,
100 pixels per degree). Setup, selection, entering editing, export, Undo and snap
query assertions are outside timing. Assertions check a complete saved edit,
exact Undo restoration and the last component/ring snap address.

Local Node.js v22.23.1, macOS arm64, Apple M2 Pro (2026-10-22):

| Parts | Import median / p95 ms | Move/save median / p95 ms | Snap index median / p95 ms |
| --- | --- | --- | --- |
| 1 | 0.037 / 0.156 | 0.023 / 0.141 | 0.022 / 0.030 |
| 25 | 0.372 / 0.621 | 0.136 / 0.316 | 0.548 / 0.770 |
| 100 | 0.836 / 1.284 | 0.454 / 0.542 | 2.461 / 3.080 |
| 400 | 4.539 / 7.135 | 2.149 / 2.555 | 5.879 / 7.096 |

Component bounds skip exact pairwise comparisons for separated extents. The
component-pair loop remains quadratic, and overlapping bounds or complex rings
can require quadratic work in total vertices. This fixture measures separated
squares, not arbitrary high-complexity topology. Full feature validation runs on
vertex changes; preview frames copy/render all components of the active feature
but do not rerun topology checks. Only the active ring/line receives handles.
MapLibre workers/GPU, browser rendering, pointer-to-frame latency and host callbacks
are excluded. These core measurements are not a browser interaction budget.

## Polygon union

`npm run benchmark:union` measures the complete session preview (including result
validation), transaction confirmation, and Undo. Fixed datasets contain 2, 25, 100
or 400 axis-aligned squares, each with four unique vertices. Grid spacing is 0.1°
for overlapping 0.15° squares and 0.2° for disjoint squares. There are at most 20
columns. Import/selection and export assertions are outside timing. Each dataset
uses five warmups and 30 measured iterations with history limit 1; every iteration
asserts exact export restoration after Undo and Redo.

Local baseline: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are median / p95
milliseconds. These are core measurements, excluding MapLibre uploads, rendering
and input latency.

| Layout | Features | Preview | Commit | Undo |
| --- | ---: | ---: | ---: | ---: |
| Overlapping | 2 | 0.096 / 0.288 | 0.017 / 0.051 | 0.004 / 0.008 |
| Overlapping | 25 | 0.592 / 1.051 | 0.049 / 0.077 | 0.017 / 0.030 |
| Overlapping | 100 | 1.861 / 2.278 | 0.112 / 0.448 | 0.047 / 0.072 |
| Overlapping | 400 | 8.999 / 10.692 | 0.301 / 0.512 | 0.149 / 0.346 |
| Disjoint | 2 | 0.017 / 0.024 | 0.018 / 0.026 | 0.002 / 0.006 |
| Disjoint | 25 | 0.182 / 0.377 | 0.121 / 0.171 | 0.016 / 0.030 |
| Disjoint | 100 | 0.537 / 0.857 | 0.429 / 0.634 | 0.045 / 0.056 |
| Disjoint | 400 | 3.040 / 3.593 | 2.234 / 2.495 | 0.199 / 0.700 |

The union calculation runs synchronously once at tool entry. It is not repeated on
pointer movement, camera movement or state reads. Result snapshots and rendering
still cost O(result vertices). Confirmation revalidates the output and records one
history action. Existing polygon self-intersection checks are quadratic, and
multipart validation compares component pairs (with bounds rejection). This simple
square benchmark is not a bound for complex boundaries, many intersections or
poorly conditioned coordinates; large overlays may block the UI. Workers, precision
grids and explicit workload budgets remain future work.

## Polygon difference

`npm run benchmark:difference` measures session preview (filled-area intersection,
subtraction and result validation), transaction confirmation and Undo. The fixed
target is the rectangle from (-1, -1) to (41, 5). Each dataset has 1, 25, 100 or 400
cutters. The holes layout uses 0.1° squares with 0.2° grid spacing and 20 columns;
the strips layout uses 0.05° wide rectangles at 0.1° spacing, from latitude -2° to
6°, splitting the target into `cutters + 1` parts. All input rings have four unique
vertices. Five warmups precede 30 measured iterations with history limit 1.
Import/selection and assertions are outside timing. Every iteration asserts one
changed target, unchanged cutters, expected ring/part count and exact Undo/Redo.

Local baseline: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are median / p95
milliseconds. Core only; MapLibre uploads, rendering and input latency are excluded.

| Layout | Cutters | Preview | Commit | Undo |
| --- | ---: | ---: | ---: | ---: |
| Holes | 1 | 0.132 / 0.315 | 0.029 / 0.068 | 0.004 / 0.007 |
| Holes | 25 | 0.507 / 1.016 | 0.148 / 0.408 | 0.007 / 0.032 |
| Holes | 100 | 1.330 / 1.685 | 0.410 / 0.472 | 0.019 / 0.031 |
| Holes | 400 | 5.208 / 5.770 | 1.749 / 2.367 | 0.062 / 0.099 |
| Strips | 1 | 0.110 / 0.178 | 0.010 / 0.014 | 0.002 / 0.002 |
| Strips | 25 | 0.746 / 1.163 | 0.099 / 0.141 | 0.006 / 0.011 |
| Strips | 100 | 3.032 / 3.308 | 0.336 / 0.656 | 0.016 / 0.025 |
| Strips | 400 | 13.223 / 17.028 | 1.566 / 2.206 | 0.072 / 0.112 |

The initial intersection check preserves exact no-op inputs but adds an overlay
pass when subtraction is needed. Both passes run synchronously once on entry;
state/pointer/camera changes never repeat them. Confirmation revalidates changed
geometry. Ring checks and hole/component pair checks can be quadratic, so these
simple rectangular datasets do not bound complex or poorly conditioned workloads.
Large operations can block the UI; workers and explicit workload budgets remain
future work.

## Polygon intersection

`npm run benchmark:intersection` measures session preview (overlay plus validation),
transaction confirmation and Undo. The overlap datasets contain 2, 25, 100 or 400
2° squares, shifted by 0.001° longitude per input. Their shared result is one
rectangle. The multipart datasets intersect one MultiPolygon of 2, 25, 100 or 400
0.1° squares (0.2° grid spacing, 20 columns) with a containing square from (-1, -1)
to (5, 5). Each ring has four unique vertices. Five warmups precede 30 measured
iterations with history limit 1. Import, selection, snapshots and assertions are
outside timing. Each iteration checks result type/part count, retained identity,
replacement of all inputs, and exact Undo/Redo.

Local baseline: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are median / p95
milliseconds. Core only; MapLibre uploads, rendering and input latency are excluded.

| Layout | Inputs | Result parts | Preview | Commit | Undo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Overlap | 2 | 1 | 0.117 / 0.284 | 0.019 / 0.032 | 0.005 / 0.007 |
| Overlap | 25 | 1 | 0.702 / 1.286 | 0.046 / 0.064 | 0.019 / 0.047 |
| Overlap | 100 | 1 | 1.653 / 2.315 | 0.105 / 0.279 | 0.052 / 0.078 |
| Overlap | 400 | 1 | 6.626 / 7.836 | 0.334 / 0.597 | 0.172 / 0.369 |
| Multipart | 2 | 2 | 0.061 / 0.066 | 0.022 / 0.025 | 0.001 / 0.001 |
| Multipart | 2 | 25 | 0.236 / 0.273 | 0.141 / 0.194 | 0.007 / 0.015 |
| Multipart | 2 | 100 | 0.702 / 1.157 | 0.551 / 0.886 | 0.024 / 0.028 |
| Multipart | 2 | 400 | 3.854 / 6.894 | 2.728 / 3.195 | 0.081 / 0.702 |

The adapter intersects operands sequentially and stops at empty output. All passes
run synchronously at tool entry; cached state/preview reads do not rerun the engine.
Intermediate complexity, holes and crossing counts can dominate input count.
Strict final validation and confirmation revalidation can be quadratic. These
simple datasets do not bound complex or poorly conditioned inputs; large overlays
can block the UI. Workers, precision grids and workload budgets remain future work.

## Polygon reshape

`npm run benchmark:reshape` measures complete session path validation/preview,
transaction confirmation and Undo. Fixed inputs are regular 10-, 100- and
1,000-corner polygons centred at (4.895, 52.372) with radius 0.01°. The route joins
vertex 0 to vertex `corners / 5`, using 3 or 25 points along their chord with a
sinusoidal inward displacement of up to 0.001° in both coordinates. The shorter
old arc is replaced. Five warmups precede 30 measurements with history limit 1.
Import, selection, snapshots and assertions are excluded from timing. Every
iteration verifies one update, preserved ID/properties and exact Undo/Redo.

Local baseline: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are median / p95
milliseconds. Core only; MapLibre projection, attachment, rendering and uploads
are excluded.

| Polygon corners | Route points | Preview | Commit | Undo |
| --- | ---: | ---: | ---: | ---: |
| 10 | 3 | 0.042 / 0.109 | 0.022 / 0.048 | 0.004 / 0.006 |
| 10 | 25 | 0.292 / 0.329 | 0.037 / 0.069 | 0.003 / 0.003 |
| 100 | 3 | 0.175 / 0.475 | 0.099 / 0.187 | 0.004 / 0.006 |
| 100 | 25 | 1.180 / 1.552 | 0.133 / 0.147 | 0.004 / 0.005 |
| 1,000 | 3 | 4.833 / 6.651 | 4.252 / 4.814 | 0.025 / 0.039 |
| 1,000 | 25 | 12.476 / 13.190 | 4.456 / 4.693 | 0.023 / 0.034 |

For n original corners and m route points, route self-validation is O(m²), boundary
contact checking is O(nm), and final ring validation is O((n+m)²). Confirmation
revalidates the result. Calculations run synchronously on route edits or side
changes, never pointer motion or state reads. Target-only mouse attachment reuses
the projected SnapIndex until the camera changes. Cached preview copying/rendering
still scales with output size. These simple datasets are not a bound for complex
or poorly conditioned shapes; workload caps and worker execution remain future work.

## Boundary tracing

Run `npm run benchmark:trace`. Fixed regular source rings centered at
`[4.895, 52.372]`, radius 0.01 degrees, have 10, 100 or 1,000 corners. Each sample
traces half the ring into a line or polygon draft (6, 51 or 501 points), confirms
and verifies exact Undo/Redo and unchanged source data. Five warmups precede 30
samples; preparation/import is outside the timed sections.

Local baseline on 2026-10-24: Apple M2 Pro, macOS arm64, Node.js 22.23.1.
Values are median / p95 elapsed milliseconds.

| Source corners | Draw type | Route | Append + validation | Commit | Undo |
| ---: | --- | ---: | ---: | ---: | ---: |
| 10 | LineString | 0.004 / 0.008 | 0.004 / 0.009 | 0.003 / 0.008 | 0.002 / 0.005 |
| 10 | Polygon | 0.003 / 0.003 | 0.009 / 0.014 | 0.003 / 0.004 | 0.001 / 0.002 |
| 100 | LineString | 0.011 / 0.024 | 0.011 / 0.021 | 0.006 / 0.015 | 0.002 / 0.003 |
| 100 | Polygon | 0.007 / 0.008 | 0.038 / 0.108 | 0.005 / 0.014 | 0.001 / 0.002 |
| 1,000 | LineString | 0.062 / 0.084 | 0.062 / 0.259 | 0.014 / 0.024 | 0.007 / 0.013 |
| 1,000 | Polygon | 0.063 / 0.074 | 1.625 / 1.836 | 0.024 / 0.302 | 0.008 / 0.011 |

Route building is O(n) in source-path vertices and does not validate the whole
draft on hover. Identical pointer-route requests reuse the last cached result.
Batch insertion avoids validation per inserted corner, but polygon validation
remains O(m²) in total draft corners. These timings exclude MapLibre snapping,
projection, uploads and rendering; they are local observations, not supported
size/frame-rate guarantees or CI budgets. See the snapping baseline for index costs.

## Shared-boundary editing

Run `npm run benchmark:shared-boundary`. Two adjoining rectangles share a straight
chain with 10, 100 or 1,000 segments near `[4.895, 52.375]`. Each sample enters the
tool, moves the middle shared vertex 0.001 degrees east, confirms both results and
undoes. Five warmups precede 30 samples. Import, selection, snapshots and assertions
are outside timing; each iteration verifies both updates and exact Undo/Redo.

Local baseline on 2026-10-24: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are
median / p95 milliseconds, excluding MapLibre projection, snapping, uploads and
rendering.

| Shared segments | Entry | Move + validation | Commit | Undo |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 0.113 / 0.286 | 0.122 / 0.264 | 0.165 / 0.307 | 0.004 / 0.011 |
| 100 | 0.266 / 0.591 | 0.564 / 0.804 | 1.053 / 1.324 | 0.009 / 0.025 |
| 1,000 | 2.776 / 3.268 | 36.665 / 40.346 | 71.608 / 78.295 | 0.058 / 0.096 |

Exact-edge discovery uses a map of reversed edges; remaining-boundary contact checks
can be quadratic. Each move validates both complete polygon rings (quadratic) and
checks their intersection. Confirmation repeats result validation and transaction
validation. Pointer moves are coalesced per animation frame, but calculations are
synchronous: 1,000 shared segments already exceed a 60 Hz frame budget locally.
These measurements are neither workload limits nor frame-rate guarantees. Large
shared boundaries need further validation/indexing or worker work before claiming
smooth interaction. Other features in the dataset are not part of this topology
check.

## Selection rotation

Run `npm run benchmark:rotation`. Regular polygons near `[4.895, 52.372]` have
10, 100 or 1,000 corners at radius 0.002°. A fourth case selects 100 ten-corner
polygons on a 0.01° grid. Each iteration computes the default pivot, previews an
absolute 30° rotation, confirms, undoes and verifies exact Redo. Five warmups
precede 30 measured samples. Import, selection and assertions are excluded.

Local baseline on 2026-10-24: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are
median / p95 elapsed milliseconds; MapLibre projection, uploads and rendering are
excluded. The preview column includes rotation, output-range checks and topology
validation; commit includes transaction validation and history recording.

| Features | Corners per polygon | Entry | Preview | Commit | Undo |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 0.007 / 0.015 | 0.030 / 0.106 | 0.022 / 0.134 | 0.004 / 0.007 |
| 1 | 100 | 0.025 / 0.034 | 0.192 / 0.307 | 0.131 / 0.273 | 0.005 / 0.006 |
| 1 | 1,000 | 0.064 / 0.087 | 6.787 / 7.543 | 6.633 / 7.274 | 0.028 / 0.042 |
| 100 | 10 | 0.103 / 0.481 | 1.118 / 1.715 | 0.975 / 1.069 | 0.092 / 0.115 |

Coordinate rotation and pivot/range scans are linear in selected vertices. Polygon
validation remains quadratic per ring, with additional hole/component comparisons.
Angle changes run synchronously from frozen originals, never from the last preview.
State reads do not recalculate; public preview copies scale with selected output.
Only selected geometry is uploaded for preview, but confirmation still uploads
committed data through the normal renderer. These timings are not supported-size
guarantees, frame-rate guarantees or CI budgets; larger and more complex shapes
need workload-specific measurement.

## Selection scaling

Run `npm run benchmark:scaling`. The same regular polygon/group fixtures as the
rotation benchmark use 10, 100 or 1,000 corners and a group of 100 ten-corner
polygons. Each iteration enters scaling with the default pivot, previews factor
1.5, confirms, undoes and verifies exact Redo. Five warmups precede 30 measured
samples; import, selection and assertions are excluded.

Local baseline on 2026-10-24: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are
median / p95 elapsed milliseconds; browser rendering and uploads are excluded.
Preview includes transformation, range checks and topology validation; commit
includes revalidation and history recording.

| Features | Corners per polygon | Entry | Preview | Commit | Undo |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 0.006 / 0.011 | 0.030 / 0.088 | 0.023 / 0.043 | 0.004 / 0.006 |
| 1 | 100 | 0.025 / 0.039 | 0.195 / 0.313 | 0.131 / 0.246 | 0.005 / 0.006 |
| 1 | 1,000 | 0.067 / 0.110 | 6.968 / 7.687 | 6.745 / 9.196 | 0.028 / 0.070 |
| 100 | 10 | 0.101 / 0.132 | 1.012 / 1.244 | 0.904 / 1.113 | 0.092 / 0.439 |

Scaling and pivot/range scans are linear in selected vertices. Polygon validation
remains quadratic per ring, with additional hole/component comparisons. Factor
changes run synchronously from frozen originals. State reads do not recalculate;
preview snapshots copy selected output. These local timings are not frame-rate
or supported-size guarantees. Large complex workloads need separate measurement.

## Drawing constraints

Run `npm run benchmark:constraints`. Each sample resolves 10,000 pointers with a
45° constraint and a constant-time last-point snapshot from a line draft with
10, 1,000 or 100,000 vertices. Coordinates stay near the Netherlands. Five warmup
samples precede 30 measured samples. Draft construction and assertions are excluded.

Local baseline on 2026-10-24: Node v22.23.1, macOS arm64, Apple M2 Pro.

| Draft vertices | 10,000 resolutions median / p95 (ms) |
| ---: | ---: |
| 10 | 2.280 / 2.620 |
| 1,000 | 2.313 / 2.589 |
| 100,000 | 2.251 / 2.522 |

The added angle calculation and anchor lookup have constant work per pointer.
This benchmark excludes MapLibre unprojection, snapping acquisition, the existing
preview renderer and topology validation. It measures incremental constraint cost,
not complete input-to-frame latency or supported drawing sizes. Measurements are
local baselines, not CI timing budgets.

## Selection simplification

Run `npm run benchmark:simplification`. Regular polygons near `[4.895, 52.372]`
have 10, 100 or 1,000 corners at radius 0.002°. A fourth case selects 100 ten-corner
polygons on a 0.01° grid. Each iteration enters the tool, previews tolerance 100
Mercator meters, confirms, undoes and verifies exact Redo. Five warmups precede
30 measured samples; import, selection and assertions are excluded.

Local baseline on 2026-10-24: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are
median / p95 elapsed milliseconds. Browser rendering/uploads are excluded; preview
includes simplification and candidate validation, commit includes revalidation.

| Features | Input corners per polygon | Entry | Preview | Commit | Undo |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 0.008 / 0.055 | 0.022 / 0.039 | 0.017 / 0.030 | 0.003 / 0.014 |
| 1 | 100 | 0.025 / 0.136 | 0.061 / 0.122 | 0.028 / 0.039 | 0.003 / 0.004 |
| 1 | 1,000 | 0.061 / 0.094 | 0.313 / 0.502 | 0.199 / 0.437 | 0.014 / 0.021 |
| 100 | 10 | 0.105 / 0.297 | 0.715 / 0.979 | 0.655 / 0.974 | 0.084 / 0.115 |

These smooth polygon fixtures simplify substantially. Lower tolerances, jagged
paths and shapes with holes/components can cost much more. Douglas–Peucker uses
linear auxiliary memory and an explicit stack, but can take quadratic time.
Polygon validation is quadratic per output ring, with additional ring/component
comparisons. These timings are local baselines, not supported-size or frame-rate
guarantees. No worker offloading is implemented; large inputs can block the UI.

## Selection buffers

Run `npm run benchmark:buffer`. The same regular polygons used for simplification
have 10, 100 or 1,000 corners near `[4.895, 52.372]` at radius 0.002°. A fourth
case selects 100 ten-corner polygons on a 0.01° grid. Each iteration enters with
10 Mercator meters, previews 20 meters, confirms, undoes and verifies exact Redo.
Five warmups precede 30 measured samples. Import, selection and assertions are
excluded. Entry includes the initial buffer calculation and validation, unlike
simplification entry at zero tolerance.

Local baseline on 2026-10-24: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are
median / p95 elapsed milliseconds. Browser rendering/uploads are excluded. Preview
includes capsule construction, batched overlay, projection and strict transaction
validation. Commit includes another validation of the cached result.

| Features | Input corners per polygon | Entry | Preview | Commit | Undo |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 0.716 / 1.311 | 0.698 / 0.904 | 0.042 / 0.063 | 0.003 / 0.010 |
| 1 | 100 | 5.795 / 6.465 | 6.777 / 7.290 | 0.180 / 0.202 | 0.006 / 0.009 |
| 1 | 1,000 | 143.395 / 159.896 | 199.032 / 207.231 | 6.718 / 7.159 | 0.028 / 0.168 |
| 100 | 10 | 57.956 / 61.376 | 56.961 / 61.558 | 3.105 / 3.489 | 0.125 / 0.574 |

The 32-gon disk adds geometry per source segment. Grouped unions remove redundant
capsule interiors before the final overlay, but dense intersections, many holes,
disjoint parts or complex output can cost substantially more. Validation remains
quadratic per output ring, plus comparisons between rings/components. These local
fixtures establish no maximum supported size, frame-rate guarantee or CI budget.
Calculation is synchronous: the measured 1,000-corner preview can block the UI for
about 200 ms. Workers, cancellation of running calculations and configurable arc
resolution are not implemented in this version.

## Line offsets

Run `npm run benchmark:offset`. Source lines start near `[4.895, 52.372]` and have
10, 100 or 1,000 vertices. Longitude increases by 0.00001° per vertex; latitude
varies by `0.00002 × sin(i / 10)` degrees. The group case selects 100 ten-vertex
lines separated by 0.001° latitude. Each iteration enters at zero, previews +10
Mercator meters, confirms, undoes and verifies exact Redo. Five warmups precede
30 measured samples; import, selection and assertions are excluded.

Local baseline on 2026-10-25: Node v22.23.1, macOS arm64, Apple M2 Pro. Values are
median / p95 elapsed milliseconds. Entry includes checking simple open paths in
both geographic/projected coordinates. Preview includes calculation, both output
intersection checks and transaction validation. Commit revalidates the cached
GeoJSON. Rendering and map uploads are excluded.

| Features | Vertices per line | Entry | Preview | Commit | Undo |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 0.039 / 0.074 | 0.062 / 0.216 | 0.028 / 0.065 | 0.009 / 0.018 |
| 1 | 100 | 0.039 / 0.209 | 0.135 / 0.527 | 0.050 / 0.194 | 0.005 / 0.020 |
| 1 | 1,000 | 0.171 / 0.601 | 0.984 / 1.397 | 0.452 / 0.774 | 0.031 / 0.054 |
| 100 | 10 | 0.215 / 0.873 | 0.838 / 1.686 | 0.611 / 1.065 | 0.091 / 0.120 |

These smooth, eastward fixtures benefit from sorting segment bounds on longitude
or projected x. Offset construction and auxiliary storage are linear; sorted
bounds cost O(n log n) plus candidate-pair comparisons. Many overlapping x ranges
can still cause quadratic work even for valid paths. The synchronous calculation
can block the UI on large or unfavorable inputs. This benchmark establishes no
supported maximum size, frame-rate guarantee or CI timing budget. Workers and
interactive dragging of the offset are not implemented in this version.
