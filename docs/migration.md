# Beta versioning and migration

There are no published versions to migrate between yet. Earlier local snapshots
used `@geo/editor@0.0.0`; the prepared candidate is now
`@jorisvdmije/map-master@0.1.0-beta.0`. Neither is a stable compatibility contract.
Keep the archive checksum or Git commit of any local version you integrate.

## Version policy

The prepared first public version is `0.1.0-beta.0`, to be published under npm's `beta`
tag after the [release prerequisites](releases.md) are met. Subsequent candidates
increment the prerelease number. Pin an exact candidate version in applications
and commit the application lockfile so adopting a new candidate is deliberate.

The public API is experimental throughout beta. Each candidate must record
user-visible changes, breaking behavior and required migration steps in the
[changelog](../CHANGELOG.md). Do not silently change geometry validity rules,
identity handling, event semantics, history behavior or persistence examples.
If a candidate has no required migration, say so in its release notes. A stable
1.0 compatibility/deprecation policy is a separate release gate.

## Adopting the first candidate from a local snapshot

1. Back up committed geometry using GeoJSON export. Finish or cancel drafts first.
   Record the old archive/commit and retain it for rollback.
2. Rename the dependency key and all imports from `@geo/editor` to
   `@jorisvdmije/map-master`, including host TypeScript/Vite aliases. Until npm
   publication, install a new local archive under that dependency key. After
   publication, use the exact `0.1.0-beta.0` version and refresh the application
   lockfile. Use only the public package entry point; imports from
   `src/`, `dist/` or internal modules are unsupported.
3. Install host-owned MapLibre. The declared peer range is `^6.15.0`, but only
   6.15.0 has been measured. Start from that version and the
   [integration guide](geometry-editor.md).
4. Compile the application and exercise drawing, cancellation, selection,
   editing, property transactions, Undo/Redo, import/export and teardown with
   representative data. Test invalid imports and locked features too.
5. Verify that all required IDs, properties, holes and multipart components
   survive a GeoJSON round trip under the documented validity policy. Do not
   bypass validation to make previously unsupported geometry load.
6. Reapply host configuration, appearance and locks after creating the editor.
   Drafts, history and feature locks are not persisted in the example workspace.

`LineEditor` remains a compatibility facade for line-only integrations; migrating
to `GeometryEditor` is optional unless the application needs other geometry.
See the [line guide](line-editor.md) for that API's scope.

The example's `geo-area-workspace` envelope stays at format version 1. It is
independent of the package version, and this release preparation makes no storage
format change. Browser data belongs to an origin, including its port; moving a
demo to another origin requires export/import, not just upgrading the package.
Host applications own their storage schema, migrations and rollback strategy.

## Independent scale axes

Scaling now exposes `scaleFactorX` and `scaleFactorY`. Use those values to display
the preview dimensions, and use `state.mode === 'scale-features'` to detect the
mode. `scaleFactor` remains the common factor for uniform scaling, but is also
null during scaling when the axes differ. `setScaleFactor(f)` still sets both
axes to `f`; use `setScaleFactors(x, y)` for independent values.

## Editable transformation pivots

`setRotationPivot(pivot?)` and `setScalePivot(pivot?)` change the pivot during an
active session; omitting the argument restores the original bounds centre.
The current angle/factors remain absolute from the original geometry, so moving
the pivot may reposition the preview. Existing entry-pivot and numeric APIs keep
their behavior. The new ⊕ handle supports mouse dragging and keyboard placement;
its snapping targets are selected original vertices and the original centre.

## Multi-vertex editing

`selectedVertexIndices` contains the complete corner selection in acquisition
order. `selectedVertexIndex` remains the last selected index for existing hosts;
use the array to display or operate on all selected corners. State fixtures must
include this new array (empty outside an edit or after clearing selection).
`selectVertex(index)` and `moveVertex(index, coordinate)` still select one corner.
The new batch APIs are described in [vertex editing](geometry-editor.md#vertex-editing).

Shift+click now toggles corners within the active draft. Dragging a segment away
from its handles moves both endpoints, while midpoint handles still insert a
corner. Delete/Backspace removes the entire corner selection or nothing if the
minimum count/fixed-junction policy would be violated. Hosts with a custom Remove
button can call `removeSelectedVertices()` for the same behavior.

Escape during a captured vertex drag now restores that gesture only; a subsequent
Escape or `cancel()` discards the entire edit. Enter during the drag is ignored.
Camera changes roll back a group/edge drag; existing single-vertex drags still
refresh. GeoJSON, saved history entries and storage formats do not change.

## Rectangle selection of vertices

Shift+drag away from a corner while editing now selects draft vertices inside a
screen rectangle, adding to the current corner selection. Shift+click on a corner
still toggles that corner. This takes precedence over MapLibre box zoom during
editing; its enabled setting is restored on release/cancellation. It operates on
the active ring/component only and does not change the feature selection. No
new public methods, state fields, GeoJSON or history formats are introduced.

## Simplification controls and comparison

Valid simplification previews now show a faint original outline beneath the result.
It uses the existing feature appearance and committed source; it does not alter
GeoJSON, exports, history or public state. The demo adds a tolerance slider and
vertex reduction summary alongside exact numeric input. The public simplification
API remains unchanged. See [simplification](simplification.md) for keyboard steps,
range behavior and invalid-result feedback.

## Split boundary endpoints

Split cuts can now start/end on the selected outer edges or corners, as well as
outside. `split-boundary-touch` still rejects intermediate boundary contacts,
corner crossings and edge overlaps. In the interactive split tool, target boundary
attachment takes priority within 18 CSS pixels even with general snapping disabled;
Alt bypasses it. The API, transaction events and history format are unchanged.
Adjacent features are not modified. See [splitting](splitting.md).

## Split and reshape feedback

`GeometryEditor.getCutFeedback()` and the exported `CutFeedback` type are additive.
Existing split/reshape state, validation errors, previews and commit contracts are
unchanged. Custom hosts may read the snapshot during `onChange` to present contact
counts or error locations. Empty diagnostic arrays are not a validity signal;
continue to use `getState().canFinish`. The LineEditor facade remains unchanged.
