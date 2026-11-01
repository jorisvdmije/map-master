# Map Master documentation website

A static, searchable documentation site with syntax-highlighted code, a complete
quickstart and a live example for every feature guide. The examples run this
repository's library build (`dist/`, through a Vite alias and TypeScript path) and
use the library's `EditorToolbar`. Their maps, data and toolbars are configured in
`src/demos.ts`; the hint under each map lives in `scripts/content.mjs`.

## Develop

From the repository root:

```sh
npm ci --prefix website
npm run dev:docs
```

The root scripts build the library first. Open http://127.0.0.1:5180. Vite reloads
website TypeScript/CSS changes; run `npm run build` after changing the library, and
restart the dev command after changing Markdown to regenerate the pages and search index.

The existing guides live in `docs/*.md`. New onboarding content lives in
`website/content/`. `scripts/content.mjs` converts both into static HTML and
rewrites guide links to site routes. Source and project links that are not hosted
as guide pages point to GitHub. Generated files are ignored by Git.

Code examples use the upstream shadcn/ui Base Nova `CodeBlock`, `Button` and
`Tabs` components in `src/components/ui/`. The install command offers package
manager tabs; tagged Markdown callouts use shadcn `Alert`. The vendored components
retain their MIT license in `SHADCN-LICENSE.md`. Local changes replace registry
imports and icon placeholders with the project's utilities and Lucide icons,
use explicit orientation selectors, and omit React Server Component directives
because this site uses Vite. The source URL is recorded in each component.

React renders these components to HTML during generation and hydrates only the
interactive islands. Shiki tokenizes at build time; no highlighter is downloaded
in the browser. Tailwind utilities are included without Preflight so the site
keeps its existing document layout. These dependencies belong to the website,
not the map library.

Use a code fence such as `ts title="main.ts"` to name a file. Fences without a
title show their language. A Markdown blockquote starting with `[!NOTE] Title`
or `[!IMPORTANT] Title`, followed by a blank quoted line and the message, becomes
an inline setup callout. Code blocks support clean copying, optional line numbers,
line wrapping and expanding long examples.

The header logo and favicon are generated from `../assets/icon.svg`, the chosen
Map Master mark. The standalone workspace includes the same mark as `icon.svg`
so it can be copied and built independently of this repository.

## Check and build

```sh
npm run test:docs
```

This builds the library and the production site, checks every generated local link
and section anchor, then uses the repository's Playwright Chromium workflow to exercise
search, copying, navigation, drawing, editing, a geometry tool and Undo through the
toolbar, GeoJSON error handling and export, every live example and a mobile layout.
It serves the site under `/map-master/` to check relative deployment paths. The
exact HTML/CSS/TypeScript printed in the quickstart is extracted, compiled against
the library build, built and exercised in a browser too.
The Vite development server is checked separately for loaded styles, maps and
drawing controls on both the overview and a nested guide.

The same command extracts the named component fences directly from
`../docs/frameworks.md` into an isolated application. React is compiled with
TypeScript, Vue with `vue-tsc` and its SFC compiler, Svelte with `svelte-check`
and both client/server compilers, and Angular with `ngc` and strict template
checking. Every component includes the published shared worker setup. The
check uses the library's public declarations, not source aliases or handwritten
framework stubs, and runs in CI on Node 22 and 24 before Pages deployment.
It checks component compilation, not a complete Next.js/Nuxt application or
each framework's browser lifecycle. Reports are kept in
`artifacts/documentation/frameworks/verification.json`.

After building the library, run only these checks with
`npm --prefix website run check:frameworks`. Full repository development uses
Node 22.22.3+ within 22.x or 24.15+ within 24.x to match Angular 22's compiler.
Install Chromium first with the root repository's documented Playwright setup.
Screenshots and the verification report are retained in `artifacts/documentation/`.

`npm run build:docs` builds without browser checks. The static output is
`website/dist/`. Deploy the whole directory to any static host; every guide has
its own HTML file and works on a direct visit without SPA rewrite rules.
Do not publish `node_modules`, `.generated`, or a developer's credentials.

CI installs this directory's lockfile separately and runs the site checks through
root `npm run check`. Website tooling is not a runtime library dependency and is
excluded from the published npm archive.

## Content and compatibility

Documentation is English, matching the library's existing guides. Search works
locally against the generated index. Code examples are copyable. The sidebar
collapses on small screens, dialogs support keyboard dismissal, and wide tables
scroll inside their article. Fonts are bundled locally with their licenses and have system fallbacks.

Examples show OpenStreetMap data from [OpenFreeMap](https://openfreemap.org/), which
needs no account or API key. If the tile service is unreachable, the examples fall
back to a plain background and keep working; the checks answer basemap requests
locally. Edits stay in the page: there is no telemetry or persistent storage.
The examples require WebGL and a secure context.

## Public hosting

The public site is https://jorisvdmije.github.io/map-master/ on GitHub Pages.
Repository Settings → Pages must use **GitHub Actions** as the publishing source.
The `github-pages` deployment environment permits only the protected `main` branch.

CI uploads `website/dist/` from the Node 22 job after all checks pass. The deploy
job publishes that same artifact only from `main`, after both Node 22 and Node 24
jobs and the published-beta workspace check succeed. Pull requests validate the
site and artifact without publishing.
Deployment uses GitHub's short-lived workflow token and OIDC; no separate hosting
secret is needed. Relative asset URLs support the `/map-master/` project path,
including direct visits to nested guide pages.

To redeploy, run the **CI** workflow manually on `main`. To roll back content,
revert the relevant change through a PR; the next successful `main` run publishes
the reverted site. A failed build or test leaves the last deployed site online.
Deployment status and the public URL appear in the workflow's **Deploy
documentation** job and the `github-pages` environment.
