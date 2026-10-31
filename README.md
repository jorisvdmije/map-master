<p align="center">
  <img src="assets/icon.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Map Master</h1>

<p align="center">
  Interactive geometry editing for <a href="https://maplibre.org/maplibre-gl-js/docs/">MapLibre GL JS</a>.<br>
  Draw, select, edit, snap, split, merge and transform GeoJSON features, with validation and undo/redo built in.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jorisvdmije/map-master"><img src="https://img.shields.io/npm/v/@jorisvdmije/map-master/beta?label=npm" alt="npm version"></a>
  <a href="https://github.com/jorisvdmije/map-master/actions/workflows/ci.yml"><img src="https://github.com/jorisvdmije/map-master/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <img src="https://img.shields.io/badge/types-TypeScript-3178c6" alt="TypeScript types included">
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@jorisvdmije/map-master" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://jorisvdmije.github.io/map-master/">Documentation</a> ·
  <a href="https://jorisvdmije.github.io/map-master/guides/quickstart.html">Quickstart</a> ·
  <a href="https://jorisvdmije.github.io/map-master/guides/examples.html">Live examples</a> ·
  <a href="docs/geometry-editor.md">API reference</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## Features

- **Draw** markers, lines and polygons, including holes. Enter finishes, Escape cancels and Backspace removes the last point.
- **Select** by click, Shift+click or Shift+drag rectangle, and list every shape under a point to choose between overlaps.
- **Edit vertices** with mouse, keyboard, touch or pen: drag corners and whole edges, insert midpoints, select and move groups.
- **Snap** to vertices and edges, **trace** existing boundaries and constrain new segments to **45°/90°** directions.
- **Move, duplicate and delete** single features or whole selections.
- **Geometry tools**: split, reshape, union, difference, intersection, buffer, line offset, simplification, rotation, scaling and shared-boundary editing, each with a live preview.
- **Validation**: self-intersecting, degenerate or otherwise invalid geometry is never committed.
- **Undo/redo** for every committed change, plus atomic multi-feature **transactions**.
- **GeoJSON in and out**, with stable feature IDs and preserved properties, including MultiLineString and MultiPolygon.
- **Styling**: theme the editor, style each feature from its properties and stripe overlapping areas.
- **Feature locks** keep reference geometry read-only while it stays usable for snapping.
- **Framework-agnostic** TypeScript with full type declarations. Your application owns the map, the UI and persistence.

## Installation

```sh
npm install @jorisvdmije/map-master maplibre-gl
```

[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) 6.15 or later is a peer dependency that
your application installs and configures. The package is ESM-only and ships its own type declarations.

## Quick start

```ts
import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeometryEditor } from '@jorisvdmije/map-master';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl); // MapLibre 6 loads its worker separately; this is the Vite syntax.

const map = new Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [4.9, 52.37],
  zoom: 12,
});

const drawButton = document.querySelector<HTMLButtonElement>('#draw')!;
const finishButton = document.querySelector<HTMLButtonElement>('#finish')!;
const undoButton = document.querySelector<HTMLButtonElement>('#undo')!;

map.once('load', () => {
  const editor = new GeometryEditor(map, { snapping: { enabled: true } });

  // Restore saved features, then start with an empty undo history.
  const saved = localStorage.getItem('features');
  if (saved) editor.importGeoJSON(JSON.parse(saved));
  editor.clearHistory();

  // Save after every committed change: drawing, edits, deletions, imports and undo/redo.
  editor.onDataChange(() => {
    localStorage.setItem('features', JSON.stringify(editor.exportGeoJSON()));
  });

  // Keep your own toolbar in sync with the editor.
  editor.onChange((state) => {
    undoButton.disabled = !state.canUndo;
    finishButton.disabled = !state.canFinish;
  });

  drawButton.onclick = () => editor.draw('Polygon');
  finishButton.onclick = () => editor.finish();
  undoButton.onclick = () => editor.undo();
});
```

