# Point markers

`GeometryEditor` supports 2D GeoJSON `Point` features alongside lines and polygons.
Markers are circular map symbols, rendered in one shared MapLibre circle layer;
the editor does not create a DOM element for each committed marker.

```ts
import { GeometryEditor, type PointFeature } from '@geo/editor';

const editor = new GeometryEditor(map, { snapping: { enabled: true } });
editor.draw('Point'); // Preview follows the pointer; one click commits and exits.

const marker: PointFeature = {
  type: 'Feature', id: 'meeting-point', properties: { name: 'Meeting point' },
  geometry: { type: 'Point', coordinates: [4.895, 52.372] },
};
editor.importGeoJSON(marker); // Or applyTransaction({ create: [marker] }).
editor.select('meeting-point');
editor.editSelected();
editor.moveVertex(0, [4.896, 52.373]);
editor.finish(); // One update, retaining the ID and properties.
```

## Interaction and data

- `draw('Point')` enters `draw-point`. Clicking places exactly one marker, emits
  `onCreate`, and returns to idle. Activate the tool again for another marker.
  Escape/Cancel before placement leaves data and history unchanged. An empty
  marker draft cannot be finished. Modifiers and double clicks follow the existing
  drawing input policy.
- Placement and vertex dragging support snapping to committed points, line
  vertices/edges and polygon boundaries. Alt bypasses snapping. Other tools can
  snap to markers as vertices; markers supply no edges or tracing path.
  Angle constraints and tracing do not alter marker placement.
- Click selection, Shift+click, rectangle selection and mixed group dragging work
  normally. A selected marker can be dragged directly. Escape during a drag
  restores the original position; release commits one transaction.
- `editSelected()` enters `edit-point` with one vertex at index 0. Drag it or call
  `moveVertex(0, coordinate)`, then Finish/Save. Cancel restores the original;
  saving an unchanged position creates no history action. `insertVertex()` leaves
  a marker unchanged; `removeVertex(0)` returns false. Use deletion to remove the feature.
- Transactions, import/export, typed IDs, nested properties, duplication,
  deletion, Undo/Redo and host-owned locks have the same contracts as other
  features. Both demos expose markers; the workspace also names and saves them.
- Rotation/scaling transform marker positions with the selection. Simplification
  leaves points unchanged. A positive buffer replaces a marker with the existing
  32-sided Mercator polygonal disk approximation; Undo restores the point.
  Polygon-only and line-offset commands reject ineligible selections.

Coordinates are exactly `[longitude, latitude]`: finite numbers in
`[-180, 180]` / `[-90, 90]`. Invalid points reject the complete import/transaction.
`MultiPoint`, altitude, geometry collections and custom HTML/image icons are not
supported. Mercator transformations retain their narrower latitude/world-span
limits. Marker appearance is presentation only and is not exported.

## Appearance

```ts
editor.setAppearance({
  marker: { color: '#116b5b', radius: 8, strokeColor: '#fff', strokeWidth: 2 },
  selectedMarker: { color: '#2563eb', radius: 10 },
  draftMarker: { color: '#df772e', opacity: 0.85 },
});
```

All three groups use `PointAppearance` and the existing atomic validation rules.
Defaults are green, blue when selected and orange while placing/moving. Vertex
editing uses the existing vertex handle appearance. Settings survive style reloads;
changes during movement also restyle the synchronous marker preview.

## Verification

`tests/markers.test.ts` covers data, validation, history, locks, snapping and tool
compatibility. Real Chromium tests cover cursor preview, placement, selection,
rectangle selection, dragging, cancellation, snapping, style reload and teardown.
The playground and installed workspace exercise markers through public controls.

`npm run benchmark:markers` measures fixed grids of 1,000 and 10,000 points:
import, snapping-index construction, indexed lookup and one-marker translation.
It excludes map rendering and is a core baseline, not a browser performance budget.

Local baseline (2026-10-25, Node 22.23.1, macOS arm64, Apple M2 Pro):
30 samples after five warmups, milliseconds as median / p95. Other checks were
running concurrently; these measurements are indicative, not release thresholds.

| Points | Import | Index build | Query | Move one marker |
| --- | --- | --- | --- | --- |
| 1,000 | 1.020 / 1.917 | 0.515 / 2.688 | 0.007 / 0.020 | 0.015 / 0.047 |
| 10,000 | 13.078 / 26.177 | 13.584 / 34.790 | 0.022 / 0.041 | 0.049 / 0.084 |
