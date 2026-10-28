# Playground workflows and user guide

The full playground now keeps Finish/Apply/Save, Cancel, Undo/Redo and the current
operation's feedback in a fixed action bar. The map and action bar remain in the
viewport while the tool panel scrolls independently. The bar reserves a stable
height so longer status messages cannot resize the map and interrupt a gesture.
On narrow screens the map sits above the scrolling tool panel.

Run `npm run dev`, then open `http://127.0.0.1:5173/`. **How to use** opens the
[step-by-step user guide](../examples/basic/guide.html) in another tab so the
current drawing stays intact. Vite builds both the playground and guide for
static hosting. The guide is a user workflow reference; public API contracts
remain in [GeometryEditor](geometry-editor.md) and the individual operation guides.

## Finding tools

- **Draw geometry:** choose Line, Marker or Polygon, then start drawing.
- **Selection / Edit shape:** vertices, holes, reshape, split and shared boundaries.
- **Selection / Transform:** rotate, scale, simplify, buffer and line offsets.
- **Selection / Combine polygons:** merge, intersect and subtract.
- **Operation settings:** the active operation's controls appear at the beginning
  of the tool panel. The action bar names the operation and explains the preview
  or validation problem. Apply/Save/Finish and Cancel stay in the same place.
- **Your geometry:** import, direct examples, export and inspect GeoJSON.

The selection toolbar retains Edit, Copy, Delete, More tools and the overlap
chooser in a reserved strip below the canvas, so ordinary selection controls do
not cover clickable geometry. The overlap chooser expands above that strip when
needed. More tools scrolls to the selection panel and moves keyboard focus to
an available action. Disabled selection commands have visible reasons associated
through `aria-describedby`; the compact toolbar equivalents inherit those descriptions.
During an active operation, one shared notice explains that it must be finished
or cancelled first. Reasons follow the current selection, locks and ring choice.
Geometric eligibility that requires calculating a result is still checked by the
library, with failure feedback in the action bar.

## Examples

The example picker loads bundled GeoJSON directly, appending a batch with fresh
IDs and selecting it in source order. This preserves subtraction's first-target
semantics. It never clears existing work; repeating an example adds fresh shapes.
Each import is one Undo action. Example loading is disabled during an operation.
Instructions appear beside the picker and in the action bar after loading.
The existing overlap-color example remains in Object colors & overlap.

## Application and library boundary

This change only adds example UI and documentation. There are no public library
API, event, geometry, history or storage changes. Host applications can use their
own controls and do not inherit this layout. `WorkflowControls` reads public state
and describes the existing buttons; it does not become a second command validator.
`bindExampleControls` uses ordinary import, selection and map APIs.

The playground keeps its existing semantics: a completed whole-feature drag saves
on release; editing/transformation sessions require explicit Save/Apply; Cancel
discards the draft; Undo restores a completed change. Reloading does not retain
playground data. Export committed GeoJSON before leaving.

## Design references

Reviewed on 2026-10-27:

- [Geoman toolbar customization](https://geoman.io/docs/leaflet/customize/toolbar):
  separate control blocks and mode-associated finish/cancel actions informed the
  grouping and stable operation controls.
- [Geoman MapLibre documentation](https://geoman.io/docs/maplibre): a first-shape
  workflow followed by task-focused guides informed the local user guide.
- [QGIS editing documentation](https://doc.qgis.org/3.44/en/docs/user_manual/working_with_vector/editing_geometry_attributes.html):
  separate basic/advanced editing tools and operation panels informed the
  selection groups and contextual settings.

These are interaction references, not copied implementation or a promise of
identical semantics. For example, this playground applies an individual editing
session; it does not adopt QGIS's layer-wide save model.

## Verification

`tests/browser/demo-workflow.test.ts` covers stable map bounds, reachable commands
and feedback after scrolling at 1280, 1000, 760, 390 and 320 CSS pixels, cancellation,
Apply/Undo/Redo, selection/lock reasons, repeatable imports and every example.
Existing demo tests continue exercising actual draw/edit/transform controls.
The guide is included in the production build and checked through its served URL.
Viewport tests check responsive layout, not qualification of physical touch devices.
See [input scope](beta-budgets.md) for those limits.
