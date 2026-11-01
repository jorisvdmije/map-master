# Toolbar

`EditorToolbar` is a ready-made MapLibre control with buttons for drawing, editing,
the geometry tools, drawing aids, measurements and Undo/Redo. Add it to the map and users can
work with the whole editor without any UI code of your own.

```ts
import { EditorToolbar, GeometryEditor } from '@jorisvdmije/map-master';

const editor = new GeometryEditor(map, { snapping: { enabled: true } });
map.addControl(new EditorToolbar(editor), 'top-left');
```

## How it works

- Each button calls a public `GeometryEditor` method, and the toolbar follows
  `onChange`. Changes made through the API or your own controls show up in the
  toolbar as well.
- A tool is enabled only when it can start. Editing tools need a qualifying,
  unlocked selection; the [table below](#tools) lists the rules.
- The active tool is highlighted. A panel beside it offers **Finish**, **Save** or
  **Apply**, **Remove last point** while drawing or cutting, **Cancel**, and a number
  field for the buffer and offset distance, simplification tolerance, rotation angle
  or scale factor. In the field, Enter applies and Escape cancels.
- Rectangles, circles, ellipses, freehand shapes and markers complete themselves on the last
  click or when the pointer is released, so their panel has no Finish button.
- Pressing the active button again cancels the tool. Before the first point is
  placed, or during a union, difference or intersection preview, another tool can
  be chosen directly; otherwise finish or cancel first.
- The toolbar is one Tab stop. The arrow keys, Home and End move between buttons.
  The editor's map shortcuts (Enter, Escape, Delete, Ctrl+Z) work when the map has
  focus; after a mouse click on a tool, the map receives focus.

## Tools

Choose the buttons and their order with `tools`. Neighbouring buttons of the same
kind (drawing, editing, drawing aids, history) form a group.

```ts
new EditorToolbar(editor, { tools: ['polygon', 'line', 'edit', 'split', 'delete', 'undo', 'redo'] });
new EditorToolbar(editor, { tools: EditorToolbar.allTools });
```

Without `tools`, the toolbar shows `EditorToolbar.defaultTools`: `point`, `line`,
`polygon`, `edit`, `split`, `union`, `difference`, `rotate`, `scale`, `delete`,
`undo` and `redo`.

| Tool | Button | Calls | Enabled when the editor is idle and |
| --- | --- | --- | --- |
| `point` | Draw marker | `draw('Point')` | always |
| `line` | Draw line | `draw('LineString')` | always |
| `polygon` | Draw polygon | `draw('Polygon')` | always |
| `rectangle` | Draw rectangle | `draw('Rectangle')` | always |
| `circle` | Draw circle | `draw('Circle')` | always |
| `ellipse` | Draw ellipse | `draw('Ellipse')` | always |
| `freehand` | Draw freehand | `draw('Freehand')` | always |
| `hole` | Draw hole | `drawHole()` | one polygon or multipolygon is selected |
| `part` | Add part | `drawPart()` | one line or polygon is selected |
| `edit` | Edit vertices | `editSelected()` | one feature is selected |
| `split` | Split polygon | `splitSelected()` | one polygon is selected |
| `cut` | Cut | `drawCut()` | there are features; cuts the selection, or everything when nothing is selected |
| `reshape` | Reshape boundary | `reshapeSelected()` | one polygon without holes is selected |
| `shared-boundary` | Edit shared boundary | `editSharedBoundary()` | two polygons without holes are selected |
| `union` | Merge polygons | `unionSelection()` | two or more polygons are selected |
| `difference` | Subtract polygons | `differenceSelection()` | two or more polygons are selected |
| `intersection` | Intersect polygons | `intersectionSelection()` | two or more polygons are selected |
| `combine` | Combine into multipart | `combineSelection()` | two or more polygons, or two or more lines, are selected |
| `explode` | Separate parts | `explodeSelection()` | a multipart feature is selected |
| `rotate` | Rotate | `rotateSelection()` | something is selected |
| `scale` | Scale | `scaleSelection()` | something is selected |
| `buffer` | Buffer | `bufferSelection()` | something is selected |
| `offset` | Offset lines | `offsetSelection()` | only lines are selected |
| `simplify` | Simplify | `simplifySelection()` | a line or polygon is selected |
| `duplicate` | Duplicate | `duplicateSelection()` | something is selected; locked features may be copied |
| `delete` | Delete | `deleteSelection()` | something is selected |
| `snapping` | Snapping | `setSnapping()` | always; shows whether snapping is on |
| `constraints` | 45° angles | `setDrawingConstraints()` | always; shows whether constraints are on |
| `tracing` | Trace boundaries | `setTracing()` | always; turning it on also turns on snapping |
| `measure` | Measurements | `setMeasurements()` | always; shows whether [measurements](measurements.md) are on |
| `zoom` | Zoom to features | `zoomToFeatures()` | there are features; shows the selection, or everything |
| `undo` | Undo | `undo()` | `canUndo` |
| `redo` | Redo | `redo()` | `canRedo` |

Editing tools stay disabled while the selection contains a
[locked feature](feature-locks.md). Duplicates are placed 24 pixels to the right of
and below the originals.

A long list of tools may not fit on a small map. Split the buttons over two
toolbars, for example drawing and editing on the left and transformations, aids and
history on the right. Each toolbar shows the action panel for its own tools only, so
a mode started through your own UI never opens a panel. On small screens, make the
toolbars [collapsible](#collapse-on-small-maps).

```ts
map.addControl(new EditorToolbar(editor, { tools: ['point', 'line', 'polygon', 'edit', 'split', 'union'] }), 'top-left');
map.addControl(new EditorToolbar(editor, { tools: ['rotate', 'scale', 'buffer', 'snapping', 'undo', 'redo'] }), 'top-right');
```

## Add your own buttons

Application buttons appear in their own group after the built-in tools. They follow
the toolbar's style, keyboard navigation and tooltips:

```ts
const saveIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
saveIcon.setAttribute('viewBox', '0 0 24 24');
// ...add paths with createElementNS; the icon is cloned into the button.

new EditorToolbar(editor, {
  buttons: [
    {
      id: 'save',
      label: 'Save to server',
      icon: saveIcon,
      onClick: (editor) => { void save(editor.exportGeoJSON()); },
      enabled: (state) => state.mode === 'idle',
    },
    {
      id: 'satellite',
      label: 'Satellite imagery',
      onClick: () => { toggleSatellite(); },
      pressed: () => satelliteVisible,
    },
  ],
});
```

| Field | Meaning |
| --- | --- |
| `id` | Unique name, exposed as `data-tool`. It may not repeat a tool name. |
| `label` | Tooltip and accessible name. |
| `icon` | Optional element, usually an SVG, cloned into the button. Without one, the button shows the label's first letter. |
| `onClick(editor)` | Runs on click. |
| `enabled(state, editor)` | Optional; the button is disabled when it returns false. Called after every editor change. |
| `pressed(state, editor)` | Optional; makes the button a toggle with `aria-pressed`. |

Call your own state changes through the editor where possible, so `enabled` and
`pressed` are re-evaluated; otherwise they update on the next editor change.

## Collapse on small maps

`collapsible: true` adds a button at the top that hides and shows the other buttons.
Add `collapsed: true` to start hidden:

```ts
const small = map.getContainer().clientWidth < 640;
map.addControl(new EditorToolbar(editor, { collapsible: small, collapsed: small }));
```

## Translate the labels

Every tooltip and panel text can be replaced, for example to translate the toolbar:

```ts
new EditorToolbar(editor, {
  labels: { polygon: 'Vlak tekenen', finish: 'Klaar', apply: 'Toepassen', cancel: 'Annuleren' },
});
```

The keys are the tool names plus `toolbar` (the accessible name of the whole
toolbar), `finish`, `save`, `apply`, `cancel`, `removeLastPoint`, `distance`,
`tolerance`, `angle`, `factor`, `collapse` and `expand`. Unknown keys and non-string
values throw a `TypeError`, as do an empty, unknown or repeated `tools` entry and an
incomplete custom button.

## Style it

The toolbar adds its stylesheet to the page, or to the shadow root that contains the
map, when it is added to the map. It uses a constructed stylesheet, so it also works
under a Content Security Policy without `'unsafe-inline'`. Theme it with custom
properties:

```css
.mm-toolbar {
  --mm-toolbar-accent: #216447;
  --mm-toolbar-pressed: #e1f0e5;
}
```

| Property | Default | Used for |
| --- | --- | --- |
| `--mm-toolbar-accent` | `#2563eb` | Active button icon, primary action, focus ring |
| `--mm-toolbar-accent-text` | `#fff` | Text on the primary action |
| `--mm-toolbar-background` | `#fff` | Groups and panel |
| `--mm-toolbar-color` | `#1f2937` | Icons and text |
| `--mm-toolbar-muted` | `#6b7280` | Field labels |
| `--mm-toolbar-border` | `#e5e7eb` | Separators and field borders |
| `--mm-toolbar-hover` | `#f1f5f9` | Hovered buttons |
| `--mm-toolbar-pressed` | `#dbeafe` | Background of the active tool |
| `--mm-toolbar-danger` | `#dc2626` | Invalid field border |
| `--mm-toolbar-shadow` | `0 0 0 2px rgba(0, 0, 0, .1)` | Outline of groups and panel |
| `--mm-toolbar-radius` | `6px` | Corner radius |

For deeper changes, override the classes: `.mm-toolbar`, `.mm-toolbar-group`,
`.mm-toolbar-button` (with `data-tool` and `aria-pressed`), `.mm-toolbar-actions`,
`.mm-toolbar-action`, `.mm-toolbar-field` and `.mm-toolbar-letter` (the letter of a
custom button without an icon).

## Remove it

`map.removeControl(toolbar)` removes the element and stops listening to the editor.
Remove the toolbar before you call `editor.destroy()`, or remove the map, which
removes its controls.

## Build your own

The toolbar uses only the public API, so you can replace it with controls that fit
your application. Render from `editor.getState()` in an `onChange` listener, and call
the methods from the [table](#tools). [Drawing](../website/content/draw.md) shows the
pattern for a few buttons, and the [GeometryEditor reference](geometry-editor.md)
lists every method.
