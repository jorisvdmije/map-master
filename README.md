<img src="assets/icon.svg" width="64" height="64" alt="">

# geo

A TypeScript library in development for drawing and editing geometry on web maps.

## Status

Line and polygon drawing, single-feature selection, deletion, and vertex editing are implemented:
preview, validate, finish or cancel, select/deselect, delete, move/insert/remove vertices, and export committed features together
as GeoJSON through one GeometryEditor API.
The API is experimental. Import and undo/redo are planned. Code and contributor documentation use English.

## Try the demo

```sh
npm ci
npm run dev
```

Open <http://localhost:5173>. Choose **Draw a line**, click at least two different
positions, and press **Enter** or **Finish**. Press **Escape** or **Cancel** to
discard the current draft. Choose **Polygon** for an outline with at least three
corners; Enter, Finish, or clicking the first corner closes a valid ring.
**Export GeoJSON** downloads committed lines and polygons only.
The map can still be dragged and zoomed while drawing.
When idle, click a line or polygon to select it in blue. Click empty space, press
Escape with map focus, or choose **Deselect** to clear selection. Selection never
changes the exported geometry.
To remove the selected shape, use **Delete** or press Delete/Backspace with map
focus. Remaining geometry stays intact. Deletion has no undo in this milestone.

Select a shape and choose **Edit vertices**. Drag a corner to move it, click a
small midpoint to insert one, and use **Remove vertex** or Delete/Backspace to
remove the selected corner. **Save** or Enter commits valid changes; **Cancel**
or Escape restores the original. Export keeps the saved version during editing.

The demo uses OpenStreetMap tiles with attribution. Tiles are optional and load
after drawing is ready; use <http://localhost:5173/?basemap=off> for a demo with no
external map requests. Use an appropriate map provider for your own application.
The editor itself does not fetch map tiles or send geometry to a service.

See the [GeometryEditor API guide](docs/geometry-editor.md) and
[code walkthrough](docs/code-walkthrough.md). The earlier LineEditor API remains
available as a compatibility facade.

## Development

Use Node.js 22.13+ within the 22.x series, or Node.js 24.x, with npm. If you use
nvm, run `nvm use` to select the development major from `.nvmrc`.

```sh
npm ci
npx playwright install chromium
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the demo with live library source updates. |
| `npm run typecheck` | Check library, browser-independent core, tests, demo, and configuration. |
| `npm run lint` | Run ESLint with type-aware rules and no warnings allowed. |
| `npm run build` | Clean `dist/` and emit ESM JavaScript and declarations. |
| `npm test` | Run core behavior tests and test the packed library in an isolated consumer. |
| `npm run test:browser` | Build the package and run real Chromium interaction and demo tests. |
| `npm run build:demo` | Build the library and a deployable demo in `examples/basic/dist/`. |
| `npm run benchmark:polygon` | Measure validation on fixed polygon fixtures; see [baseline and limits](docs/performance.md). |
| `npm run benchmark:selection` | Measure core ID lookup and selected snapshots on fixed datasets. |
| `npm run benchmark:deletion` | Measure one core deletion plus export of all surviving features. |
| `npm run benchmark:editing` | Measure moving one corner of fixed polygon drafts. |
| `npm run check` | Run all type checks, linting, tests, and the production demo build. |
| `npm pack` | Build and create a local installable archive. |

Build output lives in `dist/`. MapLibre GL JS is a host-supplied peer dependency,
not bundled into the editor. Version 6.15.0 is tested; the peer range is `^6.15.0`.
The editor requires a modern browser with WebGL and a secure context (HTTPS or
localhost) for feature UUIDs. Desktop mouse and keyboard input in Chromium is
tested; touch and other browser engines are not yet validated. The working
package name is `@geo/editor`; it is private and unpublished while the name,
license, and public API are being established.

The tests install an actual npm archive into a temporary directory, import it in
Node.js, and compile a consumer in both NodeNext and Bundler resolution modes.
They also check that internal build paths are not public imports and development
files are excluded from the archive. Temporary consumer files are removed after
the tests. Chromium tests exercise real MapLibre rendering, pointer and keyboard
input, cancellation, map gestures, style replacement, event isolation, teardown,
and the demo's export controls. Tests use local styles and need no tile service.

CI installs Chromium and runs `npm ci` and `npm run check` on Node.js 22 and 24 for
pull requests and pushes to `main`. The workflow will run once the repository is
hosted on GitHub with Actions enabled; required branch checks need configuration
in the repository settings. On Linux, `npx playwright install --with-deps chromium`
also installs the system libraries needed by the browser.

MapLibre 6.15's transitive declarations currently contain NodeNext import errors.
The browser build and consumer fixtures use `skipLibCheck` to skip checking
dependency declarations; our source and API usage remain strictly checked. The
core has its own check without DOM types or `skipLibCheck`.

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
