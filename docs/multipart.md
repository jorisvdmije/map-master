# Multipart lines and polygons

`GeometryEditor` supports 2D `MultiLineString` and `MultiPolygon` alongside
`LineString` and `Polygon`. A multipart feature has one ID and one properties
object. It stays multipart even with only one component. Component/ring order,
IDs and properties survive edits, translation, duplication, import/export and
Undo/Redo. Polygon winding is normalized at import and save: exterior CCW,
interior rings clockwise, preserving each first corner.

## Try it

In the demo, choose **Edit multipart geometry** under **Try an example**, then **Add example**.
Click either garden to select the complete `MultiPolygon`. Choose **Part to edit**,
then **Ring to edit** when the component contains holes, and choose **Edit vertices**.
Only that component/ring gets handles; the remaining components stay visible.
Save commits one complete feature update; Cancel discards it. The example also
contains a `MultiLineString` with two disconnected paths. Camera fitting includes
all imported components.

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

`draw()` still accepts only `LineString` or `Polygon`. Creating multipart drawings
interactively, adding/removing components, joining/exploding features and splitting
multipart features are subsequent tools. `splitSelected()` returns false for a
multipart feature while idle. Transactions can replace the complete geometry,
including changing its type or component count, subject to validation.

## Component and ring addresses

| Method/state | Meaning |
| --- | --- |
| `editSelected(ringIndex = 0, partIndex = 0)` | Edit one ring or line component. The first argument keeps its existing ring meaning. |
| `drawHole(partIndex = 0)` | Add a hole to the chosen Polygon/MultiPolygon component. |
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
uses `mode: 'edit-polygon'`. No new modes are added for multipart. All components
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
The demo displays that failure. Imported batches and transactions fail atomically,
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
`GeometryType` includes all four supported GeoJSON names. `DrawGeometryType`
contains only the two drawing-tool types. Consumers that previously used
`GeometryType` for drawing controls should use `DrawGeometryType` there and
handle the new variants in exhaustive geometry switches. Existing numeric
`editSelected(ringIndex)` calls still address component 0.

The legacy `LineEditor` facade remains a simple-LineString interface. Use
`GeometryEditor` for multipart integrations. See the
[multipart benchmark](performance.md#multipart-geometries) for measured core costs
and the remaining performance limits.
