# Migration guide

This guide lists the changes you need to make when upgrading. Versions follow
[semantic versioning](https://semver.org/); before 1.0, a minor version may contain
breaking changes, and every one is listed here and in the [changelog](../CHANGELOG.md).

Before upgrading, export your data with `exportGeoJSON()`, pin the exact new version
and commit your lockfile, so that adopting a release is a deliberate change. Import
only from the package entry points `@jorisvdmije/map-master`,
`@jorisvdmije/map-master/maplibre` or `@jorisvdmije/map-master/mapbox`; internal
paths are not part of the API and are blocked by the package `exports`.

## Upgrading from 0.1.0

- **Mapbox:** applications can now install `mapbox-gl@^3.34.1` and import the same
  API from `@jorisvdmije/map-master/mapbox`. Existing MapLibre imports work
  unchanged; explicitly install `maplibre-gl` because both renderer peers are
  optional. See [Mapbox setup and tested versions](mapbox.md).

- **Keyboard shortcuts:** existing map-command defaults remain available. Use
  `keyboardShortcuts` / `setKeyboardShortcuts()` to remap, disable or add tool
  bindings at runtime. Conflicting bindings throw before changing settings.
  See the [shortcut reference](keyboard-shortcuts.md).

No changes are required for most applications.

- **Types:** `EditorMode` has eight new values: `draw-rectangle`, `draw-circle`,
  `draw-ellipse`, `draw-freehand`, `draw-cut`, `draw-part`, `remove-hole` and `select-lasso`. If you `switch` over
  the mode with an exhaustiveness check, add cases for them. `ToolbarTool` and
  `ToolbarLabelKey` have new values for the new buttons. `SnappingOptions` has a new
  `layers` field and `SnapResult` an optional `layer`; code that builds a complete
  `SnappingOptions` object must add `layers: []`.
- **Keyboard:** with a selection and the map focused, the arrow keys now move the
  selected shapes instead of panning the map.
- **Lasso:** the optional `lasso` toolbar tool and `lasso()`, `getLassoOptions()`,
  `setLassoOptions()` and `selectByLasso()` methods add freehand and programmatic
  selection. `LassoOptions` is exported. Match geometry in CSS pixels using
  `intersects` or `contains`; replace, add to or subtract from the selection.
  See [lasso selection](lasso.md).
- **New:** `draw('Rectangle' | 'Circle' | 'Ellipse' | 'Freehand')`, `drawCut()`, `finishCut()`,
  `drawPart()`, `explodeSelection()`, `combineSelection()`, `zoomToFeatures()`,
  `getMeasurements()` and `setMeasurements()`; the `measurements` and `createId`
  options; the `measure()`, `formatDistance()` and `formatArea()` functions; and the
  `DrawShape`, `Measurement`, `MeasurementOptions`, `MeasurementUnits` and
  `ToolbarButton` types.
- **Toolbar:** the default buttons are unchanged. Add the new tools to `tools`, or
  use `EditorToolbar.allTools`.
- **Hole removal:** add `remove-hole` to the toolbar for a cancellable preview,
  map picking and a keyboard-accessible ring chooser. `removeHole()`,
  `setHoleToRemove()`, `getHoleRemovalPreview()` and `finishHoleRemoval()` expose
  the same workflow. Existing `deleteHole()` behavior is unchanged.

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

## Persistent vertex pins

`mapMasterPins` is now a reserved feature property, validated on import and
transaction updates. Rename unrelated application data using that name. Existing
unpinned datasets retain their editing behavior. Linked vertex saves use one
`onTransaction`/`onDataChange` event for the entire group; duplicates start
unpinned. See [pin shared vertices](vertex-pinning.md) for the metadata contract.

## Multiple data layers

`mapMasterLayer` is reserved for a stable data layer ID. Rename unrelated
application properties using that name. Without configuration, the implicit
`default` layer preserves existing behavior and unassigned GeoJSON exports
unchanged. Define all named layers before importing saved memberships. See
[data layers](data-layers.md) for configuration persistence and history policy.
