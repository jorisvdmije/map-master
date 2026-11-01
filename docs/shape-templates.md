# Reusable shape templates

Place consistent arrows, stars, or your own GeoJSON shapes with a preview before
committing. A template may contain one feature or a whole group. Position, size,
rotation and every feature in the group are saved as **one transaction and one
Undo step**.

```ts
import { EditorToolbar, GeometryEditor, defaultShapeTemplates } from '@jorisvdmije/map-master';

const editor = new GeometryEditor(map); // Arrow and Star are available by default.
map.addControl(new EditorToolbar(editor, {
  tools: ['template', 'edit', 'duplicate', 'delete', 'undo', 'redo'],
}));

editor.drawTemplate('arrow', { size: 250, rotation: 30 });
// Move the pointer to preview; click to anchor, then Finish/Enter to save.
// Another map click repositions the anchor; Escape discards the entire placement.

// Application-defined GeoJSON, optionally alongside the built-in examples:
editor.cancel();
editor.setShapeTemplates([
  ...defaultShapeTemplates(),
  {
    id: 'triangle', label: 'Triangle',
    data: {
      type: 'Feature',
      properties: { name: 'Meeting area', category: 'event', nested: { tags: ['a'] } },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [0.002, 0], [0.001, 0.001], [0, 0]]],
      },
    },
  },
]);
editor.drawTemplate('triangle', { position: [4.895, 52.372], size: 300 });
editor.setTemplatePlacement({ rotation: 45 });
const preview = editor.getTemplatePreview(); // Independent, validated GeoJSON.
editor.finishTemplate(); // TransactionEvent, or null if not anchored/valid.
```

## Place and confirm

Choose **Place template**, select a definition, then click the map. The preview
follows the pointer until the first click. After anchoring, pointer movement leaves
it in place; another click moves it. Snapping applies to anchor clicks, including
external layers; Alt bypasses snapping. Angle constraints and boundary tracing do
not alter the template geometry.

The toolbar provides **Size (Mercator m)**, **Rotation (°)**, **Longitude** and
**Latitude**. Coordinates make complete keyboard placement possible: activate
the toolbar button, enter longitude and latitude, then Finish. Enter in a numeric
field confirms and Escape cancels; composition and modified/repeated keys are
left alone. Canvas Finish/Cancel use the current [keyboard bindings](keyboard-shortcuts.md).
The optional `template` action has no default key:

```ts
editor.setKeyboardShortcuts({ template: [{ key: 't' }] });
```

Changing the definition in the picker preserves position, size and rotation.
`drawTemplate()` defaults to the first definition. Repeating it for the active
definition preserves the draft; changing tools requires Finish or Cancel. The
toolbar protects a pending template from accidental switching, including before
an anchor has been placed. Previewing or cancelling never allocates application
feature IDs or changes data/history.

## Template definitions

`EditorOptions.shapeTemplates` and `setShapeTemplates()` accept an array of
`ShapeTemplate` definitions. `defaultShapeTemplates()` returns fresh copies of the
Arrow and Star examples. An empty array disables the tool. `getShapeTemplates()`
returns independent, normalized definitions, with data as FeatureCollections.

Each definition contains a unique nonblank string `id`, a nonblank `label`, and
`data`: a parsed GeoJSON Feature or nonempty FeatureCollection. Supported geometry
types are Point, LineString, Polygon, MultiLineString and MultiPolygon. The complete
definition must have nonzero width or height; an isolated Point is not a scalable
template, but Points and [text markers](text-markers.md) may accompany other
features or form a group with distinct anchors.

The existing import rules validate all coordinates, topology, IDs and JSON
properties before replacing the library. In addition, templates must fit within
one Mercator half-world, without dateline jumps, and within latitude
±85.0511287798066°. Definitions can include holes and multipart geometries. Numeric
and string source IDs remain distinct; duplicate explicit IDs within one template
are rejected. Source IDs may be omitted (`ShapeTemplateFeature` makes them
optional), and are temporary identifiers for previews.

