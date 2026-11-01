# Geofencing

Keep new and changed geometry inside allowed polygon areas and clear of excluded
areas. The same policy validates drawings, vertex edits, linked vertices,
translation, geometry tools, imports, transactions and Undo/Redo **before a
commit**. A rejected batch changes no features, selection, history or data
revision. Geometry previews remain available for correction or cancellation.

```ts
import { EditorToolbar, GeometryEditor, GeofencingError } from '@jorisvdmije/map-master';
import type { GeofenceArea } from '@jorisvdmije/map-master';

const park: GeofenceArea = {
  id: 'park',
  geometry: { type: 'Polygon', coordinates: [
    [[4.86, 52.35], [4.88, 52.35], [4.88, 52.37], [4.86, 52.37], [4.86, 52.35]],
  ] },
};
const pond: GeofenceArea = {
  id: 'pond',
  geometry: { type: 'Polygon', coordinates: [
    [[4.869, 52.359], [4.871, 52.359], [4.871, 52.361], [4.869, 52.361], [4.869, 52.359]],
  ] },
};
const editor = new GeometryEditor(map, {
  geofencing: {
    enabled: true, allowed: [park], excluded: [pond],
    allowedMatch: 'contains', excludedMatch: 'intersects',
  },
  keyboardShortcuts: { geofencing: [{ key: 'f' }] },
});
map.addControl(new EditorToolbar(editor, {
  tools: ['point', 'line', 'polygon', 'edit', 'geofencing', 'undo', 'redo'],
}));

editor.onChange(state => {
  // Includes feature IDs (null for new drafts), reason codes and area IDs.
  console.log(state.geofencingViolations);
});
try {
  editor.importGeoJSON(data);
} catch (error) {
  if (error instanceof GeofencingError) console.log(error.violations);
  else throw error;
}
```

## Area and boundary rules

Areas use WGS84 longitude/latitude Polygon or MultiPolygon geometry, with the
same closed-ring, hole, coordinate and topology validation as imported features.
Area IDs must be nonempty strings, unique across both groups. Groups are
independent; an empty group imposes no restriction.

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Apply the configured policy and display its reference areas. |
| `allowed` | `[]` | Union of areas in which geometry must match `allowedMatch`. |
| `excluded` | `[]` | Union of areas in which geometry must **not** match `excludedMatch`. |
| `allowedMatch` | `contains` | Every component and the complete filled geometry must lie in the allowed union. |
| `excludedMatch` | `intersects` | No part may touch or overlap the excluded union. |

`contains` includes area boundaries. `intersects` includes boundary-only contact,
so the default allows touching the allowed border and refuses touching an
excluded border. There is no pixel tolerance, buffer or automatic clipping.
Matching uses planar longitude/latitude geometry; antimeridian-crossing areas
are rejected by the existing polygon validator.

With `allowedMatch: 'intersects'`, some part of the complete feature must touch
or overlap the allowed union; other parts may extend outside it. With
`excludedMatch: 'contains'`, only features wholly contained by the excluded union
are refused; partial crossings are allowed. These alternatives are explicit
policy choices. The toolbar toggle does not change the matching rules.

Adjacent and overlapping reference areas are unioned before checking. A line may
cross between adjacent allowed areas, but cannot bridge a gap or cross a hole
when containment is required. Polygon checks include filled interiors: a shape
that surrounds and fills an excluded zone is refused even when none of its
corners lie inside that zone. A zone entirely inside the feature's own hole does
not intersect it; touching the hole boundary still counts as contact.

## Preview, feedback and correction

Allowed areas have green dashed borders; excluded areas have red dashed borders.
These read-only overlays are independent of editable features, selection,
snapping, locks and history. They rebuild after map style changes and are removed
when disabled or when the editor is destroyed.

Checks of drafts use **placed geometry**, after it is topologically valid, not a
hover cursor or an incomplete ring. `state.geofencingViolations` identifies the
current invalid preview and `canFinish` becomes false. Save/Apply is disabled;
the toolbar's accessible notice names the rule and area IDs. Correct the points,
transform parameters or template placement, or Cancel. Rejected two-click shapes
retain their original anchor so another opposite corner/radius can correct them.
Freehand can be redrawn. Cutters themselves may extend outside the allowed area;
the resulting stored geometry must obey the policy.

During a captured vertex drag, existing invalid-drag rollback behavior still
applies on release. A whole-feature drag that would violate the policy is
refused, leaving committed geometry unchanged. Its notice appears while the
pointer is in a forbidden position. Keyboard selection moves use the same
validation. **Alt** bypasses snapping and alignment aids, and does not bypass a
geofence. **Escape** retains its normal gesture rollback/cancel behavior.

Programmatic imports, translations, duplicates, hole deletion and transactions
throw `GeofencingError` with an independent `violations` array. Interactive
`finish()` and tool-specific finish methods return null and keep a forbidden
preview active. Existing feature IDs and unrelated properties survive valid
operations. A multi-feature or linked edit is checked and committed atomically.

Violation codes are `outside-allowed-area`, `intersects-excluded-area`,
`inside-excluded-area` and `geofencing-calculation-failed`. The last is a
fail-closed result when a geometry calculation cannot be completed reliably.

## Runtime policy and history

```ts
editor.setGeofencing({ excluded: [] }); // Patch; other settings remain.
const policy = editor.getGeofencing(); // Independent full snapshot.
const audit = editor.checkGeofencing(editor.exportGeoJSON().features);
const undoProblems = editor.getHistoryGeofencingViolations('undo');
editor.setGeofencing({ enabled: false }); // Retains both groups for later reuse.
```

Updates validate the complete replacement policy before interrupting a gesture.
An invalid update leaves the old settings and draft intact. A valid update stops
pending gestures, retains other placed draft edits and revalidates the preview
and history. Policy changes do not add a history entry or increment data revision.

Enabling or tightening a policy does not rewrite existing data. Audit it with
`checkGeofencing()`. Existing violations may be selected, deleted or corrected;
new and changed final features must pass. Unchanged transactions remain no-ops.

Undo and Redo validate all features they would restore against the **current**
policy. A blocked action returns false, does not advance either history stack,
and sets `canUndo`/`canRedo` false. The toolbar hint and
`getHistoryGeofencingViolations(direction)` explain the block. Relaxing or
disabling the policy permits replay again. Deletions are always spatially allowed;
feature locks still apply independently.

Geofences are host configuration: they are not embedded in exported GeoJSON or
restored by feature Undo/Redo. Persist them separately and configure them again
when opening a saved dataset. The `geofencing` toolbar/keyboard action toggles
enforcement; omit that control when users should not change the host's setting.
There is no default shortcut.

Upstream reference: [Geoman Geofencing Helper Mode](https://geoman.io/docs/maplibre/helper-modes/helper-geofencing),
checked 1 November 2026. Its documented containment/intersection helper reports
events. This editor's policy blocks invalid commits and additionally covers
transactions, imports and history replay.
