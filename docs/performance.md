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
