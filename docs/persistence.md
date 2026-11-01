# Saving and loading data

The editor keeps committed features in memory. Your application decides where
they are stored: a file, browser storage or a server API. This guide shows the
patterns that keep the editor and your storage consistent.

## Load saved features

Import saved GeoJSON once the editor exists, then clear the history so users
cannot "undo" opening their data:

```ts
const editor = new GeometryEditor(map);
editor.importGeoJSON(savedFeatureCollection);
editor.clearHistory();
```

`importGeoJSON` validates every feature before anything is stored. If one feature
is invalid, it throws a `GeoJSONImportError` and imports nothing:

```ts
import { GeoJSONImportError } from '@jorisvdmije/map-master';

try {
  editor.importGeoJSON(JSON.parse(text));
} catch (error) {
  if (error instanceof GeoJSONImportError) {
    showMessage(`Feature data is invalid at ${error.path} (${error.code}).`);
  } else throw error;
}
```

IDs and properties are preserved. Features without an ID receive a UUID. An ID
that already exists in the editor is rejected, so importing the same file twice
fails instead of duplicating features. See [GeoJSON import](geometry-editor.md#geojson-import)
for the full validation rules.

## Save every change

`onDataChange` reports each committed change, whatever caused it: drawing, vertex
editing, deletion, import, a transaction, a geometry tool, or undo/redo. Drafts,
previews and cancelled edits never trigger it.

Save a complete snapshot:

```ts
editor.onDataChange(() => {
  localStorage.setItem('features', JSON.stringify(editor.exportGeoJSON()));
});
```

Or send only what changed:

```ts
editor.onDataChange(({ source, changes }) => {
  for (const { before, after } of changes) {
    if (before === null) api.create(after!);
    else if (after === null) api.delete(before.id);
    else api.update(after);
  }
});
```

Each change carries independent `before` and `after` snapshots; `source` is one of
`create`, `update`, `delete`, `import`, `transaction`, `undo` or `redo`. A change
set is always applied as a whole, so persist it as one unit where your storage
supports that. Listeners run synchronously; start asynchronous requests from the
listener rather than awaiting them inside it.

## Track unsaved changes

`getState().dataRevision` increases with every committed change, including undo
and redo. Remember the revision you last saved to show an "unsaved changes" hint:

```ts
let savedRevision = editor.getState().dataRevision;

editor.onChange((state) => {
  saveButton.disabled = state.dataRevision === savedRevision || state.mode !== 'idle';
});

async function save() {
  const revision = editor.getState().dataRevision;
  await api.saveAll(editor.exportGeoJSON());
  savedRevision = revision;
}
```

Undoing back to a saved state still produces a new revision. To treat that as
clean, compare `JSON.stringify(editor.exportGeoJSON())` with the last saved snapshot
instead.

## Update properties

The editor never interprets properties. Change them with a transaction, which is
validated, recorded as one undo step and reported through `onDataChange`:

```ts
const feature = editor.getFeature(id)!;
editor.applyTransaction({
  update: [{ ...feature, properties: { ...feature.properties, name: 'North field' } }],
});
```

Render property values as text in your UI; they come from users or files.

## Responsibilities

- Only committed data is exported. Finish or cancel the active tool before
  exporting if the user expects a draft to be included; `getState().mode` is
  `'idle'` when nothing is in progress.
- Selection, drafts, history, feature locks and appearance are not part of the
  GeoJSON. Store them separately if your application needs them.
- [Feature locks](feature-locks.md) are UI policy. Enforce authorization on your
  server as well.
- The editor does not merge concurrent edits from several users or tabs. Detect
  conflicts in your storage layer, for example with a version number.

The [area workspace example](../examples/workspace/README.md) implements these
patterns with browser storage, recovery of corrupt data and a conflict check
between tabs.
