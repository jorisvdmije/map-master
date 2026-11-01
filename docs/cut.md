# Cut

Cut removes an area that the user draws from existing features. Polygons lose the
area inside the cut, lines lose the parts inside it, and markers are left alone.
Unlike [difference](difference.md), which subtracts existing polygons from each other,
the cut shape is drawn on the spot and is not kept.

Choose **Cut** in the [toolbar](toolbar.md), or call `drawCut()`:

```ts
editor.drawCut();      // Draw the cut polygon like any polygon.
// The user closes the ring on its first corner, presses Enter or chooses Apply.
const event = editor.finishCut(); // Or editor.finish().
```

## Which features are cut

- With a selection, only the selected features are cut. The selection stays
  highlighted while the cut is drawn.
- Without a selection, every unlocked feature that overlaps the cut is cut.
- [Locked features](feature-locks.md) are never cut. `drawCut()` returns false when
  the selection contains a locked feature.

## Results

- A polygon keeps its ID and properties. If the cut divides it, it becomes a
  `MultiPolygon`; use [Separate parts](multipart.md#separate-and-combine-parts) to
  turn the pieces into separate features.
- A line keeps its ID and properties. If the cut divides it, it becomes a
  `MultiLineString`. Line parts on the edge of the cut are kept.
- A feature that lies completely inside the cut is deleted.
- Features that do not overlap the cut are unchanged.

All changes are committed as one transaction: one `onTransaction` and one
`onDataChange` event with `source: 'transaction'`, and one Undo step. When the cut
overlaps nothing, the tool ends without changing data and `finishCut()` returns null.
If a result cannot be calculated, `finishCut()` returns null and the tool stays
active, so the cut can be corrected or cancelled.

## While drawing

The cut polygon is drawn like any polygon, with the same validation, snapping,
[tracing](tracing.md), [drawing constraints](drawing-constraints.md) and
[measurements](measurements.md). The state reports `mode: 'draw-cut'`. Backspace
removes the last point, Escape cancels.

## Limits

- Calculations use planar longitude/latitude coordinates, like the other polygon
  tools; the results are exact enough for the scale of a city or region.
- The cut polygon cannot have holes or cross the antimeridian.
