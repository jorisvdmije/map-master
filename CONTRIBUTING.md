# Contributing

## Small changes, short-lived branches

Use one branch for one reviewable change, including its relevant tests and docs.
A feature may need several sequential changes. Branches are temporary; completed
features live together on `main`.

1. Define the behavior and acceptance criteria in an issue or the roadmap.
2. Create a branch from the latest `main`, such as `feat/draw-line` or `fix/cancel-drawing`.
3. Implement the smallest complete change. Include validation of failure and cancellation paths.
4. Open a pull request describing the behavior, validation performed, and known limitations.
5. Review the change and require passing checks before merging into `main`.
6. Delete the merged branch. Start the next change from the updated `main`.

Prefer squash merges for a single logical change. Use release tags for versions.
Create branches as work starts; do not create all roadmap branches in advance.
For a solo maintainer, use the same PR checklist and review the diff before merging.

This follows [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow).
The repository currently has no remote or automated branch protection configured.
When hosted, configure required checks and review rules appropriate to the team.

## Finding the right place to change

Start with the [code map](docs/code-walkthrough.md#where-to-make-a-change) and
[current architecture](docs/architecture.md). Use the [documentation index](docs/README.md)
to find integration contracts and performance baselines.

For a new operation:

1. Define its input, output, failure conditions and Undo behavior in the relevant
   API guide. Check the supported geometry subset before adding a new shape type.
2. Put geometry calculations in a pure core module. Add session coordination only
   where selection, drafts or committed data are involved. Reuse the transaction
   boundary for group changes; previews must not mutate stored features.
3. Wire the public method through `GeometryEditor`. Add pointer/keyboard handling
   in the appropriate input module. Each gesture owns cancellation and cleanup.
4. Choose the documented event contract and notify through `EditorEvents` after
   committing. Update public types/exports and the consumer fixture when needed.
5. Demonstrate the capability through the same public API in `examples/basic`,
   and add core/browser tests plus a benchmark for performance-sensitive work.

Keep a single package and the current two source directories until a concrete
integration needs a new boundary. Extract modules by responsibility, such as
keyboard input or transaction validation; do not create a folder per button or
one branch per file. Finish one reviewable behavior before starting the next.

## Definition of done for code changes

- Public behavior and limitations are documented, with a usable example when applicable.
- Type checking, linting, relevant tests, and the package build pass.
- Tests cover observable behavior and regressions, including invalid inputs where relevant.
- Interaction changes are exercised in a real browser, including cancel and cleanup paths.
- The package exposes only the intended API and its TypeScript declarations.
- New dependencies have a documented purpose and compatible licensing.
- Performance-sensitive changes include comparable measurements on a fixed dataset.

Run `npm ci` and `npx playwright install chromium` after cloning, then
`npm run check` before submitting a code change. On Linux, use
`npx playwright install --with-deps chromium` to include system dependencies.
The check command includes type checking, linting, core/package/browser tests,
and the production demo build. Package tests build through the `prepack` hook. See the
[README](README.md#development) for individual commands and supported Node versions.
Documentation-only changes need link and diff checks, not application tests.

Add behavior tests under `tests/` using Vitest. Consumer fixtures are checked
inside their isolated installation instead of against repository source files.
The package integration test uses npm's CLI path, so invoke it through `npm test`.
Put real MapLibre interaction tests in `tests/browser/`, run with
`npm run test:browser`. Use local styles so tests do not depend on tile services.
The browser suite caps parallel workers at four to limit competition between
software-rendered WebGL maps. Wait for rendered geometry before picking it;
increasing test timeouts alone does not establish that the map is ready.
The complete demo test consumes the built package and checks its buttons and
download payload. During development, `npm run dev` resolves the editor to source
for live updates; the production demo resolves it through package exports.

Tool dependencies are pinned in `package.json` and `package-lock.json`. TypeScript
6.0 is intentionally used because the installed typescript-eslint release does
not yet support TypeScript 7. Update the compiler and lint tooling together.
TypeScript builds the package, ESLint/typescript-eslint check code, Vitest runs
tests, and `@types/node` supplies types for development tools only. These are
development dependencies, not runtime dependencies for consumers. Vite serves
and builds the demo, and Playwright plus the Vitest browser provider exercise
real Chromium interactions. MapLibre is both a pinned development dependency
for verification and a peer dependency supplied by consuming applications;
`@types/geojson` provides the namespace expected by its declarations.

The runtime dependency `robust-predicates` (3.0.3, Unlicense) supplies robust
orientation predicates for polygon validation and winding. Its purpose and the
validation policy are described in the [GeometryEditor guide](docs/geometry-editor.md).

The runtime dependency `polygon-clipping` (0.15.7, MIT) supplies polygon overlay
behind `core/union.ts`, `core/difference.ts` and `core/intersection.ts`, sharing `core/polygon-overlay.ts` validation. `core/shared-boundary.ts` also uses
its intersection calculation to reject overlapping input/output polygon pairs. It adds `splaytree` (MIT) and reuses `robust-predicates`.
Results must pass our stricter topology validator; see the [union](docs/union.md), [difference](docs/difference.md) and [intersection](docs/intersection.md) contracts.

## Public API and releases

Start with prereleases and explicitly document that the API is experimental.
Record user-visible changes and migration steps. Define a compatibility policy
before 1.0, including supported browsers, MapLibre versions, and deprecation rules.

Before publishing, add a license, security reporting instructions, maintainer
contacts, and a reproducible release workflow. A completed milestone is not
automatically a production-readiness claim.
