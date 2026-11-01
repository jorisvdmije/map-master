# Contributing

Thank you for helping improve Map Master. Bug reports and feature requests go to
[GitHub Issues](https://github.com/jorisvdmije/map-master/issues); report
vulnerabilities privately as described in the [security policy](SECURITY.md).

## Development setup

Use Node.js 22.22.3 or later within 22.x, or Node.js 24.15 or later within 24.x
(`nvm use` selects the version in `.nvmrc`), with npm. The documentation checks
use Angular 22's compiler, which determines these development minimums.

```sh
git clone https://github.com/jorisvdmije/map-master.git
cd map-master
npm ci
npm ci --prefix website
npx playwright install chromium   # on Linux: npx playwright install --with-deps chromium
npm run check
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the playground on <http://localhost:5173> with live library source. Add `?basemap=off` to avoid tile requests. |
| `npm run dev:workspace` | Pack the library and run the [area workspace](examples/workspace/README.md) on <http://127.0.0.1:5174>. |
| `npm run dev:docs` | Start the documentation site on <http://127.0.0.1:5180>. |
| `npm run typecheck` | Type-check the library, the browser-independent core, tests, examples and configuration. |
| `npm run lint` | ESLint with type-aware rules and architectural import rules; no warnings allowed. |
| `npm test` | Core tests in Node.js, plus packing and installing the library in an isolated consumer. |
| `npm run test:browser` | Build, then run the full MapLibre suite and shared MapLibre/Mapbox adapter scenarios in Chromium. |
| `npm run test:workspace` | Install the packed library in the example application and run its acceptance tests and performance budgets. |
| `npm run test:docs` | Build and check the documentation site. |
| `npm run check` | All of the above plus the production demo build. Run it before opening a pull request. |
| `npm run build` | Emit ESM JavaScript and declarations to `dist/`. |
| `npm run benchmark -- <name>` | Run operation benchmarks; without a name it lists them. |
| `npm run release:prepare` | Pack one candidate archive and run the full checks against it. |

[Testing](docs/testing.md) describes every test level, the cross-browser and
published-release checks and the performance budgets.

## Workflow

1. Describe the behavior and acceptance criteria in an issue.
2. Create a short-lived branch from the latest `main`, such as `feat/trim-lines` or
   `fix/cancel-drawing`.
3. Implement the smallest complete change, including tests for failure and
   cancellation paths and the documentation it affects.
4. Open a pull request that describes the behavior, the validation performed and
   known limitations, and add user-visible changes to the **Unreleased** section of
   the [changelog](CHANGELOG.md).
5. `main` is protected: both required checks (Node.js 22 and 24) must pass on the
   latest commit and conversations must be resolved. Squash-merge one logical change.

This follows [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow).

## Where to make a change

Start with the [architecture](docs/architecture.md) and the
[code walkthrough](docs/code-walkthrough.md#where-to-make-a-change). For a new operation:

1. Define its input, output, failure conditions and undo behavior in a guide under `docs/`.
2. Put geometry calculations in a pure module in `src/core/`. Add coordination to
   `DrawingSession` only where selection, drafts or committed data are involved, and
   commit changes through the transaction boundary. Previews never mutate stored features.
3. Expose the public method on `GeometryEditor` with TSDoc, and put pointer or keyboard
   handling in a focused module in `src/maplibre/`. Every gesture owns its cancellation
   and cleanup.
4. Emit events after committing, through `EditorEvents`. Export new public types from
   `src/index.ts` and use them in the consumer fixture in `tests/fixtures/consumer/`.
5. Demonstrate the capability in the playground (`examples/basic`) through the public
   API, and add core and browser tests, plus a benchmark for performance-sensitive work.

`src/core/` must not import MapLibre, Mapbox, the GL boundary, the DOM or the public entry point, and examples
must use only the public package entry; ESLint enforces both rules.

## Definition of done

- Public behavior and limitations are documented, with an example where useful.
- `npm run check` passes.
- Tests cover observable behavior and regressions, including invalid input.
- Interaction changes are exercised in a real browser, including cancel and cleanup.
- The package exposes only the intended API and its declarations.
- New dependencies have a documented purpose and a compatible license, and are added
  to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when they ship at runtime.
- Performance-sensitive changes include measurements on a fixed dataset.

Documentation-only changes need a link check (`npm run test:docs` for pages rendered
on the site), not the full suite.

## Testing tips

- Put Node.js tests in `tests/` and real MapLibre tests in `tests/browser/`. Use local
  styles, never tile services.
- Wait for rendered geometry before picking it: subscribe to the map's `idle` event
  before importing, await it, then assert the rendered features. Raising timeouts
  does not make a map ready.
- The browser suite runs at most four workers to limit competition between
  software-rendered WebGL maps.
- Run the package test through `npm test`; it needs npm's CLI path. It installs the
  archive offline with the example application's lockfile, so the root `npm ci`
  must have cached the same third-party versions.
- After changing the library's dependencies or version, run `npm run lock:workspace`
  and review the example lockfile.
- On a budget failure, read `artifacts/beta-budgets.json` before changing anything;
  never raise a threshold or retry until green without understanding the cause.

## Dependencies

Development tools are pinned in `package.json` and `package-lock.json`. Update
TypeScript and typescript-eslint together. MapLibre is a pinned development
dependency for testing and an optional peer for consumers. Mapbox GL JS is also
pinned for adapter tests and is an optional peer. The host installs its chosen
renderer. Shared GL code imports neither renderer.

Runtime dependencies are deliberately few. `@types/geojson` supplies the shared
map boundary declarations without requiring either renderer's types:

- [`robust-predicates`](https://github.com/mourner/robust-predicates) (Unlicense)
  provides exact orientation tests for polygon validation and winding.
- [`polygon-clipping`](https://github.com/mfogel/polygon-clipping) (MIT) provides the
  polygon overlay behind union, difference, intersection, buffer, shared-boundary
  checks and overlap stripes. Every result must still pass the library's own,
  stricter topology validation.

## Releases

Maintainers follow the [release process](docs/releases.md). Record user-visible
changes in the [changelog](CHANGELOG.md) and breaking changes in the
[migration guide](docs/migration.md).
