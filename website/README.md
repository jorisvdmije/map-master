# Map Master documentation website

The complete documentation website is a Next.js App Router application with
React 19, TypeScript and TanStack React Query. It exports static HTML and React
Server Component payloads for the documentation and playground, including 42 live map examples.
The library itself remains independent of the website's framework dependencies.

## Architecture

- `src/app/`: shared root layout/providers, metadata, errors and full-page
  workspaces. The `(docs)` route group owns the home page, generated guide routes
  and persistent documentation header/sidebar/search. Layout choice is structural,
  not a client pathname branch, so workspace HTML matches before and after
  hydration. Internal links retain the shared root and use Next's router.
- `src/components/layout/`: persistent documentation shell and page footer.
- `src/components/content/`: server-rendered Markdown, workflow/gallery cards,
  interactive code boundaries and the observed table of contents.
- `src/components/ui/`: upstream shadcn/ui Base Nova components, with their MIT
  license in `SHADCN-LICENSE.md`. Code blocks support exact copying, line numbers,
  wrapping and expansion; install commands offer package-manager tabs.
- `src/features/search/`: typed React Query options, ranking and an accessible
  search dialog with keyboard navigation and retry on failure.
- `src/features/examples/`: lazy map component, editor lifecycle, configurations
  and cached basemap query. MapLibre and the geometry editor are dynamically
  imported when a map approaches the viewport. Leaving the page aborts its
  lifecycle and releases the map, editor, controls and WebGL resources.
- `src/features/playground/`: full-page geodata workbench at `/playground/`, a
  public-API map/editor boundary, typed project envelopes, IndexedDB revision
  checks, layer/style/attribute panels and scoped downloads. Geometry changes
  stay in the editor; project settings and persistence belong to this app. See
  [the playground guide](../docs/playground.md) for file formats and limits.
- `src/content/`: shared navigation, gallery, hints and content types.
- `src/features/analysis/`: full-page spatial explorer at `/analysis/`. Import
  GeoJSON or CSV, draw/import/edit polygon areas with the same geometry editor,
  and cross-filter the map, category chart, numeric histogram and paginated table.
  Turf computes intersections and area; Papa Parse handles CSV. Statistics use
  full feature values, not area weighting; boundaries count and holes are respected.
  Missing/non-numeric values are excluded from numeric aggregates. Source data is
  read-only; area changes are undoable. Export filtered GeoJSON, CSV or a summary,
  or save/reopen an `.analysis.json` file with data, areas, fields and filters.
  Files stay local, with a 10 MB / 20,000 feature / 300,000 coordinate data import
  limit and 200 analysis areas. Saved `.analysis.json` files can be up to 50 MB.
  Work is kept in memory; download it before leaving.
  A first-visit introduction (reopenable with the information button) explains the
  sample scenario, map/chart filters and aggregates, with a one-click City centre
  example. Only its dismissal is remembered in optional localStorage. Sample
  service requests use a seeded, uneven spatial distribution, local category
  concentrations, varied repair estimates and some missing values. Locations and
  costs are explicitly fictitious, not real reports or geocoded addresses.
- `src/features/bnb/`: the Dutch B&B permit example at `/analysis/bnb/`, linked
  from Analysis and documentation navigation. It uses real, locally bundled
  110 permit-area polygons from the municipal B&B map, with explicitly simulated
  quota/permit/queue data. A searchable ward list replaces the coarse city districts.
  Select a polygon to show all its permit and application markers; filter/search
  locations, inspect a record, compare current and post-application capacity,
  and export ward CSV or filtered location CSV/GeoJSON. Statistics stay
  independent of location filters. Area selection preserves the camera; the
  explicit zoom button frames the selected area. Following/fixed/off mouse
  properties show ward and marker data without selecting or intercepting clicks.
  Property cards flip/clamp at map edges and dismiss on leave/Escape. Dark ward outlines stay
  visible in both capacity modes. See [sources and scenario assumptions](src/features/bnb/SOURCES.md).
  `npm run check:bnb` exercises it in Chromium, Firefox and WebKit; the normal
  analysis unit/browser checks and full website check also include it.
- `src/lib/`: server-only content access, routes/public assets, responsive state
  and QueryClient configuration. `src/providers/` owns the stable browser client;
  server rendering receives an isolated QueryClient.
- `scripts/content.mjs` and `scripts/lib/markdown.mjs`: build-time Markdown and
  Shiki processing, generated search index, public assets and license notices.
  Markdown/highlighting/parsing dependencies stay outside browser bundles.

