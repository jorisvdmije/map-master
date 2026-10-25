# Feature locks

Milestone 18c adds host-defined read-only feature IDs. Locked features remain
visible, selectable, exportable, available for snapping/tracing and usable as
subtraction cutters. Existing geometry and properties cannot be changed or deleted.
The default is no locks. Locks cover whole features, including all multipart
components and polygon holes.

## Public API

```ts
import { FeatureLockedError, GeometryEditor } from '@geo/editor';

const editor = new GeometryEditor(map, { lockedFeatureIds: ['reference', 0] });
editor.importGeoJSON(referenceData); // Initial loading of locked IDs is allowed.
editor.clearHistory();

editor.setLockedFeatureIds(['reference']); // Replace the complete policy.
editor.isFeatureLocked('reference'); // true
editor.getLockedFeatureIds(); // Independent array snapshot.

try {
  editor.applyTransaction({ delete: ['reference'] });
} catch (error) {
  if (error instanceof FeatureLockedError) console.log(error.featureId);
  else throw error;
}
editor.setLockedFeatureIds([]); // Unlock all features.
```

These three methods and the constructor option also work on `LineEditor`.
String and numeric IDs are distinct: `0` does not lock `"0"`. Duplicates are
removed. Unknown IDs are allowed so the host can configure policy before import.
Inputs must be arrays of strings or finite numbers; invalid input throws
`TypeError` before changing policy, drafts or gestures. Arrays are copied.
Repeating the same set, in any order, is a no-op.

A changed policy emits `onChange`. Policy is separate from feature properties,
GeoJSON, data revisions and history. Setting locks neither records an action nor
clears Undo/Redo. Getters remain readable after destroy; setters throw.

## Mutation contract

| Action | Locked target behavior |
| --- | --- |
| Edit vertices, draw a hole, split, reshape, transforms, shared-boundary editing, union or intersection | Entry returns `false` without starting a preview. A multi-feature tool requires every mutation target to be unlocked. |
| `deleteSelected()`, `deleteSelection()`, `deleteHole()`, `translateSelection()` | Return `null` without changing any selected feature. Pointer translation and keyboard deletion use the same policy. |
| `applyTransaction()` updating properties/geometry or deleting | A changed locked target throws `FeatureLockedError`, with `featureId`. The entire batch is rejected, including otherwise allowed creates/updates/deletes. Normalized unchanged updates remain no-ops. |
| Initial import and transaction creation | Allowed for missing IDs, even when preconfigured as locked. The newly loaded feature is immediately protected. These append operations cannot overwrite existing IDs. |
| Duplicate selection | Allowed: copies have fresh IDs and leave originals untouched. Locks follow IDs, not copied properties; a new ID preconfigured as locked is still locked. |
| Difference | Only the first selected feature is mutated and must be unlocked. Remaining cutters can be locked. |
| Undo/Redo | Blocked if the next whole action touches any locked ID, including creation removal or restoration of a deleted ID. `canUndo`/`canRedo` become false and the methods return false. The blocked entry stays in place; entries are never skipped. Unlocking makes it available again. |

Existing preconditions still apply: for example, transactions and history changes
require idle mode, and `deleteSelected()` rejects multi-selection.

Changing policy cancels an active selection rectangle or pointer gesture. If a
newly protected mutation target belongs to the active draft/review, the complete
draft is discarded and the editor returns to idle, retaining selection and
committed data. An unrelated draft remains active; stopping an in-flight vertex
gesture rolls that gesture back to its starting draft. New drawings and
subtraction previews with only locked cutters remain active. Policy survives map
style replacement and is isolated per editor.

## Host controls and persistence

Both examples expose lock/unlock controls. The playground can lock whole
selections. The area workspace has **Lock for this session**, disables name/edit/
delete controls and shows **Locked** in its list. These demo locks reset on page
reload, are excluded from saved geometry, and do not make the workspace dirty.
An application that needs persistent rules should load its policy separately
from GeoJSON and set locks during editor construction or after loading.

This is editor interaction policy, not authorization. The host can unlock IDs;
a server must validate its own permissions. There are no per-operation roles,
user accounts, per-ring locks, or restrictions on copying/exporting reference data
in this milestone. The library does not change locked-feature colors automatically;
host controls indicate protection in the demos.

## Implementation and checks

`DrawingSession` gates tool entry and prepared commits, with a final lock check
before history/data mutation. History is inspected before moving an entry between
stacks. The MapLibre adapter cancels active gestures, restores the committed view
and blocks pointer translation acquisition for mixed locked selections. Snapping
and tracing retain all ordinary reference candidates.

Membership uses a typed ID set. History-policy checks are cached per immutable
entry and invalidated on policy replacement; repeated pointer-state reads do not
rescan large history batches. With no locks, the history gate is constant-time.
Policy updates do not upload committed geometry or rebuild the snapping index.

Run `npm run check`. Focused tests cover typed identities, atomic rejection,
constructor validation, each mutation tool, draft revocation, copying, locked
cutters, tracing, history blocking/unblocking, real keyboard/pointer interaction,
style replacement, facade forwarding, playground controls and the installed
workspace's session-only controls.
