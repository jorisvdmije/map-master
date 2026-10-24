# Beta integration milestone

Milestone 18a validates one complete consuming application against an installed
npm archive. It is a local beta preview, not a public release or a claim of
production readiness. The package remains private, experimental, and unpublished.

## Run the area workspace

From the repository root, after `npm ci`:

```sh
npm run dev:workspace
```

Open <http://127.0.0.1:5174>. The app supports drawing areas/routes, selecting on
the map or in a list, dragging shapes, editing the outer boundary of a simple
feature, changing names, deleting, Undo/Redo, GeoJSON import/export, and explicitly
saving a workspace in this browser. Use `?basemap=off` for no external map requests.

Try this workflow:

1. Choose **+ Area**, click three or more corners, then **Finish**.
2. Select the area. Enter a name and choose **Apply name**.
3. Choose **Edit vertices**, drag a corner, and **Apply changes**. Cancel discards
   a draft. Undo/Redo includes geometry, names, deletion and complete imports.
4. Choose **Save workspace**, reload, and check the geometry and name.
5. **Export GeoJSON** for a portable backup. Import appends a file as one action;
   duplicate IDs or any invalid feature reject the entire import.

This is a separate, framework-free TypeScript/Vite application in
[`examples/workspace`](../examples/workspace/). It imports only `@geo/editor` and
host-owned MapLibre. No source aliases, library internals, workspace symlinks, or
global editor test hooks are used. MapLibre's worker URL is explicitly imported
through Vite and passed to `setWorkerUrl`, for both development and production.

The launcher builds and packs the current checkout, copies the application to a
temporary directory **outside this repository**, installs its archive and pinned
dependencies with `npm ci --offline`, and starts Vite on port 5174. The root
`npm ci` supplies the cached third-party packages. The terminal prints the
consumer's temporary path. Stop the command to clean up the temporary copy.
Edit the checked-in example and restart the launcher to try changes.

The application has its own dependency lockfile. Only the entry for the local
`vendor/geo-editor.tgz` omits integrity, because that is the artifact rebuilt on
every run; third-party integrity hashes remain pinned. After changing library
dependencies/version or the application's dependencies, run `npm run lock:workspace`
and review the lockfile. Keep shared tooling versions aligned with the root
lockfile so a fresh `npm ci` primes the offline cache on the target platform.

## Application and library responsibilities

The library owns geometry validation, drafts, committed features, identities,
transactions, selection and in-memory history. The application owns controls,
MapLibre setup, error wording, downloads and persistence.

- Subscribe to `onChange` for UI state. Read `dataRevision` to update committed
  snapshots only when data changes, rather than serializing on pointer previews.
  Do not use `onTransaction` alone as a universal autosave trigger: drawing,
  imports and history have separate event contracts.
- Update properties with `applyTransaction({ update: [...] })`. Preserve the
  existing feature and unrelated properties. Names are rendered as text, never HTML.
- Compare the serialized committed collection with the last successfully saved
  snapshot to compute dirty state. Undo back to that snapshot becomes clean.
  Selection and canceled drafts do not dirty the saved collection.
- Validate restored data through `importGeoJSON`. Clear history after loading
  the saved baseline; the user cannot Undo opening the workspace itself.
- Disable save/import/export while drawing or editing. Exporting a draft as if
  it were committed would mislead users. Unapplied name edits also disable save.
- Unsubscribe and destroy the editor before removing the map. The example keeps
  a page intact when the browser places it in its back/forward cache.

## Persistence contract

The single browser workspace uses localStorage key `geo-area-workspace:v1` and a
versioned envelope:

```json
{
  "format": "geo-area-workspace",
  "version": 1,
  "data": { "type": "FeatureCollection", "features": [] }
}
```

Save is explicit. Drafts, selection, camera and Undo history are not persisted.
Saving zero features writes an empty workspace, so deleted features stay deleted
after reload. Ordinary GeoJSON export contains only the FeatureCollection.

Storage read failures, invalid JSON, unsupported versions and invalid geometry
never silently replace a saved copy. If the bytes can be read, the app offers a
recovery download and an explicit, confirmed discard action. A quota/write failure
keeps the old saved baseline and the current in-memory work; export remains usable.

Each save compares the storage contents with the baseline this tab read or last
wrote. A stale tab is instructed to export and reload instead of overwriting newer
data. This is an optimistic conflict check, **not an atomic multi-tab transaction
or collaboration system**; simultaneous saves require coordination in a future
backend or locking layer. Browser storage can be cleared and is not a backup.
It is scoped to the exact origin, including port, so `localhost` and `127.0.0.1`
do not share a saved workspace. A browser may suppress the unsaved-exit warning.

Imports and saved envelopes have a 5 MB UTF-8 limit. This is a file-size guard,
not a supported geometry-size or interaction-latency budget. Synchronous geometry
validation, JSON serialization, storage writes, and the unvirtualized feature list
still require large-dataset profiling. No server persistence or authorization is
implemented here.

## Acceptance checks

```sh
npm run test:workspace
```

This is included in `npm run check`, and therefore in the existing CI definition.
Install Chromium using the repository's usual Playwright setup first. The check
type-checks and builds the isolated installed consumer, then runs real Chromium
against the production build, using the visible application controls:

- Draw, render, select an actual polygon on the map, and download exported GeoJSON.
- Rename safely, retain IDs/properties, and Undo/Redo the property transaction.
- Cancel drawing/editing, apply a real vertex drag, save, reload and clear old history.
- Delete, Undo/Redo, and persist an empty workspace.
- Import atomically, distinguish numeric/string IDs, preserve nested properties,
  and reject duplicate IDs, broken JSON and a batch containing unsupported geometry.
- Simulate quota exhaustion and verify the saved copy and in-memory data survive.
- Download and explicitly discard corrupt saved bytes; reject invalid restored geometry.
- Reject a stale tab's save after another tab has saved.

The same installed consumer also gets a development-server draw/render/pick check
to catch worker/bundler issues that production-only tests can miss. Console errors,
failed HTTP requests, uncaught browser exceptions and external network requests
fail the tile-free acceptance. Storage edge cases also have focused unit tests.

## Findings and next beta gates

This integration needed no new library APIs. Existing public transactions support
property editing and `dataRevision` supports efficient application dirty-state
tracking. Worker setup and reliable persistence belong in integration examples.

The next beta work is deliberately separate and reviewable:

1. **Configurable editor appearance:** a public styling contract for committed,
   selected, draft and vertex states, with style-reload tests.
2. **Feature edit restrictions:** host-configured operation rules that apply to
   pointer input, keyboard shortcuts and API mutations. Restricted reference
   geometry should remain usable for snapping. This is UI policy; a backend must
   enforce its own authorization.
3. **Measured compatibility and performance:** explicit dataset/latency budgets,
   repeated mount/unmount memory checks, browser matrix and touch/accessibility
   scope. Current acceptance covers desktop Chromium and MapLibre 6.15.0.
4. **Public prerelease:** choose the package identity and license, configure a
   GitHub remote and required CI checks, add actual maintainer/security contacts,
   versioning and migration notes, and validate the exact release archive before
   publishing under a prerelease tag. No registry publication is performed here.

Trim/extend is deferred until a consuming application needs it. The full playground
continues to demonstrate advanced geometry tools; this smaller workspace focuses
on one useful application workflow.
