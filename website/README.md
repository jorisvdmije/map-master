# Map Master documentation website

The complete documentation website is a Next.js App Router application with
React 19, TypeScript and TanStack React Query. It exports static HTML and React
Server Component payloads for the documentation and playground, including 42 live map examples.
The library itself remains independent of the website's framework dependencies.

## Architecture

- `src/app/`: root layout, home page, generated guide routes, metadata, error and
  not-found boundaries. The root layout preserves the header, sidebar and search
  dialog across navigation; internal links use Next's router.
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