The [complete quickstart](https://jorisvdmije.github.io/map-master/guides/quickstart.html) builds this
into a runnable Vite project step by step.

## Usage

### Drawing

```ts
editor.draw('Point');      // one click places a marker
editor.draw('LineString'); // click to add points
editor.draw('Polygon');    // click the first corner again, press Enter or call finish()

editor.finish(); // commit a valid draft and return the new feature
editor.cancel(); // discard the draft
```

### Selecting and editing

```ts
editor.select('parcel-12');             // or let users click shapes on the map
editor.selectMany(['parcel-12', 'road-3']);

editor.editSelected();                  // drag vertices, click midpoints to insert
editor.finish();                        // save, or cancel() to restore the original

editor.translateSelection([0.001, 0]);  // move by a longitude/latitude offset
editor.duplicateSelection([0.001, 0]);  // copy with new IDs
editor.deleteSelection();
```

### Geometry tools

Every tool starts from the current selection, shows a live preview and commits as a single undo step
with `finish()`, or is discarded with `cancel()`.

| Tool | Start | Adjust |
| --- | --- | --- |
| [Split](docs/splitting.md) a polygon in two | `splitSelected()` | draw a cutting line |
| [Reshape](docs/reshape.md) part of a boundary | `reshapeSelected()` | draw a new boundary section |
| [Union](docs/union.md) of polygons | `unionSelection()` | |
| [Difference](docs/difference.md) | `differenceSelection()` | first selected polygon is the target |
| [Intersection](docs/intersection.md) | `intersectionSelection()` | |
| [Buffer](docs/buffer.md) | `bufferSelection(meters)` | `setBufferDistance(meters)` |
| [Offset](docs/offset.md) a line | `offsetSelection()` | `setOffsetDistance(meters)` |
| [Simplify](docs/simplification.md) | `simplifySelection()` | `setSimplificationTolerance(meters)` |
| [Rotate](docs/rotation.md) | `rotateSelection(pivot?)` | drag the handle or `setRotationAngle(degrees)` |
| [Scale](docs/scaling.md) | `scaleSelection(pivot?)` | drag the handles or `setScaleFactor(factor)` |
| [Edit a shared boundary](docs/shared-boundaries.md) | `editSharedBoundary()` | drag the common vertices |
| [Draw a hole](docs/geometry-editor.md#polygon-holes) | `drawHole()` | click the hole's corners |

### Data and events

```ts
const data = editor.exportGeoJSON();   // committed features as a FeatureCollection
editor.importGeoJSON(featureCollection); // validated, appended atomically
editor.getFeature('parcel-12');         // one feature by ID

// Create, update and delete several features as one undo step.
editor.applyTransaction({
  update: [{ ...parcel, properties: { ...parcel.properties, owner: 'City' } }],
  delete: ['road-3'],
});

// One stream of committed changes, with before/after snapshots.
editor.onDataChange(({ source, changes }) => {
  for (const { before, after } of changes) {
    if (!before) api.create(after!);
    else if (!after) api.remove(before.id);
    else api.update(after);
  }
});

editor.undo();
editor.redo();
```

Invalid input throws a `GeoJSONImportError` with a machine-readable `code` and a JSON `path`, and leaves
the stored data unchanged. See [transactions and events](docs/transactions.md).

### Appearance and styling

```ts
const editor = new GeometryEditor(map, {
  appearance: {
    feature: { fillColor: '#2563eb', lineColor: '#1d4ed8' },
    selected: { lineWidth: 4 },
  },
  styling: {
    feature: (feature) => ({ shape: { fillColor: feature.properties?.zone === 'park' ? '#16a34a' : '#64748b' } }),
  },
});

editor.setAppearance({ vertex: { radius: 7 } }); // change it at any time
```

See [appearance](docs/appearance.md) and [feature styling](docs/feature-styling.md).

### Keyboard and mouse

| Input | Action |
| --- | --- |
| <kbd>Enter</kbd> | Finish the active drawing, edit or tool |
| <kbd>Escape</kbd> | Cancel the active tool, or clear the selection |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete the selection, remove the last drawn point or the selected vertices |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo |
| <kbd>Shift</kbd>+click / drag | Add shapes or vertices to the selection; drag a rectangle |
| <kbd>Alt</kbd> (hold) | Place freely, without snapping or angle constraints |

Shortcuts apply while the map has keyboard focus. Vertices can also be
[edited entirely with the keyboard](docs/keyboard-vertices.md).

## Compatibility

- MapLibre GL JS `^6.15.0` on a flat (Mercator) map, with 2D WGS84 coordinates.
- A modern browser with WebGL, in a secure context (HTTPS or `localhost`).
- Continuously tested in Chromium with mouse and keyboard, including emulated touch/pen vertex editing.
  The example application is also tested in Firefox and WebKit.

See [compatibility and limits](docs/compatibility.md) for the exact scope and performance profile.

## Documentation

- [Documentation site](https://jorisvdmije.github.io/map-master/) with a quickstart and live examples
- [GeometryEditor API reference](docs/geometry-editor.md)
- [All guides](docs/README.md): markers, multipart geometry, snapping, tracing, locks, styling and every geometry tool
- [Migration guide](docs/migration.md) and [changelog](CHANGELOG.md)

## Examples

Clone the repository and run:

```sh
npm ci
npm run dev            # full geometry playground on http://localhost:5173
npm run dev:workspace  # small app with saving, import/export, on http://127.0.0.1:5174
```

The [playground](docs/playground-workflow.md) demonstrates every tool. The
[area workspace](examples/workspace/README.md) shows a complete application with local persistence.

## Contributing

Bug reports and pull requests are welcome. Read the [contribution guide](CONTRIBUTING.md) for the
development setup, the checks to run and the architecture. Report security issues privately as described
in the [security policy](SECURITY.md).

## License

[MIT](LICENSE) © jorisvdmije. See [third-party notices](THIRD_PARTY_NOTICES.md) for runtime dependencies.
