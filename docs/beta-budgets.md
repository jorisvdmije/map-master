# Beta compatibility and performance gates

Milestone 18d adds executable regression budgets for the installed package and
workspace. The package is still an unpublished beta preview. These are initial
engineering targets for one fixed workload, not a service-level agreement or a
claim that every dataset of this size has the same cost.

## Compatibility scope

| Surface | Current evidence and scope |
| --- | --- |
| Browser engine | Playwright 1.64.1 bundled Chromium 156.0.8078.4; real desktop browser interactions and budget checks pass locally. The report records the browser actually launched. |
| Local platform | macOS arm64, Apple M2 Pro, Node 22.23.1. See the committed raw baseline for exact measurements. |
| Hosted CI | Ubuntu x64 with Node 22.23.4 and 24.21.0 passed `npm run release:prepare` on integrated `main` commit `864aa34`, including the full check suite and installed-consumer budgets. Both jobs produced identical archives. See [raw qualification evidence](release-evidence/2026-10-28-main/README.md); later release commits require fresh verification. |
| MapLibre | 6.15.0 is tested. The peer range remains `^6.15.0`; that installation range is broader than the verified-version list. Rerun checks before qualifying an upgrade. |
| Chrome / Edge releases | Not separately qualified. Sharing an engine does not establish that a shipping browser version passes. |
| Firefox / Safari / WebKit | Not qualified in this milestone. Add real interaction/installed-consumer runs before expanding the support matrix. Chromium CDP memory measurements cannot be reused as cross-engine evidence. |
| Input | Desktop mouse/pointer capture and focused keyboard shortcuts: Escape, Enter, Delete/Backspace, Undo/Redo, Shift selection, Alt snapping bypass. |
| Touch / pen / mobile | [Vertex and midpoint editing](touch-pen-vertices.md) has Chromium-emulated contact/capture, pan/zoom separation, interruption and installed-consumer checks. Physical tablets/styluses, drawing, whole-feature drags and other touch tools remain unqualified. |
| Accessibility | Native demo controls and focused keyboard actions are tested. Canvas geometry has no complete keyboard-only navigation or screen-reader editing workflow; no WCAG conformance claim. Hosts needing that workflow must provide accessible coordinate/feature controls through the public API. |
| Projection / geometry | Existing 2D WGS84 and Mercator operation contracts remain in force, including topology, latitude and antimeridian limits. See the individual API guides. |

## Dataset profile

The fixed fixture contains **1,000 features and 2,765 coordinate positions**:
333 Point markers, 333 two-point lines, 333 four-corner polygons and one isolated
100-corner polygon. The position count includes polygon closure copies. Every
feature has a small name/group properties object. The grid sits near Amsterdam;
the largest polygon is edited while snapping indexes the entire committed grid.
The fixture definition and a size/complexity guard are checked in.

This profile qualifies ordinary placement/selection/import and editing one
100-corner polygon in this specific workload. It does not qualify 1,000 complex
polygons, 10,000 features, huge properties, deeply nested holes, dense overlapping
geometry, large group drags or expensive overlay/buffer operations. Those operations
retain functional coverage and their separate [core baselines](performance.md).
The workspace's 5 MB file limit and 100-action history limit are not dataset or
memory guarantees. There is no new runtime rejection limit in this milestone.

The viewport is 1280 × 900 CSS pixels, device scale 1; the dedicated map is
900 × 650. Rendering is headless Chromium with software WebGL fallback enabled;
the actual WebGL renderer and device pixel ratio are recorded, rather than
assuming that the flag forces one GPU backend. There are
no basemap tiles or external network requests. Browser startup, initial page
navigation, asset downloads, storage writes and host-specific callbacks are not
included in the latency targets below.

## Latency budgets

All values are milliseconds, **p95**, using the nearest-rank method. Thresholds
are reviewed constants in `scripts/beta-budget-policy.mjs`; there is no environment
variable that silently disables them or retries a failed run until it passes.

