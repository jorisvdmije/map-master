# Alignment guides

Align a new point, an edited vertex or a moving selection with visible geometry.
Dashed guides show horizontal and vertical alignment and the extension of a
straight edge beyond its endpoints. Guides are opt-in and independent of ordinary
[snapping](geometry-editor.md#snapping-while-drawing).

```ts
import { EditorToolbar, GeometryEditor } from '@jorisvdmije/map-master';

const editor = new GeometryEditor(map, {
  alignmentGuides: { enabled: true, distance: 8 },
  keyboardShortcuts: { guides: [{ key: 'g' }] },
});
map.addControl(new EditorToolbar(editor, {
  tools: ['line', 'polygon', 'edit', 'guides', 'snapping', 'undo', 'redo'],
}));

editor.setAlignmentGuides({ horizontal: true, vertical: true, extensions: false });
const settings = editor.getAlignmentGuides(); // Independent complete settings.
const alignment = editor.getAlignment(); // Independent acquisition snapshot, or null.
```

## Using the guides

Enable **Alignment guides**, then draw a line or polygon, drag a vertex in an edit
session, or drag a selected shape. Markers, text anchors, template anchors and
two-click shapes use the same pointer alignment. For a moving selection, the
marked vertex of the grabbed feature is the anchor; every selected feature moves
by the same geographic offset. Locked geometry can supply references but cannot
be moved. Guides never modify the reference geometry.

Hold **Alt** to bypass both guides and ordinary snapping. Pressing or releasing
Alt, or changing guide settings, also updates a stationary pointer. **Escape**
rolls back a vertex or selection drag; cancelling a drawing discards its draft.
Saving an edit or releasing a selection drag retains the existing single Undo
step. Guide settings, references and overlays do not add history or exported
properties. Programmatic coordinates and keyboard vertex movements stay exact.

Guides use the canvas's **CSS pixels**, even with camera bearing, pitch or a high
device pixel ratio. Horizontal means horizontal on screen; it does not mean a
constant geographic latitude. Camera changes rebuild the projected reference
index. Color and opacity follow `appearance.snap.color` and `appearance.snap.opacity`.
The overlay ignores pointer events and is hidden from assistive technology; the
toolbar toggle supports keyboard focus and a configurable `guides` shortcut.
There is no default shortcut for this toggle.

## Tolerance and priority

`distance` is one radial tolerance for the acquired point, default **8 CSS pixels**.
Horizontal and vertical guides can combine when their intersection lies within
that radius. Otherwise the closest single horizontal, vertical or extension
guide wins; axes win equal-distance ties. A combined axis intersection takes
priority over an extension. Extensions apply beyond an edge's endpoints;
ordinary edge snapping owns the segment interior.

The existing ring-closing target, boundary attachments, ordinary vertex/edge
snapping and boundary tracing retain priority. Drawing angle constraints also
take priority after the first point. **Shift** during selection movement retains
its strict geographic axis constraint and bypasses guides and snapping. Freehand
drawing, lasso selection, rotation, scaling and buffer/offset handles do not use
alignment guides.

## Sources and bounded searches

Committed visible vertices supply axes. Extensions require both edge endpoints
within the viewport plus a 32-pixel margin. Multipart components and polygon
holes participate. The moving feature is excluded from the committed index;
vertex editing instead freezes stationary draft vertices, rings and inactive
parts at gesture start and excludes every moving vertex and incident edge.
A drawing uses its first point and last three placed points as draft references.
External basemap features participate in ordinary snapping only.

Sorted axis indexes and a capped extension grid avoid a full scan per pointer
query. Settings and diagnostics are public:

| Setting | Default | Accepted values |
| --- | --- | --- |
| `enabled` | `false` | boolean |
| `distance` | `8` | finite number greater than 0, at most 32 CSS pixels |
| `horizontal` | `true` | boolean |
| `vertical` | `true` | boolean |
| `extensions` | `true` | boolean |
| `maxCandidates` | `96` | integer from 6 through 512 |

Invalid patches throw before changing settings. `maxCandidates` limits the total
index entries inspected across committed and draft references and all enabled
guide types, excluding the logarithmic navigation of the sorted axis indexes.
The budget is divided among those searches. Extension buckets retain
at most 128 sources. Dense scenes may omit a closer source; acquisition reports
`limited: true` when a budget or bucket cap omits sources. There is no full-scan
fallback. Index construction is separate, proportional to the reference dataset
and its projected edges; it occurs after data/camera changes, not every movement.

`getAlignment()` returns `{ coordinate, distance, guides, examinedCandidates,
limited }` only while a guide is active. Each guide contains its `kind`,
`featureId`, vertex/edge `index`, optional committed `partIndex`/`ringIndex`, and
canvas-relative `start`/`end`. A null feature ID identifies a draft reference.
`getSnap()` and `onSnap` continue to report ordinary snapping. Poll
`getAlignment()` when your own interaction UI needs this separate information.

Guides clear after release, cancellation, blur or teardown. Style reloads retain
drawings and rebuild their visual previews; camera changes reproject sources and
cancel whole-selection drags. See the fixed-dataset measurements in
[performance notes](performance.md#alignment-guides).

The upstream scope was checked against Geoman's
[Snap Guides helper](https://geoman.io/docs/maplibre/helper-modes/helper-snap_guides)
on 2026-11-01. The API, precedence and explicit search limits above are Map
Master's contract.
