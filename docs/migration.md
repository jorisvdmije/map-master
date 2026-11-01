# Migration guide

This guide lists the changes you need to make when upgrading. Versions follow
[semantic versioning](https://semver.org/); before 1.0, a minor version may contain
breaking changes, and every one is listed here and in the [changelog](../CHANGELOG.md).

Before upgrading, export your data with `exportGeoJSON()`, pin the exact new version
and commit your lockfile, so that adopting a release is a deliberate change. Import
only from the package entry point `@jorisvdmije/map-master`; internal paths are not
part of the API and are blocked by the package `exports`.

## Upgrading from 0.1.0-beta.0

No changes are required: 0.1.0 is backwards compatible with 0.1.0-beta.0.

- **New:** `onDataChange(listener)` reports every committed change (drawing, edits,
  deletions, imports, transactions, geometry tools and undo/redo) in one stream with
  before/after snapshots. If you combined `onCreate`, `onUpdate`, `onDelete`,
  `onImport`, `onTransaction` and `onHistory` to save data, you can replace them with
  this single listener. See [saving and loading data](persistence.md).
- **New:** `getFeature(id)` returns one committed feature without exporting the whole
  collection.
- **New:** the `EditorMode`, `DataChangeEvent` and `DataChangeSource` types are exported.
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
