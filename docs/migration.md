# Migration guide

This guide lists the changes you need to make when upgrading. Versions follow
[semantic versioning](https://semver.org/); before 1.0, a minor version may contain
breaking changes, and every one is listed here and in the [changelog](../CHANGELOG.md).

Before upgrading, export your data with `exportGeoJSON()`, pin the exact new version
and commit your lockfile, so that adopting a release is a deliberate change. Import
only from the package entry point `@jorisvdmije/map-master`; internal paths are not
part of the API and are blocked by the package `exports`.

## Upgrading from 0.1.0

No changes are required for most applications.

- **Types:** `EditorMode` has six new values: `draw-rectangle`, `draw-circle`,
  `draw-ellipse`, `draw-freehand`, `draw-cut` and `draw-part`. If you `switch` over
  the mode with an exhaustiveness check, add cases for them. `ToolbarTool` and
  `ToolbarLabelKey` have new values for the new buttons. `SnappingOptions` has a new
  `layers` field and `SnapResult` an optional `layer`; code that builds a complete
  `SnappingOptions` object must add `layers: []`.
- **Keyboard:** with a selection and the map focused, the arrow keys now move the
  selected shapes instead of panning the map.
- **New:** `draw('Rectangle' | 'Circle' | 'Ellipse' | 'Freehand')`, `drawCut()`, `finishCut()`,
  `drawPart()`, `explodeSelection()`, `combineSelection()`, `zoomToFeatures()`,
  `getMeasurements()` and `setMeasurements()`; the `measurements` and `createId`
  options; the `measure()`, `formatDistance()` and `formatArea()` functions; and the
  `DrawShape`, `Measurement`, `MeasurementOptions`, `MeasurementUnits` and
  `ToolbarButton` types.
- **Toolbar:** the default buttons are unchanged. Add the new tools to `tools`, or
  use `EditorToolbar.allTools`.

## Upgrading from 0.1.0-beta.0

No changes are required: 0.1.0 is backwards compatible with 0.1.0-beta.0.

- **New:** `onDataChange(listener)` reports every committed change (drawing, edits,
  deletions, imports, transactions, geometry tools and undo/redo) in one stream with
  before/after snapshots. If you combined `onCreate`, `onUpdate`, `onDelete`,
  `onImport`, `onTransaction` and `onHistory` to save data, you can replace them with
  this single listener. See [saving and loading data](persistence.md).
- **New:** `EditorToolbar`, a ready-made MapLibre control with buttons for every tool.
  Add it with `map.addControl(new EditorToolbar(editor))`; see the [toolbar guide](toolbar.md).
- **New:** `getFeature(id)` returns one committed feature without exporting the whole
  collection.
- **New:** the `EditorMode`, `DataChangeEvent`, `DataChangeSource`, `ToolbarOptions`,
  `ToolbarTool`, `ToolbarLabels` and `ToolbarLabelKey` types are exported.
- **Deprecated:** `LineEditor`. Replace it with `GeometryEditor`; the
  [LineEditor page](line-editor.md) maps each method.
- **Package:** the package no longer declares a Node.js `engines` range, so installing
  it does not warn on other Node.js versions. The guides are no longer included in
  the npm archive; read them online.

## Upgrading from local snapshots before 0.1.0-beta.0

Builds made before the first public release used the package name `@geo/editor`.
Rename the dependency and every import to `@jorisvdmije/map-master`, install the
published version, and re-test drawing, editing, import/export, undo/redo and teardown
with representative data.
