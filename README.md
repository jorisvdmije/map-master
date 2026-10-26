<img src="assets/icon.svg" width="64" height="64" alt="">

# Map Master

[Point markers](docs/markers.md) support one-click placement, selection, movement, import/export, locks and Undo/Redo. Choose **Marker** in the playground or **+ Marker** in the workspace.

A TypeScript library in development for drawing and editing geometry on web maps.

## Status

[Beta compatibility and performance gates](docs/beta-budgets.md) now check a fixed
1,000-feature installed-consumer workload and repeated map/editor teardown. The
verified target is desktop Chromium with mouse/keyboard and MapLibre 6.15.0.

Marker placement and line/polygon drawing (including holes), single and multiple feature selection, group movement and duplication, deletion, vertex editing, GeoJSON import, undo/redo, and drawing/editing/movement snapping are implemented:
preview, validate, finish or cancel, select/deselect, delete, select groups of vertices with Shift+click or a rectangle, move/remove corners together, drag whole edges, insert vertices, and export committed features together
as GeoJSON through one GeometryEditor API.
[Atomic transactions](docs/transactions.md) can create, update, and delete multiple
features as one validated batch and one undo action.
[Polygon union](docs/union.md) previews and merges selected polygons into one feature with atomic Undo.
[Fixed drawing angles](docs/drawing-constraints.md) optionally constrain free pointer placement to 45° or 90° map directions, with Alt bypass and exact snapping priority.
[Line offsets](docs/offset.md) move open lines left/right with a signed Mercator-meter distance, limited miter joins, validated preview and atomic Undo.
[Selection buffers](docs/buffer.md) turn selected lines/polygons into outward zones with a positive Mercator-meter distance, validated preview and atomic Undo.
[Selection simplification](docs/simplification.md) removes detail with a tolerance slider or exact Mercator-meter input, vertex reduction counts, an original-outline comparison and atomic Undo.
[Selection scaling](docs/scaling.md) resizes mixed selections around a movable pivot, with proportional corner handles, independent horizontal/vertical side handles, numeric preview and atomic Undo.
[Selection rotation](docs/rotation.md) rotates mixed selections by dragging a handle or entering an angle, with a screen-aligned selection frame, movable snapping pivot, Shift angle steps and atomic Undo.

[Shared-boundary editing](docs/shared-boundaries.md) updates two adjacent single-ring polygons together, with fixed junctions and atomic Undo.

[Boundary tracing](docs/tracing.md) follows existing lines and rings while drawing, with route preview and whole-section correction.

