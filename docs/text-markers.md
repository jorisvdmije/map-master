# Text markers

Text markers are GeoJSON Point features with plain, multiline text and persisted
styling. Create a label with `drawText()`, or import the documented properties
below. Ordinary `draw('Point')` markers keep their circle appearance.

```ts
import { EditorToolbar, GeometryEditor, isTextMarker } from '@jorisvdmije/map-master';

const editor = new GeometryEditor(map);
map.addControl(new EditorToolbar(editor, {
  tools: ['text', 'point', 'edit', 'duplicate', 'delete', 'undo', 'redo'],
}));

editor.drawText({ text: 'Meeting point\nNorth entrance', style: { fontSize: 20 } });
// Click to anchor the label. Finish/Enter commits; Escape cancels.
// Click elsewhere before Finish to reposition it.

// Later, select a label on the map and open an edit draft:
const selected = editor.getSelected();
if (selected && isTextMarker(selected)) {
  editor.editSelected();
  editor.setTextMarker({ text: 'South entrance', style: { color: '#175c4c' } });
  editor.moveVertex(0, [4.895, 52.372]);
  editor.finish(); // Text, styling and position are one undoable update.
}
```

## Placement and editing

Choose **Draw text**, click the map, and enter text in the toolbar panel. A label
stays in `draw-text` until Finish; merely placing it never commits an empty
feature. Text can be entered before or after placement. A second map click moves
the anchor. `getTextMarkerDraft()` returns an independent `{ text, style? }`
snapshot, or null outside a label draft. Repeating `drawText()` preserves the
current draft; starting another tool requires finishing or cancelling first.

Select a committed label and choose **Edit vertices** to change its text, size,
colors, weight or alignment. This uses `edit-point`, with one position at vertex
index 0. Drag the handle, use the existing keyboard vertex control, or call
`moveVertex(0, coordinate)`. Save commits all draft changes together; Cancel
discards all of them. An unchanged save produces no data event or history entry.
`setTextMarker()` patches only supplied text/style fields and validates the
whole patch before changing the draft. Use `applyTransaction()` to replace a
committed feature immediately, without a draft.

In the text field, Enter adds a newline, Ctrl/Command+Enter saves, and Escape
cancels. Composition input is left alone. These field editing keys are fixed,
like the toolbar's numeric-field keys. On the canvas, Finish and Cancel use the
current [configured shortcuts](keyboard-shortcuts.md). The optional `text`
shortcut activates this tool; it has no default binding:

```ts
editor.setKeyboardShortcuts({ text: [{ key: 't' }] });
```

## GeoJSON contract

`properties.mapMasterText` is reserved label metadata. Other properties, typed
IDs and the exact text (including whitespace, newlines and Unicode) survive
import/export, movement, duplication and history.

```json
{
  "type": "Feature",
  "id": "meeting-point",
  "geometry": { "type": "Point", "coordinates": [4.895, 52.372] },
  "properties": {
    "name": "Meeting point",
    "mapMasterText": {
      "text": "Meeting point\nNorth entrance",
      "style": {
        "color": "#172b3a",
        "backgroundColor": "#ffffff",
        "fontSize": 20,
        "fontWeight": "bold",
        "textAlign": "center"
      }
    }
  }
}
```

| Field | Accepted values | Default when omitted |
| --- | --- | --- |
| `text` | Required string, at most 2,000 UTF-16 code units; at least one non-whitespace character | None |
| `style.color` | `#RGB` or `#RRGGBB` | `#172b3a` |
| `style.backgroundColor` | `#RGB` or `#RRGGBB` | `#ffffff` |
| `style.fontSize` | Finite number, 8–96 CSS pixels | 16 |
| `style.fontWeight` | `normal` or `bold` | `normal` |
| `style.textAlign` | `left`, `center` or `right` | `center` |

`style` itself is optional. Unknown metadata/style fields and invalid values
reject the complete import or transaction with `GeoJSONImportError`, code
`invalid-properties`, at the feature's `properties.mapMasterText` path. Empty
text is permitted in drafts but disables Finish. The exported public types are
`TextMarkerFeature`, `TextMarkerOptions` and `TextMarkerStyle`; `isTextMarker()`
identifies labels in editor data.

## Selection, movement and locks

Click anywhere on the visible text box to select a label. Shift+click and the
overlap query include labels. Dragging a selected label from any part of its text
box moves it with an immediate text preview. Escape restores its original
position. Mixed group movement, arrow-key nudging, duplication, deletion,
snapping and host-owned locks follow the [point marker contracts](markers.md).
Locking a label during an edit cancels the entire draft; locked labels cannot be
edited or moved, and history cannot change them.

Rectangle selection intersects the visible label box. [Lasso selection](lasso.md)
uses the geographic Point anchor, like other Point features. Rotation and scaling
move label anchors; text remains upright at the same CSS size. Buffering a label
produces a polygon: the metadata is preserved but displayed only on Points.
Undo restores the original label. Application appearance settings for circle
markers do not override persisted text styling.

## Rendering and lifecycle

Labels use DOM text nodes above the canvas, with `textContent`; strings such as
`<img src=x onerror=...>` are displayed literally. HTML, arbitrary CSS and remote
font URLs are not accepted. Labels use the system font and require no basemap
glyph endpoint. Boxes wrap at 320 pixels or 80% of the map width and clip at 240
pixels high; the full text remains in GeoJSON. Text stays upright and centered
on its anchor as the camera moves, rotates or pitches. Overlapping labels remain
visible, in feature order, with the latest label on top.

Unlike ordinary circle markers, each text marker has a DOM element. This is
intended for annotations; no large-label dataset performance budget is claimed.
Labels and active edits survive style reloads. Destroying the editor or removing
the map removes its labels and camera listeners.

The scope follows Geoman's [documented text-layer workflow](https://geoman.io/docs/leaflet/modes/draw-mode),
including text entry and editing; this Point metadata contract belongs to Map Master.

Unit and real Chromium tests cover validation/atomic rollback, exact history,
round-trips, typing/composition, safe rendering, label-bound selection and drag,
locks, camera/style reloads and cleanup. The live example also exercises
download/import through the installed package.
