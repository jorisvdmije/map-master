# Fixed drawing angles

Enable **Fixed drawing angles** in the demo, then choose **45°** (axes and
diagonals) or **90°** (axes only). Place the first point normally. Each following
free pointer placement uses the nearest allowed direction from the last placed
point. This applies to drawing lines, polygons and polygon holes.

The direction grid follows east/west and north/south in the Mercator map plane.
It does not rotate with the screen, or align to the preceding segment. A 45° step
allows eight directions; a 90° step allows four. This is a placement aid, not a
promise that every angle of the saved geometry is 45° or 90°.

## Precedence and interaction

1. Clicking the first polygon corner closes the shape exactly, as before. The
   closing edge is not constrained, including when finishing with Enter.
2. Exact snapping to committed vertices/edges and boundary tracing take priority.
   They preserve the existing geometry even when the resulting segment is off-angle.
3. Otherwise the pointer follows the selected angle step from the last draft point.

Hold **Alt** to bypass both angle constraints and ordinary snapping/tracing.
Polygon click-to-close remains available within its normal small hit radius.
Turn snapping off when every newly placed segment must follow the direction grid.

Toggling constraints or changing the step updates the current pointer preview;
already placed points stay unchanged. Backspace uses the previous draft point as
the new anchor. A traced section still removes as one step. Preview and click use
the same resolver; clicking recalculates the endpoint from the current pointer.

Splitting, reshaping, vertex editing, moving, rotating, scaling, imported geometry
and programmatic coordinate commands remain unchanged. Explicit `traceBoundary`
calls keep their exact source geometry. Finishing still uses ordinary geometry
validation and records the existing create/edit history action. Cancel adds none.

## Public API

```ts
const editor = new GeometryEditor(map, {
  drawingConstraints: { enabled: true, angleStep: 45 },
});
editor.draw('LineString');
editor.setDrawingConstraints({ angleStep: 90 });
const options = editor.getDrawingConstraints();
editor.setDrawingConstraints({ enabled: false });
```

`DrawingConstraintsOptions` has `enabled: boolean` and `angleStep: 45 | 90`.
Defaults are `{ enabled: false, angleStep: 45 }`. Constructor and setter accept
partial options. Unsupported steps and nonboolean enablement throw TypeError
before changing options or mounting editor resources. Options are not retained
by reference; the getter returns an independent snapshot.

A changed `setDrawingConstraints` emits `onChange` and schedules a preview refresh.
An identical update emits nothing. Changing options does not alter dataRevision,
geometry, selection or history. Settings persist across tools, cancellation and
style replacement. Commands throw after destruction; the getter stays readable.
The LineEditor facade exposes the same options and getter/setter.

## Geometry and supported area

For longitude/latitude in radians, use x = λ and y = asinh(tan(φ)). Round the
anchor-to-pointer direction to the nearest multiple of the selected step and
preserve the projected radial distance. The inverse uses λ = x and
φ = atan(sinh(y)). Cardinal direction coefficients are exact; horizontal segments
keep the anchor latitude exactly and vertical segments keep its longitude exactly.
Floating-point roundoff still affects other coordinates. Exact half-step ties
choose the next direction counterclockwise in the north-positive plane.

These are Mercator directions/distances, not geodesic bearings or ground-distance
constraints. At nonzero pitch or bearing they need not look horizontal/vertical
on screen. Camera changes recalculate placement for the current screen pointer;
already placed coordinates do not change. No intermediate vertices are inserted.

Constrained anchor, pointer and output must be within longitude ±180° and latitude
±85.0511287798066°. Segments jumping more than 180° longitude are unsupported.
Unsupported constrained placement shows no candidate segment and a click adds no
point; move the pointer back, disable constraints or use Alt to return to the
ordinary drawing contract. No clamping or repair is performed. The first point,
exact snaps and explicit commands retain their existing coordinate policies.
Globe and terrain constraints are outside this first version.

The added calculation and anchor lookup are constant time per pointer resolution,
independent of draft size. Existing snapping, rendering and topology validation
have their own costs. See the [benchmark](performance.md#drawing-constraints).
