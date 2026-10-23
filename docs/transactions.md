# Atomic feature transactions

Status: implemented in milestone 10. Transactions provide a commit boundary for
split, union, difference, and other operations affecting several features. The [split tool](splitting.md) introduced in milestone 11 builds on this boundary.

## Public API

```ts
import type { FeatureTransaction, GeometryFeature } from '@geo/editor';

// Supply complete GeoJSON features with explicit IDs; the editor validates them.
declare const updatedFeature: GeometryFeature;
declare const newFeature: GeometryFeature;

const transaction: FeatureTransaction = {
  update: [updatedFeature],
  create: [newFeature],
  delete: ['obsolete-feature'],
};
const result = editor.applyTransaction(transaction); // TransactionEvent | null

const unsubscribe = editor.onTransaction(({ changes }) => {
  // All changes have already committed. Each entry has before/after snapshots:
  // null before = creation; null after = deletion; both present = replacement.
  persistBatch(changes);
});

editor.undo(); // Reverse the complete batch once.
editor.redo(); // Restore it, including the same IDs and feature order.
```

`editor` is an existing idle GeometryEditor; `persistBatch` represents the host's
persistence function. Register observers before applying a batch when the host
needs to persist it. Subscribe to `onHistory` as well to persist undo/redo changes.
The library does not implement network/database transactions or concurrent edits.
The LineEditor compatibility facade does not expose this mixed-geometry API.

## Input and identity

- Each operation is optional; `{}` is an empty transaction. Present operations
  must be arrays. Unknown operation names are rejected to catch misspellings.
- Create/update entries must be complete GeoJSON Features with explicit string
  or finite numeric IDs, geometry, and properties. No automatic ID generation.
- Updates replace geometry and properties in full while retaining the ID and
  collection position. Geometry type may change between supported types. This
  is not a property patch API. Creates append in supplied order.
- Create IDs must not exist. Update/delete IDs must exist in the original store.
  An ID may appear only once across the entire transaction, even for an unchanged
  update. Delete-and-recreate with the same ID is rejected; use update instead.
  Numeric `7` and string `"7"` remain distinct.
- Features use the existing import contract: 2D LineString, Polygon, MultiLineString or MultiPolygon with validated components and interior rings,
  supported topology, bounded coordinates, JSON properties or null. Polygon
  winding is normalized. Foreign feature members are ignored as with import.
- Inputs and returned snapshots cannot mutate the stored collection or history.
  The transaction method is synchronous and available only while idle. Finish
  or cancel a drawing/edit first. Calling it or subscribing after destroy throws.

Validation finishes for every entry before any data or history mutation. Invalid
geometry/properties throw `GeoJSONImportError` with a transaction-relative path,
for example `$.create[1].geometry.coordinates`. Invalid transaction structure/IDs
throw TypeError; conflicting, missing, or existing IDs throw RangeError. A failure
preserves data, selection, revision, draft, undo, and redo, and emits no events.

Updates whose normalized geometry and JSON properties are unchanged are omitted
from the resulting changes. Object key order does not make properties different;
array order does. If no effective changes remain, return null without rendering,
events, revision increment, or clearing redo. This is structural equality after
normalization, not a geometric equivalence test for alternate ring start points.

## Commit and events

A nonempty batch increments dataRevision once, records one `transaction` history
action, uploads the committed source once, and emits one `onTransaction`, then
one `onChange`. Callbacks see the fully committed state; MapLibre paints
asynchronously. Selection is retained if its ID survives, otherwise cleared.
Undo does not restore past selection. The next snap query uses the new revision.

Changes are ordered as effective updates, deletions, then creations, preserving
input order within each group. Undo events swap before/after in that same order;
they describe an atomic batch rather than intermediate UI states. Every listener
and the return value receive independent snapshots. Exceptions in observers are
reported asynchronously and do not roll back the committed batch or prevent other
listeners. Unsubscribe and editor/map destruction clean up subscriptions.

`onCreate`, `onUpdate`, `onDelete`, and `onImport` are not emitted for explicit
transactions. Existing individual methods retain their current events.
`onTransaction` reports explicit transactions, confirmed splits, unions and changed differences, deleteSelection(), group translations, duplicateSelection() and deleteHole(); it is not a
universal change stream. Undo/redo emits only `onHistory` with `action: 'transaction'`, followed by
`onChange`. Update exhaustive switches over HistoryAction for the new member.
The existing history limit applies per batch, not per changed feature or byte.

## Internal boundary

`core/transaction.ts` prepares isolated changes against the original feature map
and reuses import validation. It does not mutate the store. DrawingSession's
shared commit method records original deletion positions and final append
positions before applying any changes. Drawing, saved edits, import, deletion,
and explicit transactions now all use this commit boundary.

A common application path handles both forward commits and history replay.
Insertion positions are sorted so multiple deletions supplied in any order can
be restored in exact collection order. Unchanged stored geometry is retained
by reference internally; only changed features are held in history.

See the [performance baseline](performance.md#atomic-transactions). The [interactive split tool](splitting.md)
calculates and previews two polygon geometries, then confirms one update/create
batch through this boundary. Transactions themselves do not calculate geometry.
