<img src="assets/icon.svg" width="64" height="64" alt="">

# geo

A planned open-source TypeScript library for drawing and editing geometry on web maps.

## Status

The development foundation is implemented: a strict TypeScript build, linting,
package integration tests, and a GitHub Actions workflow. The package currently
has an empty public entry point; drawing and editing are not implemented yet.
The initial target is MapLibre GL JS; the first working milestone is drawing a
line and exporting it as GeoJSON. Code and contributor documentation use English.

## Development

Use Node.js 22.13+ within the 22.x series, or Node.js 24.x, with npm. If you use
nvm, run `nvm use` to select the development major from `.nvmrc`.

```sh
npm ci
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check library, tests, and test configuration with TypeScript. |
| `npm run lint` | Run ESLint with type-aware rules and no warnings allowed. |
| `npm run build` | Clean `dist/` and emit ESM JavaScript and declarations. |
| `npm test` | Build and pack the library, then test an isolated consuming application. |
| `npm run check` | Run type checking, linting, and tests (including the package build). |
| `npm pack` | Build and create a local installable archive. |

Build output lives in `dist/`. There are no runtime dependencies yet. The working
package name is `@geo/editor`; it is private and unpublished while the name,
license, and public API are being established.

The tests install an actual npm archive into a temporary directory, import it in
Node.js, and compile a consumer in both NodeNext and Bundler resolution modes.
They also check that internal build paths are not public imports and development
files are excluded from the archive. Temporary consumer files are removed after
the tests. Browser interaction tests will be introduced with map interactions.

CI runs the same `npm ci` and `npm run check` commands on Node.js 22 and 24 for
pull requests and pushes to `main`. The workflow will run once the repository is
hosted on GitHub with Actions enabled; required branch checks need configuration
in the repository settings.

## Direction

- Build one small, tested capability at a time.
- Keep geometry and editing state independent of the map renderer and UI framework.
- Start with one package and one MapLibre example.
- Use GeoJSON for data exchange; applications own persistence and authorization.
- Measure performance and document supported behavior before claiming production readiness.

See the [architecture proposal](docs/architecture.md), [incremental roadmap](docs/roadmap.md),
and [contribution workflow](CONTRIBUTING.md).

## License

An open-source license must be selected and added before the first public release.
No project license has been added yet.