[Polygon reshape](docs/reshape.md) replaces one boundary section of a single-ring polygon, with side choice, preview and atomic Undo.
[Polygon intersection](docs/intersection.md) keeps the common filled area of all selected polygons, with a cancellable preview and atomic Undo.
[Polygon difference](docs/difference.md) subtracts selected cutting shapes from the first selected target, preserving cutters and supporting empty results.
[Split Features](docs/splitting.md) divides a selected polygon into two independent features.
[Group movement](docs/geometry-editor.md#move-selected-shapes) snaps a fixed anchor to other shapes, supports Shift axis locking and a live displacement ruler, and records the move as one undoable action.
[Duplication](docs/geometry-editor.md#duplicate-selected-shapes) creates independent copies with new IDs and one Undo for the whole group.
[Multipart geometry](docs/multipart.md) supports imported or transaction-created MultiLineString/MultiPolygon features, with component/ring editing and whole-feature history.
The API is experimental. Code and contributor documentation use English.

[Editor appearance](docs/appearance.md) configures feature/selection colors,
outlines, draft fills and editing/snap/pivot markers through constructor options
or live `setAppearance()` patches. Both demos have a **Map colors** selector.
Settings survive map style changes and leave GeoJSON and Undo history unchanged.

[Feature locks](docs/feature-locks.md) protect reference geometry across editing,
transactions, pointer/keyboard actions and Undo/Redo while retaining snapping.
Both demos offer session lock/unlock controls.

## Try the demo

For the smaller **Area workspace** application, run `npm run dev:workspace`
after `npm ci` and open <http://127.0.0.1:5174>. Draw/edit areas and routes,
change names, save/reopen locally, and exchange GeoJSON files. It installs a
fresh npm archive outside this checkout and uses only public APIs. See the
[beta integration guide](docs/beta.md) for acceptance checks and release gates.
This is a local beta preview; the package remains private and unpublished.
The [release guide](docs/releases.md), [changelog](CHANGELOG.md) and
[migration policy](docs/migration.md) cover preparation for the public beta.

For the full geometry playground:

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
**Export GeoJSON** downloads committed markers, lines and polygons.
The map can still be dragged and zoomed while drawing.
**Snap to vertices & edges** is enabled in the demo: drawing within 18 CSS pixels
of an existing corner or edge shows a purple indicator and places the point there.
Corners take priority. This also works while dragging existing corners or new
midpoints in **Edit vertices**. The edited shape is excluded as a target. Hold
**Alt** to place freely or turn off the checkbox.
Library integrations opt in with `{ snapping: { enabled: true } }`; see the
[snapping API](docs/geometry-editor.md#snapping-while-drawing).
When idle, click a marker, line or polygon to select it in blue. Click empty space, press
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

Select a polygon and choose **Split polygon**. Start and end the cutting line on
its edges/corners or outside, passing through its interior. Review the two colored
parts, then press Enter or **Apply split**. Backspace removes the last cut point;
Escape cancels. Nearby target edges take priority over neighbouring shapes, which
remain unchanged. Following an edge or touching it midway is unsupported.

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
| `npm run dev:workspace` | Pack and install the library in a standalone area-workspace app on port 5174. |
| `npm run test:budgets` | Run installed-browser latency and lifecycle-memory gates; write `artifacts/beta-budgets.json`. |
| `npm run test:workspace` | Build an isolated installed consumer; exercise production CRUD/storage/recovery and development rendering in Chromium. |
| `npm run lock:workspace` | Refresh the example lockfile after dependency/version changes; review before committing. |
| `npm run release:prepare` | Pack once, run the full checks against that candidate and retain its archive, checksum and reports. |
| `npm run typecheck` | Check library, browser-independent core, tests, demo, and configuration. |
| `npm run lint` | Run ESLint with type-aware rules and no warnings allowed. |
| `npm run build` | Clean `dist/` and emit ESM JavaScript and declarations. |
| `npm test` | Run core behavior tests and test the packed library in an isolated consumer. |
| `npm run test:browser` | Build the package and run real Chromium interaction and demo tests. |
| `npm run build:demo` | Build the library and a deployable demo in `examples/basic/dist/`. |
| `npm run benchmark:offset` | Measure line-offset entry, validated preview, commit and Undo. |
| `npm run benchmark:buffer` | Measure buffer entry, validated preview, commit and Undo. |
| `npm run benchmark:simplification` | Measure simplification entry, validated preview, commit and Undo. |
| `npm run benchmark:constraints` | Measure angle resolution and anchor lookup across draft sizes. |
| `npm run benchmark:scaling` | Measure scale entry, validated preview, commit and Undo for polygons and groups. |
| `npm run benchmark:rotation` | Measure rotation entry, validated preview, commit and Undo for polygons and groups. |
| `npm run benchmark:shared-boundary` | Measure shared-chain entry, two-polygon preview validation, atomic commit and Undo. |
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
| `npm run benchmark:editing` | Measure atomic movement of corner groups in fixed polygon drafts. |
| `npm run benchmark:vertex-selection` | Measure draft rectangle picking and selection with a deterministic projection. |
| `npm run benchmark:import` | Measure atomic imports of fixed line and polygon datasets. |
| `npm run benchmark:history` | Measure undoing a middle deletion, with and without export. |
| `npm run benchmark:snapping` | Measure projected index building and nearby-point queries on fixed polygon grids. |
| `npm run benchmark:transactions` | Measure mixed batch commits and exact undo on fixed datasets. |
| `npm run benchmark:split` | Measure splitting and result validation on fixed polygon fixtures. |
| `npm run check` | Run all type checks, linting, tests, the demo build and isolated workspace acceptance. |
| `npm pack` | Build and create a local installable archive. |

Build output lives in `dist/`. MapLibre GL JS is a host-supplied peer dependency,
not bundled into the editor. Version 6.15.0 is tested; the peer range is `^6.15.0`.
The editor requires a modern browser with WebGL and a secure context (HTTPS or
localhost) for feature UUIDs. Desktop mouse and keyboard input in Chromium is
tested; touch and other browser engines are not yet validated. The package is
`@jorisvdmije/map-master`, licensed under MIT. Candidate `0.1.0-beta.0` remains
private and unpublished pending the [release gates](docs/releases.md).

The tests install an actual npm archive into a temporary directory, import it in
Node.js, and compile a consumer in both NodeNext and Bundler resolution modes.
They also check that internal build paths are not public imports and development
files are excluded from the archive. Temporary consumer files are removed after
the tests. Chromium tests exercise real MapLibre rendering, pointer and keyboard
input, cancellation, map gestures, style replacement, event isolation, teardown,
and the demo's export controls. Tests use local styles and need no tile service.

CI installs Chromium and runs `npm ci` and `npm run release:prepare` (including
`npm run check`) on Node.js 22 and 24 for
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

Map Master is licensed under the [MIT License](LICENSE), copyright 2026
jorisvdmije. See [third-party notices](THIRD_PARTY_NOTICES.md) for runtime dependencies.

## Maintainer and support

Maintained by [@jorisvdmije](https://github.com/jorisvdmije). Use
[GitHub Issues](https://github.com/jorisvdmije/map-master/issues) for ordinary bug
reports and feature requests. Report vulnerabilities confidentially through the
channel and setup status in [SECURITY.md](SECURITY.md). The repository and its
reporting channels must still be activated before public distribution.