React Query caches the search index and basemap style for the browser session,
with no refetch on focus. Each map receives its own clone of the cached style.
Offline requests settle into an error/retry state or an editable plain map.
Failed basemap requests are not cached as successful styles; subsequent examples
retry the service. A failed map can be retried without reloading the document.
Menu, search, tabs and code-display state use React; a separate Zustand store is
unnecessary for the current interactions. Map editing state belongs to the editor.
The UI does not store credentials or send telemetry.

## Develop

From the repository root, with Node 22.22.3+ within 22.x or 24.15+ within 24.x:

```sh
npm ci --prefix website
npm run dev:docs
```

Open http://127.0.0.1:5180. The root command builds the library first, then starts
Next.js with Turbopack. TypeScript, React and CSS changes use Fast Refresh.
After changing the map library, rebuild it with root `npm run build`. After
changing Markdown, navigation or generated assets, restart `dev:docs` to regenerate
content and the route manifest.

Existing guides live in `../docs/*.md`; onboarding content lives in `content/`.
The content compiler rejects duplicate slugs, resolves Markdown links to Next
routes, and retains source/project links to GitHub. Add a hint in
`src/content/demo-hints.ts` and a configuration in `src/features/examples/demos.ts`
to give a guide a live example. `[[demo:name]]` controls explicit placement;
`[[gallery]]` and `[[examples]]` render the shared React card components.

Use a code fence such as `ts title="main.ts"` to name a file. A Markdown blockquote
starting with `[!NOTE] Title` or `[!IMPORTANT] Title`, followed by a blank quoted
line and its message, renders as a setup callout. Content comes only from trusted
repository Markdown. It is converted to React on the server; code blocks and maps
are normal React components, without independent roots or manual hydration.
Content and public assets are published atomically after successful compilation,
so running a content build cannot remove files underneath the development server.

