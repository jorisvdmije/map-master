# Testing

Map Master is tested at four levels. `npm run check` runs all of them except the
cross-browser and published-release checks, which run in separate CI jobs.

| Level | Command | What it covers |
| --- | --- | --- |
| Core and package | `npm test` | Geometry, validation, editing state, transactions and history in Node.js; packs the library, installs the archive in a clean consumer and compiles it with NodeNext and Bundler resolution. |
| Browser | `npm run test:browser` | Real MapLibre rendering in Chromium: pointer, keyboard, touch/pen emulation, snapping, every tool, style reloads, teardown and both demos. |
| Installed application | `npm run test:workspace` | The [area workspace](../examples/workspace/README.md) installed from a packed archive outside the repository, exercised through its UI, plus the performance budgets. |
| Documentation site | `npm run test:docs` | Builds the website, checks every link and anchor, and runs the quickstart and interactive examples in a browser. |

Set up once after cloning:

```sh
npm ci
npm ci --prefix website
npx playwright install chromium   # on Linux: npx playwright install --with-deps chromium
```

## Installed-application acceptance

`npm run test:workspace` packs the current checkout, copies the example application
to a temporary directory, installs the archive with the example's own lockfile and
runs Chromium against both its production build and its development server. It uses
only the visible controls of the application and fails on console errors, failed
requests or any request to an external host. The scenarios cover:

- drawing, rendering, selecting a real polygon on the map and exporting GeoJSON;
- renaming through transactions, Undo/Redo, cancelling and applying vertex drags;
- keyboard group edits and touch vertex edits, saved as one undo step;
- appearance changes, session locks, deletion and empty-workspace persistence;
- atomic imports with typed IDs, rejection of duplicate IDs and invalid files;
- storage quota errors, recovery of corrupt saved data and conflicts between tabs.

The application has its own lockfile. After changing the library's dependencies or
version, or the example's dependencies, run `npm run lock:workspace` and review the
lockfile diff.

## Performance budgets

The same installed application runs latency and lifecycle-memory budgets with a
fixed 1,000-feature dataset; [compatibility and limits](compatibility.md) lists the
thresholds. Each interaction is measured 30 times after 5 warm-up runs (imports 5
times), and the 95th percentile must stay within budget. The lifecycle check creates
and destroys a map and editor 20 times after 5 warm-up cycles, forces garbage
collection through the Chrome DevTools Protocol and bounds heap growth, heap slope,
DOM nodes and event listeners.

```sh
npm run test:budgets   # budgets only; writes artifacts/beta-budgets.json
```

The thresholds live in `scripts/beta-budget-policy.mjs`. Investigate a failing report
before changing a threshold, and include old and new raw results with any deliberate
change. The report records raw samples, browser and package versions and the archive
checksum.

## Cross-browser checks

```sh
npx playwright install firefox webkit
npm run test:compatibility -- firefox webkit
```

This runs the desktop workspace scenarios against a freshly packed archive in the
selected engines (all three by default). The Chromium-only touch scenario and memory
budgets are skipped in Firefox and WebKit. Set `GEO_COMPAT_HEADED=1` to watch the
browser; on Linux CI the job runs headed under `xvfb-run`. Reports are written to
`artifacts/browser-compatibility/`.

## Published release checks

```sh
npm run test:workspace:published
npm run test:compatibility:published -- firefox webkit
```

These download the exact version recorded in `examples/workspace/published-release.json`
from npm, verify its SHA-512 integrity and run the same acceptance, budgets and
compatibility checks against it. They never fall back to a local build. Update the
pin only after publishing and verifying a new release.

## Benchmarks

Micro-benchmarks for individual operations live in `benchmarks/`:

```sh
npm run benchmark                     # list the available benchmarks
npm run benchmark -- snapping union   # run selected benchmarks
npm run benchmark -- all              # run every benchmark
```

They use fixed datasets and print timing tables. Recorded results and their
conditions are kept in [performance notes](performance.md).

## Continuous integration

- **CI** runs `npm run release:prepare` (which includes `npm run check`) on Node.js 22
  and 24 for every pull request and push to `main`, keeps the packed candidate and its
  reports for 14 days, checks the published release and deploys the documentation
  site from `main`.
- **Browser compatibility** runs the cross-browser checks for Firefox and WebKit on
  Ubuntu and macOS.