| Metric | Budget | Start → end |
| --- | ---: | --- |
| Workspace import | 2,000 | File-input change event → async file read, JSON parse, validation/import, list/dirty-state update and two animation frames after the import control is ready. Does not assert the map tiles are ready at this endpoint. |
| Workspace selection | 150 | Actual list click → selection handler/list update and two animation frames. The chosen name must match. |
| Editor selection render | 100 | Public `select` → MapLibre idle and two animation frames. Selected identity is verified. |
| First pointer preview after camera change | 150 | Captured real pointermove → the changed active vertex is found at its new rendered map position, followed by one animation frame. Includes snapping-index reconstruction after camera invalidation. |
| Repeated pointer preview | 100 | Same endpoint, repeated movements within one gesture with a reusable snapping index. |
| Commit render | 1,000 | Public `finish` → MapLibre idle and two animation frames after the full committed source update. Undo resets the input outside the timer. |

Thirty measured samples follow five warmups for each interaction; imports use
five measured fresh-page samples after one warmup. With five samples, p95 is the
maximum. Every raw sample is retained. Captured pointer timings use the browser's
clock, excluding Playwright transport. Acquisition requires a real rendered
vertex within one CSS pixel of the edited coordinate; a missing update fails
instead of reporting an artificially fast result. Queries run with snapping
**enabled**, including misses; the timing fixture is not a snapping accuracy test.
The normal browser suite covers exact acquisition and Alt behavior.

The animation/render endpoints are reproducible proxies, not compositor telemetry
or physical input-to-photon measurements. Background load and rendering hardware
can affect results. The budgets detect large regressions in this profile; passing
does not claim uninterrupted 60 fps. Investigate a failed report before changing
a threshold, and include old/new raw results with any deliberate policy change.

## Lifecycle and memory budgets

On one browser page, create a new map/editor, import the fixture, edit/commit,
Undo/Redo, translate a small mixed selection, change appearance, register observers,
and build a snapping preview. Destroy while drawing, remove the map, and release
fixture references. Five warmup cycles precede **twenty measured cycles**.

After each teardown, assert that editor sources/layers and preview overlays are
gone and the map container is empty. Chromium CDP explicitly requests garbage
collection before collecting renderer-main-isolate heap size and DOM counters.
The baseline is the final warmup's post-GC sample, not an empty startup process.

| Measure | Gate |
| --- | ---: |
| Maximum post-GC heap growth from warm baseline | ≤ 8 MiB |
| Least-squares heap slope across measured cycles | ≤ 256 KiB/cycle |
| Maximum retained DOM-node growth | ≤ 100 |
| Maximum retained event-listener growth | ≤ 20 |

These bounds accommodate small engine/cache variation while checking both a
single retained increase and sustained growth. They do **not** measure worker
heaps, GPU allocations, native/process RSS or retained active-history memory.
A bounded result after twenty cycles is evidence against regressions in this
scenario, not proof of absence of every leak. Worker/GPU profiling and longer
application-specific sessions remain necessary before wider production claims.

## Running and reviewing

```sh
npm run test:budgets       # policy tests + isolated installed-consumer budgets
npm run test:workspace     # same budgets + production acceptance + dev smoke
npm run check              # full repository checks, including the above
```

The existing workspace launcher packs the library, installs its archive outside
the repository using the consumer lockfile, and builds the real workspace plus a
**test-only** second HTML entry. The lifecycle fixture imports only the public
`@jorisvdmije/map-master` entry point and the consumer's MapLibre dependency. It adds no globals
or test controls to the normal application or library. The test build shares
bundler chunks between the two entries; initial bundle-loading time is excluded.

Standalone budget/workspace runs write `artifacts/beta-budgets.json`, including raw
samples, limits, observed package/browser versions, CPU/OS, archive SHA-256 and
errors. Breaches, incomplete measurements, browser errors and external requests
exit nonzero. Policy unit tests exercise latency breaches, retained heap/node/
listener growth, slope, invalid samples and fixture size. Failures before the
browser harness starts (for example build errors) may have no report.

Release preparation writes the same report alongside its candidate archive in
`artifacts/releases/candidate-*`. CI retains that directory for 14 days per Node version using GitHub's
[upload-artifact action](https://github.com/actions/upload-artifact), also when a
budget fails. The public repository is configured with required checks; passing hosted
qualification on the actual release commit remains a release prerequisite.

The local reference report is [beta-budgets-baseline.json](beta-budgets-baseline.json).
Update that reference only after reviewing the measurement conditions and any
changes in behavior. The older microbenchmarks remain useful for diagnosis but
do not substitute for these installed-browser checks.
