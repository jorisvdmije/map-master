<img src="assets/icon.svg" width="64" height="64" alt="">

# geo

A TypeScript library in development for drawing and editing geometry on web maps.

## Status

Line and polygon drawing (including holes), single and multiple feature selection, group movement and duplication, deletion, vertex editing, GeoJSON import, undo/redo, and drawing/editing snapping are implemented:
preview, validate, finish or cancel, select/deselect, delete, move/insert/remove vertices, and export committed features together
as GeoJSON through one GeometryEditor API.
[Atomic transactions](docs/transactions.md) can create, update, and delete multiple
features as one validated batch and one undo action.
[Polygon union](docs/union.md) previews and merges selected polygons into one feature with atomic Undo.
[Boundary tracing](docs/tracing.md) follows existing lines and rings while drawing, with route preview and whole-section correction.

[Polygon reshape](docs/reshape.md) replaces one boundary section of a single-ring polygon, with side choice, preview and atomic Undo.
[Polygon intersection](docs/intersection.md) keeps the common filled area of all selected polygons, with a cancellable preview and atomic Undo.
[Polygon difference](docs/difference.md) subtracts selected cutting shapes from the first selected target, preserving cutters and supporting empty results.
[Split Features](docs/splitting.md) divides a selected polygon into two independent features.
[Group movement](docs/geometry-editor.md#move-selected-shapes) previews a selected group and records the move as one undoable action.
[Duplication](docs/geometry-editor.md#duplicate-selected-shapes) creates independent copies with new IDs and one Undo for the whole group.
[Multipart geometry](docs/multipart.md) supports imported or transaction-created MultiLineString/MultiPolygon features, with component/ring editing and whole-feature history.
The API is experimental. Code and contributor documentation use English.

## Try the demo

```sh
npm ci
npm run dev
```

Open <http://localhost:5173>. Choose **Draw a line**, click at least two different
positions, and press **Enter** or **Finish**. Press **Escape** or **Cancel** to
discard the current draft. Choose **Polygon** for an outline with at least three
corners; Enter, Finish, or clicking the first corner closes a valid ring.
For multipart examples, download the sample in the data panel and import it. Select a feature and use **Part to edit** to choose a component.
Select a polygon and choose **Draw a hole** to create an interior ring; choose a ring to edit or delete it.
Choose **Duplicate** to copy the selection with a small offset; the copies become selected.
Drag any selected shape to move the selection together; release saves, Escape cancels, and Undo restores the whole group.
**Export GeoJSON** downloads committed lines and polygons only.
The map can still be dragged and zoomed while drawing.
**Snap to vertices & edges** is enabled in the demo: drawing within 18 CSS pixels
of an existing corner or edge shows a purple indicator and places the point there.
Corners take priority. This also works while dragging existing corners or new
midpoints in **Edit vertices**. The edited shape is excluded as a target. Hold
**Alt** to place freely or turn off the checkbox.
Library integrations opt in with `{ snapping: { enabled: true } }`; see the
[snapping API](docs/geometry-editor.md#snapping-while-drawing).
When idle, click a line or polygon to select it in blue. Click empty space, press
Escape with map focus, or choose **Deselect** to clear selection. Selection never
changes the exported geometry. **Shift+click** toggles a shape; **Shift+drag**
adds shapes intersecting the blue rectangle. The Delete button removes a group
as one undoable action. Edit vertices and Split polygon require one selected shape.
See the [selection API](docs/geometry-editor.md#selection).
To remove the selected shape, use **Delete** or press Delete/Backspace with map
focus. Remaining geometry stays intact. Undo restores a deleted shape while its action remains in history.

Select two or more polygons with **Shift+click**, choose **Merge polygons**, review
the preview, then **Apply merge**. Escape cancels; Undo restores every original.
The first selected feature supplies the retained ID and properties.

Select a polygon and choose **Split polygon**. Place an outside-to-outside cutting
line across two edges, review the two colored parts, then press Enter or
**Apply split**. Backspace removes the last cut point; Escape cancels.
Cuts through existing corners or along edges are not supported in this first version.

Select a shape and choose **Edit vertices**. Drag a corner to move it, click a
small midpoint to insert one, and use **Remove vertex** or Delete/Backspace to
remove the selected corner. **Save** or Enter commits valid changes; **Cancel**
or Escape restores the original. Export keeps the saved version during editing.

Use **Import GeoJSON** to add a `.geojson`/`.json` file with supported lines and
polygons (up to 5 MB in the demo). IDs and properties are preserved. Invalid
files and duplicate IDs leave current data untouched. The map fits imported shapes.

Use **Undo**/**Redo** to reverse or replay saved actions, including an entire
import. With map focus: Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes.
Finish or cancel an active drawing/edit first. The default history retains
100 actions; applications can configure `historyLimit` or clear it explicitly.

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
| `npm run benchmark:trace` | Measure source-route preview, batch append/validation, confirmation and Undo. |
| `npm run benchmark:reshape` | Measure route validation, reshape confirmation and Undo for increasing polygon sizes. |
| `npm run benchmark:intersection` | Measure common-area preview, commit and Undo for large selections and multipart results. |
| `npm run benchmark:difference` | Measure subtraction preview, commit and Undo with holes and multipart results. |
| `npm run benchmark:union` | Measure polygon union preview, atomic commit and Undo on overlapping/disjoint selections. |
| `npm run benchmark:multipart` | Measure import, component editing and snapping index construction for multipart polygons. |
| `npm run benchmark:holes` | Measure import and ring edits on polygons with fixed hole counts. |
| `npm run benchmark:polygon` | Measure validation on fixed polygon fixtures; see [baseline and limits](docs/performance.md). |
| `npm run benchmark:duplication` | Measure group duplication and exact undo/redo on fixed datasets. |
| `npm run benchmark:translation` | Measure group preview, validated commit, and undo on fixed datasets. |
| `npm run benchmark:selection` | Measure core ID lookup and selected snapshots on fixed datasets. |
| `npm run benchmark:deletion` | Measure one core deletion plus export of all surviving features. |
| `npm run benchmark:editing` | Measure moving one corner of fixed polygon drafts. |
| `npm run benchmark:import` | Measure atomic imports of fixed line and polygon datasets. |
| `npm run benchmark:history` | Measure undoing a middle deletion, with and without export. |
| `npm run benchmark:snapping` | Measure projected index building and nearby-point queries on fixed polygon grids. |
| `npm run benchmark:transactions` | Measure mixed batch commits and exact undo on fixed datasets. |
| `npm run benchmark:split` | Measure splitting and result validation on fixed polygon fixtures. |
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

## Finding your way around

- **Use the library:** [GeometryEditor API](docs/geometry-editor.md) and the
  [integration example](examples/basic/main.ts).
- **Understand or extend it:** [code map](docs/code-walkthrough.md#where-to-make-a-change),
  [architecture](docs/architecture.md) and [contribution guide](CONTRIBUTING.md).
- **Find a contract or measurement:** [documentation index](docs/README.md).
- **Choose the next feature:** [incremental roadmap](docs/roadmap.md).

## Direction

- Build one small, tested capability at a time.
- Keep geometry and editing state independent of the map renderer and UI framework.
- Start with one package and one MapLibre example.
- Use GeoJSON for data exchange; applications own persistence and authorization.
- Measure performance and document supported behavior before claiming production readiness.

See the [architecture guide](docs/architecture.md), [incremental roadmap](docs/roadmap.md),
and [contribution workflow](CONTRIBUTING.md).

## License

An open-source license must be selected and added before the first public release.
No project license has been added yet.
