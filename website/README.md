# Map Master documentation website

A static, searchable documentation site with a complete quickstart and three
interactive examples: drawing, editing/Undo, and GeoJSON import/export.
The examples install the published `@jorisvdmije/map-master@0.1.0-beta.0` package;
they do not alias repository source. Updating that version is an explicit change.

## Develop

From the repository root:

```sh
npm ci --prefix website
npm run dev:docs
```

Open http://127.0.0.1:5180. Vite reloads TypeScript/CSS changes. Restart the dev
command after changing Markdown to regenerate the HTML pages and search index.

The existing guides live in `docs/*.md`. New onboarding content lives in
`website/content/`. `scripts/content.mjs` converts both into static HTML and
rewrites guide links to site routes. Source and project links that are not hosted
as guide pages point to GitHub. Generated files are ignored by Git.

## Check and build

```sh
npm run test:docs
```

This builds the production site, checks every generated local link and section
anchor, then uses the repository's Playwright Chromium workflow to exercise
search, copying, navigation, drawing, editing, Undo, GeoJSON error handling and
export, plus a mobile layout check. It serves the site under `/map-master/` to
check relative deployment paths. The exact HTML/CSS/TypeScript printed in the
quickstart is extracted, compiled, built and exercised in a browser too.
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

Examples use a small fictional map bundled with the site, with no tile service,
API key, telemetry or persistent storage. They require WebGL and a secure context.
MapLibre is loaded only on pages containing an interactive example. Pages and
reference content remain readable without JavaScript; search and examples need it.
The site does not expand the library's documented browser/device support matrix.

The optional Sites preview is a separate private deployment of the static output;
its hosting identity and credentials are not part of this public source repository.
Public hosting or a custom domain can be configured separately.
