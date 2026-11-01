# Rectangles, circles, ellipses and freehand shapes

Besides markers, lines and polygons, `draw()` creates four kinds of shapes that
are stored as ordinary `Polygon` features: rectangles, circles, ellipses and freehand
outlines. Use the **Draw rectangle**, **Draw circle**, **Draw ellipse** and **Draw
freehand** buttons of the [toolbar](toolbar.md), or call `draw()` yourself:

```ts
editor.draw('Rectangle'); // Click one corner, then the opposite corner.
editor.draw('Circle');    // Click the center, then a point on the edge.
editor.draw('Ellipse');   // Click the center, then a corner of its bounding box.
editor.draw('Freehand');  // Press, drag around the area and release.
```

| Shape | Interaction | Result |
| --- | --- | --- |
| `Rectangle` | Two clicks on opposite corners. | A four-corner polygon aligned with north and east. |
| `Circle` | Click the center, then a point on the edge. | A 64-corner polygon whose corners all lie at the same geodesic distance from the center. |
| `Ellipse` | Click the center, then a corner of the box around it. | A 64-corner polygon with the east–west and north–south radii up to that corner. |
| `Freehand` | Press, drag and release with a mouse, finger or pen. | A polygon that follows the pointer, simplified to within 1.5 screen pixels. |

The shape is created on the last click, or when the pointer is released, and
appears in `onCreate`, `onDataChange` and Undo like any drawn polygon. Escape or
`cancel()` discards it; Backspace or `removeLastDrawStep()` removes the first corner
or center of a rectangle, circle or ellipse. While one is being drawn, the editor's
state reports `mode: 'draw-rectangle'`, `'draw-circle'` or `'draw-ellipse'`, and
`vertexCount` is 1 after the first click. Freehand drawing reports
`mode: 'draw-freehand'`.

Snapping applies to both clicks of a rectangle, circle and ellipse, so a rectangle can start
exactly on the corner of another feature. Enable
[measurements](measurements.md) to see the width, height, radius and area while
drawing.

## What gets stored

GeoJSON has no rectangle, circle or ellipse type, so every shape is saved as a `Polygon` with
empty properties. Edit it afterwards like any other polygon: drag corners, reshape,
split or buffer it. Use [`measure()`](measurements.md#measure-in-your-own-code) to
read its size:

```ts
import { measure } from '@jorisvdmije/map-master';

editor.onCreate((feature) => {
  const { area } = measure(feature.geometry);
  console.log(`New feature ${feature.id}: ${Math.round(area)} m²`);
});
```

## Freehand details

- Dragging in freehand mode draws instead of panning the map, also with one finger
  on a touch screen; panning returns when the pointer is released. Use the scroll wheel or pinch to zoom while the tool is
  active.
- Outlines that cross themselves, which often happens where the end meets the start,
  are resolved into one simple polygon by keeping the largest enclosed area.
- A short drag that encloses no area creates nothing; the tool stays active.
- A click without dragging is ignored, and the click that ends a stroke never
  selects the new feature.

## Limits

- Circles and ellipses are polygons; their size changes if you edit or scale them like
  any other polygon. One that would cross the antimeridian or come within 0.1° of a
  pole is rejected, and the tool stays active.
- Rectangles and ellipses follow north and east even when the map is rotated.
- Freehand drawing does not snap or trace.
