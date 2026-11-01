# Multipart lines and polygons

`GeometryEditor` supports 2D `MultiLineString` and `MultiPolygon` alongside
`LineString` and `Polygon`. A multipart feature has one ID and one properties
object. It stays multipart even with only one component. Component/ring order,
IDs and properties survive edits, translation, duplication, import/export and
Undo/Redo. Polygon winding is normalized at import and save: exterior CCW,
interior rings clockwise, preserving each first corner.

The live example shows two pond islands stored as one `MultiPolygon`. Click either
island to select the complete feature, then use the multipart tools of the
[toolbar](toolbar.md): **Add part**, **Separate parts** and **Combine into multipart**.

## Construction and selection

Use `importGeoJSON()` for a parsed Feature/FeatureCollection, or
`applyTransaction({ create: [...] })` for explicit IDs. For example:

```ts
editor.importGeoJSON({
  type: 'Feature', id: 'paths', properties: { name: 'Routes' },
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [[4.88, 52.37], [4.89, 52.37]],
      [[4.90, 52.36], [4.91, 52.36]],
    ],
  },
});
editor.select('paths');
editor.editSelected(0, 1); // Ring index first, then component index: second path.
editor.moveVertex(0, [4.899, 52.36]);
editor.finish(); // One onUpdate, one edit history action.
```

Clicking any component selects its entire feature. Rectangle selection deduplicates
hits across components. Empty gaps and polygon holes remain empty for picking.
`featureCount` counts features, not components. Group movement, duplication and
whole-feature deletion act on every component. Duplication assigns one new ID
per feature. Cross-feature overlap is permitted; multipart topology validation
only compares components belonging to the same `MultiPolygon`.

Splitting a multipart feature with `splitSelected()` is not supported; it returns
false. Transactions can replace the complete geometry, including changing its type
or component count, subject to validation.

To fill a hole in any polygon component, use [Remove hole](remove-hole.md).
Choose the part and ring from the toolbar dropdown or click inside the hole.
Filling a hole occupied by another component is rejected to preserve topology.

## Add a part

`drawPart()` draws a new component for the selected line or polygon. Finishing
turns the feature into a `MultiLineString` or `MultiPolygon` that keeps its ID and
properties:

```ts
editor.select('islands');
editor.drawPart();  // Click the corners of the new island, then finish.
editor.finish();    // One onUpdate and one edit history action.
```

The existing parts stay visible while drawing, and the state reports
`mode: 'draw-part'` with `activePartIndex` set to the new component's index. A new
polygon part may not touch or overlap the existing parts; `validationError` reports
`part-intersection` or `part-overlap` until it is moved clear. `drawPart()` returns
false unless exactly one unlocked line or polygon is selected.

## Separate and combine parts

| Method | Result |
| --- | --- |
| `explodeSelection()` | Every selected `MultiPolygon` or `MultiLineString` becomes one feature per part. The first part keeps the ID; the others get new IDs and a copy of the properties. All resulting features are selected. |
| `combineSelection()` | Two or more selected polygons, or two or more selected lines, become one multipart feature. The first selected feature keeps its ID and properties; the others are deleted. |

Both are one transaction and one Undo step, and return the committed changes or
null. `combineSelection()` returns null for a mix of lines and polygons, and for
polygons that touch or overlap: use [union](union.md) to merge those into one area.
Both return null when the selection contains a [locked feature](feature-locks.md).

## Component and ring addresses

| Method/state | Meaning |
| --- | --- |
| `editSelected(ringIndex = 0, partIndex = 0)` | Edit one ring or line component. The first argument keeps its existing ring meaning. |
| `drawHole(partIndex = 0)` | Add a hole to the chosen Polygon/MultiPolygon component. |
| `drawPart()` | Draw a new component; `activePartIndex` is the index it will get. |
| `deleteHole(ringIndex, partIndex = 0)` | Remove one hole as a validated transaction. |
| `activePartIndex` | Component being edited, or receiving a hole; 0 for simple geometries, null outside these modes. |
| `activeRingIndex` | Polygon ring being edited/drawn; null for line components. |
| `getDraft()`, `vertexCount`, `selectedVertexIndex` | Local coordinates/count/index in the active line or open ring. |

Indices are zero-based. For simple geometries only component 0 exists. Lines
accept only ring 0. Polygon ring 0 is the exterior; subsequent rings are holes.
Invalid/noninteger indices throw `RangeError` before entering a mode. Without a
sole feature selection, editing/hole commands remain no-ops. Repeating an active
edit or hole-drawing command returns false and keeps the current address; finish
or cancel before switching components. Indices refer to current array positions,
not permanent component identities.

Editing a multiline component uses `mode: 'edit-line'`; editing any polygon ring
uses `mode: 'edit-polygon'`. Drawing a new component uses `mode: 'draw-part'`. All components
of the target feature are excluded from snapping during editing/hole drawing.
Other features remain targets. `SnapResult.partIndex` identifies a multipart
component; `ringIndex` additionally identifies a polygon ring. Both indices precede
the local vertex/edge `index` in tie breaking, after the existing feature priority.
Simple geometries omit `partIndex`; line geometries omit `ringIndex`; closure
targets omit both. Disconnected line components never acquire a bridging edge.

## Validation and history

Each multipart geometry needs at least one nonempty component. Each line needs
two finite positions with no consecutive duplicates. Each polygon component
follows the existing [ring contract](geometry-editor.md#polygon-contract): closed,
valid exterior and strictly contained, disjoint holes, world-bounded 2D positions,
no dateline-crossing edges. Invalid nested input is rejected with a
`GeoJSONImportError` whose path includes component/ring/position indices.

The supported `MultiPolygon` subset is deliberately strict: filled areas must be
disjoint, and component boundaries cannot touch, cross or share an edge, including
isolated point touches. Boundary conflicts report `part-intersection`; containment
in another component's filled area reports `part-overlap`. An island strictly
inside another component's hole is valid. These checks use planar longitude/latitude
geometry, consistent with the existing polygon policy.

Moving an exterior or hole validates the complete `MultiPolygon` after each
vertex change. Invalid drafts stay editable; Finish returns null, and Cancel
preserves saved data. Deleting a hole containing an island would fill the area
around that island and cause overlap: the transaction throws and changes nothing.
Imported batches and transactions fail atomically,
retaining selection, data revision and Undo/Redo on error.

A changed saved component edit or drawn hole emits one `onUpdate`, then
`onChange`, and records one `edit` action for the complete feature. Hole deletion
emits `onTransaction`, then `onChange`. Undo/Redo restore every component and ring
exactly. No-op saves and cancellation add no history. Previews never appear in
exports. Style reload restores the preview, active handles and whole-feature
selection; finish/cancel/destroy release interaction state through the same paths
as simple geometries.

## Types and compatibility

`GeometryFeature` now includes `MultiLineFeature` and `MultiPolygonFeature`.
`GeometryType` includes all supported GeoJSON names. `DrawGeometryType`
contains the simple types `draw()` creates. Consumers that previously used
`GeometryType` for drawing controls should use `DrawGeometryType` there and
handle the new variants in exhaustive geometry switches. Existing numeric
`editSelected(ringIndex)` calls still address component 0.

See the
[multipart benchmark](performance.md#multipart-geometries) for measured core costs
and the remaining performance limits.