The logo/favicon derive from `../assets/icon.svg`. Fonts and the MapLibre worker
are served locally. Maps use OpenStreetMap data from
[OpenFreeMap](https://openfreemap.org/) without an API key. A failed basemap request
falls back to a plain background while the editor keeps working. Examples require
WebGL and a secure context.

## Check and build

```sh
npm run test:docs
```

This builds the library, runs Next/React/TypeScript lint rules, builds the full
static export under `/map-master/`, compiles the published framework examples
with their real compilers, and exercises the website using the repository's
Playwright Chromium workflow. Install Chromium using the root repository's
Playwright setup first.

The checks cover every page's local links/anchors, search/copying, persistent DOM
identity, browser history and scroll restoration, map cleanup, pending map
navigation, React Query cache reuse/error recovery, legacy URLs, JavaScript-free
reading, mobile navigation and all live examples. The exact quickstart files are
extracted, compiled, built with Vite (the documented consumer setup) and tested
in a browser. A real Next.js development server is checked separately, at the
root path, for styles, maps and drawing controls.
Embedded-map checks expand the complete toolbar and exercise text, templates,
geometry operations and data layers at phone/tablet widths. The shared library
also checks short/transformed maps and every control corner on both renderers.
It uses the isolated `.next-dev/` build directory, so your regular Next.js server
can remain running. Additional regressions exercise malformed search responses,
offline requests, recovered map services, denied/missing clipboard access,
screen-reader selection, IME composition and mobile keyboard focus. Mobile users
without JavaScript can browse every guide through the header's All guides link.

React examples compile with TypeScript, Vue with `vue-tsc` and its SFC compiler,
Svelte with `svelte-check` and client/server compilers, and Angular with `ngc` and
strict templates. These checks use the library's public declarations and the
published shared worker setup. They verify the documented components, rather
than complete applications in each framework. Reports/screenshots are retained
in `../artifacts/documentation/`.

After a build, individual checks are available:

```sh
npm --prefix website run lint
npm --prefix website run typecheck
npm --prefix website run check:frameworks
npm --prefix website run check:content
npm --prefix website run check:browser
```

`check:browser` expects the `/map-master/` export produced by the full check. To
build without browser checks, run `npm run build:docs`. The default build targets
the root path. To build for a subdirectory, set the path at build time:

```sh
NEXT_PUBLIC_BASE_PATH=/map-master npm run build:docs
npm --prefix website run preview
```

`preview` serves `website/dist/` on port 5180 at the build's configured base path.
Next's base path applies to routes and RSC requests; `assetPath()` prefixes public
assets. Sidebar/gallery links disable automatic prefetch so long documentation
menus do not download every guide's code examples at once.

## Static hosting

Deploy all of `website/dist/`, including `_next`, `.nojekyll` and the RSC `.txt`
files. Every canonical guide is a directory with `index.html`, so direct visits
work on plain static hosts without rewrite rules. Existing `guides/name.html`
URLs remain readable without JavaScript and redirect to canonical routes with
JavaScript, retaining query strings and section anchors. Unknown paths have a
complete exported `404.html` page.

The public site is https://jorisvdmije.github.io/map-master/. GitHub Pages must use
**GitHub Actions** as its source. CI runs checks on Node 22 and 24 and uploads the
verified `/map-master/` export from the Node 22 job. Deployment publishes that
same artifact from `main` after the required checks succeed. Pull requests only
validate. Authentication uses GitHub's short-lived workflow token and OIDC.

To redeploy, run **CI** manually on `main`. Revert a change through a PR to roll
back; the next successful `main` build publishes it. Failed checks leave the last
successful deployment online. Do not publish `.next`, `.generated`, `node_modules`
or developer credentials; these directories are excluded from Git and the npm
library package.

### Amsterdam street monitor

`/analysis/streets/` combines the complete local Amsterdam NWB snapshot
(45,870 segments, including Weesp) with real public municipal lighting-object
statuses, registered trees and twelve complete months of MORA reports. One
selectable street object shows concrete pooled indicators, original segment
details and a monthly report chart. It supports 3/12-month windows, linked
filters, Pearson/Spearman with log/linear scatter axes, minimum-length controls,
citywide k-means street profiles and area comparisons. Selection preserves the
camera. No synthetic safety/maintenance scores or activity adjustment remain.

CSV/GeoJSON exports retain raw counts, units, periods and matching limitations;
JSON reports also preserve source audits and analysis settings. Color classes
are illustrative, not official quality standards. Public lighting objects
include decorative LSD types and are not asserted to be individual lamps.

Run `npm run test:analysis` for source reconciliation, spatial attribution and
mathematical checks; `npm run check:streets` covers three browsers and mobile.
See `src/features/streets/SOURCES.md` for complete methods and limitations.
Refresh deliberately with `npm run data:streets` (if geometry is changing),
then `npm run data:street-observations`, then rebuild. Counts are bound to the
exact geometry hash. Visitors use local assets without live municipal API
requests or credentials; future source refreshes may require an API key.

The `Concentraties` map mode adds Gaussian heatmaps and fixed hexagon count maps for reports (all, nuisance,
roads/maintenance), municipal trees, lighting objects and faults. It uses real
source locations aggregated to 25 m, fixed citywide color references, physical
100/250/500 m smoothing, a continuous color ramp, source-cell marker transitions,
keyboard-accessible cell tables and weighted GeoJSON export. The optional point
asset is lazy-loaded. `npm run check:heatmaps` validates it across three browsers;
`node scripts/heatmap-browsers.mjs chromium --visual` records the real basemap.

Choose `Hexagonen` for 100/250/500 m wide regular cells, fixed count scales,
clickable polygons, labels at sufficient zoom, and polygon GeoJSON exports.
The grid stays fixed during navigation and conserves the same filtered totals.


The `Verandering` analysis adds a shift radar over real monthly MORA counts.
For each named street it compares the last three complete months against the
preceding nine, scaled by the change in the **rest of Amsterdam**, excluding
that street. The windows and city reference stay fixed when searching or
changing the main report-period selector. Ranked increases/decreases, subject
and sample-size controls, actual/reference monthly charts, exclusion reasons,
accessible tables and CSV/JSON exports make each signal auditable. This is a
descriptive comparison, not a forecast, local seasonal adjustment or
significance test. No artificial scores or new data sources are introduced.

The analytical review also adds median/interquartile summaries and exact
histogram bounds in the free explorer; queue medians and count/share capacity
rankings in the B&B demo; same-sample raw-count sensitivity for correlations;
and deterministic, nonempty street profiles with convergence/compactness
information. `npm run check` now includes the free-analysis and B&B browser
suite as well as the street and heatmap suites.


Property cards share screen-space positioning across documentation examples,
Playground, free analysis, B&B and Street Lab. Choose cursor-following, centered
hover, centered click-only or off. Same-feature pointer movement updates the
position on every frame; clicking pins an interactive card at the center without
moving the camera. Cards remain bounded on resize, support touch and Escape,
and render attribute values as text. `npm run check:properties` verifies these
interactions and existing per-layer content settings in all three browsers.


Linux CI runs documentation browser suites under `xvfb-run` with
`GEO_DOCS_HEADED=1`, matching the existing windowed WebGL qualification used
for Firefox and WebKit. Browser scripts also accept `GEO_COMPAT_HEADED=1`
for interactive debugging. This setting does not change the core Chromium
performance-budget browser configuration. Failures retain the analysis,
properties, street and heatmap screenshots alongside documentation evidence.

Server-shell assertions parse direct HTTP responses, so client JavaScript cannot
insert a missing shell and make the server check pass. Browser suites separately
exercise hydration, navigation, reloads and map readiness in each engine.
