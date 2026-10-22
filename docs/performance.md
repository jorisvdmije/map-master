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
does O(n³) total validation work; a future import must validate each complete
ring once instead of replaying every click. Pointer motion uses cached validity
and does not invoke the validator. For much larger rings, incremental checks or
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