All definitions are validated and copied atomically: one invalid definition leaves
the old library, features, selection, history and active tools intact. Replacing
the library during template placement throws; Finish or Cancel first. Registry
changes are configuration, and are not part of exported GeoJSON or Undo history.

## Geometry and validation

The anchor is the center of the source's projected bounding box. Size is the
longest **unrotated** side of that box in spherical Mercator-plane meters, default
200. Uniform scaling preserves aspect ratio. These are projected map distances,
not geodesic ground distances; ground size varies with latitude. Rotation is
clockwise from the source orientation, default 0°, normalized to (-180, 180].
Every change is recomputed from the original template, so changing sizes or angles
back and forth does not accumulate rounding drift.

`getTemplateDraft()` returns an independent `TemplateDraft` with `templateId`,
`position` (null before anchoring), `size` and `rotation`. Patch any fields with
`setTemplatePlacement()`, including `position: null` to clear the anchor. Invalid
syntax, unknown IDs, nonpositive/nonfinite sizes, nonfinite angles and malformed
coordinates throw before changing the draft.

Coordinates outside the supported Mercator world, world-spanning results, or
precision loss that makes geometry invalid produce a null preview and disable
Finish. `EditorState.templateError` is `template-out-of-bounds` or
`template-invalid-result`; correcting the placement restores a valid preview.
Topology is validated using the same rules as import and transactions. Hover
previews have no committed anchor; a hover alone can never enable Finish.

## Commit, properties and locks

`finishTemplate()` allocates fresh IDs for the entire group, reserves them against
each other and the existing store, and commits once. If allocation or validation
fails, nothing is added and the draft stays available for correction. All source
properties, including nested values, are preserved independently. Template labels
in the picker are rendered as plain text.

The created features become the selection. They are ordinary GeoJSON features;
no template linkage or hidden sizing metadata is added. Existing features and
their IDs are unchanged, even when a source ID matches one already in the map.
Host locks apply normally to subsequent edits, deletion, transforms and history.
Placing a new shape does not modify locked reference data. Duplicating, editing,
importing and exporting the result use the existing feature contracts.

Template placement emits `onTransaction` and one `onDataChange` with source
`transaction`; it does not emit per-feature `onCreate` events. `finish()` also
confirms the placement and returns its first created feature. Use
`finishTemplate()` when you need every created feature in the transaction.

## Application-owned pickers

The default toolbar dropdown lists your registered definitions. To choose the
initial definition from an application-owned picker, use `ToolbarOptions.templatePicker`:

```ts
map.addControl(new EditorToolbar(editor, {
  tools: ['template', 'undo', 'redo'],
  templatePicker: (templates) => {
    // Read an existing application select, or consult application state.
    const selected = document.querySelector<HTMLSelectElement>('#shape-choice')?.value;
    return templates.find(template => template.id === selected)?.id ?? null;
  },
}));
```

The callback is synchronous and receives independent definitions and the editor.
Return a registered ID, or null to leave the current tool intact. An unknown ID
throws before another empty drawing is cancelled. The callback applies to the
toolbar button; a canvas shortcut starts the first registered definition. For an
asynchronous application dialog, use a custom [toolbar button](toolbar.md), then
call `drawTemplate(id)` after a choice, while the editor is idle.

Templates and their previews survive camera movement, appearance changes and
style reloads. Cancel, editor destruction and map removal clear every preview.
Unit and Chromium tests cover custom groups, topology, properties, ID allocation,
invalid transformations, keyboard placement, snapping, cancellation, history,
custom pickers and lifecycle cleanup. The live example demonstrates a two-feature
booth placement and GeoJSON export/import.

The scoped upstream reference is Geoman's
[Draw Custom Shape mode](https://geoman.io/docs/maplibre/draw-modes/draw-custom_shape).
The registry, sizing units and transaction contract above belong to Map Master.
